import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm';
import type { RedTeamStore } from '../store.js';
import type { PlannerInstallation, PlannerStatus } from '../planner/integration.js';
import { admitManagedTask, expiredTaskIds, finishManagedTask, isTerminalTask, pauseManagedTask, reconcileTaskAdmission, requireManagedTask, stampTaskFirstRun } from './index.js';
import { TaskModelRouter, taskModelChunkCommitsOutput, type TaskModelSelection, type TaskModelRoute, type TaskModelRole, type TaskProfileResolver, type TaskModelPoolAttempt, type TaskModelRouterOptions } from './runtime-model.js';
import { registerTaskLifecycleScope } from './runtime-scope.js';
import { deleteManagedTaskData, type TaskDeleteOptions, type TaskDeleteResult } from './deletion.js';
import { setNativeModelAttribution, clearNativeModelAttribution } from '../system-runtime/model-attribution.js';

/** These are execution operations: callers must supply the real Planner installation. */
export interface LifecyclePlanner extends Pick<PlannerInstallation, 'start' | 'pause' | 'status'> {
  park(taskId: string, parent: Agent): Promise<void>;
  beginSettling(taskId: string, parent: Agent): Promise<void>;
  finalize(taskId: string, parent: Agent, signal: AbortSignal): Promise<{ met: boolean }>;
}
export interface TaskLifecycleOptions {
  concurrency: number;
  enabled?: boolean;
  autoPoll?: boolean;
  pollMs?: number;
  now?: () => Date;
  onError?: (error: unknown, taskId?: string) => void;
  /** Fence/drain other task writers; commit/rollback owns releasing that fence. */
  prepareTaskDelete?: (taskId: string) => Promise<{ commit(): Promise<void>; rollback(): Promise<void> }>;
}
interface Binding {
  owner: TaskLifecycleRuntime; parent: Agent; taskId: string; settling: boolean;
  starting?: Promise<PlannerStatus>; finalizing?: Promise<void>;
  finalResult?: boolean;
}
/** Conversation attribution can exist before an execution owner is chosen. */
export interface TaskAgentBinding {
  owner: TaskLifecycleRuntime; taskId: string; settling: boolean; parent?: Agent;
}
const bindings = new Map<string, Binding>();
const conversationAliases = new Map<string, { runtime: TaskLifecycleRuntime; taskId: string; agent: Agent }>();
const admissionLocks = new Map<string, Promise<void>>();
const deletionCommits = new Map<string, () => Promise<void>>();
const keyFor = (store: RedTeamStore, id: string) => `${process.platform === 'win32' ? store.storagePath.toLowerCase() : store.storagePath}\0${id}`;
function parentRoute(parent: Agent): TaskModelRoute {
  const { provider, model, maxTokens, reasoningEffort } = parent.options;
  if (!provider || !model) throw new Error('Task parent must select a real provider and model');
  return { provider, model, ...(maxTokens === undefined ? {} : { maxTokens }), ...(reasoningEffort === undefined ? {} : { reasoningEffort }) };
}

/** Owns actual admissions, model-call clock stamps and FINAL coordination, across agent scopes. */
export class TaskLifecycleRuntime {
  private readonly lifetime = new AbortController();
  private readonly parentTasks = new Map<string, string>();
  private readonly active = new Map<string, number>();
  private readonly errors: unknown[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private tick?: Promise<void>;
  private readonly now: () => Date;
  private readonly startPlanner: LifecyclePlanner['start'];
  private readonly pausePlanner: LifecyclePlanner['pause'];
  private policy: { enabled: boolean; limit: number };

  constructor(readonly store: RedTeamStore, readonly planner: LifecyclePlanner, readonly models: TaskModelRouter, private readonly options: TaskLifecycleOptions) {
    if (!Number.isSafeInteger(options.concurrency) || options.concurrency < 1) throw new Error('task concurrency must be positive');
    if (options.pollMs !== undefined && (!Number.isFinite(options.pollMs) || options.pollMs <= 0)) throw new Error('pollMs must be positive');
    this.now = options.now ?? (() => new Date());
    this.policy = { enabled: options.enabled ?? true, limit: options.concurrency };
    this.startPlanner = planner.start.bind(planner); this.pausePlanner = planner.pause.bind(planner);
  }
  private owned(): Binding[] { return [...bindings.values()].filter(b => b.owner === this); }
  get disposed(): boolean { return this.lifetime.signal.aborted; }
  admission(): { enabled: boolean; limit: number } { return { ...this.policy }; }
  async setAdmission(policy: { enabled: boolean; limit: number }): Promise<void> {
    if (typeof policy.enabled !== 'boolean' || !Number.isSafeInteger(policy.limit) || policy.limit < 1) throw new Error('task admission requires enabled boolean and positive integer limit');
    this.lifetime.signal.throwIfAborted();
    this.policy = { ...policy };
    if (this.tick) await this.tick;
    await this.step();
  }
  private peers(): Binding[] { return [...bindings.values()].filter(b => b.owner.store.storagePath === this.store.storagePath); }
  private binding(id: string): Binding {
    return bindings.get(keyFor(this.store, id)) ?? (() => { throw new Error(`task has no attached parent: ${id}`); })();
  }
  private async serial<T>(operation: () => Promise<T>): Promise<T> {
    const key = keyFor(this.store, ''); const previous = admissionLocks.get(key) ?? Promise.resolve();
    const result = previous.then(operation); const settled = result.then(() => {}, () => {});
    admissionLocks.set(key, settled);
    try { return await result; } finally { if (admissionLocks.get(key) === settled) admissionLocks.delete(key); }
  }
  private report(error: unknown, taskId?: string): void { this.errors.push(error); this.options.onError?.(error, taskId); }
  bindParent(taskId: string, parent: Agent): void {
    this.lifetime.signal.throwIfAborted(); requireManagedTask(this.store.snapshot(), taskId);
    const existing = bindings.get(keyFor(this.store, taskId));
    if (existing && existing.parent.id !== parent.id) throw new Error(`task belongs to another parent: ${taskId}`);
    if (!existing) bindings.set(keyFor(this.store, taskId), { owner: this, parent, taskId, settling: false });
    (existing?.owner ?? this).parentTasks.set(parent.id, taskId);
    this.arm();
  }
  /** Attach a chat segment without claiming the task's Planner execution owner. */
  attachConversation(taskId: string, agent: Agent): () => void {
    this.lifetime.signal.throwIfAborted(); requireManagedTask(this.store.snapshot(), taskId);
    if (this.store.snapshot().intents.some(row => row.execution?.childSessionId === agent.id)) throw new Error('Worker sessions cannot be attached as task conversations');
    const key = keyFor(this.store, agent.id), previous = conversationAliases.get(key);
    if (previous) throw new Error(`Conversation already attached: ${agent.id}`);
    const alias = { runtime: this, taskId, agent }; conversationAliases.set(key, alias);
    const remove = () => { if (conversationAliases.get(key) === alias) conversationAliases.delete(key); };
    agent.ctx.effect(() => remove);
    return remove;
  }
  /** Resume persisted task clocks/FIFO after resolving their actual DSH parent Agent handles. */
  async recover(resolveParent: (taskId: string) => Promise<Agent | undefined>): Promise<string[]> {
    await this.store.load(); const missing: string[] = [];
    for (const task of this.store.snapshot().tasks) {
      if (isTerminalTask(task.status) || task.status === 'draft') continue;
      const parent = await resolveParent(task.id);
      if (!parent) { missing.push(task.id); continue; }
      this.bindParent(task.id, parent);
    }
    await this.step();
    for (const binding of this.owned()) {
      const task = requireManagedTask(this.store.snapshot(), binding.taskId);
      if (task.status === 'running' && !task.queued && !binding.settling) await this.launch(binding);
    }
    return missing;
  }
  taskForAgent(agentId: string): { binding: TaskAgentBinding; role: 'mainagent' | 'worker' } | undefined {
    const alias = conversationAliases.get(keyFor(this.store, agentId));
    if (alias) {
      if (alias.runtime !== this || this.disposed || !this.store.snapshot().tasks.some(row => row.id === alias.taskId)) return;
      const binding = bindings.get(keyFor(this.store, alias.taskId));
      return { binding: binding ?? { owner: this, taskId: alias.taskId, settling: false }, role: 'mainagent' };
    }
    const intent = this.store.snapshot().intents.find(row => row.execution?.childSessionId === agentId);
    const taskId = intent?.taskId ?? this.parentTasks.get(agentId);
    if (!taskId) return;
    const binding = bindings.get(keyFor(this.store, taskId));
    if (binding?.owner !== this) return;
    return { binding, role: intent ? 'worker' : 'mainagent' };
  }
  private async readiness(): Promise<Map<string, { normal: boolean; final: boolean }>> {
    const ready = new Map<string, { normal: boolean; final: boolean }>();
    for (const binding of this.peers()) {
      const task = this.store.snapshot().tasks.find(t => t.id === binding.taskId);
      if (!task) continue;
      const [planner, worker, goals] = await Promise.all([
        binding.owner.models.selectRoute(binding.taskId, parentRoute(binding.parent), 'planner'),
        binding.owner.models.selectRoute(binding.taskId, parentRoute(binding.parent), 'worker'),
        this.store.snapshot().goals.some(goal => goal.taskId === binding.taskId) ? Promise.resolve({ available: true }) : binding.owner.models.selectRoute(binding.taskId, parentRoute(binding.parent), 'goals'),
      ]);
      ready.set(binding.taskId, { normal: planner.available && worker.available && goals.available, final: planner.available });
    }
    return ready;
  }
  async start(taskId: string, parent: Agent, action?: 'start' | 'resume' | 'rerun'): Promise<PlannerStatus> {
    await this.store.load(); this.bindParent(taskId, parent); const binding = this.binding(taskId);
    if (binding.owner !== this) return binding.owner.start(taskId, parent, action);
    const task = requireManagedTask(this.store.snapshot(), taskId);
    if (isTerminalTask(task.status) && action !== 'rerun') return this.planner.status(taskId);
    if (binding.settling && action !== 'rerun') throw new Error('task is completing its timeout FINAL round');
    await this.serial(async () => {
      const ready = await this.readiness();
      await this.store.transaction(state => admitManagedTask(state, taskId, {
        ...this.policy,
        ready: row => ready.get(row.id)?.normal === true,
        hasGoals: row => state.goals.some(g => g.taskId === row.id),
      }, action ?? (requireManagedTask(state, taskId).status === 'paused' ? 'resume' : 'start'), this.now()));
      if (action === 'rerun') { binding.settling = false; delete binding.finalResult; }
    });
    const admitted = requireManagedTask(this.store.snapshot(), taskId);
    if (admitted.queued) return this.planner.status(taskId);
    return this.launch(binding);
  }
  private launch(binding: Binding): Promise<PlannerStatus> {
    if (binding.starting) return binding.starting;
    const run = binding.owner.startPlanner(binding.taskId, binding.parent);
    binding.starting = run;
    void run.then(() => { binding.starting = undefined; binding.owner.arm(); }, error => { binding.starting = undefined; binding.owner.report(error, binding.taskId); binding.owner.arm(); });
    return run;
  }
  async pause(taskId: string, parent: Agent): Promise<PlannerStatus> {
    const binding = this.binding(taskId); if (binding.parent.id !== parent.id) throw new Error('task belongs to another parent');
    if (binding.owner !== this) return binding.owner.pause(taskId, parent);
    if (binding.settling) throw new Error('timeout FINAL is independent of ordinary task pause');
    await this.serial(async () => { await this.store.transaction(state => pauseManagedTask(state, taskId, this.now())); });
    const result = await this.pausePlanner(taskId, parent); await this.step(); return result;
  }
  async deleteTask(taskId: string, parent: Agent, options: TaskDeleteOptions = {}): Promise<TaskDeleteResult> {
    await this.store.load(); this.lifetime.signal.throwIfAborted();
    const attached = bindings.get(keyFor(this.store, taskId));
    if (attached && attached.parent.id !== parent.id) throw new Error('task belongs to another parent');
    if (attached && attached.owner !== this) return attached.owner.deleteTask(taskId, parent, options);
    const result = await this.serial(async () => {
      const deletionKey = keyFor(this.store, taskId);
      const pendingCommit = deletionCommits.get(deletionKey);
      if (pendingCommit) { await pendingCommit(); deletionCommits.delete(deletionKey); }
      if (!this.store.snapshot().tasks.some(task => task.id === taskId)) return { taskId, deleted: false, assetsDeleted: 0, assetsDetached: 0, findingsDeleted: 0 };
      const prepared = await this.options.prepareTaskDelete?.(taskId);
      let committed = false;
      try {
        // FINAL owns a separate run. Let it finish before stopping the ordinary execution tree.
        await attached?.finalizing;
        await this.pausePlanner(taskId, parent);
        await Promise.allSettled([attached?.starting]); // pause drained/aborted this actual run.
        const deleted = await this.store.transaction(state => deleteManagedTaskData(state, taskId, options));
        committed = true;
        bindings.delete(keyFor(this.store, taskId));
        if (this.parentTasks.get(parent.id) === taskId) this.parentTasks.delete(parent.id);
        if (prepared) deletionCommits.set(deletionKey, () => prepared.commit());
        try { await prepared?.commit(); deletionCommits.delete(deletionKey); }
        catch (error) { throw new Error(`task deleted; conversation cleanup failed: ${String(error)}`, { cause: error }); }
        return deleted;
      } catch (error) {
        if (prepared && !committed) {
          try { await prepared.rollback(); }
          catch (rollback) { throw new AggregateError([error, rollback], 'task deletion and writer rollback failed'); }
        }
        throw error;
      }
    });
    await this.step(); return result;
  }
  private assertModelCall(taskId: string, role: TaskModelRole, final: boolean): void {
    this.lifetime.signal.throwIfAborted(); const task = requireManagedTask(this.store.snapshot(), taskId);
    // ARTEX task main chat may inspect terminal tasks; it does not start the execution clock.
    if (!final && role === 'mainagent') return;
    const binding = this.binding(taskId);
    if (final) { if (!binding.settling) throw new Error('FINAL model call requires deadline settlement'); return; }
    if (binding.settling || task.status !== 'running' || task.queued) throw new Error('task is not admitted for an ordinary model call');
    if (task.deadlineAt && Date.parse(task.deadlineAt) <= this.now().getTime()) throw new Error('task deadline reached; awaiting FINAL settlement');
  }
  async beforeModelCall(taskId: string, role: TaskModelRole, final = false): Promise<void> {
    this.assertModelCall(taskId, role, final);
    if (!final && role !== 'mainagent') await this.store.transaction(state => {
      this.assertModelCall(taskId, role, false); stampTaskFirstRun(state, taskId, this.now());
    });
    this.arm();
  }
  /** Wrap the actual provider stream so active-call accounting ends on failure, abort and consumer return. */
  async *trackStream(taskId: string, role: TaskModelRole, stream: () => AsyncIterable<StreamChunk>, final = false): AsyncIterable<StreamChunk> {
    await this.beforeModelCall(taskId, role, final);
    this.active.set(taskId, (this.active.get(taskId) ?? 0) + 1);
    try { yield* stream(); }
    finally { const left = (this.active.get(taskId) ?? 1) - 1; if (left) this.active.set(taskId, left); else this.active.delete(taskId); this.arm(); }
  }
  async *modelStream(call: { taskId: string; parent: Agent; request: GenerateOptions; signal: AbortSignal; final?: boolean; role?: 'planner' | 'goals' }): AsyncIterable<StreamChunk> {
    const binding = this.binding(call.taskId);
    if (binding.parent.id !== call.parent.id) throw new Error('planner model belongs to another parent');
    const role = call.role ?? 'planner';
    const owner = binding.owner;
    let dispatched = false;
    try {
      yield* owner.models.stream(call.taskId, role, { ...call.request, signal: AbortSignal.any([call.signal, owner.lifetime.signal]) }, parentRoute(call.parent), async () => {
        await owner.beforeModelCall(call.taskId, role, call.final ?? false);
        if (!dispatched) { dispatched = true; owner.active.set(call.taskId, (owner.active.get(call.taskId) ?? 0) + 1); }
      });
    } finally {
      if (dispatched) { const left = (owner.active.get(call.taskId) ?? 1) - 1; if (left) owner.active.set(call.taskId, left); else owner.active.delete(call.taskId); owner.arm(); }
    }
  }
  /** One deterministic pass; the production timer invokes this same path. */
  step(): Promise<void> {
    if (this.tick) return this.tick;
    const run = this.serial(async () => {
      if (this.lifetime.signal.aborted) return;
      await this.store.load();
      for (const id of expiredTaskIds(this.store.snapshot(), this.now())) {
        const binding = bindings.get(keyFor(this.store, id));
        if (!binding || binding.settling) continue;
        binding.settling = true;
        try { await binding.owner.planner.beginSettling(id, binding.parent); }
        catch (error) { binding.settling = false; throw error; }
      }
      const ready = await this.readiness();
      for (const binding of this.peers()) {
        const task = this.store.snapshot().tasks.find(t => t.id === binding.taskId);
        if (!task || isTerminalTask(task.status) || !binding.settling || binding.finalizing || (!ready.get(task.id)?.final && binding.finalResult === undefined)) continue;
        binding.owner.launchFinal(binding);
      }
      const needsReconcile = this.store.snapshot().tasks.some(task => {
        const binding = bindings.get(keyFor(this.store, task.id));
        if (!binding || binding.settling || task.status !== 'running') return false;
        return task.queued ? ready.get(task.id)?.normal : !ready.get(task.id)?.normal && !binding.owner.active.get(task.id);
      });
      if (!needsReconcile) return;
      const result = await this.store.transaction(state => reconcileTaskAdmission(state, {
        ...this.policy,
        ready: row => !!ready.get(row.id)?.normal && !bindings.get(keyFor(this.store, row.id))?.settling,
        hasGoals: row => state.goals.some(g => g.taskId === row.id),
      }, row => {
        const binding = bindings.get(keyFor(this.store, row.id));
        return !binding || binding.settling || !!binding.owner.active.get(row.id);
      }, this.now()));
      for (const id of result.parked) { const binding = bindings.get(keyFor(this.store, id)); if (binding) await binding.owner.planner.park(id, binding.parent); }
      for (const { taskId } of result.started) { const binding = bindings.get(keyFor(this.store, taskId)); if (binding) void binding.owner.launch(binding); }
    });
    this.tick = run.finally(() => { this.tick = undefined; this.arm(); });
    return this.tick;
  }
  private launchFinal(binding: Binding): void {
    const run = (async () => {
      if (binding.finalResult === undefined) {
        try { binding.finalResult = (await this.planner.finalize(binding.taskId, binding.parent, this.lifetime.signal)).met; }
        catch (error) { if (this.lifetime.signal.aborted) throw error; binding.finalResult = false; await this.store.addTrace({ taskId: binding.taskId, worker: 'planner', kind: 'error', summary: `FINAL failed: ${error instanceof Error ? error.message : String(error)}` }); }
      }
      this.lifetime.signal.throwIfAborted();
      await this.store.transaction(state => finishManagedTask(state, binding.taskId, binding.finalResult ? 'done' : 'timeout', this.now()));
      await this.planner.park(binding.taskId, binding.parent);
    })();
    binding.finalizing = run;
    void run.then(() => { binding.finalizing = undefined; this.arm(); }, error => { binding.finalizing = undefined; if (!this.lifetime.signal.aborted) this.report(error, binding.taskId); });
  }
  async flush(taskId?: string): Promise<void> {
    await this.tick;
    await Promise.all(this.owned().filter(b => !taskId || b.taskId === taskId).flatMap(b => [b.starting, b.finalizing]));
    if (this.errors.length) throw new AggregateError(this.errors.splice(0), 'task lifecycle operations failed');
  }
  private arm(): void {
    if (this.options.autoPoll === false || this.lifetime.signal.aborted || this.timer || !this.owned().length) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.step().catch(error => this.report(error)); }, this.options.pollMs ?? 2000);
    this.timer.unref();
  }
  async dispose(): Promise<void> {
    if (this.lifetime.signal.aborted) return;
    this.lifetime.abort(new Error('task lifecycle disposed')); clearTimeout(this.timer);
    await this.tick?.catch(() => {});
    const owned = this.owned();
    const settled = await Promise.allSettled(owned.map(async binding => {
      await this.planner.park(binding.taskId, binding.parent);
      await Promise.allSettled([binding.starting, binding.finalizing]);
    }));
    for (const binding of owned) bindings.delete(keyFor(this.store, binding.taskId));
    this.parentTasks.clear();
    for (const [key, alias] of conversationAliases) if (alias.runtime === this) conversationAliases.delete(key);
    const failures = settled.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failures.length) throw new AggregateError(failures.map(r => r.reason), 'task lifecycle shutdown failed');
  }
}

/** Install in the same scope as Planner; root hooks filter exact parent/child task bindings. */
export function installTaskLifecycle(ctx: Context, store: RedTeamStore, planner: LifecyclePlanner, options: TaskLifecycleOptions & { profiles: TaskProfileResolver; modelHealth?: TaskModelRouterOptions['modelHealth']; poolSettings?: TaskModelRouterOptions['poolSettings'] }): TaskLifecycleRuntime {
  const router = new TaskModelRouter(store, ctx.llm, options.profiles, { modelHealth: options.modelHealth, poolSettings: options.poolSettings });
  const runtime = new TaskLifecycleRuntime(store, planner, router, options);
  const originalStart = planner.start; const originalPause = planner.pause;
  planner.start = (taskId, parent) => runtime.start(taskId, parent);
  planner.pause = (taskId, parent) => runtime.pause(taskId, parent);
  const attempts = new Map<string, { selection: TaskModelSelection; committed: boolean; turn: number; step: number; pool: TaskModelPoolAttempt }>();
  const disposers: Array<() => void> = [registerTaskLifecycleScope(ctx, runtime)];
  disposers.push(ctx.root.on('agent/request', async (payload, next) => {
    const binding = runtime.taskForAgent(payload.agent.id); if (!binding) return next();
    payload.signal.throwIfAborted(); const config = await next();
    const previous = attempts.get(payload.agent.id);
    const pool = previous?.turn === payload.turn && previous.step === payload.step ? previous.pool : { triedProfileIds: [] };
    const selection = await router.selectRoute(binding.binding.taskId, parentRoute(payload.agent), binding.role, pool);
    if (!selection.available) throw new Error(selection.reason ?? 'task model is unavailable');
    attempts.set(payload.agent.id, { selection, committed: false, turn: payload.turn, step: payload.step, pool });
    setNativeModelAttribution(payload.agent.id, selection);
    const { reasoningEffort: _oldEffort, maxTokens: _oldMax, ...retained } = config;
    return { ...retained, ...selection.route };
  }));
  disposers.push(ctx.root.on('agent/assistant-stream', ({ agent, frame }) => {
    const attempt = attempts.get(agent.id);
    if (attempt && frame.type === 'chunk' && taskModelChunkCommitsOutput(frame.chunk)) attempt.committed = true;
  }));
  disposers.push(ctx.root.on('agent/request-error', async (payload, next) => {
    const attempt = attempts.get(payload.agent.id); if (!attempt || !runtime.taskForAgent(payload.agent.id)) return next();
    payload.signal.throwIfAborted();
    const result = await router.recordFailure(attempt.selection, payload.failure, attempt.committed, attempt.pool);
    if (result.replay) return { kind: 'retry' as const };
    if (result.handled) return undefined;
    return next();
  }));
  disposers.push(ctx.root.on('llm/stream', (request, next) => {
    if (!request.sessionId || request.purpose) return next();
    const binding = runtime.taskForAgent(request.sessionId); if (!binding) return next();
    // Existing Workers get their bounded task-timeout wrapup while admission is
    // frozen. Ordinary Planner/goals calls remain blocked by assertModelCall.
    const attempt = attempts.get(request.sessionId);
    const stream = attempt ? () => router.decorateStream(request, attempt.selection, next) : next;
    return runtime.trackStream(binding.binding.taskId, binding.role, stream, binding.role === 'worker' && binding.binding.settling);
  }));
  disposers.push(ctx.root.on('agent/disposed', ({ agent }) => { attempts.delete(agent.id); clearNativeModelAttribution(agent.id); }));
  ctx.effect(() => async () => {
    for (const id of attempts.keys()) clearNativeModelAttribution(id);
    for (const dispose of disposers.reverse()) dispose();
    planner.start = originalStart; planner.pause = originalPause;
    await runtime.dispose();
  });
  return runtime;
}
