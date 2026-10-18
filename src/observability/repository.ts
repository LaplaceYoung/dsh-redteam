import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { matches, page, type CommandRow, type LlmRecord, type ObservabilityState, type RecordFilter, type UsageRow } from './model.js';

interface Lane { tail: Promise<void> }
const lanes = new Map<string, Lane>();
const fresh = (): ObservabilityState => ({ version: 1, recording: false, usage: [], records: [], commands: [] });

/** A canonical file lane is shared by independent Agent/preset/UI instances. */
export class ObservabilityRepository {
  readonly path: string;
  private readonly lane: Lane;
  constructor(path: string) {
    this.path = resolve(path);
    const key = process.platform === 'win32' ? this.path.toLowerCase() : this.path;
    this.lane = lanes.get(key) ?? { tail: Promise.resolve() }; lanes.set(key, this.lane);
  }
  private async read(): Promise<ObservabilityState> {
    let value: unknown;
    try { value = JSON.parse(await readFile(this.path, 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fresh(); throw error; }
    if (!value || typeof value !== 'object') throw new Error('Invalid observability state');
    const state = value as ObservabilityState;
    if (state.version !== 1 || typeof state.recording !== 'boolean' || !Array.isArray(state.records) || !Array.isArray(state.usage) || !Array.isArray(state.commands)) throw new Error('Invalid observability state');
    for (const row of [...state.usage, ...state.commands]) if (!row || typeof row.id !== 'string' || typeof row.startedAt !== 'string' || typeof row.status !== 'string') throw new Error('Invalid persisted observability row');
    for (const row of state.usage) if (!row.usage || [row.usage.inputTokens, row.usage.outputTokens, row.usage.cacheReadTokens ?? 0, row.usage.cacheWriteTokens ?? 0].some(n => !Number.isFinite(n) || n < 0)) throw new Error('Invalid persisted token usage');
    return state;
  }
  async snapshot(): Promise<ObservabilityState> { await this.lane.tail; return this.read(); }
  private async transaction<T>(mutate: (state: ObservabilityState) => T): Promise<T> {
    const operation = this.lane.tail.then(async () => {
      const state = await this.read(), result = mutate(state);
      await mkdir(dirname(this.path), { recursive: true }); const temporary = this.path + '.' + randomUUID() + '.tmp';
      try { await writeFile(temporary, JSON.stringify(state), 'utf8'); await rename(temporary, this.path); }
      catch (error) { await unlink(temporary).catch(() => {}); throw error; }
      return structuredClone(result);
    });
    this.lane.tail = operation.then(() => {}, () => {}); return operation;
  }
  async setRecording(enabled: boolean): Promise<{ enabled: boolean }> {
    if (typeof enabled !== 'boolean') throw new Error('enabled must be boolean');
    return this.transaction(state => { state.recording = enabled; return { enabled }; });
  }
  async appendCall(usage: UsageRow, record?: LlmRecord): Promise<void> { await this.transaction(state => { state.usage.push(usage); if (record) state.records.push(record); }); }
  async appendCommand(row: CommandRow): Promise<void> { await this.transaction(state => { const index = state.commands.findIndex(item => item.id === row.id); if (index < 0) state.commands.push(row); else state.commands[index] = row; }); }
  async records(filter: RecordFilter = {}) { return page((await this.snapshot()).records.filter(row => matches(row, filter)).map(({ request: _request, chunks: _chunks, ...row }) => row), filter); }
  async detail(id: string): Promise<LlmRecord> { const row = (await this.snapshot()).records.find(row => row.id === id); if (!row) throw new Error('LLM record not found'); return row; }
  async commands(filter: RecordFilter = {}) { return page((await this.snapshot()).commands.filter(row => matches(row, filter)), filter); }
  async tasks() {
    const result = new Map<string, number>();
    for (const row of (await this.snapshot()).records) { const id = row.taskId ?? ''; result.set(id, (result.get(id) ?? 0) + 1); }
    return [...result].map(([taskId, count]) => ({ taskId, count }));
  }
  /** Debug trace deletion intentionally preserves the always-on billing ledger. */
  async deleteRecords(taskId: string): Promise<number> {
    if (!taskId.trim()) throw new Error('taskId is required');
    return this.transaction(state => { const before = state.records.length; state.records = state.records.filter(row => row.taskId !== taskId); return before - state.records.length; });
  }
  async deleteTask(taskId: string): Promise<void> {
    if (!taskId.trim()) throw new Error('taskId is required');
    await this.transaction(state => { state.records = state.records.filter(row => row.taskId !== taskId); state.usage = state.usage.filter(row => row.taskId !== taskId); state.commands = state.commands.filter(row => row.taskId !== taskId); });
  }
  async toolStats(filter: RecordFilter = {}) {
    const counts = new Map<string, { tool: string; calls: number; errors: number; denied: number; timeouts: number; aborted: number; truncated: number; durationMs: number }>();
    for (const row of (await this.snapshot()).commands.filter(row => matches(row, filter))) {
      const item = counts.get(row.tool) ?? { tool: row.tool, calls: 0, errors: 0, denied: 0, timeouts: 0, aborted: 0, truncated: 0, durationMs: 0 };
      item.calls++; if (row.status !== 'ok' && row.status !== 'running') item.errors++; if (row.status === 'denied') item.denied++; if (row.status === 'timeout') item.timeouts++; if (row.status === 'aborted') item.aborted++; if (row.truncated) item.truncated++; item.durationMs += row.durationMs ?? 0; counts.set(row.tool, item);
    }
    return [...counts.values()].sort((a, b) => b.calls - a.calls || a.tool.localeCompare(b.tool));
  }
  async usage(filter: RecordFilter = {}, group: 'model' | 'profile' | 'day' = 'model') {
    const groups = new Map<string, { key: string; provider?: string; model?: string; profileId?: string; day?: string; calls: number; failed: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; reasoningTokens: number; durationMs: number }>();
    for (const row of (await this.snapshot()).usage.filter(row => matches(row, filter))) {
      const day = row.startedAt.slice(0, 10), key = group === 'model' ? JSON.stringify([row.provider, row.model]) : group === 'profile' ? row.profileId ?? '' : JSON.stringify([row.profileId ?? '', day]);
      const item = groups.get(key) ?? { key, ...(group === 'model' ? { provider: row.provider, model: row.model } : { profileId: row.profileId ?? '', ...(group === 'day' ? { day } : {}) }), calls: 0, failed: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, durationMs: 0 };
      item.calls++; if (row.status !== 'ok') item.failed++; item.inputTokens += row.usage.inputTokens; item.outputTokens += row.usage.outputTokens; item.cacheReadTokens += row.usage.cacheReadTokens ?? 0; item.cacheWriteTokens += row.usage.cacheWriteTokens ?? 0; item.reasoningTokens += row.usage.reasoningTokens ?? 0; item.durationMs += row.durationMs; groups.set(key, item);
    }
    return [...groups.values()];
  }
}
