import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { TokenUsage } from '@deepseek-ai/dsh-llm';
import { defaultEnabledTools, defaultJudgeConfig, validateJudge, validateRule, type Action, type JudgeConfig, type Rule, type RuleInput, type ReviewInput } from './model.js';

export interface InterceptRecord {
  id: string; taskId?: string; sessionId: string; callId: string; rootCallId: string; toolName: string; toolInput: unknown;
  ruleId?: string; ruleName?: string; status: 'pending' | 'allowed' | 'denied' | 'timeout'; action: Action;
  decisionSource: 'rule' | 'model' | 'manual'; reason: string; createdAt: string; decidedAt?: string; effectiveAction?: 'allow' | 'deny'; decisionReason?: string;
  inputDigest: string; configDigest: string; modelInput?: ReviewInput; modelInputDigest?: string; modelFallback?: boolean; profileId?: string;
  execution: { status: 'pending' | 'succeeded' | 'failed' | 'not_executed' | 'unknown'; output?: string; truncated?: boolean; completedAt?: string };
  usage?: unknown;
}
export interface JudgeCall { id: string; taskId?: string; sessionId: string; provider: string; model: string; startedAt: string; finishedAt?: string; status: 'running' | 'succeeded' | 'failed' | 'cancelled' | 'unknown'; usage?: TokenUsage; error?: string }
export interface InterceptionState { version: 1; nextOrder: number; rules: Rule[]; records: InterceptRecord[]; enabledTools: string[]; judge: JudgeConfig; judgeCalls: JudgeCall[] }
type Subscriber = (record: InterceptRecord) => void;
interface Lane { tail: Promise<void>; listeners: Map<string, Set<Subscriber>>; initialized: boolean; initializing?: Promise<void> }
const lanes = new Map<string, Lane>();
export const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fresh = (): InterceptionState => ({ version: 1, nextOrder: 1, rules: [], records: [], enabledTools: [...defaultEnabledTools], judge: defaultJudgeConfig(), judgeCalls: [] });
export function validateRecord(row: InterceptRecord): void {
  if (!row || typeof row.id !== 'string' || !row.id || typeof row.sessionId !== 'string' || typeof row.callId !== 'string' || typeof row.rootCallId !== 'string' || typeof row.toolName !== 'string'
    || typeof row.reason !== 'string' || typeof row.createdAt !== 'string' || typeof row.inputDigest !== 'string' || typeof row.configDigest !== 'string'
    || !['pending', 'allowed', 'denied', 'timeout'].includes(row.status) || !['allow', 'ask', 'deny'].includes(row.action) || !['rule', 'model', 'manual'].includes(row.decisionSource)
    || row.taskId !== undefined && typeof row.taskId !== 'string' || !row.execution || !['pending', 'succeeded', 'failed', 'not_executed', 'unknown'].includes(row.execution.status)
    || row.status !== 'pending' && !['allow', 'deny'].includes(row.effectiveAction ?? '') || row.toolInput === undefined) throw new Error('Invalid persisted interception record');
}

/** One atomic file and serialized mutation lane per canonical path, shared by all Agent scopes. */
export class InterceptionRepository {
  readonly path: string;
  private readonly lane: Lane;
  constructor(path: string) {
    this.path = resolve(path); const key = process.platform === 'win32' ? this.path.toLowerCase() : this.path;
    let lane = lanes.get(key); if (!lane) { lane = { tail: Promise.resolve(), listeners: new Map(), initialized: false }; lanes.set(key, lane); } this.lane = lane;
  }
  private async read(): Promise<InterceptionState> {
    let text: string;
    try { text = await readFile(this.path, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fresh(); throw error; }
    const state: InterceptionState = JSON.parse(text);
    if (state.version !== 1 || !Array.isArray(state.rules) || !Array.isArray(state.records) || !Array.isArray(state.enabledTools) || state.enabledTools.some(n => typeof n !== 'string') || !Number.isSafeInteger(state.nextOrder)) throw new Error('Invalid interception repository');
    state.rules.forEach(rule => { validateRule(rule); if (typeof rule.id !== 'string' || !Number.isSafeInteger(rule.order)) throw new Error('Invalid persisted rule identity'); }); validateJudge(state.judge); state.records.forEach(validateRecord);
    if (state.judge.timeoutSeconds <= 0) state.judge.timeoutSeconds = 15;
    if (state.judge.askTimeoutSeconds <= 0) state.judge.askTimeoutSeconds = 300;
    if (new Set(state.rules.map(r => r.id)).size !== state.rules.length || new Set(state.records.map(r => r.id)).size !== state.records.length) throw new Error('Duplicate persisted interception ID');
    state.judgeCalls ??= []; // Version 1 files written before the independent usage ledger.
    if (!Array.isArray(state.judgeCalls) || state.judgeCalls.some(row => !row || typeof row.id !== 'string' || typeof row.startedAt !== 'string' || !['running', 'succeeded', 'failed', 'cancelled', 'unknown'].includes(row.status))) throw new Error('Invalid judge usage ledger');
    return state;
  }
  async snapshot(): Promise<InterceptionState> { await this.lane.tail; return this.read(); }
  async transaction<T>(mutate: (state: InterceptionState) => T): Promise<T> {
    const operation = this.lane.tail.then(async () => {
      const state = await this.read(); const result = mutate(state);
      await mkdir(dirname(this.path), { recursive: true }); const temp = this.path + '.' + randomUUID() + '.tmp';
      try { await writeFile(temp, JSON.stringify(state), 'utf8'); await rename(temp, this.path); }
      catch (error) { await unlink(temp).catch(() => {}); throw error; }
      return structuredClone(result);
    });
    this.lane.tail = operation.then(() => {}, () => {}); return operation;
  }
  /** Restart cannot resume the original in-memory tool call. Never leave a phantom live approval. */
  async initialize(legacyRules: readonly { id: string; taskId?: string; name: string; enabled: boolean; priority: number; matchTarget: string; matchType: string; pattern: string; action: string; message?: string; createdAt: string; updatedAt: string }[] = []): Promise<void> {
    if (this.lane.initialized) return;
    if (this.lane.initializing) return this.lane.initializing;
    const operation = this.transaction(state => {
      if (state.rules.length === 0 && state.nextOrder === 1) for (const old of legacyRules) {
        const rule: Rule = { ...old, matchTarget: old.matchTarget === 'tool' ? 'tool_name' : old.matchTarget as Rule['matchTarget'], matchType: old.matchType === 'contains' ? 'string' : old.matchType as Rule['matchType'], action: old.action as Action, message: old.message ?? '', order: state.nextOrder++, timeoutEnabled: false, timeoutSeconds: 60, timeoutAction: 'deny' };
        validateRule(rule); state.rules.push(rule);
      }
      for (const row of state.records) {
        if (row.status === 'pending') Object.assign(row, { status: 'denied', effectiveAction: 'deny', decisionReason: '宿主重启，原工具执行已不可恢复', decidedAt: new Date().toISOString() });
        if (row.execution.status === 'pending') row.execution = { status: row.status === 'denied' ? 'not_executed' : 'unknown', output: '宿主重启前未收到工具结果', completedAt: new Date().toISOString() };
      }
      for (const call of state.judgeCalls) if (call.status === 'running') { call.status = 'unknown'; call.finishedAt = new Date().toISOString(); }
    });
    this.lane.initializing = operation;
    try { await operation; this.lane.initialized = true; } finally { this.lane.initializing = undefined; }
  }
  async upsertRule(input: RuleInput, id?: string): Promise<Rule> {
    validateRule(input);
    const keys = ['taskId', 'name', 'enabled', 'priority', 'matchTarget', 'matchType', 'pattern', 'action', 'message', 'timeoutEnabled', 'timeoutSeconds', 'timeoutAction'];
    if (Object.keys(input).some(key => !keys.includes(key))) throw new Error('Unknown or immutable rule field');
    return this.transaction(state => {
      const current = id ? state.rules.find(r => r.id === id) : undefined;
      if (id && !current) throw new Error(`Intercept rule not found: ${id}`);
      const at = new Date().toISOString();
      if (current) { Object.assign(current, input, { updatedAt: at }); return current; }
      const row: Rule = { ...input, id: randomUUID(), order: state.nextOrder++, createdAt: at, updatedAt: at }; state.rules.push(row); return row;
    });
  }
  async deleteRule(id: string): Promise<void> { await this.transaction(s => { const i = s.rules.findIndex(r => r.id === id); if (i < 0) throw new Error('Intercept rule not found'); s.rules.splice(i, 1); }); }
  async toggleRule(id: string, enabled: boolean): Promise<Rule> { return this.transaction(s => { const row = s.rules.find(r => r.id === id); if (!row) throw new Error('Intercept rule not found'); row.enabled = enabled; row.updatedAt = new Date().toISOString(); return row; }); }
  async configure(input: { enabledTools?: string[]; judge?: JudgeConfig }): Promise<void> {
    if (input.enabledTools !== undefined && (!Array.isArray(input.enabledTools) || input.enabledTools.some(n => typeof n !== 'string' || !n))) throw new Error('enabledTools must contain nonempty tool names');
    if (input.judge !== undefined) validateJudge(input.judge);
    await this.transaction(s => { if (input.enabledTools !== undefined) s.enabledTools = [...new Set(input.enabledTools)]; if (input.judge !== undefined) s.judge = input.judge; });
  }
  async add(input: Omit<InterceptRecord, 'id' | 'createdAt'>): Promise<InterceptRecord> { return this.transaction(s => { const row = { ...input, id: randomUUID(), createdAt: new Date().toISOString() }; validateRecord(row); s.records.push(row); return row; }); }
  async detail(id: string): Promise<InterceptRecord> { const row = (await this.snapshot()).records.find(r => r.id === id); if (!row) throw new Error('Approval not found'); return row; }
  async decide(id: string, allowed: boolean, options: { timeout?: boolean; reason?: string; expectedTaskId?: string } = {}): Promise<{ resolved: boolean; record: InterceptRecord }> {
    const result = await this.transaction(s => {
      const row = s.records.find(r => r.id === id); if (!row) throw new Error('Approval not found');
      if (options.expectedTaskId !== undefined && row.taskId !== options.expectedTaskId) throw new Error('Approval belongs to another task');
      if (row.status !== 'pending') return { resolved: false, record: row };
      Object.assign(row, { status: options.timeout ? 'timeout' : allowed ? 'allowed' : 'denied', effectiveAction: allowed ? 'allow' : 'deny', decidedAt: new Date().toISOString(), decisionReason: options.reason ?? (allowed ? '人工允许执行' : '人工拒绝执行') });
      return { resolved: true, record: row };
    });
    if (result.resolved) for (const listener of this.lane.listeners.get(id) ?? []) listener(result.record);
    return result;
  }
  async wait(id: string, signal: AbortSignal): Promise<InterceptRecord> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => { signal.removeEventListener('abort', abort); const set = this.lane.listeners.get(id); set?.delete(receive); if (!set?.size) this.lane.listeners.delete(id); };
      const receive = (row: InterceptRecord) => { if (settled || row.status === 'pending') return; settled = true; cleanup(); resolve(row); };
      const abort = () => { if (settled) return; settled = true; cleanup(); reject(signal.reason); };
      const set = this.lane.listeners.get(id) ?? new Set<Subscriber>(); set.add(receive); this.lane.listeners.set(id, set);
      signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) { abort(); return; }
      void this.detail(id).then(receive, error => { if (!settled) { settled = true; cleanup(); reject(error); } });
    });
  }
  async complete(id: string, execution: InterceptRecord['execution']): Promise<void> { await this.transaction(s => { const row = s.records.find(r => r.id === id); if (!row) throw new Error('Approval not found'); row.execution = execution; }); }
  async startJudge(input: Pick<JudgeCall, 'taskId' | 'sessionId' | 'provider' | 'model'>): Promise<string> { return this.transaction(state => { const row: JudgeCall = { ...input, id: randomUUID(), startedAt: new Date().toISOString(), status: 'running' }; state.judgeCalls.push(row); return row.id; }); }
  async updateJudge(id: string, patch: Pick<JudgeCall, 'usage'> & Partial<Pick<JudgeCall, 'status' | 'error' | 'finishedAt'>>): Promise<void> { await this.transaction(state => { const row = state.judgeCalls.find(call => call.id === id); if (!row) throw new Error('Judge call not found'); Object.assign(row, patch); }); }
  async judgeUsage(days = 30, now = new Date()): Promise<{ calls: number; input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_write_tokens: number; daily: { date: string; calls: number; input_tokens: number; output_tokens: number }[] }> {
    if (!Number.isSafeInteger(days)) throw new Error('days must be an integer'); if (days <= 0) days = 30;
    const rows = (await this.snapshot()).judgeCalls; const result = { calls: rows.length, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, daily: [] as { date: string; calls: number; input_tokens: number; output_tokens: number }[] };
    const daily = new Map<string, typeof result.daily[number]>(); const cutoff = now.getTime() - days * 86400000;
    for (const row of rows) {
      result.input_tokens += row.usage?.inputTokens ?? 0; result.output_tokens += row.usage?.outputTokens ?? 0; result.cache_read_tokens += row.usage?.cacheReadTokens ?? 0; result.cache_write_tokens += row.usage?.cacheWriteTokens ?? 0;
      if (Date.parse(row.startedAt) < cutoff) continue;
      const date = row.startedAt.slice(0, 10); const day = daily.get(date) ?? { date, calls: 0, input_tokens: 0, output_tokens: 0 }; day.calls++; day.input_tokens += row.usage?.inputTokens ?? 0; day.output_tokens += row.usage?.outputTokens ?? 0; daily.set(date, day);
    }
    result.daily = [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)); return result;
  }
}
