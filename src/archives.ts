import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, open, readdir, readFile, rename, rm, stat, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createZstdCompress, createZstdDecompress, constants } from 'node:zlib';
import tar from 'tar-stream';
import type { RedTeamSnapshot, RedTeamTask } from './types.js';
import { initializeTaskManagement } from './task-management/index.js';
import type { TaskArchiveSupplement } from './session-archive.js';
import { withTrafficMutation } from './traffic-tools/mutation.js';
import { detachTaskAssets, remapTaskAssetReferences, restoreTaskAssets, taskAssets } from './shared-assets.js';

export interface ArchiveRecord {
  id: string; taskId: string;
  state: 'queued' | 'failed' | 'archive_queued' | 'archiving' | 'archive_failed' | 'ready' | 'restore_queued' | 'restoring' | 'restore_failed' | 'delete_queued' | 'deleting' | 'delete_failed';
  progress: number; phase?: string; error?: string; warnings?: string[];
  formatVersion?: number; archivePath?: string; sha256?: string;
  originalSize?: number; compressedSize?: number; taskTitle?: string; taskGoal?: string;
  originalStatus?: RedTeamTask['status']; dataCounts?: Record<string, number>;
  createdAt: string; updatedAt: string;
}

export interface ArchiveStore {
  readonly storagePath: string;
  load(): Promise<void>;
  snapshot(): RedTeamSnapshot;
  transaction<T>(mutator: (snapshot: RedTeamSnapshot) => T): Promise<T>;
}

export interface ArchiveFile { root: string; path: string }
export interface ArchiveOptions {
  dataDir: string;
  fileRoots?: Record<string, string>;
  sessions?: TaskArchiveSupplement;
  trafficBodies?: TaskArchiveSupplement;
  lifecycle: {
    quiesce(taskId: string): Promise<void>;
    files?(taskId: string, snapshot: RedTeamSnapshot): Promise<ArchiveFile[]>;
  };
}

const owned = ['nodes', 'edges', 'intents', 'findings', 'evidence', 'traces', 'approvals', 'goals', 'constraints', 'scopes', 'traffic', 'interceptRules', 'reports', 'taskAssetRules'] as const;
type OwnedCollection = typeof owned[number];
interface Manifest {
  format: 'dsh-redteam-task'; version: 1; taskId: string; createdAt: string;
  task: RedTeamTask;
  tables: Pick<RedTeamSnapshot, OwnedCollection | 'assets' | 'companies' | 'notificationEvents' | 'notificationDeliveries' | 'taskCategories' | 'taskTemplates'>;
  files: ArchiveFile[];
  sessions?: true;
  trafficBodies?: true;
}
interface Journal { archiveId: string; taskId: string; files: ArchiveFile[] }
const queues = new Map<string, Promise<unknown>>();

function safeSegment(value: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error(`invalid archive identifier: ${value}`);
  return value;
}
function inside(root: string, name: string): string {
  if (!name || isAbsolute(name) || name.includes('\\') || name.split('/').some((part) => !part || part === '.' || part === '..' || part.includes(':'))) throw new Error(`invalid archive path: ${name}`);
  const target = resolve(root, name);
  const rel = relative(root, target);
  if (!rel || rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) throw new Error(`archive path escapes root: ${name}`);
  return target;
}
async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}
async function rejectLinks(root: string, name: string): Promise<void> {
  let path = root;
  for (const part of name.split('/')) {
    path = join(path, part);
    try { if ((await lstat(path)).isSymbolicLink()) throw new Error(`archive path contains a symbolic link: ${path}`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  }
}
async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(value)); await file.sync(); } finally { await file.close(); }
}
async function digest(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

/** Streaming tar.zst, the same container and checksum scheme used by ARTEX.
 * The manifest is explicitly DSH-versioned; PostgreSQL ARTEX dumps are not interchangeable.
 */
async function packageFiles(path: string, payload: string): Promise<{ originalSize: number; compressedSize: number; sha256: string; warnings: string[] }> {
  const pack = tar.pack();
  let originalSize = 0;
  const warnings: string[] = [];
  const temporary = `${path}.partial`;
  const completion = pipeline(pack, createZstdCompress({ params: { [constants.ZSTD_c_compressionLevel]: 10, [constants.ZSTD_c_checksumFlag]: 1 } }), createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
  // Observe stream failures even when directory traversal has not finished.
  void completion.catch(() => {});
  async function walk(dir: string, prefix: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const source = join(dir, entry.name);
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      const info = await lstat(source);
      if (info.isSymbolicLink()) { warnings.push(`Skipped symbolic link: ${name}`); continue; }
      if (info.isDirectory()) {
        await new Promise<void>((accept, reject) => pack.entry({ name, type: 'directory', mode: 0o700 }, (error) => error ? reject(error) : accept()));
        await walk(source, name);
      } else if (info.isFile()) {
        originalSize += info.size;
        await pipeline(createReadStream(source), pack.entry({ name, type: 'file', size: info.size, mode: 0o600 }));
      } else throw new Error(`unsupported archive file: ${source}`);
    }
  }
  try {
    await walk(payload, '');
    pack.finalize();
    await completion;
    const file = await open(temporary, 'r+');
    try { await file.sync(); } finally { await file.close(); }
    await rename(temporary, path);
    return { originalSize, compressedSize: (await stat(path)).size, sha256: await digest(path), warnings };
  } catch (error) {
    pack.destroy(error instanceof Error ? error : new Error(String(error)));
    await completion.catch(() => {});
    await rm(temporary, { force: true });
    throw error;
  }
}

async function extractPackage(path: string, expected: string, destination: string): Promise<void> {
  if (await digest(path) !== expected) throw new Error('task archive checksum mismatch');
  const extract = tar.extract();
  let count = 0;
  let bytes = 0;
  const entries = new Set<string>();
  extract.on('entry', (header, stream, next) => {
    // tar-stream owns entry streams; route their failures to the awaited extraction pipeline.
    stream.on('error', (error: Error) => extract.destroy(error));
    void (async () => {
      count += 1; bytes += header.size ?? 0;
      if (count > 1_000_000 || bytes > 2 ** 47) throw new Error('task archive exceeds extraction limits');
      if (entries.has(header.name)) throw new Error(`duplicate archive entry: ${header.name}`);
      entries.add(header.name);
      const target = inside(destination, header.name);
      if (header.type === 'directory') { await mkdir(target, { recursive: true, mode: 0o700 }); stream.resume(); }
      else if (header.type === 'file') { await mkdir(dirname(target), { recursive: true, mode: 0o700 }); await pipeline(stream, createWriteStream(target, { flags: 'wx', mode: 0o600 })); }
      else throw new Error(`unsupported archive entry: ${header.type}`);
      next();
    })().catch((error: Error) => { stream.destroy(error); extract.destroy(error); });
  });
  await pipeline(createReadStream(path), createZstdDecompress(), extract);
}

function selectTask(snapshot: RedTeamSnapshot, taskId: string): Manifest {
  const task = snapshot.tasks.find((row) => row.id === taskId);
  if (!task) throw new Error(`task not found: ${taskId}`);
  const tables: Manifest['tables'] = {
    assets: taskAssets(snapshot, taskId),
    nodes: snapshot.nodes.filter((row) => row.taskId === taskId && row.kind !== 'asset'),
    edges: snapshot.edges.filter((row) => row.taskId === taskId),
    intents: snapshot.intents.filter((row) => row.taskId === taskId),
    findings: snapshot.findings.filter((row) => row.taskId === taskId),
    evidence: snapshot.evidence.filter((row) => row.taskId === taskId),
    traces: snapshot.traces.filter((row) => row.taskId === taskId),
    approvals: snapshot.approvals.filter((row) => row.taskId === taskId),
    goals: snapshot.goals.filter((row) => row.taskId === taskId),
    constraints: snapshot.constraints.filter((row) => row.taskId === taskId),
    scopes: snapshot.scopes.filter((row) => row.taskId === taskId),
    traffic: snapshot.traffic.filter((row) => row.taskId === taskId),
    interceptRules: snapshot.interceptRules.filter((row) => row.taskId === taskId),
    reports: snapshot.reports.filter((row) => row.taskId === taskId),
    taskAssetRules: snapshot.taskAssetRules.filter(row => row.taskId === taskId),
    taskTemplates: snapshot.taskTemplates.filter(row => row.id === task.templateId),
    taskCategories: [],
    companies: [],
    notificationEvents: snapshot.notificationEvents.filter((row) => row.snapshot.taskId === taskId),
    notificationDeliveries: [],
  };
  const events = new Set(tables.notificationEvents.map((row) => row.id));
  tables.notificationDeliveries = snapshot.notificationDeliveries.filter((row) => events.has(row.eventId));
  const companies = new Set([...tables.scopes.map((row) => row.companyId), ...tables.assets.map(row => row.companyId), ...(task.companyIds ?? [])]);
  tables.companies = snapshot.companies.filter((row) => companies.has(row.id));
  const categories = new Set([task.categoryId, ...tables.taskTemplates.map(template => template.categoryId)]);
  tables.taskCategories = snapshot.taskCategories.filter(category => categories.has(category.id));
  return { format: 'dsh-redteam-task', version: 1, taskId, task: structuredClone(task), tables: structuredClone(tables), createdAt: new Date().toISOString(), files: [] };
}
function validateManifest(value: unknown, job: ArchiveRecord): asserts value is Manifest {
  if (!value || typeof value !== 'object') throw new Error('invalid archive manifest');
  const data = value as Partial<Manifest>;
  if (data.format !== 'dsh-redteam-task' || data.version !== 1 || data.taskId !== job.taskId || data.task?.id !== job.taskId || !data.tables || !Array.isArray(data.files)) throw new Error('task archive format or identity mismatch');
  if (data.sessions !== undefined && data.sessions !== true) throw new Error('invalid archive session marker');
  if (data.trafficBodies !== undefined && data.trafficBodies !== true) throw new Error('invalid archive traffic body marker');
  // v1 packages written before task management had no such tables or references.
  data.tables.taskAssetRules ??= []; data.tables.taskCategories ??= []; data.tables.taskTemplates ??= [];
  for (const key of [...owned, 'assets', 'companies', 'taskCategories', 'taskTemplates'] as const) {
    const rows = data.tables[key];
    if (!Array.isArray(rows)) throw new Error(`invalid archive table: ${key}`);
    const ids = new Set<string>();
    for (const row of rows) {
      if (!row || typeof row !== 'object' || typeof row.id !== 'string' || ids.has(row.id) || ((owned as readonly string[]).includes(key) && (!('taskId' in row) || row.taskId !== job.taskId))) throw new Error(`invalid archive row: ${key}`);
      ids.add(row.id);
    }
  }
  for (const asset of data.tables.assets) {
    if (typeof asset.taskId !== 'string' || typeof asset.kind !== 'string' || typeof asset.value !== 'string' || !asset.metadata || typeof asset.metadata !== 'object' || Array.isArray(asset.metadata)) throw new Error('invalid archive asset');
  }
  const categories = new Set(data.tables.taskCategories.map(row => row.id));
  if (data.task.categoryId && !categories.has(data.task.categoryId)) throw new Error('archive task category reference is missing');
  if (data.task.templateId && !data.tables.taskTemplates.some(row => row.id === data.task!.templateId)) throw new Error('archive task template reference is missing');
  if (data.tables.taskTemplates.some(row => row.categoryId && !categories.has(row.categoryId))) throw new Error('archive template category reference is missing');
  initializeTaskManagement({ tasks: [data.task], ...data.tables });
  if (!Array.isArray(data.tables.notificationEvents) || !Array.isArray(data.tables.notificationDeliveries)) throw new Error('invalid archive notification tables');
  const events = new Set<string>();
  for (const event of data.tables.notificationEvents) {
    if (!event || typeof event.id !== 'string' || events.has(event.id) || event.snapshot?.taskId !== job.taskId) throw new Error('invalid archive notification event');
    events.add(event.id);
  }
  const deliveries = new Set<string>();
  for (const delivery of data.tables.notificationDeliveries) {
    if (!delivery || typeof delivery.id !== 'string' || deliveries.has(delivery.id) || !events.has(delivery.eventId)) throw new Error('invalid archive notification delivery');
    deliveries.add(delivery.id);
  }
}

function restoreTaskReferences(state: RedTeamSnapshot, manifest: Manifest): void {
  const categoryIds = new Map<string, string>();
  for (const category of manifest.tables.taskCategories) {
    const byId = state.taskCategories.find(row => row.id === category.id);
    if (byId && byId.name !== category.name) throw new Error(`restore category id conflict: ${category.id}`);
    const existing = byId ?? state.taskCategories.find(row => row.name.toLowerCase() === category.name.toLowerCase());
    if (existing) categoryIds.set(category.id, existing.id);
    else { state.taskCategories.push(structuredClone(category)); categoryIds.set(category.id, category.id); }
  }
  if (manifest.task.categoryId) manifest.task.categoryId = categoryIds.get(manifest.task.categoryId)!;
  const templateIds = new Map<string, string>();
  const signature = (row: RedTeamSnapshot['taskTemplates'][number]) => JSON.stringify({ name: row.name.toLowerCase(), description: row.description, goal: row.goal, categoryId: row.categoryId, interceptRules: row.interceptRules });
  for (const source of manifest.tables.taskTemplates) {
    const template = structuredClone(source);
    if (template.categoryId) template.categoryId = categoryIds.get(template.categoryId)!;
    const existing = state.taskTemplates.find(row => row.id === template.id) ?? state.taskTemplates.find(row => row.name.toLowerCase() === template.name.toLowerCase());
    if (existing && signature(existing) !== signature(template)) throw new Error(`restore template reference conflict: ${template.id}`);
    if (existing) templateIds.set(template.id, existing.id);
    else { state.taskTemplates.push(template); templateIds.set(template.id, template.id); }
  }
  if (manifest.task.templateId) manifest.task.templateId = templateIds.get(manifest.task.templateId)!;
}

export class ArchiveRuntime {
  private readonly root: string;
  private readonly roots: Record<string, string>;
  constructor(private readonly store: ArchiveStore, private readonly options: ArchiveOptions) {
    this.root = resolve(options.dataDir, 'archives', 'tasks');
    this.roots = { data: resolve(options.dataDir), ...Object.fromEntries(Object.entries(options.fileRoots ?? {}).map(([key, path]) => [safeSegment(key), resolve(path)])) };
  }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const key = process.platform === 'win32' ? this.root.toLowerCase() : this.root;
    const previous = queues.get(key) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(action);
    queues.set(key, current);
    void current.finally(() => { if (queues.get(key) === current) queues.delete(key); }).catch(() => {});
    return current;
  }
  private job(id: string): ArchiveRecord {
    const job = this.store.snapshot().archives.find((row) => row.id === id);
    if (!job) throw new Error(`archive not found: ${id}`);
    return job;
  }
  private async patch(id: string, patch: Partial<ArchiveRecord>): Promise<void> {
    await this.store.transaction((state) => {
      const row = state.archives.find((item) => item.id === id);
      if (!row) throw new Error(`archive not found: ${id}`);
      Object.assign(row, patch, { updatedAt: new Date().toISOString() });
    });
  }
  private source(file: ArchiveFile): string {
    const root = this.roots[safeSegment(file.root)];
    if (!root) throw new Error(`archive file root is not configured: ${file.root}`);
    return inside(root, file.path);
  }
  private staged(stage: string, file: ArchiveFile): string { return inside(stage, `payload/files/${safeSegment(file.root)}/${file.path}`); }
  private packagePath(id: string): string { return join(this.root, `${safeSegment(id)}.tar.zst`); }
  private async rollback(stage: string, journal: Journal, restore: boolean): Promise<void> {
    const errors: unknown[] = [];
    for (const file of [...journal.files].reverse()) {
      const live = this.source(file), staged = this.staged(stage, file);
      const source = restore ? live : staged, destination = restore ? staged : live;
      try {
        // Both present means this move never ran, or a destination appeared independently.
        // Never overwrite either side. For restore, pre-existing live files are left untouched.
        if (!await exists(source)) continue;
        if (await exists(destination)) { if (!restore) throw new Error(`archive rollback destination exists: ${destination}`); continue; }
        await mkdir(dirname(destination), { recursive: true });
        await rename(source, destination);
      } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'task archive rollback failed');
    await rm(stage, { recursive: true, force: true });
  }

  archive(taskId: string): Promise<ArchiveRecord> { return this.serial(async () => {
    safeSegment(taskId); await this.store.load();
    const job = await this.store.transaction((state) => {
      const task = state.tasks.find((row) => row.id === taskId);
      if (!task) throw new Error(`task not found: ${taskId}`);
      if (!['paused', 'done', 'failed', 'timeout'].includes(task.status)) throw new Error('task must be paused or terminal before archiving');
      const previous = state.archives.find((row) => row.taskId === taskId);
      if (previous && !['failed', 'queued', 'archive_failed', 'archive_queued'].includes(previous.state)) throw new Error(`task archive state does not allow archiving: ${previous.state}`);
      const now = new Date().toISOString();
      const result: ArchiveRecord = { id: previous?.id ?? randomUUID(), taskId, state: 'archive_queued', phase: 'queued', progress: 0, warnings: [], taskTitle: task.title, taskGoal: task.goal, originalStatus: task.status, formatVersion: 1, createdAt: previous?.createdAt ?? now, updatedAt: now };
      if (previous) Object.assign(previous, result, { error: undefined }); else state.archives.push(result);
      return result;
    });
    await this.runArchive(job.id);
    return this.job(job.id);
  }); }

  private async runArchive(id: string): Promise<void> {
    let prepared: { release(): Promise<void> } | undefined;
    try {
      await this.patch(id, { state: 'archiving', phase: 'quiesce', progress: 1, error: undefined });
      prepared = await this.options.sessions?.prepare?.(this.job(id).taskId, 'archive');
      // Capture writers may need the traffic lock while stopping. Drain them first.
      await this.options.lifecycle.quiesce(this.job(id).taskId);
      await withTrafficMutation(this.store.storagePath, () => this.archiveQuiesced(id));
    } catch (error) {
      if (this.job(id).state !== 'ready') await this.patch(id, { state: 'archive_failed', error: String(error) });
      throw error;
    } finally {
      await prepared?.release();
    }
  }

  private async archiveQuiesced(id: string): Promise<void> {
    const job = this.job(id);
    const stage = join(this.root, '.staging', safeSegment(id));
    let journal: Journal | undefined;
    let committed = false;
    try {
      const snapshot = this.store.snapshot();
      if (snapshot.intents.some((row) => row.taskId === job.taskId && ['claimed', 'running'].includes(row.state))) throw new Error('task still has running workers');
      const manifest = selectTask(snapshot, job.taskId);
      if (!['paused', 'done', 'failed', 'timeout'].includes(manifest.task.status)) throw new Error('task must remain paused or terminal while archiving');
      if (manifest.tables.notificationDeliveries.some((delivery) => delivery.state === 'sending')) throw new Error('task has notification deliveries in flight; retry archiving after delivery settles');
      const files = await this.options.lifecycle.files?.(job.taskId, snapshot) ?? [];
      const defaultFile = { root: 'data', path: `tasks/${job.taskId}` };
      if (await exists(this.source(defaultFile))) files.unshift(defaultFile);
      const names = new Set<string>();
      for (const file of files) {
        const source = this.source(file);
        const key = `${file.root}/${file.path}`;
        if ([...names].some((name) => key === name || key.startsWith(`${name}/`) || name.startsWith(`${key}/`))) throw new Error(`overlapping archive file roots: ${key}`);
        names.add(key);
        await rejectLinks(this.roots[file.root], file.path);
        if (!await exists(source)) throw new Error(`archive source missing: ${source}`);
        const relativeToArchive = relative(source, this.root);
        if (source === this.root || (relativeToArchive && !relativeToArchive.startsWith('..') && !isAbsolute(relativeToArchive))) throw new Error('archive source contains the archive directory');
      }
      journal = { archiveId: id, taskId: job.taskId, files };
      await writeJson(join(stage, 'journal.json'), journal);
      await this.patch(id, { phase: 'stage_files', progress: 10 });
      for (const file of files) { const target = this.staged(stage, file); await mkdir(dirname(target), { recursive: true }); await rename(this.source(file), target); }
      await this.patch(id, { phase: 'snapshot_database', progress: 20 });
      manifest.files = files;
      if (this.options.sessions) {
        await this.options.sessions.capture(join(stage, 'payload', 'sessions'), job.taskId, snapshot);
        manifest.sessions = true;
      }
      if (this.options.trafficBodies) {
        await this.options.trafficBodies.capture(join(stage, 'payload', 'traffic-bodies'), job.taskId, snapshot);
        manifest.trafficBodies = true;
      }
      await writeJson(join(stage, 'payload', 'manifest.json'), manifest);
      await this.patch(id, { phase: 'compress', progress: 50 });
      await mkdir(this.root, { recursive: true });
      const metadata = await packageFiles(this.packagePath(id), join(stage, 'payload'));
      await this.patch(id, { phase: 'compact_database', progress: 78 });
      await this.store.transaction((state) => {
        const current = selectTask(state, job.taskId);
        if (JSON.stringify(current.task) !== JSON.stringify(manifest.task) || JSON.stringify(current.tables) !== JSON.stringify(manifest.tables)) throw new Error('task changed while archiving');
        detachTaskAssets(state, job.taskId, { deleteExclusive: true, preserveCompanyAssets: true, candidates: new Set(manifest.tables.assets.map(asset => asset.id)) });
        for (const key of owned) { const rows = state[key]; for (let index = rows.length - 1; index >= 0; index--) if (rows[index].taskId === job.taskId) rows.splice(index, 1); }
        const events = new Set(manifest.tables.notificationEvents.map((event) => event.id));
        state.notificationEvents = state.notificationEvents.filter((event) => !events.has(event.id));
        state.notificationDeliveries = state.notificationDeliveries.filter((delivery) => !events.has(delivery.eventId));
        state.tasks.splice(state.tasks.findIndex((task) => task.id === job.taskId), 1);
        const row = state.archives.find((item) => item.id === id)!;
        Object.assign(row, metadata, { state: 'ready', phase: 'ready', progress: 100, archivePath: this.packagePath(id), dataCounts: Object.fromEntries(Object.entries(manifest.tables).map(([key, rows]) => [key, rows.length])), updatedAt: new Date().toISOString() });
      });
      committed = true;
      try { await rm(stage, { recursive: true, force: true }); }
      catch (error) { await this.patch(id, { warnings: [...metadata.warnings, `Archive committed; staging cleanup failed: ${String(error)}`] }); }
    } catch (error) {
      if (committed) throw error;
      const errors = [error];
      if (journal) await this.rollback(stage, journal, false).catch((failure) => errors.push(failure));
      await rm(this.packagePath(id), { force: true }).catch((failure) => errors.push(failure));
      const failure = errors.length === 1 ? error : new AggregateError(errors, 'task archiving and rollback failed');
      await this.patch(id, { state: 'archive_failed', error: String(failure) });
      throw failure;
    }
  }

  restore(id: string): Promise<string[]> { return this.serial(async () => {
    await this.store.load();
    const job = this.job(id);
    if (!['ready', 'restore_failed', 'restore_queued', 'restoring'].includes(job.state)) throw new Error(`task archive state does not allow restoring: ${job.state}`);
    await this.patch(id, { state: 'restore_queued', error: undefined });
    return this.runRestore(id);
  }); }

  private async runRestore(id: string): Promise<string[]> {
    let prepared: { release(): Promise<void> } | undefined;
    try { prepared = await this.options.sessions?.prepare?.(this.job(id).taskId, 'restore'); }
    catch (error) { await this.patch(id, { state: 'restore_failed', error: String(error) }); throw error; }
    try { return await withTrafficMutation(this.store.storagePath, () => this.restoreLocked(id)); }
    finally { await prepared?.release(); }
  }

  private async restoreLocked(id: string): Promise<string[]> {
    const job = this.job(id);
    const stage = join(this.root, '.restore', safeSegment(id));
    let journal: Journal | undefined;
    let committed = job.phase === 'consume_package';
    try {
      if (!committed) {
        if (!job.sha256) throw new Error('archive has no checksum');
        if (job.archivePath !== this.packagePath(id)) throw new Error('archive package path does not match managed path');
        await this.patch(id, { state: 'restoring', phase: 'verify_package', progress: 10, error: undefined });
        await mkdir(join(stage, 'payload'), { recursive: true });
        await extractPackage(this.packagePath(id), job.sha256, join(stage, 'payload'));
        const manifest: unknown = JSON.parse(await readFile(join(stage, 'payload', 'manifest.json'), 'utf8'));
        validateManifest(manifest, job);
        if (manifest.sessions) {
          if (!this.options.sessions) throw new Error('task archive requires DSH session persistence to restore');
          await this.patch(id, { phase: 'restore_sessions', progress: 35 });
          await this.options.sessions.restore(join(stage, 'payload', 'sessions'), job.taskId);
        }
        if (manifest.trafficBodies) {
          if (!this.options.trafficBodies) throw new Error('task archive requires traffic body storage to restore');
          await this.options.trafficBodies.restore(join(stage, 'payload', 'traffic-bodies'), job.taskId);
        }
        const names = new Set<string>();
        for (const file of manifest.files) {
          const target = this.source(file);
          const name = `${file.root}/${file.path}`;
          if ([...names].some((value) => name === value || name.startsWith(`${value}/`) || value.startsWith(`${name}/`))) throw new Error(`overlapping archive paths: ${name}`);
          names.add(name);
          await rejectLinks(this.roots[file.root], file.path);
          if (await exists(target)) throw new Error(`restore destination already exists: ${target}`);
          if (!await exists(this.staged(stage, file))) throw new Error(`archive payload missing: ${name}`);
        }
        journal = { archiveId: id, taskId: job.taskId, files: manifest.files };
        await writeJson(join(stage, 'journal.json'), journal);
        await this.patch(id, { phase: 'restore_files', progress: 55 });
        for (const file of manifest.files) { const target = this.source(file); await mkdir(dirname(target), { recursive: true }); await rename(this.staged(stage, file), target); }
        await this.patch(id, { phase: 'restore_database', progress: 70 });
        await this.store.transaction((state) => {
          if (state.tasks.some((task) => task.id === job.taskId)) throw new Error(`restore task already exists: ${job.taskId}`);
          restoreTaskReferences(state, manifest);
          const restoredAssets = restoreTaskAssets(state, job.taskId, manifest.tables.assets);
          remapTaskAssetReferences(manifest.tables, restoredAssets.mapping);
          for (const key of [...owned, 'notificationEvents', 'notificationDeliveries'] as const) {
            const rows = state[key] as Array<{ id: string }>;
            const ids = new Set(rows.map((row) => row.id));
            if (manifest.tables[key].some((row) => ids.has(row.id))) throw new Error(`restore row id conflict: ${key}`);
            rows.push(...structuredClone(manifest.tables[key]));
          }
          state.tasks.push(manifest.task);
          const companies = new Set(state.companies.map((company) => company.id));
          state.companies.push(...manifest.tables.companies.filter((company) => !companies.has(company.id)));
          const row = state.archives.find((item) => item.id === id)!;
          Object.assign(row, { phase: 'consume_package', progress: 95, warnings: [...(row.warnings ?? []), ...restoredAssets.warnings], updatedAt: new Date().toISOString() });
        });
        committed = true;
      }
      await rm(stage, { recursive: true, force: true });
      await rm(this.packagePath(id), { force: true });
      const warnings = this.job(id).warnings ?? [];
      await this.store.transaction((state) => { const index = state.archives.findIndex((row) => row.id === id); if (index >= 0) state.archives.splice(index, 1); });
      return warnings;
    } catch (error) {
      const errors = [error];
      if (!committed) {
        if (journal) await this.rollback(stage, journal, true).catch((failure) => errors.push(failure));
        else await rm(stage, { recursive: true, force: true }).catch((failure) => errors.push(failure));
      }
      const failure = errors.length === 1 ? error : new AggregateError(errors, 'task restore and rollback failed');
      await this.patch(id, { state: 'restore_failed', error: String(failure) });
      throw failure;
    }
  }

  delete(id: string): Promise<void> { return this.serial(async () => {
    await this.store.load(); const job = this.job(id);
    if (!['ready', 'restore_failed', 'delete_failed', 'delete_queued', 'deleting'].includes(job.state) || job.phase === 'consume_package') throw new Error(`task archive state does not allow deleting: ${job.state}`);
    await this.runDelete(id);
  }); }
  private async runDelete(id: string): Promise<void> {
    const path = this.packagePath(id), staged = `${path}.deleting`;
    try {
      await this.patch(id, { state: 'deleting', phase: 'stage_package_delete', progress: 35, error: undefined });
      if (await exists(path)) { if (await exists(staged)) throw new Error('both archive package and delete stage exist'); await rename(path, staged); }
      await this.store.transaction((state) => { const index = state.archives.findIndex((row) => row.id === id); if (index < 0) throw new Error(`archive not found: ${id}`); state.archives.splice(index, 1); });
    } catch (error) {
      if (await exists(staged) && !await exists(path)) await rename(staged, path);
      await this.patch(id, { state: 'delete_failed', error: String(error) });
      throw error;
    }
    await rm(staged, { force: true });
  }

  /** Resolve journaled file moves before resuming durable queued operations. */
  recover(): Promise<void> { return this.serial(async () => {
    await this.store.load();
    for (const kind of ['.staging', '.restore']) {
      const parent = join(this.root, kind);
      if (!await exists(parent)) continue;
      for (const entry of await readdir(parent, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const stage = join(parent, safeSegment(entry.name));
        const job = this.store.snapshot().archives.find((row) => row.id === entry.name);
        if (!await exists(join(stage, 'journal.json'))) { await rm(stage, { recursive: true, force: true }); continue; }
        const journal = JSON.parse(await readFile(join(stage, 'journal.json'), 'utf8')) as Journal;
        if (journal.archiveId !== entry.name || !Array.isArray(journal.files)) throw new Error('invalid archive recovery journal');
        if ((kind === '.staging' && job?.state === 'ready') || (kind === '.restore' && (!job || job.phase === 'consume_package'))) await rm(stage, { recursive: true, force: true });
        else await this.rollback(stage, journal, kind === '.restore');
      }
    }
    if (await exists(this.root)) for (const entry of await readdir(this.root)) {
      if (entry.endsWith('.tar.zst.deleting')) {
        const id = entry.slice(0, -'.tar.zst.deleting'.length), path = this.packagePath(id);
        if (!this.store.snapshot().archives.some((row) => row.id === id)) await unlink(join(this.root, entry));
        else if (!await exists(path)) await rename(join(this.root, entry), path);
      }
    }
    for (const job of this.store.snapshot().archives) {
      if (['queued', 'archive_queued', 'archiving'].includes(job.state)) { await rm(this.packagePath(job.id), { force: true }); await rm(`${this.packagePath(job.id)}.partial`, { force: true }); await this.runArchive(job.id); }
      else if (['restore_queued', 'restoring'].includes(job.state) || job.phase === 'consume_package') await this.runRestore(job.id);
      else if (['delete_queued', 'deleting'].includes(job.state)) await this.runDelete(job.id);
    }
  }); }
}
