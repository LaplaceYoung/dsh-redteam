import { mkdir, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { syncRecordGraph } from './graph.js';
import { withTrafficMutation } from './traffic-tools/mutation.js';
import { associateTaskAsset } from './shared-assets.js';
import { assertFindingWritable, validateFindingInput, validateFindingUpdate } from './findings-reports/runtime.js';
import type { FindingPatch } from './findings-reports/types.js';
import { notificationSettingsPatch } from './notification-settings.js';
import * as taskManagement from './task-management/index.js';
import { assertAssetInsertionAllowed, assertIntentAssetsAllowed, initialGlobalAssetRules, listGlobalAssetRules, validateGlobalAssetRules, type GlobalAssetRule } from './task-asset-runtime.js';
import { recordNotificationEvent, snapshotForFinding, validateNotificationFilter, validateNotificationChannel, prepareNotificationConfigUpdate } from './notifications.js';
import type { Approval, Asset, Company, Constraint, Evidence, Finding, Goal, GraphEdge, GraphNode, Intent, InterceptRule, NotificationChannel, RedTeamSnapshot, RedTeamTask, Report, ScopeEntry, TaskArchive, TaskStatus, TrafficRecord, WorkerTrace } from './types.js';

const emptySnapshot = (): RedTeamSnapshot => ({ notificationSettings: {}, assetInterceptRules: initialGlobalAssetRules(), ...taskManagement.emptyTaskManagement(), version: 0, tasks: [], assets: [], nodes: [], edges: [], intents: [], findings: [], evidence: [], traces: [], approvals: [], goals: [], constraints: [], scopes: [], traffic: [], interceptRules: [], archives: [], reports: [], notificationChannels: [], notificationEvents: [], notificationDeliveries: [], companies: [] });

interface StoreBackend {
  state: RedTeamSnapshot;
  loadPromise?: Promise<void>;
  writeChain: Promise<void>;
}

// UI, session agents and in-process workers must share one committed state and writer.
const backends = new Map<string, WeakRef<StoreBackend>>();

function requireTask(state: RedTeamSnapshot, taskId: string): void {
  if (!state.tasks.some((task) => task.id === taskId)) throw new Error(`task not found or archived: ${taskId}`);
}

export class RedTeamStore {
  private readonly backend: StoreBackend;
  private readonly filePath: string;

  constructor(configuredPath?: string) {
    const value = configuredPath ?? resolve(process.env.DSH_HOME ?? resolve(homedir(), '.dsh'), 'storages', 'redteam.json');
    this.filePath = resolve(value.startsWith('~/') ? `${homedir()}/${value.slice(2)}` : value);
    const key = process.platform === 'win32' ? this.filePath.toLowerCase() : this.filePath;
    this.backend = backends.get(key)?.deref() ?? { state: emptySnapshot(), writeChain: Promise.resolve() };
    backends.set(key, new WeakRef(this.backend));
  }

  load(): Promise<void> {
    return this.backend.loadPromise ??= this.loadFromDisk().catch((error: unknown) => {
      this.backend.loadPromise = undefined;
      throw error;
    });
  }

  private async loadFromDisk(): Promise<void> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.filePath, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { tasks?: unknown }).tasks)) throw new Error('invalid redteam store');
      const loaded = { ...emptySnapshot(), ...(parsed as Partial<RedTeamSnapshot>) };
      validateGlobalAssetRules(loaded.assetInterceptRules);
      loaded.notificationSettings = notificationSettingsPatch(loaded.notificationSettings);
      taskManagement.initializeTaskManagement(loaded);
      syncRecordGraph(loaded);
      this.backend.state = loaded;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  snapshot(): RedTeamSnapshot { return structuredClone(this.backend.state); }
  /** Shared atomic transaction for domain runtimes; publish only after durable write. */
  async transaction<T>(mutator: (state: RedTeamSnapshot) => T): Promise<T> {
    let result!: T;
    await this.commit((state) => { result = mutator(state); });
    return structuredClone(result);
  }

  get storagePath(): string { return this.filePath; }
  private async commit(mutator: (state: RedTeamSnapshot) => void): Promise<void> {
    const operation = this.backend.writeChain.then(async () => {
      await this.load();
      const next = structuredClone(this.backend.state);
      mutator(next);
      syncRecordGraph(next);
      next.version += 1;
      const serialized = JSON.stringify(next, null, 2);
      await mkdir(dirname(this.filePath), { recursive: true });
      const temp = `${this.filePath}.${randomUUID()}.tmp`;
      try {
        await writeFile(temp, serialized, 'utf8');
        await rename(temp, this.filePath);
      } finally {
        await unlink(temp).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
      }
      this.backend.state = JSON.parse(serialized) as RedTeamSnapshot;
    });
    // The caller receives the failure; subsequent transactions can still run.
    this.backend.writeChain = operation.catch(() => {});
    await operation;
  }

  async createTask(title: string, goal: string): Promise<RedTeamTask> {
    return this.createManagedTask({ title, goal });
  }

  async createManagedTask(input: taskManagement.NewTaskInput, availableProfileIds: ReadonlySet<string> = new Set()): Promise<RedTeamTask> {
    return this.transaction(state => {
      const now = new Date(), at = now.toISOString();
      const task: RedTeamTask = taskManagement.createManagedTask(state, input, now, state.companies.map(c => c.id), availableProfileIds);
      if (input.templateId) task.templateId = input.templateId;
      const origin = { id: randomUUID(), taskId: task.id, kind: 'fact' as const, label: task.description || task.title, data: { origin: true, goal: task.goal } };
      state.nodes.push(origin);
      if (task.seedFirstIntent) {
        const intent = { id: randomUUID(), taskId: task.id, summary: `完成任务目标：${task.goal}（任务：${task.description}）`, state: 'open' as const, input: { seed: true }, createdAt: at, updatedAt: at };
        state.intents.push(intent); state.edges.push({ id: randomUUID(), taskId: task.id, from: origin.id, to: intent.id, relation: 'derived_from' });
      }
      const companyIds = new Set(task.companyIds);
      const companyScopes = state.scopes.filter(scope => scope.taskId === 'global' && scope.companyId && companyIds.has(scope.companyId));
      state.scopes.push(...companyScopes.map(scope => ({ ...structuredClone(scope), id: randomUUID(), taskId: task.id, createdAt: at })));
      const companyAssets = state.assets.filter(asset => asset.companyId && companyIds.has(asset.companyId));
      for (const asset of companyAssets) {
        const company = state.companies.find(row => row.id === asset.companyId)!;
        associateTaskAsset(asset, task.id, { source: 'company', summary: `任务创建时关联企业：${company.name}` });
      }
      return task;
    });
  }
  createTaskCategory(name: string) { return this.transaction(s => taskManagement.createTaskCategory(s, name)); }
  renameTaskCategory(id: string, name: string) { return this.transaction(s => taskManagement.renameTaskCategory(s, id, name)); }
  deleteTaskCategory(id: string) { return this.transaction(s => taskManagement.deleteTaskCategory(s, id)); }
  listTaskCategories() { return taskManagement.listTaskCategories(this.snapshot()); }
  createTaskTemplate(input: taskManagement.TaskTemplateInput) { return this.transaction(s => taskManagement.createTaskTemplate(s, input)); }
  updateTaskTemplate(id: string, patch: taskManagement.TaskTemplatePatch) { return this.transaction(s => taskManagement.patchTaskTemplate(s, id, patch)); }
  deleteTaskTemplate(id: string) { return this.transaction(s => { const removed = taskManagement.deleteTaskTemplate(s, id); if (removed) for (const task of s.tasks) if (task.templateId === id) delete task.templateId; return removed; }); }
  listTaskTemplates() { return taskManagement.listTaskTemplates(this.snapshot()); }
  updateTaskMetadata(id: string, patch: {title?: string; pinned?: boolean}) { return this.transaction(s => taskManagement.patchTaskMetadata(s, id, patch)); }
  setTasksCategory(taskIds: string[], categoryId: string | null) { return this.transaction(s => taskManagement.setTasksCategory(s, taskIds, categoryId)); }
  createTaskAssetRule(taskId: string, input: taskManagement.TaskRuleInput) { return this.transaction(s => taskManagement.createTaskAssetRule(s, taskId, input)); }
  updateTaskAssetRule(taskId: string, id: string, input: taskManagement.TaskRuleInput) { return this.transaction(s => taskManagement.updateTaskAssetRule(s, taskId, id, input)); }
  toggleTaskAssetRule(taskId: string, id: string, enabled: boolean) { return this.transaction(s => taskManagement.toggleTaskAssetRule(s, taskId, id, enabled)); }
  deleteTaskAssetRule(taskId: string, id: string) { return this.transaction(s => taskManagement.deleteTaskAssetRule(s, taskId, id)); }
  listGlobalAssetRules() { return listGlobalAssetRules(this.snapshot()); }
  createGlobalAssetRule(input: Omit<taskManagement.TaskRuleInput, 'action'>) { return this.transaction(state => {
    const { action: _action, ...rule } = taskManagement.normalizeTaskRule({ ...input, action: 'block' });
    const at = new Date().toISOString(); const row: GlobalAssetRule = { ...rule, id: randomUUID(), builtin: false, createdAt: at, updatedAt: at }; state.assetInterceptRules.push(row); return row;
  }); }
  updateGlobalAssetRule(id: string, input: Omit<taskManagement.TaskRuleInput, 'action'>) { return this.transaction(state => {
    const row = state.assetInterceptRules.find(rule => rule.id === id); if (!row) throw new taskManagement.TaskManagementError('not_found', `global asset rule not found: ${id}`);
    const { action: _action, ...rule } = taskManagement.normalizeTaskRule({ ...input, action: 'block' }); Object.assign(row, rule, { updatedAt: new Date().toISOString() }); return row;
  }); }
  toggleGlobalAssetRule(id: string, enabled: boolean) { return this.transaction(state => {
    const row = state.assetInterceptRules.find(rule => rule.id === id); if (!row) throw new taskManagement.TaskManagementError('not_found', `global asset rule not found: ${id}`);
    if (typeof enabled !== 'boolean') throw new taskManagement.TaskManagementError('invalid', 'enabled must be boolean'); row.enabled = enabled; row.updatedAt = new Date().toISOString(); return row;
  }); }
  deleteGlobalAssetRule(id: string) { return this.transaction(state => { const index = state.assetInterceptRules.findIndex(rule => rule.id === id); if (index < 0) return false; state.assetInterceptRules.splice(index,1); return true; }); }

  async setTaskStatus(taskId: string, status: TaskStatus): Promise<RedTeamTask> {
    let result: RedTeamTask | undefined;
    await this.commit((s) => {
      result = s.tasks.find((task) => task.id === taskId);
      if (!result) throw new Error(`task not found: ${taskId}`);
      result.status = status;
      result.updatedAt = new Date().toISOString();
    });
    return result!;
  }

  async importSnapshot(input: Partial<RedTeamSnapshot>): Promise<RedTeamSnapshot> {
    const settings = input.notificationSettings === undefined ? undefined : notificationSettingsPatch(input.notificationSettings);
    if (input.assetInterceptRules !== undefined) validateGlobalAssetRules(input.assetInterceptRules);
    const collections: Array<keyof RedTeamSnapshot> = ['tasks', 'assets', 'nodes', 'edges', 'intents', 'findings', 'evidence', 'traces', 'approvals', 'goals', 'constraints', 'scopes', 'traffic', 'interceptRules', 'archives', 'reports', 'notificationChannels', 'notificationEvents', 'notificationDeliveries', 'companies', 'taskCategories', 'taskTemplates', 'taskAssetRules', 'assetInterceptRules'];
    await this.commit((s) => {
      if (settings) Object.assign(s.notificationSettings,settings);
      for (const key of collections) {
        const incoming = input[key];
        if (!Array.isArray(incoming)) continue;
        const current = s[key] as unknown as Array<{ id?: string; taskId?: string }>;
        const ids = new Set(current.map((item) => item.id).filter((id): id is string => typeof id === 'string'));
        for (const item of incoming as Array<{ id?: string; taskId?: string }>) {
          if (item.id && ids.has(item.id)) continue;
          current.push(structuredClone(item));
          if (item.id) ids.add(item.id);
        }
      }
      taskManagement.initializeTaskManagement(s);
    });
    return this.snapshot();
  }

  async addAsset(input: Omit<Asset, 'id' | 'createdAt'>): Promise<Asset> { return this.addRecord('assets', { ...input, id: randomUUID(), createdAt: new Date().toISOString() }); }
  async addNode(input: GraphNode): Promise<GraphNode> { await this.commit((s) => { requireTask(s, input.taskId); s.nodes.push(input); }); return input; }
  async addEdge(input: Omit<GraphEdge, 'id'>): Promise<GraphEdge> { const value = { ...input, id: randomUUID() }; await this.commit((s) => { requireTask(s, input.taskId); s.edges.push(value); }); return value; }
  async addIntent(input: Omit<Intent, 'id' | 'createdAt' | 'updatedAt' | 'state'> & { state?: Intent['state'] }): Promise<Intent> { const now = new Date().toISOString(); return this.addRecord('intents', { ...input, id: randomUUID(), state: input.state ?? 'open', createdAt: now, updatedAt: now }); }
  async updateIntent(intentId: string, patch: Partial<Pick<Intent, 'state' | 'worker' | 'output'>>): Promise<Intent> {
    let result: Intent | undefined;
    await this.commit((s) => {
      result = s.intents.find((item) => item.id === intentId);
      if (!result) throw new Error(`intent not found: ${intentId}`);
      Object.assign(result, patch, { updatedAt: new Date().toISOString() });
    });
    return result!;
  }
  async claimIntent(taskId: string, worker: string, runtime?: { execution: import('./types.js').WorkerExecution; concurrency: number }): Promise<Intent | undefined> {
    let result: Intent | undefined;
    await this.commit((s) => {
      const task = s.tasks.find((item) => item.id === taskId);
      if (!task) throw new Error(`task not found: ${taskId}`);
      if (['paused', 'done', 'failed', 'timeout'].includes(task.status) || task.queued) throw new Error(`task is ${task.queued ? 'queued' : task.status}: ${taskId}`);
      if (runtime) {
        const busy = s.intents.filter((item) => item.execution?.parentSessionId === runtime.execution.parentSessionId && ['claimed', 'running'].includes(item.state)).length;
        if (busy >= runtime.concurrency) throw new Error(`worker concurrency limit reached: ${runtime.concurrency}`);
      }
      result = s.intents.find((item) => item.taskId === taskId && item.state === 'open');
      if (!result) return;
      result.state = runtime ? 'claimed' : 'running';
      result.worker = worker;
      if (runtime) result.execution = runtime.execution;
      result.updatedAt = new Date().toISOString();
      s.traces.push({ id: randomUUID(), taskId, intentId: result.id, worker, kind: 'start', summary: `Worker 领取意图：${result.summary}`, createdAt: result.updatedAt });
    });
    return result;
  }
  async setWorkerMessage(intentId: string, messageId: string): Promise<void> {
    await this.commit((s) => {
      const intent = s.intents.find((item) => item.id === intentId);
      if (!intent?.execution) throw new Error(`worker binding not found: ${intentId}`);
      intent.execution.messageId = messageId;
    });
  }
  /**
   * Attach the provider-owned child identity after DSH Agent Teams allocates
   * its durable teammate Session. The intent is claimed first so the normal
   * ARTEX concurrency gate remains atomic; this method only changes the
   * provider binding before Worker events are admitted.
   */
  async setWorkerExecution(intentId: string, execution: import('./types.js').WorkerExecution): Promise<void> {
    await this.commit((s) => {
      const intent = s.intents.find((item) => item.id === intentId);
      if (!intent) throw new Error(`intent not found: ${intentId}`);
      if (intent.state !== 'claimed' && intent.state !== 'running') throw new Error(`intent is not active: ${intentId}`);
      intent.execution = structuredClone(execution);
      intent.updatedAt = new Date().toISOString();
    });
  }
  async recordWorkerEvent(childSessionId: string, seq: number, trace: Pick<WorkerTrace, 'kind' | 'summary' | 'data'>, patch: Partial<Pick<Intent, 'state' | 'output'>> = {}): Promise<void> {
    await this.commit((s) => {
      const intent = s.intents.find((item) => item.execution?.childSessionId === childSessionId);
      if (!intent?.execution) throw new Error(`worker binding not found: ${childSessionId}`);
      if (seq <= (intent.execution.lastEventSeq ?? -1)) return;
      intent.execution.lastEventSeq = seq;
      Object.assign(intent, patch, { updatedAt: new Date().toISOString() });
      s.traces.push({ ...trace, id: randomUUID(), taskId: intent.taskId, intentId: intent.id, worker: childSessionId, createdAt: intent.updatedAt });
    });
  }
  async addFinding(input: Omit<Finding, 'id' | 'createdAt'>): Promise<Finding> {
    return this.transaction((state) => {
      validateFindingInput(state, input);
      const finding = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
      state.findings.push(finding);
      recordNotificationEvent(state, snapshotForFinding(finding, state.assets));
      return finding;
    });
  }
  async updateFinding(id: string, patch: FindingPatch): Promise<Finding> {
    return this.updateFindingAtomic(id, () => patch);
  }
  async updateFindingAtomic(id: string, decide: (state: RedTeamSnapshot, finding: Finding) => FindingPatch): Promise<Finding> {
    return this.transaction((state) => {
      const finding = state.findings.find((row) => row.id === id);
      if (!finding) throw new Error(`finding not found: ${id}`);
      assertFindingWritable(state, finding);
      const fromStatus = finding.status;
      const patch = decide(state, finding);
      validateFindingUpdate(state, finding, patch);
      Object.assign(finding, Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)));
      if (finding.status !== fromStatus) recordNotificationEvent(state, snapshotForFinding(finding, state.assets, fromStatus));
      return finding;
    });
  }
  async addEvidence(input: Omit<Evidence, 'id' | 'createdAt'>): Promise<Evidence> { return this.addRecord('evidence', { ...input, id: randomUUID(), createdAt: new Date().toISOString() }); }
  async addTrace(input: Omit<WorkerTrace, 'id' | 'createdAt'>): Promise<WorkerTrace> { return this.addRecord('traces', { ...input, id: randomUUID(), createdAt: new Date().toISOString() }); }
  async addApproval(input: Omit<Approval, 'id' | 'requestedAt'>): Promise<Approval> { return this.addRecord('approvals', { ...input, id: randomUUID(), requestedAt: new Date().toISOString() }); }
  async addGoal(input: Omit<Goal, 'id' | 'createdAt' | 'updatedAt'>): Promise<Goal> { const now = new Date().toISOString(); return this.addRecord('goals', { ...input, id: randomUUID(), createdAt: now, updatedAt: now }); }
  async updateGoal(id: string, patch: Partial<Pick<Goal, 'text' | 'vulnClass' | 'state'>>): Promise<Goal> { return this.updateRecord('goals', id, patch); }
  async deleteGoal(id: string): Promise<Goal> { return this.updateGoal(id, { state: 'deleted' }); }
  async addConstraint(input: Omit<Constraint, 'id' | 'createdAt' | 'updatedAt'>): Promise<Constraint> { const now = new Date().toISOString(); return this.addRecord('constraints', { ...input, id: randomUUID(), createdAt: now, updatedAt: now }); }
  async updateConstraint(id: string, patch: Partial<Pick<Constraint, 'kind' | 'text'>>): Promise<Constraint> { return this.updateRecord('constraints', id, patch); }
  async deleteConstraint(id: string): Promise<Constraint> { return this.updateConstraint(id, { text: '[deleted]' }); }
  async addScope(input: Omit<ScopeEntry, 'id' | 'createdAt'>): Promise<ScopeEntry> { return this.addRecord('scopes', { ...input, id: randomUUID(), createdAt: new Date().toISOString() }); }
  async addCompany(input: Omit<Company, 'id' | 'createdAt' | 'updatedAt'>): Promise<Company> { const now = new Date().toISOString(); return this.addRecord('companies', { ...input, id: randomUUID(), createdAt: now, updatedAt: now }); }
  async updateCompany(id: string, patch: Partial<Pick<Company, 'name' | 'description'>>): Promise<Company> { return this.updateRecord('companies', id, patch); }
  async deleteScope(id: string): Promise<ScopeEntry> { let result: ScopeEntry | undefined; await this.commit((s) => { const index = s.scopes.findIndex((item) => item.id === id); if (index < 0) throw new Error(`scope not found: ${id}`); result = s.scopes.splice(index, 1)[0]; }); return result!; }
  async addTraffic(input: Omit<TrafficRecord, 'id' | 'createdAt'>, prepare?: () => Promise<void | (() => Promise<void>)>): Promise<TrafficRecord> {
    return withTrafficMutation(this.storagePath, async () => {
      const rollback = await prepare?.();
      try { return await this.addRecord('traffic', { ...input, id: randomUUID(), createdAt: new Date().toISOString() }); }
      catch (error) {
        try { await rollback?.(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'traffic record and blob cleanup failed'); }
        throw error;
      }
    });
  }
  async addInterceptRule(input: Omit<InterceptRule, 'id' | 'createdAt' | 'updatedAt'>): Promise<InterceptRule> { const now = new Date().toISOString(); return this.addRecord('interceptRules', { ...input, id: randomUUID(), createdAt: now, updatedAt: now }); }
  async updateInterceptRule(id: string, patch: Partial<Pick<InterceptRule, 'enabled' | 'priority' | 'pattern' | 'action' | 'message'>>): Promise<InterceptRule> { return this.updateRecord('interceptRules', id, patch); }
  async deleteInterceptRule(id: string): Promise<InterceptRule> { let result: InterceptRule | undefined; await this.commit((s) => { const index = s.interceptRules.findIndex((item) => item.id === id); if (index < 0) throw new Error(`intercept rule not found: ${id}`); result = s.interceptRules.splice(index, 1)[0]; }); return result!; }
  async addArchive(input: Omit<TaskArchive, 'id' | 'createdAt' | 'updatedAt'>): Promise<TaskArchive> { const now = new Date().toISOString(); return this.addRecord('archives', { ...input, id: randomUUID(), createdAt: now, updatedAt: now }); }
  async updateArchive(id: string, patch: Partial<Pick<TaskArchive, 'state' | 'progress' | 'error'>>): Promise<TaskArchive> { return this.updateRecord('archives', id, patch); }
  async setReport(taskId: string, markdown: string): Promise<Report> { let result: Report | undefined; await this.commit((s) => { requireTask(s, taskId); result = s.reports.find((item) => item.taskId === taskId); if (result) { result.markdown = markdown; result.version += 1; result.updatedAt = new Date().toISOString(); } else { result = { id: randomUUID(), taskId, markdown, version: 1, updatedAt: new Date().toISOString() }; s.reports.push(result); } }); return result!; }
  async addNotificationChannel(input: Omit<NotificationChannel, 'id' | 'createdAt' | 'updatedAt'>): Promise<NotificationChannel> { validateNotificationFilter(input.filter); validateNotificationChannel(input.kind, input.config); const now = new Date().toISOString(); return this.addRecord('notificationChannels', { ...input, id: randomUUID(), createdAt: now, updatedAt: now }); }
  async updateNotificationChannel(id: string, patch: Partial<Pick<NotificationChannel, 'name' | 'mode' | 'enabled' | 'config' | 'filter' | 'ratePerMin'>>): Promise<NotificationChannel> {
    if (patch.filter) validateNotificationFilter(patch.filter);
    return this.transaction((state) => {
      const channel = state.notificationChannels.find((row) => row.id === id);
      if (!channel) throw new Error(`notification channel not found: ${id}`);
      const config = patch.config === undefined ? channel.config : prepareNotificationConfigUpdate(channel.kind, channel.config, patch.config);
      validateNotificationChannel(channel.kind, config);
      Object.assign(channel, Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)), { config, updatedAt: new Date().toISOString() });
      return channel;
    });
  }

  private async addRecord<K extends keyof RedTeamSnapshot, V extends RedTeamSnapshot[K] extends Array<infer I> ? I : never>(key: K, value: V): Promise<V> {
    await this.commit((s) => {
      if (value && typeof value === 'object' && 'companyId' in value && value.companyId !== undefined && !s.companies.some(c => c.id === value.companyId)) throw new taskManagement.TaskManagementError('not_found', `company not found: ${value.companyId}`);
      const companyGlobal = value && typeof value === 'object' && 'companyId' in value && typeof value.companyId === 'string' && (key === 'assets' || key === 'scopes');
      if (value && typeof value === 'object' && 'taskId' in value && typeof value.taskId === 'string' && !(value.taskId === 'global' && (key === 'approvals' || companyGlobal))) requireTask(s, value.taskId);
      if (key === 'assets') assertAssetInsertionAllowed(s, value as Asset);
      if (key === 'intents') { const intent = value as Intent; assertIntentAssetsAllowed(s, intent.taskId, intent.input); }
      (s[key] as unknown as V[]).push(value);
    });
    return value;
  }

  private async updateRecord<K extends keyof RedTeamSnapshot, V extends RedTeamSnapshot[K] extends Array<infer I> ? I : never>(key: K, id: string, patch: Partial<V>): Promise<V> {
    let result: V | undefined;
    await this.commit((s) => {
      const collection = s[key] as unknown as Array<V & { id: string }>;
      result = collection.find((item) => item.id === id);
      if (!result) throw new Error(`${String(key)} record not found: ${id}`);
      const definedPatch = Object.fromEntries(Object.entries(patch as object).filter(([, value]) => value !== undefined));
      Object.assign(result, definedPatch);
      if (typeof result === 'object' && result !== null && 'updatedAt' in result) Object.assign(result, { updatedAt: new Date().toISOString() });
    });
    return result!;
  }
}
