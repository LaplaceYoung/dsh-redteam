import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface ServiceLog { seq: number; db_id: number; ts: string; level: string; tag: string; text: string }
/** One bounded durable journal per host installation, with a monotonic restart-safe cursor. */
export class ServiceLogs {
  private rows: ServiceLog[] = [];
  private sequence = 0;
  private tail: Promise<void>;
  private failure: Error | undefined;
  private listeners = new Set<(row: ServiceLog) => void>();
  readonly ready: Promise<void>;
  constructor(readonly path: string, readonly retention = 20000) {
    this.ready = this.load(); this.tail = this.ready;
  }
  private async load() {
    let value: unknown;
    try { value = JSON.parse(await readFile(this.path, 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    if (!value || typeof value !== 'object' || !('sequence' in value) || !Number.isSafeInteger(value.sequence) || !('items' in value) || !Array.isArray(value.items)) throw new Error('Invalid service log journal');
    let previous = 0;
    for (const row of value.items) {
      if (!row || !Number.isSafeInteger(row.seq) || row.seq <= previous || row.db_id !== row.seq || !['ts', 'level', 'tag', 'text'].every(key => typeof row[key] === 'string')) throw new Error('Invalid service log record');
      previous = row.seq;
    }
    if (Number(value.sequence) < previous) throw new Error('Invalid service log cursor');
    this.rows = value.items.slice(-this.retention); this.sequence = Number(value.sequence);
  }
  append(input: Omit<ServiceLog, 'seq' | 'db_id'>): Promise<void> {
    const operation = this.tail.then(async () => {
      const row = { ...input, seq: this.sequence + 1, db_id: this.sequence + 1 };
      const rows = [...this.rows, row].slice(-this.retention);
      await mkdir(dirname(this.path), { recursive: true });
      const temp = `${this.path}.${randomUUID()}.tmp`;
      await writeFile(temp, JSON.stringify({ sequence: row.seq, items: rows }), 'utf8');
      await rename(temp, this.path);
      this.rows = rows; this.sequence = row.seq; this.failure = undefined;
      for (const listener of this.listeners) listener(structuredClone(row));
    });
    this.tail = operation.catch(error => { this.failure = error instanceof Error ? error : new Error(String(error)); });
    return operation;
  }
  async flush() { await this.tail; if (this.failure) throw this.failure; }
  async recent(since = 0, limit = 500) {
    await this.flush(); const items = this.rows.filter(row => row.seq > since).slice(0, limit);
    return { items: structuredClone(items), cursor: items.at(-1)?.seq ?? since, latest: this.sequence, truncated: since > 0 && this.rows.length > 0 && since < this.rows[0]!.seq - 1 };
  }
  async history(before = 0, limit = 200) {
    await this.flush(); const rows = this.rows.filter(row => !before || row.db_id < before);
    return { items: structuredClone(rows.slice(-limit)), has_more: rows.length > limit, retention: this.retention };
  }
  subscribe(listener: (row: ServiceLog) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
}
