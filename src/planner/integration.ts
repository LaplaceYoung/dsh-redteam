import { randomUUID } from 'node:crypto';
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { GenerateOptions, RequestMessage, StreamChunk } from '@deepseek-ai/dsh-llm';
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session';
import { defineTool, type ToolRunContext, type ToolExecution, type ToolExecutionResult } from '@deepseek-ai/dsh-tools';
import type { JsonValue } from '@deepseek-ai/dsh-util-values';
import type { RedTeamStore } from '../store.js';
import { stampTaskFirstRun } from '../task-management/index.js';
import { createDshPlannerCompletion, createDshPlannerModel, type PlannerTrigger } from './model.js';
import { bootstrapTaskGoals } from './bootstrap.js';
import { PlannerRuntime, type PlannerWorkers, type PlannerOptions } from './runtime.js';
import type { PlatformPrepareRun } from '../platform/contracts.js';
import { GraphCompactor } from '../graph-tools/compaction.js';
import { createDshDigestProvider } from '../graph-tools/digest-model.js';
import type { Constraint } from '../types.js';

export interface PlannerIntegrationConfig extends Omit<PlannerOptions, 'compactor'> {
  maxTurns?: number;
  bootstrapMaxTurns?: number;
  enableGoalMet?: boolean;
  prepareRun?: PlatformPrepareRun;
  constraints?: (taskId: string) => Constraint[];
  /** Host model-chain routing owns readiness and first-run stamping when provided. */
  modelStream?: (call: { taskId: string; parent: Agent; request: GenerateOptions; signal: AbortSignal; final?: boolean; role?: 'goals' | 'planner'; purpose?: 'digest' }) => AsyncIterable<StreamChunk>;
  /** Admission/policy hook, run before each model request and before the default first-run stamp. */
  beforeModelCall?: (call: { taskId: string; parent: Agent; request: Readonly<GenerateOptions>; signal: AbortSignal }) => void | Promise<void>;
  onMessage?: (taskId: string, message: RequestMessage) => void | Promise<void>;
}

export interface PlannerInstallation {
  runtime: PlannerRuntime;
  readonly compactor: GraphCompactor;
  start(taskId: string, parent: Agent): Promise<PlannerStatus>;
  pause(taskId: string, parent: Agent): Promise<PlannerStatus>;
  beginSettling(taskId: string, parent: Agent): Promise<void>;
  park(taskId: string, parent: Agent): Promise<void>;
  finalize(taskId: string, parent: Agent, signal: AbortSignal): Promise<{ met: boolean }>;
  steer(taskId: string, message: string, parent: Agent): Promise<{ taskId: string; hintId: string }>;
  status(taskId: string): PlannerStatus;
  notify(taskId: string, trigger?: PlannerTrigger): void;
  /** Call only after awaiting WorkerRuntime.observe(session,event). */
  notifyWorkerEvent(session: Session, event: SessionEvent): void;
  dispose(): Promise<void>;
}

export interface PlannerStatus {
  taskId: string;
  taskStatus: string;
  attached: boolean;
  runtime?: ReturnType<PlannerRuntime['inspect']>;
  counts: { open: number; claimed: number; running: number; paused: number; done: number; failed: number; stopped: number; exhausted: number; blocked: number };
  lastPlannerEvent?: { kind: string; summary: string; createdAt: string };
}

function json(value: unknown): JsonValue { return JSON.parse(JSON.stringify(value)) as JsonValue; }
function record(value: unknown): Record<string, unknown> | undefined { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function caller(exec: ToolRunContext): Agent {
  if (!exec.agent) throw new Error('Planner tools require a live DSH Agent');
  exec.signal.throwIfAborted();
  return exec.agent;
}

const domainMutations = new Set([
  'redteam_add_asset', 'redteam_plan_intent', 'redteam_worker_finish', 'redteam_kill_worker',
  'redteam_add_edge', 'redteam_record_finding', 'redteam_update_finding',
  'redteam_add_goal', 'redteam_update_goal', 'redteam_prove_goal', 'redteam_delete_goal',
  'redteam_add_constraint', 'redteam_update_constraint', 'redteam_delete_constraint',
  'redteam_add_scope', 'redteam_delete_scope', 'redteam_add_company_scope',
  'redteam_rea_analyze', 'redteam_rea_command',
]);

/** Call inside ctx.inject(['tools','llm',...]). Installation registers tools and owns its teardown. */
export function installPlanner(ctx: Context, store: RedTeamStore, workers: PlannerWorkers, config: PlannerIntegrationConfig): PlannerInstallation {
  const parents = new Map<string, Agent>();
  const observed = new Map<string, number>();
  const finals = new Map<string, Promise<{ met: boolean }>>();
  const lifetime = new AbortController();
  let disposed: Promise<void> | undefined;
  const assertAvailable = () => { if (disposed) throw new Error('planner integration is disposed'); };
  function select(parent: Agent) {
    const { provider, model, maxTokens, reasoningEffort } = parent.options;
    if (!provider?.trim() || !model?.trim()) throw new Error('Parent Agent must select a provider and model before starting Planner');
    if (!config.modelStream && !ctx.llm.listProviders().some((route) => route.id === provider)) throw new Error(`Parent Agent provider is not registered: ${provider}`);
    return { provider, model, maxTokens, reasoningEffort };
  }
  function modelStream(taskId: string, parent: Agent, signal: AbortSignal, route: ReturnType<typeof select>, final = false, role?: 'goals' | 'planner', purpose?: 'digest') {
    return {
      async *stream(request: GenerateOptions) {
        signal.throwIfAborted();
        const dispatched = { ...request, ...(route.reasoningEffort === undefined ? {} : { reasoningEffort: route.reasoningEffort }), ...(purpose === 'digest' ? { sessionId: parent.id } : {}) };
        await config.beforeModelCall?.({ taskId, parent, request: dispatched, signal });
        signal.throwIfAborted();
        if (config.modelStream) yield* config.modelStream({ taskId, parent, request: dispatched, signal: request.signal ?? signal, final, role, ...(purpose ? { purpose } : {}) });
        else {
          if (!final) await store.transaction((state) => { stampTaskFirstRun(state, taskId); });
          signal.throwIfAborted();
          yield* ctx.llm.stream(dispatched);
        }
      }
    };
  }
  const compactor: GraphCompactor = new GraphCompactor(store, {
    provider: { async generate(input, signal) {
      const parent = parents.get(input.taskId);
      if (!parent) throw new Error(`Compactor parent is not attached: ${input.taskId}`);
      const route = select(parent);
      return createDshDigestProvider(modelStream(input.taskId, parent, signal, route, false, 'planner', 'digest'), () => route).generate(input, signal);
    } },
    isTaskActive(state, taskId): boolean {
      const run = runtime.inspect(taskId), task = state.tasks.find(task => task.id === taskId);
      return !lifetime.signal.aborted && runtime.owns(taskId) && !!run && !run.stopping && !run.settling && task?.status === 'running' && !task.queued;
    },
    onError: (taskId, error) => (config.onError ?? ((error, taskId) => ctx.logger?.error?.(`Compactor ${taskId}: ${error instanceof Error ? error.message : String(error)}`)))(error, taskId),
  });
  const runtime: PlannerRuntime = new PlannerRuntime(store, workers, {
    async plan(context, signal) {
      const parent = parents.get(context.taskId);
      if (!parent) throw new Error(`Planner parent is not attached: ${context.taskId}`);
      const route = select(parent);
      // Resolve the actual parent's route every round; never invent a default provider/model.
      const model = createDshPlannerModel(modelStream(context.taskId, parent, signal, route), { provider: route.provider, model: route.model, maxTokens: route.maxTokens, maxTurns: config.maxTurns, enableGoalMet: config.enableGoalMet, onMessage: config.onMessage, constraints: config.constraints, prepareRun: config.prepareRun ? input => config.prepareRun!({ ...input, parent, sessionId: parent.id }) : undefined });
      return model.plan(context, signal);
    }
  }, {
    ...config,
    compactor,
    bootstrap: config.bootstrap ?? (async (taskId, parent, signal) => {
      const route = select(parent);
      return bootstrapTaskGoals(store, taskId, createDshPlannerCompletion(modelStream(taskId, parent, signal, route, false, 'goals')), signal, { provider: route.provider, model: route.model, maxTokens: route.maxTokens, maxTurns: config.bootstrapMaxTurns, onMessage: config.onMessage, prepareRun: config.prepareRun ? input => config.prepareRun!({ ...input, parent, sessionId: parent.id }) : undefined });
    }),
    onError: config.onError ?? ((error, taskId) => ctx.logger?.error?.(`Planner ${taskId}: ${error instanceof Error ? error.message : String(error)}`))
  });

  function task(taskId: string) {
    const task = store.snapshot().tasks.find((row) => row.id === taskId);
    if (!task) throw new Error(`task not found: ${taskId}`);
    return task;
  }
  function authorize(taskId: string, parent: Agent): void {
    task(taskId);
    const owner = runtime.inspect(taskId)?.parentSessionId;
    if (owner && owner !== parent.id) throw new Error(`Planner belongs to another parent session: ${taskId}`);
    const foreign = store.snapshot().intents.find((row) => row.taskId === taskId && ['open', 'claimed', 'running'].includes(row.state) && row.execution && row.execution.parentSessionId !== parent.id);
    if (foreign) throw new Error(`Task contains a worker owned by another parent session: ${foreign.id}`);
  }

  const disposers: Array<() => void> = [];
  const installation: PlannerInstallation = {
    runtime,
    compactor,
    async start(taskId, parent) {
      assertAvailable(); authorize(taskId, parent);
      const current = task(taskId);
      if (['done', 'failed', 'timeout'].includes(current.status)) return installation.status(taskId);
      if ('queued' in current && current.queued) throw new Error('Task is queued; its task admission controller must grant a slot before Planner starts');
      select(parent);
      if (!runtime.owns(taskId)) finals.delete(taskId);
      parents.set(taskId, parent);
      await runtime.start(taskId, parent);
      await runtime.flush(taskId);
      return installation.status(taskId);
    },
    async pause(taskId, parent) {
      assertAvailable(); authorize(taskId, parent);
      await runtime.pause(taskId);
      parents.delete(taskId);
      return installation.status(taskId);
    },
    async beginSettling(taskId, parent) {
      assertAvailable(); authorize(taskId, parent);
      await runtime.beginSettling(taskId, parent);
      await workers.beginTaskTimeout?.(taskId);
    },
    async park(taskId, parent) {
      assertAvailable(); authorize(taskId, parent);
      await runtime.park(taskId, parent); parents.delete(taskId);
    },
    async finalize(taskId, parent, signal) {
      assertAvailable(); authorize(taskId, parent);
      const existing = finals.get(taskId);
      if (existing) return existing;
      const operation = (async () => {
        const independent = AbortSignal.any([signal, lifetime.signal]);
        const route = select(parent);
        const model = createDshPlannerModel(modelStream(taskId, parent, independent, route, true), { provider: route.provider, model: route.model, maxTokens: route.maxTokens, maxTurns: config.maxTurns, final: true, onMessage: config.onMessage, constraints: config.constraints, prepareRun: config.prepareRun ? input => config.prepareRun!({ ...input, parent, sessionId: parent.id }) : undefined });
        return runtime.finalize(taskId, parent, independent, model);
      })();
      finals.set(taskId, operation);
      return operation;
    },
    async steer(taskId, message, parent) {
      assertAvailable(); authorize(taskId, parent);
      if (!message.trim()) throw new Error('Planner steering message cannot be blank');
      if (!runtime.inspect(taskId) || task(taskId).status !== 'running') throw new Error('Start Planner before sending it a steering hint');
      const hint = await store.addNode({ id: randomUUID(), taskId, kind: 'fact', label: message.trim(), data: { kind: 'strategic_hint', source: 'human', parentSessionId: parent.id } });
      runtime.notify(taskId, { kind: 'hint', hints: [message.trim()] });
      return { taskId, hintId: hint.id };
    },
    status(taskId) {
      const current = task(taskId);
      const snapshot = store.snapshot();
      const counts = { open: 0, claimed: 0, running: 0, paused: 0, done: 0, failed: 0, stopped: 0, exhausted: 0, blocked: 0 };
      for (const intent of snapshot.intents) if (intent.taskId === taskId) counts[intent.state]++;
      const last = [...snapshot.traces].reverse().find((row) => row.taskId === taskId && row.worker === 'planner');
      const state = runtime.inspect(taskId);
      return { taskId, taskStatus: current.status, attached: !!state, ...(state ? { runtime: state } : {}), counts, ...(last ? { lastPlannerEvent: { kind: last.kind, summary: last.summary, createdAt: last.createdAt } } : {}) };
    },
    notify(taskId, trigger) { if (!disposed && runtime.owns(taskId)) runtime.notify(taskId, trigger); },
    notifyWorkerEvent(session, event) {
      if (disposed || event.type !== 'turn/end') return;
      if (event.seq <= (observed.get(session.id) ?? -1)) return;
      const intent = store.snapshot().intents.find((row) => row.execution?.childSessionId === session.id);
      // Ignore an out-of-order event which WorkerRuntime did not commit as current.
      if (!intent || !runtime.owns(intent.taskId) || intent.execution!.lastEventSeq !== event.seq) return;
      observed.set(session.id, event.seq);
      runtime.notify(intent.taskId, { kind: 'done', intentId: intent.id, detail: event.data.reason.kind });
    },
    dispose() {
      return disposed ??= (async () => {
        lifetime.abort(new Error('Planner integration disposed'));
        for (const dispose of disposers.splice(0).reverse()) dispose();
        await compactor.dispose();
        await Promise.allSettled(finals.values());
        await runtime.dispose();
        parents.clear(); observed.clear(); finals.clear();
      })();
    }
  };

  const output = { schema: { type: 'json' as const }, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }] };
  disposers.push(ctx.tools.register(defineTool({
    name: 'redteam_start_planner', description: 'Start the autonomous ARTEX Planner for this task using the calling Agent provider/model. Runs the first pending plan and fills native Worker slots; later events continue scheduling automatically.',
    parameters: { task_id: { type: 'string', required: true } }, output,
    execute: async (args: { task_id: string }, exec: ToolRunContext) => json(await installation.start(args.task_id, caller(exec)))
  })));
  disposers.push(ctx.tools.register(defineTool({
    name: 'redteam_pause_planner', description: 'Pause this task, cancel in-flight planning, drain its native Workers, and retain their confirmed conversations for resume.',
    parameters: { task_id: { type: 'string', required: true } }, output,
    execute: async (args: { task_id: string }, exec: ToolRunContext) => json(await installation.pause(args.task_id, caller(exec)))
  })));
  disposers.push(ctx.tools.register(defineTool({
    name: 'redteam_steer_planner', description: 'Persist a strategic hint on this running task and wake its Planner. Returns a hint receipt; does not claim a new plan has completed.',
    parameters: { task_id: { type: 'string', required: true }, message: { type: 'string', required: true } }, output,
    execute: async (args: { task_id: string; message: string }, exec: ToolRunContext) => json(await installation.steer(args.task_id, args.message, caller(exec)))
  })));
  disposers.push(ctx.tools.register(defineTool({
    name: 'redteam_planner_status', description: 'Read this task status, attached Planner owner, pending activity, Worker counts, and latest Planner result/error.',
    parameters: { task_id: { type: 'string', required: true } }, output,
    execute: async (args: { task_id: string }) => json(installation.status(args.task_id))
  })));
  const notifyTool = (exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): undefined => {
    if (result.isError || !domainMutations.has(exec.name)) return;
    const args = record(exec.arguments);
    const value = record(result.value);
    const taskId = typeof args?.task_id === 'string' ? args.task_id : typeof value?.taskId === 'string' ? value.taskId : undefined;
    if (taskId) installation.notify(taskId, { kind: exec.name.includes('finding') ? 'finding' : 'change', detail: exec.name });
  };
  // Worker agents are sibling scopes; an agent-local listener cannot see their writes.
  disposers.push(ctx.root.on('tools/result', notifyTool));
  ctx.effect(() => () => installation.dispose());
  return installation;
}
