import { randomUUID } from 'node:crypto';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { RedTeamStore } from '../store.js';
import type { Intent, RedTeamSnapshot } from '../types.js';
import { assertIntentAssetsAllowed } from '../task-asset-runtime.js';
import { finishManagedTask } from '../task-management/index.js';
import { PlannerExecutionError } from './model.js';
import type { PlannerContext, PlannerModel, PlannerPlan, PlannerTodo, PlannerTrigger } from './model.js';
import type { GraphCompactor } from '../graph-tools/compaction.js';

/** Native WorkerRuntime satisfies the first four methods; recovery is an explicit host seam. */
export interface PlannerWorkers {
  start(taskId: string, parent: Agent, signal: AbortSignal, provider?: 'spawn' | 'fork'): Promise<Intent | undefined>;
  stop(intentId: string, parent: Agent, state?: 'paused' | 'failed' | 'stopped'): Promise<Intent>;
  steer(intentId: string, message: string, parent: Agent, signal: AbortSignal): Promise<unknown>;
  quiesceTask(taskId: string, state?: 'paused' | 'stopped'): Promise<void>;
  /** Rebind/replay persisted native events, then persist running or settled state. Never blindly resubmit work. */
  recover?(intent: Intent, parent: Agent, signal: AbortSignal): Promise<void>;
  beginTaskTimeout?(taskId: string): Promise<void>;
}

export interface PlannerOptions {
  concurrency: number;
  debounceMs?: number;
  heartbeatMs?: number;
  provider?: 'spawn' | 'fork';
  onError?: (error: unknown, taskId: string) => void;
  bootstrap?: (taskId: string, parent: Agent, signal: AbortSignal) => Promise<void | { warning?: string }>;
  compactor?: Pick<GraphCompactor, 'onPlannerRound' | 'cancelTask'>;
}

interface TaskRun {
  owner: PlannerRuntime;
  taskId: string;
  parent: Agent;
  controller: AbortController;
  triggers: PlannerTrigger[];
  ready: Promise<void>;
  planning?: Promise<void>;
  pumping?: Promise<void>;
  debounce?: ReturnType<typeof setTimeout>;
  heartbeat?: ReturnType<typeof setTimeout>;
  error?: unknown;
  stopping: boolean;
  settling?: boolean;
  initializing?: boolean;
}

// Agent-scoped plugin instances in the same host must not create duplicate task loops.
const owners = new Map<string, TaskRun>();
const admissions = new Map<string, Promise<void>>();
const active = (intent: Intent) => intent.state === 'claimed' || intent.state === 'running';
const terminal = (status: string) => status === 'done' || status === 'failed' || status === 'timeout';
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

function taskContract(state: RedTeamSnapshot, taskId: string): string {
  const task = state.tasks.find((task) => task.id === taskId);
  return stable([task?.goal, task?.description, task?.sourceTaskIds, state.goals.filter((row) => row.taskId === taskId), state.constraints.filter((row) => row.taskId === taskId), state.scopes.filter((row) => row.taskId === taskId)]);
}

export class PlannerRuntime {
  private readonly runs = new Set<TaskRun>();
  private readonly debounceMs: number;
  private readonly heartbeatMs: number;
  private disposed = false;

  constructor(private readonly store: RedTeamStore, private readonly workers: PlannerWorkers, private readonly model: PlannerModel, private readonly options: PlannerOptions) {
    if (!Number.isSafeInteger(options.concurrency) || options.concurrency < 1) throw new Error('planner concurrency must be a positive integer');
    this.debounceMs = options.debounceMs ?? 800;
    this.heartbeatMs = options.heartbeatMs ?? 600_000;
    if (!Number.isFinite(this.debounceMs) || this.debounceMs < 0) throw new Error('planner debounceMs must be nonnegative');
    if (!Number.isFinite(this.heartbeatMs) || this.heartbeatMs < 600_000) throw new Error('ARTEX planner heartbeatMs must be at least 600000');
  }

  private key(taskId: string): string { return `${this.store.storagePath.toLocaleLowerCase()}\0${taskId}`; }
  owns(taskId: string): boolean { return owners.get(this.key(taskId))?.owner === this; }
  inspect(taskId: string): { parentSessionId: string; planning: boolean; admitting: boolean; stopping: boolean; settling: boolean; pendingTriggers: number; error?: string } | undefined {
    const run = owners.get(this.key(taskId));
    return run && { parentSessionId: run.parent.id, planning: !!run.planning, admitting: !!run.pumping, stopping: run.stopping, settling: !!run.settling, pendingTriggers: run.triggers.length, ...(run.error === undefined ? {} : { error: errorText(run.error) }) };
  }
  private isRunning(run: TaskRun): boolean {
    return !run.stopping && !run.settling && !run.controller.signal.aborted && this.store.snapshot().tasks.some((task) => task.id === run.taskId && task.status === 'running' && !task.queued);
  }

  async start(taskId: string, parent: Agent): Promise<void> {
    if (this.disposed) throw new Error('planner is disposed');
    const existing = owners.get(this.key(taskId));
    if (existing) {
      if (existing.parent.id !== parent.id) throw new Error(`task planner belongs to another parent: ${taskId}`);
      if (existing.stopping || existing.settling) throw new Error(`task planner is still stopping or settling: ${taskId}`);
      await existing.ready;
      return;
    }
    const run: TaskRun = { owner: this, taskId, parent, controller: new AbortController(), triggers: [], ready: Promise.resolve(), stopping: false, initializing: true };
    owners.set(this.key(taskId), run);
    this.runs.add(run);
    run.ready = this.initialize(run).catch(async (error: unknown) => {
      try { if (!run.controller.signal.aborted && this.store.snapshot().tasks.some((row) => row.id === taskId)) await this.report(run, error); }
      finally { if (!run.settling) this.release(run); }
      throw error;
    }).finally(() => { run.initializing = false; });
    await run.ready;
  }

  private async initialize(run: TaskRun): Promise<void> {
    await this.store.load();
    const task = this.store.snapshot().tasks.find((row) => row.id === run.taskId);
    if (!task) throw new Error(`task not found: ${run.taskId}`);
    if (terminal(task.status)) { this.release(run); return; }
    if (task.queued) throw new Error('Task must be admitted before Planner starts');
    const inflight = this.store.snapshot().intents.filter((row) => row.taskId === run.taskId && active(row));
    for (const intent of inflight) {
      if (!intent.execution || intent.execution.parentSessionId !== run.parent.id) throw new Error(`cannot recover worker owned by another parent: ${intent.id}`);
      if (!this.workers.recover) throw new Error(`native worker recovery adapter required: ${intent.id}`);
      await this.workers.recover(intent, run.parent, run.controller.signal);
    }
    await this.store.transaction((state) => {
      run.controller.signal.throwIfAborted();
      const current = state.tasks.find((row) => row.id === run.taskId);
      if (!current) throw new Error(`task disappeared during start: ${run.taskId}`);
      if (terminal(current.status)) return;
      current.status = 'running';
      current.updatedAt = new Date().toISOString();
    });
    if (!this.isRunning(run)) { if (!run.settling) this.release(run); return; }
    const current = this.store.snapshot();
    const currentTask = current.tasks.find((row) => row.id === run.taskId)!;
    if ((currentTask.goal.trim() || currentTask.description?.trim()) && !current.goals.some((row) => row.taskId === run.taskId)) {
      if (!this.options.bootstrap) throw new Error('Task goal requires LLM bootstrap decomposition before Planner starts');
      await this.store.addTrace({ taskId: run.taskId, worker: 'planner', kind: 'start', summary: 'Planner 第 0 轮：分解目标并提取约束/范围', data: { phase: 'bootstrap' } });
      const bootstrap = await this.options.bootstrap(run.taskId, run.parent, run.controller.signal);
      run.controller.signal.throwIfAborted();
      const decomposed = this.store.snapshot().goals.filter((row) => row.taskId === run.taskId);
      if (currentTask.goal.trim() && !decomposed.length) throw new Error('Planner bootstrap returned without decomposed goals');
      await this.store.addTrace({ taskId: run.taskId, worker: 'planner', kind: bootstrap?.warning ? 'error' : 'result', summary: bootstrap?.warning ? `Planner 目标初始化保留了原版降级结果：${bootstrap.warning}` : `Planner 目标分解完成：${decomposed.length} 个目标`, data: { phase: 'bootstrap', goalIds: decomposed.map((row) => row.id), ...(bootstrap?.warning ? { warning: bootstrap.warning } : {}) } });
    }
    this.pump(run);
    const hasWork = this.store.snapshot().intents.some((row) => row.taskId === run.taskId && (row.state === 'open' || active(row)));
    if (!hasWork) this.enqueue(run, { kind: 'start' });
    this.armHeartbeat(run);
  }

  /** Call after the corresponding store write, including after WorkerRuntime.observe(turn/end). */
  notify(taskId: string, trigger: PlannerTrigger = { kind: 'change' }): void {
    const run = owners.get(this.key(taskId));
    if (!run) return;
    run.owner.enqueue(run, trigger);
    // A finished child frees shared parent capacity for all of that parent's tasks.
    for (const candidate of owners.values()) if (candidate.parent.id === run.parent.id && candidate.owner.store.storagePath === this.store.storagePath) candidate.owner.pump(candidate);
  }

  private enqueue(run: TaskRun, trigger: PlannerTrigger): void {
    if (!this.isRunning(run)) return;
    if (!run.triggers.some((entry) => stable(entry) === stable(trigger))) run.triggers.push(trigger);
    if (!run.debounce && !run.planning) {
      run.debounce = setTimeout(() => { run.debounce = undefined; this.plan(run); }, this.debounceMs);
      run.debounce.unref();
    }
  }

  private armHeartbeat(run: TaskRun): void {
    clearTimeout(run.heartbeat);
    if (!this.isRunning(run)) return;
    run.heartbeat = setTimeout(() => { run.heartbeat = undefined; this.enqueue(run, { kind: 'heartbeat' }); }, this.heartbeatMs);
    run.heartbeat.unref();
  }

  private pump(run: TaskRun): void {
    if (run.pumping || !this.isRunning(run)) return;
    const key = `${this.store.storagePath}\0${run.parent.id}`;
    const previous = admissions.get(key) ?? Promise.resolve();
    const operation = previous.then(async () => {
      while (this.isRunning(run)) {
        const state = this.store.snapshot();
        const busy = state.intents.filter((row) => row.execution?.parentSessionId === run.parent.id && active(row)).length;
        if (busy >= this.options.concurrency || !state.intents.some((row) => row.taskId === run.taskId && row.state === 'open')) return;
        const next = state.intents.find((row) => row.taskId === run.taskId && row.state === 'open')!;
        const started = next.execution ? await this.resumeWorker(run, next) : await this.workers.start(run.taskId, run.parent, run.controller.signal, this.options.provider ?? 'spawn');
        if (!started) return;
      }
    });
    const settled = operation.catch(async (error: unknown) => { if (!run.controller.signal.aborted) await this.report(run, error); });
    admissions.set(key, settled);
    run.pumping = settled.finally(() => { run.pumping = undefined; if (admissions.get(key) === settled) admissions.delete(key); });
    // report() can fail on storage errors; retain an observable rejection for flush().
    void run.pumping.catch(() => {});
  }

  private async resumeWorker(run: TaskRun, prior: Intent): Promise<Intent | undefined> {
    const claimed = await this.store.transaction((state) => {
      const task = state.tasks.find((row) => row.id === run.taskId);
      if (run.settling || run.controller.signal.aborted || task?.status !== 'running' || task.queued) return undefined;
      const row = state.intents.find((item) => item.id === prior.id);
      if (!row || row.state !== 'open') return undefined;
      if (state.intents.filter((item) => item.execution?.parentSessionId === run.parent.id && active(item)).length >= this.options.concurrency) return undefined;
      if (row.execution?.parentSessionId !== run.parent.id) throw new Error(`cannot resume worker owned by another parent: ${row.id}`);
      row.state = 'claimed'; row.updatedAt = new Date().toISOString();
      return row;
    });
    if (!claimed) return undefined;
    try {
      await this.workers.steer(claimed.id, '任务已恢复。继续本意图尚未完成的工作；先核对已记录的结果与证据，不要重复已完成的操作。', run.parent, run.controller.signal);
      return claimed;
    } catch (error) {
      // The native inbox receipt may be uncertain: retain the original binding for recovery.
      await this.store.updateIntent(claimed.id, { state: 'paused', output: { terminalReason: 'resume_error', error: errorText(error) } });
      throw error;
    }
  }

  private plan(run: TaskRun): void {
    if (run.planning || !this.isRunning(run)) return;
    const triggers = run.triggers.splice(0);
    run.planning = this.round(run, triggers).catch(async (error: unknown) => {
      if (!run.stopping) await this.report(run, error);
    }).finally(() => {
      run.planning = undefined;
      if (run.triggers.length) this.enqueue(run, run.triggers[0]);
      this.armHeartbeat(run);
    });
    void run.planning.catch(() => {});
  }

  private async round(run: TaskRun, triggers: PlannerTrigger[]): Promise<void> {
    await this.options.compactor?.onPlannerRound(run.taskId, run.controller.signal);
    if (!this.isRunning(run)) return;
    const snapshot = this.store.snapshot();
    const goals = snapshot.goals.filter((goal) => goal.taskId === run.taskId && goal.state === 'open');
    if (!goals.length) {
      const finished = await this.store.transaction((state) => {
        const task = state.tasks.find((row) => row.id === run.taskId);
        if (run.settling || task?.status !== 'running' || task.queued || state.goals.some((row) => row.taskId === run.taskId && row.state === 'open') || state.intents.some((row) => row.taskId === run.taskId && (row.state === 'open' || active(row)))) return false;
        return finishManagedTask(state, run.taskId, 'done');
      });
      if (finished) { await this.options.compactor?.cancelTask(run.taskId); this.release(run); }
      return;
    }
    const contract = taskContract(snapshot, run.taskId);
    const context: PlannerContext = { taskId: run.taskId, snapshot, triggers, todos: this.todos(snapshot, run.taskId) };
    await this.store.addTrace({ taskId: run.taskId, worker: 'planner', kind: 'start', summary: 'Planner 开始规划', data: { triggers } });
    let plan: PlannerPlan;
    let modelError: unknown;
    try { plan = await this.model.plan(context, run.controller.signal); }
    catch (error) {
      if (!(error instanceof PlannerExecutionError) || run.controller.signal.aborted) throw error;
      plan = error.partialPlan; modelError = error;
    }
    run.controller.signal.throwIfAborted();
    if (!this.isRunning(run)) return;
    if (taskContract(this.store.snapshot(), run.taskId) !== contract) { this.enqueue(run, { kind: 'change', detail: '目标、约束或范围在规划期间变化，重新规划' }); return; }
    // Steering is not transactional with the model; each successful native receipt remains traceable.
    for (const steer of plan.steers) {
      this.requireWorker(run, steer.intentId);
      await this.workers.steer(steer.intentId, steer.message, run.parent, run.controller.signal);
    }
    for (const kill of plan.kills) {
      this.requireWorker(run, kill.intentId);
      await this.workers.stop(kill.intentId, run.parent, 'stopped');
      await this.store.updateIntent(kill.intentId, { output: { terminalReason: 'stopped', reason: kill.reason } });
    }
    const applied = await this.commitPlan(run, plan, contract);
    if (applied.state === 'stale') { this.enqueue(run, { kind: 'change' }); return; }
    if (applied.state === 'done') {
      run.controller.abort(new Error('task goals met'));
      await this.options.compactor?.cancelTask(run.taskId);
      await run.pumping;
      await this.workers.quiesceTask(run.taskId, 'stopped');
      this.release(run);
    } else this.pump(run);
    if (modelError) throw modelError;
    if (applied.errors.length) throw new AggregateError(applied.errors.map((message) => new Error(message)), `Planner partial commit: ${applied.errors.join('; ')}`);
  }

  private requireWorker(run: TaskRun, intentId: string): void {
    const intent = this.store.snapshot().intents.find((row) => row.id === intentId && row.taskId === run.taskId);
    if (!intent || !active(intent) || intent.execution?.parentSessionId !== run.parent.id) throw new Error(`planner control requires a live owned task worker: ${intentId}`);
    run.controller.signal.throwIfAborted();
  }

  private async commitPlan(run: Pick<TaskRun, 'taskId' | 'controller' | 'settling'>, plan: PlannerPlan, contract: string, final = false): Promise<{ state: 'running' | 'done' | 'stale'; errors: string[] }> {
    return this.store.transaction((state) => {
      const task = state.tasks.find((row) => row.id === run.taskId);
      if (!task || (final ? terminal(task.status) : run.settling || task.status !== 'running' || task.queued) || run.controller.signal.aborted || taskContract(state, run.taskId) !== contract) return { state: 'stale', errors: [] };
      const now = new Date().toISOString();
      const errors: string[] = [];
      const readable = new Set([run.taskId, ...(task.sourceTaskIds ?? []).filter((id) => state.tasks.some((source) => source.id === id))]);
      const knowledge = (id: string) => state.nodes.some((row) => row.id === id && readable.has(row.taskId) && (row.kind === 'fact' || row.kind === 'finding'));
      for (const proof of plan.proofs) {
        try {
          const goal = state.goals.find((row) => row.id === proof.goalId && row.taskId === run.taskId && row.state !== 'deleted');
          if (!goal) throw new Error(`proof references unknown task goal: ${proof.goalId}`);
          if (!proof.evidenceIds.length) throw new Error(`goal proof needs a fact/finding: ${proof.goalId}`);
          for (const evidenceId of proof.evidenceIds) if (!knowledge(evidenceId)) throw new Error(`proof references missing task/source fact or finding: ${evidenceId}`);
          for (const evidenceId of proof.evidenceIds) {
            if (!state.edges.some((edge) => edge.taskId === run.taskId && edge.from === evidenceId && edge.to === goal.id && edge.relation === 'proves')) state.edges.push({ id: randomUUID(), taskId: run.taskId, from: evidenceId, to: goal.id, relation: 'proves' });
          }
          goal.state = 'met'; goal.updatedAt = now;
        } catch (error) { errors.push(errorText(error)); }
      }
      const done = plan.goalMet !== undefined || !state.goals.some((row) => row.taskId === run.taskId && row.state === 'open');
      for (const proposal of plan.intents) {
        try {
          if (!proposal.summary.trim()) throw new Error('planner intent summary cannot be blank');
          const id = proposal.id ?? randomUUID();
          if (state.intents.some((row) => row.id === id && row.taskId === run.taskId)) continue;
          if (state.intents.some((row) => row.id === id)) throw new Error(`intent ID belongs to another task: ${id}`);
          assertIntentAssetsAllowed(state, run.taskId, proposal.input);
          for (const from of proposal.parentIds ?? []) if (!knowledge(from)) throw new Error(`intent parent must be a task/source fact or finding: ${from}`);
          const origin = state.nodes.find((node) => node.taskId === run.taskId && node.kind === 'fact' && (node.data.kind === 'origin' || node.data.origin === true));
          const parents = proposal.parentIds?.length ? proposal.parentIds : origin ? [origin.id] : [];
          for (const from of parents) {
            state.edges.push({ id: randomUUID(), taskId: run.taskId, from, to: id, relation: 'derived_from' });
          }
          state.intents.push({ id, taskId: run.taskId, summary: proposal.summary, input: proposal.input, state: 'open', createdAt: now, updatedAt: now });
        } catch (error) { errors.push(errorText(error)); }
      }
      if (!final && !done && !state.intents.some((row) => row.taskId === run.taskId && (row.state === 'open' || active(row)))) errors.push('planner stalled: goals remain open but no new or active intent exists');
      if (done && !final) finishManagedTask(state, run.taskId, 'done');
      state.traces.push({ id: randomUUID(), taskId: run.taskId, worker: 'planner', kind: errors.length ? 'error' : 'result', summary: done ? plan.goalMet ? `Planner goal_met：${plan.goalMet.reason}` : final ? 'FINAL 目标证据已提交，等待任务协调器落终态' : '目标证据已提交，任务完成' : errors.length ? `Planner 部分提交：${errors.join('; ')}` : 'Planner 已提交规划', data: { plannerPlan: plan, todos: plan.todos ?? this.todos(state, run.taskId), errors, ...(final ? { phase: 'final' } : {}) }, createdAt: now });
      return { state: done ? 'done' : 'running', errors };
    });
  }

  private todos(state: RedTeamSnapshot, taskId: string): PlannerTodo[] {
    const trace = [...state.traces].reverse().find((row) => row.taskId === taskId && row.worker === 'planner' && Array.isArray(row.data?.todos));
    return (trace?.data?.todos as PlannerTodo[] | undefined) ?? [];
  }

  private async report(run: TaskRun, error: unknown): Promise<void> {
    run.error = error;
    await this.store.addTrace({ taskId: run.taskId, worker: 'planner', kind: 'error', summary: errorText(error) });
    this.options.onError?.(error, run.taskId);
  }

  /** Deterministically process pending events; also surfaces errors from background rounds. */
  async flush(taskId: string): Promise<void> {
    const run = owners.get(this.key(taskId));
    if (!run) return;
    await run.ready;
    do {
      clearTimeout(run.debounce); run.debounce = undefined;
      if (run.triggers.length && !run.planning && this.isRunning(run)) run.owner.plan(run);
      await Promise.all([run.planning, run.pumping]);
    } while (this.isRunning(run) && (run.triggers.length || run.planning || run.pumping));
    if (run.error) { const error = run.error; run.error = undefined; throw error; }
  }

  /** Freeze new work immediately, without interrupting the current native activations. */
  async beginSettling(taskId: string, parent: Agent): Promise<void> {
    let run = owners.get(this.key(taskId));
    if (run && (run.owner !== this || run.parent.id !== parent.id)) throw new Error(`task planner belongs to another owner: ${taskId}`);
    if (!this.store.snapshot().tasks.some((task) => task.id === taskId)) throw new Error(`task not found: ${taskId}`);
    if (!run) {
      run = { owner: this, taskId, parent, controller: new AbortController(), triggers: [], ready: Promise.resolve(), stopping: false };
      owners.set(this.key(taskId), run); this.runs.add(run);
    }
    run.settling = true; run.triggers.length = 0;
    clearTimeout(run.debounce); clearTimeout(run.heartbeat);
    await this.options.compactor?.cancelTask(taskId);
  }

  /** Suspend an admission slot without overwriting persistent queued/status metadata. */
  async park(taskId: string, parent: Agent): Promise<void> {
    await this.beginSettling(taskId, parent);
    const run = owners.get(this.key(taskId))!;
    const interrupted = this.store.snapshot().intents.filter((row) => row.taskId === taskId && active(row)).map((row) => row.id);
    run.stopping = true; run.controller.abort(new Error('task parked'));
    await Promise.allSettled([run.ready, run.planning, run.pumping]);
    await this.workers.quiesceTask(taskId, 'paused');
    await this.store.transaction((state) => {
      for (const intent of state.intents) if (interrupted.includes(intent.id) && intent.state !== 'done') {
        intent.state = 'open'; intent.updatedAt = new Date().toISOString();
        if (!intent.execution?.messageId) { delete intent.worker; delete intent.execution; }
      }
    });
    this.release(run);
  }

  /** ARTEX settlement: up to 90s graceful drain, hard stop, then one independent FINAL round. */
  async finalize(taskId: string, parent: Agent, signal: AbortSignal, model: PlannerModel): Promise<{ met: boolean }> {
    await this.beginSettling(taskId, parent);
    await this.workers.beginTaskTimeout?.(taskId);
    const run = owners.get(this.key(taskId))!;
    const deadline = Date.now() + 90_000;
    const busy = () => !!run.initializing || !!run.planning || !!run.pumping || this.store.snapshot().intents.some((row) => row.taskId === taskId && active(row));
    while (busy() && Date.now() < deadline) {
      signal.throwIfAborted();
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(signal.reason); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, Math.min(500, deadline - Date.now()));
        signal.addEventListener('abort', abort, { once: true });
      });
    }
    signal.throwIfAborted();
    run.controller.abort(new Error('task settlement drain finished'));
    await this.workers.quiesceTask(taskId, 'stopped');
    await Promise.allSettled([run.ready, run.planning, run.pumping]);
    signal.throwIfAborted();
    const snapshot = this.store.snapshot();
    const task = snapshot.tasks.find((row) => row.id === taskId);
    if (!task || terminal(task.status)) { this.release(run); return { met: task?.status === 'done' }; }
    const contract = taskContract(snapshot, taskId);
    await this.store.addTrace({ taskId, worker: 'planner', kind: 'start', summary: '任务超时收尾：FINAL 目标判定', data: { phase: 'final' } });
    let plan: PlannerPlan;
    let modelError: unknown;
    try { plan = await model.plan({ taskId, snapshot, triggers: [{ kind: 'final', detail: '任务已到期，只提交最后目标判定，不派发新意图' }], todos: this.todos(snapshot, taskId) }, signal); }
    catch (error) {
      if (!(error instanceof PlannerExecutionError) || signal.aborted) throw error;
      plan = error.partialPlan; modelError = error;
    }
    signal.throwIfAborted();
    if (plan.intents.length || plan.steers.length || plan.kills.length) throw new Error('FINAL planner cannot add intents or control Workers');
    const finalController = new AbortController();
    const abortFinal = () => finalController.abort(signal.reason);
    signal.addEventListener('abort', abortFinal, { once: true });
    try {
      const applied = await this.commitPlan({ taskId, controller: finalController }, plan, contract, true);
      if (applied.state === 'stale') throw new Error('Task contract changed during FINAL planner judgment');
      if (modelError) await this.report(run, modelError);
      if (applied.errors.length) await this.report(run, new Error(`FINAL partial commit: ${applied.errors.join('; ')}`));
      // The task lifecycle coordinator alone writes done/timeout with its first-writer guard.
      return { met: applied.state === 'done' };
    } finally { signal.removeEventListener('abort', abortFinal); }
  }

  /** Task pause requeues only workers interrupted by this pause; individually paused workers stay parked. */
  async pause(taskId: string): Promise<void> { await this.stopTask(taskId, 'paused', '任务已暂停'); }
  async fail(taskId: string, reason: string): Promise<void> { await this.stopTask(taskId, 'failed', reason); }

  private async stopTask(taskId: string, status: 'paused' | 'failed', reason: string): Promise<void> {
    const run = owners.get(this.key(taskId));
    if (run && run.owner !== this) return run.owner.stopTask(taskId, status, reason);
    const beforeAbort = this.store.snapshot().intents.filter((row) => row.taskId === taskId && active(row)).map((row) => row.id);
    if (run) { run.stopping = true; run.controller.abort(new Error(reason)); clearTimeout(run.debounce); clearTimeout(run.heartbeat); }
    await this.options.compactor?.cancelTask(taskId);
    const interrupted = await this.store.transaction((state) => {
      const task = state.tasks.find((row) => row.id === taskId);
      if (!task) throw new Error(`task not found: ${taskId}`);
      if (terminal(task.status)) return [];
      task.status = status; task.updatedAt = new Date().toISOString();
      return [...new Set([...beforeAbort, ...state.intents.filter((row) => row.taskId === taskId && active(row)).map((row) => row.id)])];
    });
    if (run) await Promise.allSettled([run.ready, run.planning, run.pumping]);
    await this.workers.quiesceTask(taskId, status === 'paused' ? 'paused' : 'stopped');
    await this.store.transaction((state) => {
      for (const intent of state.intents) if (interrupted.includes(intent.id) && intent.state !== 'done') {
        intent.state = status === 'paused' ? 'open' : 'stopped';
        intent.output = { ...intent.output, terminalReason: status === 'paused' ? 'task_paused' : 'stopped', reason };
        // A saved native receipt identifies the conversation to continue on resume.
        if (!intent.execution?.messageId) { delete intent.worker; delete intent.execution; }
        intent.updatedAt = new Date().toISOString();
      }
    });
    if (run) this.release(run);
  }

  private release(run: TaskRun): void {
    clearTimeout(run.debounce); clearTimeout(run.heartbeat);
    if (owners.get(this.key(run.taskId)) === run) owners.delete(this.key(run.taskId));
    this.runs.delete(run);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    const results = await Promise.allSettled([...this.runs].map((run) => this.pause(run.taskId)));
    const errors = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (errors.length) throw new AggregateError(errors.map((result) => result.reason), 'planner shutdown failed');
  }
}
