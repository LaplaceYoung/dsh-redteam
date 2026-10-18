import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-session';
import { BlockAssembler, type GenerateOptions, type TokenUsage } from '@deepseek-ai/dsh-llm';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { SideContextBuilder, type SideContextInfo, type SideMemory } from './side-questions-context.js';

export type SideParent = { kind: 'conversation'; id: string } | { kind: 'task'; id: string; explorationId?: string; intentId?: string };
export interface SideSnapshot { parent: SideParent; capturedAt: string; version: number; identity: string; windowTokens: number; request: GenerateOptions }
export interface SideExchange {
  id: string; parent: SideParent; clientRequestId: string; generation: number; ordinal: number; question: string; answer: string;
  status: 'running' | 'completed' | 'cancelled' | 'failed' | 'interrupted'; error?: string;
  model: { provider: string; model: string; identity: string }; snapshotAt: string; createdAt: string; sequence: number;
  usage: TokenUsage; context?: SideContextInfo;
}
export interface SideSession { parent: SideParent; generation: number; snapshot: SideSnapshot; memory: SideMemory; exchanges: SideExchange[] }
export interface SideTaskArchive { version: 1; taskId: string; ordinal: number; sessions: SideSession[] }
interface SideState { version: 1; ordinal: number; sessions: Record<string, SideSession> }
export interface SideQuestionsOptions {
  directory: string;
  parentForSession(sessionId: string): SideParent | undefined | Promise<SideParent | undefined>;
  parentExists(parent: SideParent): boolean | Promise<boolean>;
  /** Include an opaque configuration revision to invalidate changed profiles; never credentials. */
  modelIdentity?(request: Pick<GenerateOptions, 'provider' | 'model' | 'reasoningEffort' | 'maxTokens'>, parent: SideParent): string | Promise<string>;
  prepareQuestion?(parent: SideParent, question: string): string | Promise<string>;
  outputTokens?: number;
  onError?(error: unknown): void;
}
export class SideQuestionError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = 'SideQuestionError'; }
}
export const sideParentKey = (parent: SideParent): string => JSON.stringify(parent.kind === 'conversation' ? ['conversation', parent.id] : ['task', parent.id, parent.explorationId ?? '', parent.intentId ?? '']);
const copy = <T>(value: T): T => structuredClone(value);
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const isMissing = (error: unknown): boolean => error instanceof Error && 'code' in error && error.code === 'ENOENT';
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const counter = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const timestamp = (value: unknown): value is string => nonempty(value) && Number.isFinite(Date.parse(value));
function validateParent(parent: unknown): asserts parent is SideParent {
  if (!record(parent) || !['task', 'conversation'].includes(String(parent.kind)) || !nonempty(parent.id) ||
    parent.explorationId !== undefined && !nonempty(parent.explorationId) || parent.intentId !== undefined && !nonempty(parent.intentId)) throw new SideQuestionError(400, '无效旁路父会话');
  if (parent.kind === 'conversation' && (parent.explorationId !== undefined || parent.intentId !== undefined)) throw new SideQuestionError(400, '普通会话不能包含任务探索引用');
}
function validateState(value: unknown): asserts value is SideState {
  if (!record(value) || value.version !== 1 || !counter(value.ordinal) || !record(value.sessions)) throw new Error('Invalid side-question persistence');
  const ids = new Set<string>();
  for (const [key, session] of Object.entries(value.sessions)) {
    if (!record(session) || !record(session.snapshot) || !record(session.memory) || !counter(session.generation) || !Array.isArray(session.exchanges)) throw new Error('Invalid side-question session');
    validateParent(session.parent);
    if (sideParentKey(session.parent) !== key) throw new Error('Invalid side-question parent key');
    const clients = new Set<string>(); let ordinal = 0;
    for (const exchange of session.exchanges) {
      if (!record(exchange) || !nonempty(exchange.id) || !nonempty(exchange.clientRequestId) || !/^[A-Za-z0-9_.:-]{1,128}$/.test(exchange.clientRequestId) || !nonempty(exchange.question) || [...exchange.question].length > 4000 || typeof exchange.answer !== 'string' || !counter(exchange.ordinal) || exchange.ordinal <= ordinal || exchange.ordinal > value.ordinal || exchange.generation !== session.generation || !counter(exchange.sequence) || !timestamp(exchange.createdAt) || !timestamp(exchange.snapshotAt) || !['running', 'completed', 'cancelled', 'failed', 'interrupted'].includes(String(exchange.status))) throw new Error('Invalid side-question exchange');
      validateParent(exchange.parent);
      if (sideParentKey(exchange.parent) !== key || ids.has(exchange.id) || clients.has(exchange.clientRequestId)) throw new Error('Duplicate or mismatched side-question exchange');
      ids.add(exchange.id); clients.add(exchange.clientRequestId); ordinal = exchange.ordinal;
      if (!record(exchange.model) || !nonempty(exchange.model.provider) || !nonempty(exchange.model.model) || !nonempty(exchange.model.identity) || !record(exchange.usage) || !counter(exchange.usage.inputTokens) || !counter(exchange.usage.outputTokens)) throw new Error('Invalid side-question model or usage');
      for (const field of ['cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'totalTokens']) if (exchange.usage[field] !== undefined && !counter(exchange.usage[field])) throw new Error('Invalid side-question usage');
      if (exchange.error !== undefined && typeof exchange.error !== 'string') throw new Error('Invalid side-question error');
      if (exchange.context !== undefined && (!record(exchange.context) || typeof exchange.context.phase !== 'string' || !counter(exchange.context.recentExchanges) || typeof exchange.context.historySummarized !== 'boolean' || typeof exchange.context.snapshotSummarized !== 'boolean' || typeof exchange.context.overflowRetried !== 'boolean' || !counter(exchange.context.estimatedInputTokens) || typeof exchange.context.inputBudget !== 'number' || !Number.isFinite(exchange.context.inputBudget) || !counter(exchange.context.outputTokens))) throw new Error('Invalid side-question context');
    }
    const snapshot = session.snapshot;
    validateParent(snapshot.parent);
    if (sideParentKey(snapshot.parent) !== key || !timestamp(snapshot.capturedAt) || !counter(snapshot.version) || !counter(snapshot.windowTokens) || snapshot.windowTokens === 0 || !record(snapshot.request) || !nonempty(snapshot.request.provider) || !nonempty(snapshot.request.model) || !Array.isArray(snapshot.request.messages) || !nonempty(snapshot.identity)) throw new Error('Invalid side-question snapshot');
    for (const message of snapshot.request.messages) {
      if (!record(message) || !['system', 'developer', 'user', 'assistant', 'tool'].includes(String(message.role)) || !Array.isArray(message.content)) throw new Error('Invalid side-question snapshot message');
      for (const block of message.content) if (!record(block) || !nonempty(block.type) || block.type === 'text' && typeof block.text !== 'string') throw new Error('Invalid side-question snapshot block');
    }
    if (snapshot.request.maxTokens !== undefined && (!counter(snapshot.request.maxTokens) || snapshot.request.maxTokens === 0) || snapshot.request.system !== undefined && typeof snapshot.request.system !== 'string' || snapshot.request.reasoningEffort !== undefined && !nonempty(snapshot.request.reasoningEffort)) throw new Error('Invalid side-question snapshot controls');
    const memory = session.memory;
    if (typeof memory.history !== 'string' || !counter(memory.through) || memory.through > value.ordinal || memory.snapshotKey !== undefined && typeof memory.snapshotKey !== 'string' || memory.snapshotSummary !== undefined && typeof memory.snapshotSummary !== 'string' || memory.tailStart !== undefined && !counter(memory.tailStart)) throw new Error('Invalid side-question memory');
    if (memory.through !== 0 && !session.exchanges.some(e => record(e) && e.ordinal === memory.through && e.status === 'completed')) throw new Error('Invalid side-question summary cursor');
  }
}
function validateTaskArchive(taskId: string, data: unknown): SideTaskArchive {
  if (!nonempty(taskId) || !record(data) || data.version !== 1 || data.taskId !== taskId || !counter(data.ordinal) || !Array.isArray(data.sessions)) throw new SideQuestionError(400, '无效旁路任务归档');
  const candidate: { version: 1; ordinal: number; sessions: Record<string, unknown> } = { version: 1, ordinal: data.ordinal, sessions: {} };
  for (const session of data.sessions) {
    if (!record(session)) throw new SideQuestionError(400, '无效旁路归档会话');
    validateParent(session.parent);
    if (session.parent.kind !== 'task' || session.parent.id !== taskId) throw new SideQuestionError(400, '旁路归档包含其他父会话');
    const key = sideParentKey(session.parent);
    if (candidate.sessions[key]) throw new SideQuestionError(400, '旁路归档包含重复父会话');
    candidate.sessions[key] = session;
  }
  validateState(candidate);
  if (Object.values(candidate.sessions).some(session => session.exchanges.some(e => e.status === 'running'))) throw new SideQuestionError(409, '旁路归档包含未排空的运行中请求');
  return copy({ version: 1, taskId, ordinal: candidate.ordinal, sessions: Object.values(candidate.sessions) });
}

/** Original ARTEX side questions are one-shot LLM calls, not child Agents.
 * Only the original native Agent owns its Session; this service cannot steer,
 * cancel, append to, or execute tools on that Agent.
 */
export class SideQuestionService {
  private state: SideState = { version: 1, ordinal: 0, sessions: {} };
  private queue: Promise<unknown> = Promise.resolve();
  private readonly runs = new Map<string, { parent: SideParent; abort: AbortController; done: Promise<void> }>();
  private readonly blockedTasks = new Set<string>();
  private readonly blockedParents = new Set<string>();
  private readonly latest = new Map<string, SideSnapshot>();
  private readonly listeners = new Set<(exchange: SideExchange) => void>();
  private readonly captureVersions = new Map<string, number>();
  private readonly captureParents = new Map<string, SideParent>();
  private readonly sessionCaptures = new Map<string, { key: string; version: number }>();
  private stopped = false;
  private unhook?: () => void;
  private unhookSession?: () => void;
  private readonly path: string;
  private constructor(private readonly ctx: Context, private readonly options: SideQuestionsOptions) { this.path = join(options.directory, 'side-questions.json'); }
  static async open(ctx: Context, options: SideQuestionsOptions): Promise<SideQuestionService> {
    if (options.outputTokens !== undefined && (!Number.isInteger(options.outputTokens) || options.outputTokens < 256 || options.outputTokens > 32768)) throw new Error('旁路输出预算须为256–32768');
    const service = new SideQuestionService(ctx, options);
    try { const value: unknown = JSON.parse(await readFile(service.path, 'utf8')); validateState(value); service.state = value; }
    catch (error) { if (!isMissing(error)) throw error; }
    await service.serial(async () => {
      const next = copy(service.state); let changed = false;
      for (const session of Object.values(next.sessions)) for (const e of session.exchanges) if (e.status === 'running') { e.status = 'interrupted'; e.error = '服务重启，旁路回答已中断'; e.sequence++; changed = true; }
      if (changed) await service.persist(next);
    });
    service.unhook = ctx.root.on('llm/stream', (request, next) => {
      if (!request.sessionId || request.purpose) return next();
      return (async function* () {
        const parent = await options.parentForSession(request.sessionId!);
        if (!parent) { yield* next(); return; }
        const key = sideParentKey(parent);
        const version = (service.captureVersions.get(key) ?? service.state.sessions[key]?.snapshot.version ?? 0) + 1;
        service.captureVersions.set(key, version);
        service.captureParents.set(key, copy(parent));
        service.sessionCaptures.set(request.sessionId!, { key, version });
        let snapshot: SideSnapshot | undefined;
        try { snapshot = await service.capture(parent, request, version); } catch (error) { service.report(error); }
        const assembler = new BlockAssembler(); let complete = false;
        for await (const chunk of next()) { assembler.push(chunk); if (chunk.type === 'finish') complete = chunk.reason.kind !== 'error' && chunk.reason.kind !== 'aborted'; yield chunk; }
        if (snapshot && complete && !request.signal?.aborted) {
          const finished = copy(snapshot); finished.request.messages.push(assembler.message({ provider: request.provider, model: request.model }));
          try { await service.saveSnapshot(finished); } catch (error) { service.report(error); }
        }
      })();
    });
    // A final native tool result can land after the last model request. Fold
    // the actual durable Session surface at turn/end, as ARTEX Capture.Finish
    // does, without synthesizing or appending any transcript messages.
    service.unhookSession = ctx.root.on('session/event', (session, event) => {
      if (event.type !== 'turn/end') return;
      const captured = service.sessionCaptures.get(session.id);
      if (!captured || captured.version !== service.captureVersions.get(captured.key)) return;
      const snapshot = service.latest.get(captured.key) ?? service.state.sessions[captured.key]?.snapshot;
      if (!snapshot || snapshot.version !== captured.version) return;
      const finished = copy(snapshot), messages = session.deriveMessages();
      const prefix = finished.request.messages.filter(message => message.role === 'system');
      finished.request.messages = copy(messages[0]?.role === 'system' ? messages : [...prefix, ...messages]);
      finished.capturedAt = new Date().toISOString();
      void service.saveSnapshot(finished).catch(error => service.report(error));
    });
    return service;
  }
  private report(error: unknown): void { if (this.options.onError) this.options.onError(error); else console.error('[side-questions]', error); }
  private serial<T>(operation: () => Promise<T>): Promise<T> { const result = this.queue.then(operation, operation); this.queue = result.then(() => undefined, () => undefined); return result; }
  private async persist(state: SideState): Promise<void> {
    await mkdir(this.options.directory, { recursive: true });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 }); await rename(temporary, this.path); this.state = state; }
    finally { await rm(temporary, { force: true }); }
  }
  private isBlocked(parent: SideParent): boolean { return this.stopped || this.blockedParents.has(sideParentKey(parent)) || parent.kind === 'task' && this.blockedTasks.has(parent.id); }
  private async assertParent(parent: SideParent): Promise<void> { validateParent(parent); if (this.isBlocked(parent)) throw new SideQuestionError(409, '父会话正在删除、归档或服务已关闭'); if (!await this.options.parentExists(parent)) throw new SideQuestionError(404, '旁路父会话已删除或归档'); }
  private async identity(request: GenerateOptions, parent: SideParent): Promise<{ identity: string; windowTokens: number }> {
    const model = await this.ctx.llm.resolveModelInfo(request.provider, request.model);
    const config = { provider: request.provider, model: request.model, reasoningEffort: request.reasoningEffort, maxTokens: request.maxTokens };
    return { identity: hash([config, model, this.options.modelIdentity ? await this.options.modelIdentity(config, parent) : '']), windowTokens: model.context?.contextWindow ?? 200000 };
  }
  private async capture(parent: SideParent, request: GenerateOptions, version: number): Promise<SideSnapshot | undefined> {
    if (this.isBlocked(parent) || !await this.options.parentExists(parent)) return;
    const { signal: _signal, sessionId: _session, purpose: _purpose, ...data } = request;
    const model = await this.identity(request, parent);
    const snapshot = { parent: copy(parent), capturedAt: new Date().toISOString(), version, ...model, request: copy(data) };
    await this.saveSnapshot(snapshot); return snapshot;
  }
  private async saveSnapshot(snapshot: SideSnapshot): Promise<void> {
    const key = sideParentKey(snapshot.parent);
    await this.serial(async () => {
      if (this.isBlocked(snapshot.parent) || !await this.options.parentExists(snapshot.parent)) return;
      if (snapshot.version !== this.captureVersions.get(key)) return;
      const previous = this.latest.get(key) ?? this.state.sessions[key]?.snapshot;
      if (previous && previous.version > snapshot.version) return;
      this.latest.set(key, copy(snapshot));
      const next = copy(this.state);
      const session = next.sessions[key] ?? { parent: copy(snapshot.parent), generation: 0, snapshot, memory: { history: '', through: 0 }, exchanges: [] };
      session.snapshot = copy(snapshot); next.sessions[key] = session; await this.persist(next);
    });
  }
  subscribe(listener: (exchange: SideExchange) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private publish(exchange: SideExchange): void { for (const listener of this.listeners) { try { listener(copy(exchange)); } catch (error) { this.report(error); } } }
  async list(parent: SideParent, options: { before?: number; limit?: number } = {}): Promise<{ items: SideExchange[]; current?: SideExchange; nextCursor?: number; snapshot?: { capturedAt: string; provider: string; model: string; available: boolean; reason?: string } }> {
    validateParent(parent); await this.queue;
    if (!await this.options.parentExists(parent)) return { items: [] };
    const session = this.state.sessions[sideParentKey(parent)];
    if (!session) return { items: [] };
    const limit = Math.min(100, Math.max(1, options.limit ?? 30));
    const eligible = session.exchanges.filter(e => options.before === undefined || e.ordinal < options.before).reverse();
    const items = eligible.slice(0, limit); let available = true, reason: string | undefined;
    try { available = (await this.identity(session.snapshot.request, parent)).identity === session.snapshot.identity; if (!available) reason = '模型配置已变化，请先运行主 Agent 更新上下文'; } catch (error) { available = false; reason = error instanceof Error ? error.message : String(error); }
    return copy({ items, current: session.exchanges.find(e => e.status === 'running'), nextCursor: eligible.length > limit ? items.at(-1)!.ordinal : undefined,
      snapshot: { capturedAt: session.snapshot.capturedAt, provider: session.snapshot.request.provider, model: session.snapshot.request.model, available, reason } });
  }
  async get(id: string): Promise<SideExchange | undefined> { await this.queue; for (const session of Object.values(this.state.sessions)) { const found = session.exchanges.find(e => e.id === id); if (found) return await this.options.parentExists(session.parent) ? copy(found) : undefined; } }

  /** Caller owns the task archive/admission barrier. This only drains writes. */
  async quiesceTask(taskId: string): Promise<void> {
    if (!nonempty(taskId)) throw new SideQuestionError(400, '无效任务ID');
    const runs = await this.serial(async () => {
      const selected = [...this.runs.values()].filter(run => run.parent.kind === 'task' && run.parent.id === taskId);
      for (const run of selected) run.abort.abort(new Error('任务正在归档，旁路请求已中断'));
      return selected;
    });
    await Promise.all(runs.map(run => run.done));
    await this.serial(async () => {
      const next = copy(this.state);
      for (const [key, snapshot] of this.latest) {
        if (snapshot.parent.kind !== 'task' || snapshot.parent.id !== taskId) continue;
        const session = next.sessions[key] ?? { parent: copy(snapshot.parent), generation: 0, snapshot, memory: { history: '', through: 0 }, exchanges: [] };
        if (snapshot.version >= session.snapshot.version) session.snapshot = copy(snapshot);
        next.sessions[key] = session;
      }
      if (!isDeepStrictEqual(next, this.state)) await this.persist(next);
    });
  }
  async exportTaskArchive(taskId: string): Promise<SideTaskArchive> {
    if (!nonempty(taskId)) throw new SideQuestionError(400, '无效任务ID');
    await this.quiesceTask(taskId);
    return this.serial(async () => {
      const sessions = Object.values(this.state.sessions).filter(session => session.parent.kind === 'task' && session.parent.id === taskId);
      return validateTaskArchive(taskId, { version: 1, taskId, ordinal: this.state.ordinal, sessions });
    });
  }
  private planTaskArchive(taskId: string, data: unknown): { next: SideState; keys: string[] } {
    const archive = validateTaskArchive(taskId, data);
    if ([...this.runs.values()].some(run => run.parent.kind === 'task' && run.parent.id === taskId)) throw new SideQuestionError(409, '任务旁路请求尚未排空');
    const next = copy(this.state), keys: string[] = [];
    const existingIds = new Map(Object.entries(next.sessions).flatMap(([key, session]) => session.exchanges.map(e => [e.id, key] as const)));
    for (const incoming of archive.sessions) {
      const key = sideParentKey(incoming.parent), current = next.sessions[key]; keys.push(key);
      for (const e of incoming.exchanges) {
        const owner = existingIds.get(e.id);
        if (owner !== undefined && owner !== key) throw new SideQuestionError(409, '旁路记录ID已属于其他父会话');
      }
      if (!current) { next.sessions[key] = copy(incoming); continue; }
      if (current.generation !== incoming.generation || current.exchanges.some(e => e.status === 'running')) throw new SideQuestionError(409, '旁路会话清除代次冲突或仍有运行中请求');
      for (const e of incoming.exchanges) {
        const same = current.exchanges.find(row => row.id === e.id);
        if (same) { if (!isDeepStrictEqual(same, e)) throw new SideQuestionError(409, '旁路记录内容与现有记录冲突'); continue; }
        if (current.exchanges.some(row => row.clientRequestId === e.clientRequestId || row.ordinal === e.ordinal)) throw new SideQuestionError(409, '旁路请求ID或历史游标冲突');
        current.exchanges.push(copy(e));
      }
      current.exchanges.sort((a, b) => a.ordinal - b.ordinal);
      if (current.memory.through === incoming.memory.through && current.memory.history !== incoming.memory.history) throw new SideQuestionError(409, '旁路摘要游标对应内容冲突');
      if (incoming.memory.through > current.memory.through) current.memory = copy(incoming.memory);
      if (Date.parse(incoming.snapshot.capturedAt) > Date.parse(current.snapshot.capturedAt)) current.snapshot = copy(incoming.snapshot);
    }
    next.ordinal = Math.max(next.ordinal, archive.ordinal);
    validateState(next);
    return { next, keys };
  }
  async preflightTaskArchive(taskId: string, data: unknown): Promise<void> {
    await this.serial(async () => { this.planTaskArchive(taskId, data); });
  }
  async restoreTaskArchive(taskId: string, data: unknown): Promise<void> {
    await this.serial(async () => {
      const { next, keys } = this.planTaskArchive(taskId, data);
      if (isDeepStrictEqual(next, this.state)) return;
      await this.persist(next);
      for (const key of keys) {
        const session = next.sessions[key];
        this.latest.set(key, copy(session.snapshot));
        this.captureParents.set(key, copy(session.parent));
        this.captureVersions.set(key, Math.max(this.captureVersions.get(key) ?? 0, session.snapshot.version) + 1);
      }
    });
  }
  async ask(parent: SideParent, input: { clientRequestId: string; question: string }): Promise<SideExchange> {
    const question = input.question.trim();
    if (!question || [...question].length > 4000 || !/^[A-Za-z0-9_.:-]{1,128}$/.test(input.clientRequestId)) throw new SideQuestionError(400, '问题须为1–4000字符，并提供有效请求ID');
    return this.serial(async () => {
      await this.assertParent(parent); const key = sideParentKey(parent), persisted = this.state.sessions[key];
      const existing = persisted?.exchanges.find(e => e.generation === persisted.generation && e.clientRequestId === input.clientRequestId);
      if (existing) { if (existing.question !== question) throw new SideQuestionError(409, '同一请求ID不能用于不同问题'); return copy(existing); }
      const snapshot = this.latest.get(key) ?? persisted?.snapshot;
      if (!snapshot) throw new SideQuestionError(409, '尚无上下文快照，请先运行主 Agent');
      const session = persisted ?? { parent: copy(parent), generation: 0, snapshot, memory: { history: '', through: 0 }, exchanges: [] };
      if (session.exchanges.some(e => e.status === 'running')) throw new SideQuestionError(409, '当前会话已有旁路问题正在回答');
      if (this.runs.size >= 4) throw new SideQuestionError(429, '旁路请求已达并发上限');
      if ((await this.identity(snapshot.request, parent)).identity !== snapshot.identity) throw new SideQuestionError(409, '模型配置已删除或变化，请先运行主 Agent 更新上下文');
      const preparedQuestion = this.options.prepareQuestion ? await this.options.prepareQuestion(parent, question) : question;
      const next = copy(this.state); const e: SideExchange = { id: randomUUID(), parent: copy(parent), clientRequestId: input.clientRequestId, generation: session.generation,
        ordinal: ++next.ordinal, question, answer: '', status: 'running', model: { provider: snapshot.request.provider, model: snapshot.request.model, identity: snapshot.identity },
        snapshotAt: snapshot.capturedAt, createdAt: new Date().toISOString(), sequence: 0, usage: { inputTokens: 0, outputTokens: 0 } };
      next.sessions[key] = copy(session); next.sessions[key].snapshot = copy(snapshot); next.sessions[key].exchanges.push(e); await this.persist(next);
      const abort = new AbortController();
      // Start after admission releases its serial lock. No parent run signal is shared.
      const done = Promise.resolve().then(() => this.run(copy(e), copy(snapshot), preparedQuestion, copy(session.memory), copy(session.exchanges), abort.signal));
      this.runs.set(e.id, { parent: copy(parent), abort, done });
      void done.then(() => this.runs.delete(e.id), error => { this.runs.delete(e.id); this.report(error); });
      this.publish(e); return copy(e);
    });
  }
  private async update(exchange: SideExchange): Promise<void> {
    await this.serial(async () => {
      const key = sideParentKey(exchange.parent), next = copy(this.state), session = next.sessions[key];
      const found = session?.exchanges.find(e => e.id === exchange.id);
      if (!found || found.status !== 'running' || session.generation !== exchange.generation || found.sequence >= exchange.sequence) return;
      Object.assign(found, copy(exchange)); await this.persist(next); this.publish(found);
    });
  }
  private async run(e: SideExchange, snapshot: SideSnapshot, question: string, memory: SideMemory, history: SideExchange[], abort: AbortSignal): Promise<void> {
    const timeout = new AbortController(); const timer = setTimeout(() => timeout.abort(new Error('旁路请求超过120秒')), 120000); timer.unref();
    const signal = AbortSignal.any([abort, timeout.signal]);
    let toolUse = false;
    const completion = async (request: GenerateOptions, summary: boolean): Promise<string> => {
      signal.throwIfAborted(); let text = '', complete = false; const assembler = new BlockAssembler(); let lastWrite = 0;
      try {
        for await (const chunk of this.ctx.llm.stream({ ...request, signal })) {
          signal.throwIfAborted(); assembler.push(chunk);
          if (chunk.type === 'text-delta') text += chunk.text;
          if (chunk.type === 'block-end' && chunk.block.type === 'text') text = assembler.blocks().filter(block => block.type === 'text').map(block => block.text).join('');
          if (chunk.type === 'tool-call-delta' || chunk.type === 'block-start' && chunk.blockType === 'tool-call' || chunk.type === 'block-end' && chunk.block.type === 'tool-call') toolUse = true;
          if (chunk.type === 'finish') {
            complete = true;
            if (chunk.reason.kind === 'error') throw new Error(chunk.reason.failure.message);
            if (chunk.reason.kind === 'aborted') throw new Error('模型响应中断');
            if (summary && (chunk.reason.kind === 'max-tokens' || toolUse)) throw new Error('旁路摘要未完整生成');
          }
          if (!summary) { e.answer = text; if (Date.now() - lastWrite >= 250) { e.sequence++; await this.update(e); lastWrite = Date.now(); } }
        }
      } finally {
        const usage = assembler.usage;
        if (usage) {
          e.usage.inputTokens += usage.inputTokens; e.usage.outputTokens += usage.outputTokens;
          for (const field of ['cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'] as const) if (usage[field] !== undefined) e.usage[field] = (e.usage[field] ?? 0) + usage[field];
        }
      }
      if (!complete) throw new Error('模型响应中断，请重新提问');
      if (!text.trim()) { if (!summary && toolUse) return '当前旁路提问不能执行工具操作，请在主会话中发出操作请求。'; throw new Error('模型没有返回回答'); }
      return text;
    };
    const builder = new SideContextBuilder(snapshot.request, hash(snapshot), memory, history.filter(item => item.status === 'completed'), snapshot.windowTokens,
      this.options.outputTokens ?? 8192, async request => { e.context = copy(builder.info); e.sequence++; await this.update(e); return completion(request, true); }, async value => {
        signal.throwIfAborted(); await this.serial(async () => {
          const next = copy(this.state), session = next.sessions[sideParentKey(e.parent)];
          if (!session || session.generation !== e.generation || session.exchanges.find(item => item.id === e.id)?.status !== 'running') throw new Error('旁路上下文已清除或取消');
          session.memory = copy(value); await this.persist(next);
        });
      });
    try {
      let priorSize = Infinity;
      for (let attempt = 0; attempt < 2; attempt++) {
        const request = await builder.prepare(question, attempt > 0); e.context = copy(builder.info);
        if (attempt > 0 && builder.info.estimatedInputTokens >= priorSize) throw new Error('旁路压缩未能进一步缩减上下文');
        priorSize = builder.info.estimatedInputTokens;
        try { e.answer = await completion(request, false); break; }
        catch (error) { if (attempt > 0 || e.answer || toolUse || signal.aborted || !/context_length_exceeded|maximum context length|context window|prompt is too long|input is too long|context length exceeded/i.test(error instanceof Error ? error.message : String(error))) throw error; }
      }
      signal.throwIfAborted(); e.status = 'completed';
    } catch (error) { e.status = abort.aborted ? 'cancelled' : 'failed'; e.error = error instanceof Error ? error.message : String(error); }
    finally { clearTimeout(timer); e.context = copy(builder.info); e.sequence++; await this.update(e); }
  }
  async wait(id: string): Promise<SideExchange | undefined> { await this.runs.get(id)?.done; return this.get(id); }
  async cancel(id: string): Promise<SideExchange> {
    const existing = await this.get(id); if (!existing) throw new SideQuestionError(404, '旁路问题不存在');
    const run = this.runs.get(id); run?.abort.abort(new Error('用户取消旁路请求')); await run?.done; return (await this.get(id))!;
  }
  private async deletion(match: (parent: SideParent) => boolean, block: () => void | Promise<void>, unblock: () => void): Promise<{ commit(): Promise<void>; rollback(): Promise<void> }> {
    await this.serial(async () => {
      await block();
      // Fence requests already in flight, including their later turn/end
      // event. A restored parent can capture a new real run after commit.
      for (const [key, parent] of this.captureParents) if (match(parent)) this.captureVersions.set(key, (this.captureVersions.get(key) ?? 0) + 1);
      for (const run of this.runs.values()) if (match(run.parent)) run.abort.abort(new Error('父会话正在删除'));
    });
    try { await Promise.all([...this.runs.values()].filter(run => match(run.parent)).map(run => run.done)); await this.queue; }
    catch (error) { unblock(); throw error; }
    let settled = false;
    return {
      commit: () => this.serial(async () => {
        if (settled) return;
        const next = copy(this.state); for (const [key, session] of Object.entries(next.sessions)) if (match(session.parent)) { delete next.sessions[key]; this.latest.delete(key); }
        await this.persist(next); settled = true; unblock();
      }),
      rollback: () => this.serial(async () => { if (settled) return; settled = true; unblock(); }),
    };
  }
  prepareTaskDelete(taskId: string): Promise<{ commit(): Promise<void>; rollback(): Promise<void> }> {
    return this.deletion(parent => parent.kind === 'task' && parent.id === taskId, () => { if (this.blockedTasks.has(taskId)) throw new SideQuestionError(409, '任务删除已在进行'); this.blockedTasks.add(taskId); }, () => this.blockedTasks.delete(taskId));
  }
  prepareParentDelete(parent: SideParent): Promise<{ commit(): Promise<void>; rollback(): Promise<void> }> {
    const key = sideParentKey(parent); return this.deletion(p => sideParentKey(p) === key, () => { if (this.blockedParents.has(key)) throw new SideQuestionError(409, '会话删除已在进行'); this.blockedParents.add(key); }, () => this.blockedParents.delete(key));
  }
  async clear(parent: SideParent): Promise<void> {
    const key = sideParentKey(parent);
    const barrier = await this.deletion(p => sideParentKey(p) === key, async () => {
      await this.assertParent(parent); this.blockedParents.add(key);
    }, () => this.blockedParents.delete(key));
    try { await this.serial(async () => { const next = copy(this.state), session = next.sessions[sideParentKey(parent)]; if (session) { session.generation++; session.exchanges = []; session.memory = { history: '', through: 0 }; await this.persist(next); } }); }
    finally { await barrier.rollback(); }
  }
  async dispose(): Promise<void> { if (this.stopped) return; this.stopped = true; this.unhook?.(); this.unhookSession?.(); for (const run of this.runs.values()) run.abort.abort(new Error('旁路服务关闭')); await Promise.all([...this.runs.values()].map(run => run.done)); await this.queue; this.listeners.clear(); }
}
export async function installSideQuestions(ctx: Context, options: SideQuestionsOptions): Promise<SideQuestionService> {
  const service = await SideQuestionService.open(ctx, options); ctx.effect(() => () => service.dispose()); return service;
}
