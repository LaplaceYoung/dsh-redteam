import { lstat, readdir, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { RedTeamStore } from '../store.js';
import type { TrafficRecord } from '../types.js';
import { withTrafficMutation } from './mutation.js';

export interface TrafficDeletionResult { deleted: number; reclaimed: number; blobReclaimed: number }

function referenced(rows: TrafficRecord[]): Set<string> {
  const hashes = new Set<string>();
  for (const row of rows) for (const part of [row.request, row.response]) {
    if (!part || typeof part !== 'object' || !('bodySha256' in part)) continue;
    if (typeof part.bodySha256 !== 'string' || !/^[a-f0-9]{64}$/.test(part.bodySha256)) throw new Error('invalid stored traffic blob reference');
    hashes.add(part.bodySha256);
  }
  return hashes;
}

/** Global disposable traffic deletion. Finding evidence uses its own immutable
 * snapshots and body store, neither of which is touched here. */
export class TrafficDeletion {
  private readonly blobRoot: string;
  constructor(private readonly store: RedTeamStore) { this.blobRoot = join(dirname(store.storagePath), 'redteam', 'traffic', '_blobs', 'sha256'); }

  deleteHost(raw: string): Promise<TrafficDeletionResult> {
    const host = raw.trim();
    if (!host) throw new Error('missing host');
    // Match SQLite LIKE used by the original DeleteHost, including its %/_ wildcards.
    const expression = host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
    const pattern = new RegExp(expression, 'i');
    return this.remove(row => pattern.test(row.host), false);
  }
  deleteHostsExact(hosts: string[]): Promise<TrafficDeletionResult> {
    const selected = new Set(hosts.map(host => host.trim()).filter(Boolean));
    if (!selected.size) throw new Error('missing hosts');
    return this.remove(row => selected.has(row.host), false);
  }
  deleteAll(): Promise<TrafficDeletionResult> { return this.remove(() => true, true); }

  private remove(matches: (row: TrafficRecord) => boolean, collectEmpty: boolean): Promise<TrafficDeletionResult> {
    return withTrafficMutation(this.store.storagePath, async () => {
      const result = await this.store.transaction(state => {
        const before = Buffer.byteLength(JSON.stringify(state.traffic, null, 2));
        const kept = state.traffic.filter(row => !matches(row));
        const deleted = state.traffic.length - kept.length;
        // Validate the retained live set before committing any deletion.
        referenced(kept);
        state.traffic = kept;
        return {deleted, reclaimed:before - Buffer.byteLength(JSON.stringify(kept, null, 2))};
      });
      let blobReclaimed = 0;
      if (result.deleted || collectEmpty) {
        try { blobReclaimed = await this.collect(referenced(this.store.snapshot().traffic)); }
        catch (error) { throw new Error(`deleted ${result.deleted} traffic exchanges; blob collection failed: ${String(error)}`, {cause:error}); }
      }
      return {...result,blobReclaimed};
    });
  }

  private async collect(live: Set<string>): Promise<number> {
    let root;
    try { root = await lstat(this.blobRoot); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0; throw error; }
    if (!root.isDirectory() || root.isSymbolicLink()) throw new Error('invalid traffic blob root');
    let reclaimed = 0;
    for (const shard of await readdir(this.blobRoot, {withFileTypes:true})) {
      if (!/^[a-f0-9]{2}$/.test(shard.name)) continue;
      if (!shard.isDirectory() || shard.isSymbolicLink()) throw new Error(`invalid traffic blob shard: ${shard.name}`);
      const directory = join(this.blobRoot, shard.name);
      for (const file of await readdir(directory, {withFileTypes:true})) {
        const hash = /^([a-f0-9]{64})\.bin$/.exec(file.name)?.[1];
        if (!hash || !hash.startsWith(shard.name) || live.has(hash)) continue;
        const path = join(directory, file.name), info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink()) throw new Error(`invalid traffic blob file: ${file.name}`);
        await unlink(path); reclaimed += info.size;
      }
    }
    return reclaimed;
  }
}
