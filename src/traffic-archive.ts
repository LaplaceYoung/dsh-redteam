import { createReadStream } from 'node:fs';
import { constants, copyFile, link, lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import type { RedTeamSnapshot } from './types.js';
import type { TaskArchiveSupplement } from './session-archive.js';

interface Body { hash: string; length: number }
function body(value: unknown): Body {
  if (!value || typeof value !== 'object' || !('hash' in value) || typeof value.hash !== 'string' || !/^[a-f0-9]{64}$/.test(value.hash)
    || !('length' in value) || typeof value.length !== 'number' || !Number.isSafeInteger(value.length) || value.length < 0) throw new Error('invalid archived traffic body reference');
  return { hash: value.hash, length: value.length };
}
async function verify(path: string, expected: Body): Promise<void> {
  const info = await lstat(path);
  if (!info.isFile() || info.size !== expected.length) throw new Error(`traffic body size or file type mismatch: ${expected.hash}`);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  if (hash.digest('hex') !== expected.hash) throw new Error(`traffic body checksum mismatch: ${expected.hash}`);
}
async function present(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

/** Traffic blobs are content-addressed and shared across tasks. Always copy them;
 * archiving or retrying a restore must never remove another task's evidence.
 */
export class TrafficArchiveRuntime implements TaskArchiveSupplement {
  constructor(private readonly root: string) {}
  private path(value: Body): string { return join(this.root, value.hash.slice(0, 2), `${value.hash}.bin`); }
  private async verifyShard(value: Body): Promise<void> {
    const shard = dirname(this.path(value));
    if (await present(shard)) {
      const info = await lstat(shard);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`invalid traffic body directory: ${shard}`);
    }
  }

  async capture(directory: string, taskId: string, snapshot: RedTeamSnapshot): Promise<void> {
    const bodies = new Map<string, Body>();
    for (const row of snapshot.traffic) {
      if (row.taskId !== taskId) continue;
      for (const message of [row.request, row.response]) {
        if (!message || typeof message !== 'object' || !('bodySha256' in message)) continue;
        const value = body({ hash: message.bodySha256, length: 'bodyLength' in message ? message.bodyLength : undefined });
        const previous = bodies.get(value.hash);
        if (previous && previous.length !== value.length) throw new Error(`conflicting traffic body length: ${value.hash}`);
        bodies.set(value.hash, value);
      }
    }
    await mkdir(directory, { recursive: true });
    for (const value of bodies.values()) {
      const target = join(directory, `${value.hash}.bin`);
      await this.verifyShard(value);
      await verify(this.path(value), value);
      await copyFile(this.path(value), target, constants.COPYFILE_EXCL);
      await verify(target, value);
    }
    await writeFile(join(directory, 'index.json'), JSON.stringify({ format: 'dsh-redteam-traffic-bodies', version: 1, taskId, bodies: [...bodies.values()] }), { flag: 'wx', mode: 0o600 });
  }

  async restore(directory: string, taskId: string): Promise<void> {
    const value: unknown = JSON.parse(await readFile(join(directory, 'index.json'), 'utf8'));
    if (!value || typeof value !== 'object' || !('format' in value) || value.format !== 'dsh-redteam-traffic-bodies'
      || !('version' in value) || value.version !== 1 || !('taskId' in value) || value.taskId !== taskId || !('bodies' in value) || !Array.isArray(value.bodies)) throw new Error('invalid traffic body archive index');
    const bodies = value.bodies.map(body);
    if (new Set(bodies.map(item => item.hash)).size !== bodies.length) throw new Error('duplicate archived traffic body');
    for (const item of bodies) {
      await this.verifyShard(item);
      await verify(join(directory, `${item.hash}.bin`), item);
      if (await present(this.path(item))) await verify(this.path(item), item);
    }
    for (const item of bodies) {
      const target = this.path(item);
      await this.verifyShard(item);
      if (await present(target)) { await verify(target, item); continue; }
      await mkdir(dirname(target), { recursive: true });
      const temporary = `${target}.${randomUUID()}.restore`;
      try {
        await copyFile(join(directory, `${item.hash}.bin`), temporary, constants.COPYFILE_EXCL);
        await verify(temporary, item);
        // Publish atomically without replacing a concurrently created shared blob.
        try { await link(temporary, target); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
        await verify(target, item);
      } finally { await rm(temporary, { force: true }); }
    }
  }
}
