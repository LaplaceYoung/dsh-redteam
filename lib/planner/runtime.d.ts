import type { Agent } from '@deepseek-ai/dsh-agent';
import type { RedTeamStore } from '../store.js';
import type { Intent } from '../types.js';
import type { PlannerModel, PlannerTrigger } from './model.js';
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
    bootstrap?: (taskId: string, parent: Agent, signal: AbortSignal) => Promise<void | {
        warning?: string;
    }>;
    compactor?: Pick<GraphCompactor, 'onPlannerRound' | 'cancelTask'>;
}
export declare class PlannerRuntime {
    private readonly store;
    private readonly workers;
    private readonly model;
    private readonly options;
    private readonly runs;
    private readonly debounceMs;
    private readonly heartbeatMs;
    private disposed;
    constructor(store: RedTeamStore, workers: PlannerWorkers, model: PlannerModel, options: PlannerOptions);
    private key;
    owns(taskId: string): boolean;
    inspect(taskId: string): {
        parentSessionId: string;
        planning: boolean;
        admitting: boolean;
        stopping: boolean;
        settling: boolean;
        pendingTriggers: number;
        error?: string;
    } | undefined;
    private isRunning;
    start(taskId: string, parent: Agent): Promise<void>;
    private initialize;
    /** Call after the corresponding store write, including after WorkerRuntime.observe(turn/end). */
    notify(taskId: string, trigger?: PlannerTrigger): void;
    private enqueue;
    private armHeartbeat;
    private pump;
    private resumeWorker;
    private plan;
    private round;
    private requireWorker;
    private commitPlan;
    private todos;
    private report;
    /** Deterministically process pending events; also surfaces errors from background rounds. */
    flush(taskId: string): Promise<void>;
    /** Freeze new work immediately, without interrupting the current native activations. */
    beginSettling(taskId: string, parent: Agent): Promise<void>;
    /** Suspend an admission slot without overwriting persistent queued/status metadata. */
    park(taskId: string, parent: Agent): Promise<void>;
    /** ARTEX settlement: up to 90s graceful drain, hard stop, then one independent FINAL round. */
    finalize(taskId: string, parent: Agent, signal: AbortSignal, model: PlannerModel): Promise<{
        met: boolean;
    }>;
    /** Task pause requeues only workers interrupted by this pause; individually paused workers stay parked. */
    pause(taskId: string): Promise<void>;
    fail(taskId: string, reason: string): Promise<void>;
    private stopTask;
    private release;
    dispose(): Promise<void>;
}
