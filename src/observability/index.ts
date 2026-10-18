import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { GenerateOptions, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm';
import { defineTool, type ToolExecution, type ToolExecutionResult } from '@deepseek-ai/dsh-tools';
import { ObservabilityRepository } from './repository.js';
import type { Attribution, CommandRow, LlmRecord, RecordFilter, UsageRow } from './model.js';
import { installWireCapture, observeWire, wireRecord } from './wire.js';
import { isNoaRedispatchedRequest } from '../system-runtime/compaction-host.js';
export { ObservabilityRepository } from './repository.js';
export type { Attribution, CommandRow, LlmRecord, RecordFilter, UsageRow } from './model.js';
export { installObservabilityHttp } from './http.js';

const attribution = new AsyncLocalStorage<Attribution>();
/** Auxiliary calls without a durable session carry explicit identity across asynchronous work. */
export function withObservation<T>(identity: Attribution, call: () => T): T { return attribution.run(identity, call); }
/** Stream factories are lazy: keep attribution active for every next/return, including external consumers. */
export async function* withObservationStream<T>(identity: Attribution, create: () => AsyncIterable<T>): AsyncGenerator<T> {
  const iterator = attribution.run(identity, () => create()[Symbol.asyncIterator]()); let completed = false;
  try {
    while (true) { const item = await attribution.run(identity, () => iterator.next()); if (item.done) { completed = true; return; } yield item.value; }
  } finally { if (!completed && iterator.return) await attribution.run(identity, () => iterator.return!()); }
}

export interface ObservabilityOptions {
  path?: string;
  resolveCall(request: GenerateOptions): Attribution | undefined;
  resolveAgent(agent: Agent): Attribution | undefined;
  onError?(error: unknown): void;
}
interface Started { id: string; identity: Attribution; time: number; startedAt: string; dispatched: boolean; denied?: boolean; finish(): void }
interface SharedRuntime {
  repository: ObservabilityRepository;
  owners: Set<ObservabilityOptions>;
  pending: Set<Promise<void>>;
  active: Set<Promise<void>>;
  remove: (() => void)[];
  removeWire: () => void;
  removeResult: () => void;
}
const installations = new WeakMap<Context, Map<string, SharedRuntime>>();

function classify(result: Readonly<ToolExecutionResult>): Pick<CommandRow, 'status' | 'truncated' | 'exitCode'> {
  let status: CommandRow['status'] = result.isError ? 'error' : 'ok';
  const code = result.isError ? result.error.info?.code ?? '' : '';
  if (/DENIED|DECLINED|REJECTED/.test(code)) status = 'denied';
  else if (/TIMEOUT|TIMED_OUT/.test(code)) status = 'timeout';
  else if (/ABORT|CANCEL/.test(code)) status = 'aborted';
  const value = !result.isError && result.value && typeof result.value === 'object' && !Array.isArray(result.value) ? result.value : undefined;
  if (value?.timedOut === true) status = 'timeout'; else if (value?.aborted === true) status = 'aborted';
  const sandbox = value?.sandbox;
  if (sandbox && typeof sandbox === 'object' && !Array.isArray(sandbox) && sandbox.denied === true) status = 'denied';
  const exitCode = typeof value?.exitCode === 'number' ? value.exitCode : undefined;
  if (status === 'ok' && exitCode !== undefined && exitCode !== 0) status = 'error';
  const truncated = ['stdout', 'stderr'].some(key => { const stream = value?.[key]; return stream && typeof stream === 'object' && !Array.isArray(stream) && stream.truncated === true; });
  return { status, truncated, ...(exitCode === undefined ? {} : { exitCode }) };
}

function createRuntime(ctx: Context, repository: ObservabilityRepository): SharedRuntime {
  const runtime: SharedRuntime = { repository, owners: new Set(), pending: new Set(), active: new Set(), remove: [], removeWire: installWireCapture(), removeResult: () => {} };
  const started = new WeakMap<object, Started>();
  const report = (error: unknown) => { const handler = [...runtime.owners].find(owner => owner.onError)?.onError; if (handler) handler(error); else console.error('[redteam-observability]', error); };
  const track = (operation: Promise<void>) => { runtime.pending.add(operation); operation.catch(report).finally(() => runtime.pending.delete(operation)); };
  const resolveCall = (request: GenerateOptions): Attribution | undefined => {
    const inherited = attribution.getStore(), selected = [...runtime.owners].map(owner => owner.resolveCall(request)).find(Boolean);
    if (!inherited && !selected) return;
    return { ...inherited, ...selected, ...(inherited?.runId ? { runId: inherited.runId } : {}), ...(inherited?.intentId ? { intentId: inherited.intentId } : {}), ...(inherited?.explorationId ? { explorationId: inherited.explorationId } : {}) };
  };
  const resolveAgent = (agent: Agent | undefined): Attribution | undefined => agent ? [...runtime.owners].map(owner => owner.resolveAgent(agent)).find(Boolean) : attribution.getStore();
  runtime.remove.push(ctx.root.on('llm/stream', (request, next) => {
    const identity = resolveCall(request); if (!identity) return next();
    return (async function* () {
      const startedAt = new Date().toISOString(), start = performance.now(), recording = (await repository.snapshot()).recording;
      let finishCall!: () => void;
      const completion = new Promise<void>(resolve => { finishCall = resolve; }); runtime.active.add(completion);
      const { signal: _signal, ...body } = request;
      const savedRequest = recording ? structuredClone(body) : undefined;
      const wire = recording ? { attempts: [] } : undefined;
      const chunks: StreamChunk[] = []; let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
      let status: UsageRow['status'] = 'aborted', error: unknown;
      try {
        for await (const chunk of observeWire(wire, next())) {
          if (recording) chunks.push(structuredClone(chunk));
          // DSH usage chunks carry whole-call disjoint counters, not additive provider deltas.
          if (chunk.type === 'usage') usage = { ...chunk.usage };
          if (chunk.type === 'finish') {
            status = chunk.reason.kind === 'error' ? 'error' : chunk.reason.kind === 'aborted' ? 'aborted' : 'ok';
            if ('failure' in chunk.reason) error = chunk.reason.failure;
          }
          yield chunk;
        }
      } catch (cause) { status = request.signal?.aborted ? 'aborted' : 'error'; error = cause instanceof Error ? { name: cause.name, message: cause.message } : String(cause); throw cause; }
      finally {
        const row: UsageRow = { ...identity, ...(request.sessionId ? { sessionId: request.sessionId } : {}), id: randomUUID(), startedAt, endedAt: new Date().toISOString(), durationMs: Math.round(performance.now() - start), provider: request.provider, model: request.model, ...(request.purpose ? { purpose: request.purpose } : {}), status, usage, ...(error === undefined ? {} : { error }) };
        const record: LlmRecord | undefined = savedRequest && wire ? { ...row, request: savedRequest, chunks, wire: wireRecord(wire) } : undefined;
        try { if (!isNoaRedispatchedRequest(request)) await repository.appendCall(row, record); } catch (failure) { report(failure); }
        finally { runtime.active.delete(completion); finishCall(); }
      }
    })();
  }));
  runtime.remove.push(ctx.root.on('tools/pre-execute', async (exec, next) => {
    const identity = resolveAgent(exec.agent);
    if (identity) {
      let settle!: () => void; const completion = new Promise<void>(resolve => { settle = resolve; }); runtime.active.add(completion);
      const start: Started = { id: randomUUID(), identity, time: performance.now(), startedAt: new Date().toISOString(), dispatched: false, finish: () => { runtime.active.delete(completion); settle(); } }; started.set(exec.token, start);
      try { await repository.appendCommand({ ...identity, id: start.id, callId: exec.callId, rootCallId: exec.rootCallId, tool: exec.name, input: structuredClone(exec.arguments), startedAt: start.startedAt, endedAt: start.startedAt, status: 'running', dispatched: false, truncated: false, result: null }); }
      catch (error) { report(error); }
    }
    const decision = await next();
    if (decision.kind === 'deny') { const start = started.get(exec.token); if (start) start.denied = true; }
    return decision;
  }));
  runtime.remove.push(ctx.root.on('tools/execute', async (exec, next) => {
    const start = started.get(exec.token); if (start) start.dispatched = true;
    return next();
  }));
  runtime.removeResult = ctx.root.on('tools/result', (exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>) => {
    const start = started.get(exec.token), identity = start?.identity ?? resolveAgent(exec.agent); if (!identity) return;
    started.delete(exec.token);
    const endedAt = new Date().toISOString();
    const row: CommandRow = { ...identity, ...(exec.agent ? { agentId: exec.agent.id, sessionId: exec.agent.id } : {}), id: start?.id ?? randomUUID(), callId: exec.callId, rootCallId: exec.rootCallId, tool: exec.name, input: structuredClone(exec.arguments), startedAt: start?.startedAt ?? endedAt, endedAt, ...(start ? { durationMs: Math.round(performance.now() - start.time) } : {}), dispatched: start?.dispatched ?? false, ...classify(result), ...(start?.denied ? { status: 'denied' as const } : {}), result: structuredClone(result) };
    track(repository.appendCommand(row).finally(() => start?.finish())); return undefined;
  });
  return runtime;
}

export function installObservability(ctx: Context, store: { storagePath: string }, options: ObservabilityOptions) {
  const repository = new ObservabilityRepository(options.path ?? join(dirname(store.storagePath), 'observability.json'));
  const key = process.platform === 'win32' ? repository.path.toLowerCase() : repository.path;
  let paths = installations.get(ctx.root); if (!paths) { paths = new Map(); installations.set(ctx.root, paths); }
  let runtime = paths.get(key); if (!runtime) { runtime = createRuntime(ctx, repository); paths.set(key, runtime); }
  const owned = runtime; owned.owners.add(options); let disposal: Promise<void> | undefined;
  const flush = async () => { while (owned.pending.size || owned.active.size) await Promise.all([...owned.pending, ...owned.active]); };
  const removeTool = ctx.tools.register(defineTool({ name: 'redteam_observability', description: 'Inspect recorded LLM calls, always-on token metering and actual tool executions; manage body recording and delete exact-task traces.', parameters: {
    action: { type: 'string', enum: ['settings', 'recording', 'records', 'record', 'tasks', 'delete_records', 'commands', 'tool_stats', 'usage'], required: true },
    filter: { type: 'json' }, id: { type: 'string' }, taskId: { type: 'string' }, enabled: { type: 'boolean' }, group: { type: 'string', enum: ['model', 'profile', 'day'] },
  }, output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }, execute: async (args) => {
    await Promise.all([...owned.pending]); const filter = validateFilter(args.filter);
    let result: unknown;
    switch (args.action) {
      case 'settings': result = { enabled: (await repository.snapshot()).recording }; break;
      case 'recording': if (typeof args.enabled !== 'boolean') throw new Error('enabled is required'); result = await repository.setRecording(args.enabled); break;
      case 'records': result = await repository.records(filter); break;
      case 'record': if (!args.id) throw new Error('id is required'); result = await repository.detail(args.id); break;
      case 'tasks': result = await repository.tasks(); break;
      case 'delete_records': if (!args.taskId) throw new Error('taskId is required'); result = { deleted: await repository.deleteRecords(args.taskId) }; break;
      case 'commands': result = await repository.commands(filter); break;
      case 'tool_stats': result = await repository.toolStats(filter); break;
      case 'usage': result = await repository.usage(filter, args.group); break;
      default: throw new Error('Unknown observability action');
    }
    return JSON.parse(JSON.stringify(result));
  } }));
  const dispose = () => disposal ??= (async () => { removeTool(); owned.owners.delete(options); const last = !owned.owners.size; if (last) { owned.remove.reverse().forEach(remove => remove()); paths.delete(key); } await flush(); if (last) { owned.removeResult(); owned.removeWire(); } })();
  ctx.effect(() => dispose);
  return { repository, ready: repository.snapshot().then(() => {}), flush, dispose };
}

export function validateFilter(value: unknown): RecordFilter {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('filter must be an object');
  const fields = new Set(['taskId', 'sessionId', 'agentId', 'runId', 'profileId', 'role', 'model', 'provider', 'status', 'tool', 'q', 'from', 'until']);
  const filter: RecordFilter = {};
  for (const [key, item] of Object.entries(value)) {
    if (fields.has(key)) { if (typeof item !== 'string') throw new Error(key + ' must be a string'); Object.assign(filter, { [key]: item }); }
    else if (key === 'offset' || key === 'limit') { if (!Number.isSafeInteger(item) || Number(item) < (key === 'offset' ? 0 : 1) || key === 'limit' && Number(item) > 1000) throw new Error('Invalid pagination'); Object.assign(filter, { [key]: item }); }
    else throw new Error('Unknown filter: ' + key);
  }
  for (const key of ['from', 'until'] as const) if (filter[key] !== undefined) { const parsed = new Date(filter[key]); if (!Number.isFinite(parsed.valueOf())) throw new Error('Invalid ' + key); filter[key] = parsed.toISOString(); }
  return filter;
}
