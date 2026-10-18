import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { GenerateOptions, RequestMessage, StreamChunk } from '@deepseek-ai/dsh-llm';
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session';
import type { RedTeamStore } from '../store.js';
import { type PlannerTrigger } from './model.js';
import { PlannerRuntime, type PlannerWorkers, type PlannerOptions } from './runtime.js';
import type { PlatformPrepareRun } from '../platform/contracts.js';
import { GraphCompactor } from '../graph-tools/compaction.js';
import type { Constraint } from '../types.js';
export interface PlannerIntegrationConfig extends Omit<PlannerOptions, 'compactor'> {
    maxTurns?: number;
    bootstrapMaxTurns?: number;
    enableGoalMet?: boolean;
    prepareRun?: PlatformPrepareRun;
    constraints?: (taskId: string) => Constraint[];
    /** Host model-chain routing owns readiness and first-run stamping when provided. */
    modelStream?: (call: {
        taskId: string;
        parent: Agent;
        request: GenerateOptions;
        signal: AbortSignal;
        final?: boolean;
        role?: 'goals' | 'planner';
        purpose?: 'digest';
    }) => AsyncIterable<StreamChunk>;
    /** Admission/policy hook, run before each model request and before the default first-run stamp. */
    beforeModelCall?: (call: {
        taskId: string;
        parent: Agent;
        request: Readonly<GenerateOptions>;
        signal: AbortSignal;
    }) => void | Promise<void>;
    onMessage?: (taskId: string, message: RequestMessage) => void | Promise<void>;
}
export interface PlannerInstallation {
    runtime: PlannerRuntime;
    readonly compactor: GraphCompactor;
    start(taskId: string, parent: Agent): Promise<PlannerStatus>;
    pause(taskId: string, parent: Agent): Promise<PlannerStatus>;
    beginSettling(taskId: string, parent: Agent): Promise<void>;
    park(taskId: string, parent: Agent): Promise<void>;
    finalize(taskId: string, parent: Agent, signal: AbortSignal): Promise<{
        met: boolean;
    }>;
    steer(taskId: string, message: string, parent: Agent): Promise<{
        taskId: string;
        hintId: string;
    }>;
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
    counts: {
        open: number;
        claimed: number;
        running: number;
        paused: number;
        done: number;
        failed: number;
        stopped: number;
        exhausted: number;
        blocked: number;
    };
    lastPlannerEvent?: {
        kind: string;
        summary: string;
        createdAt: string;
    };
}
/** Call inside ctx.inject(['tools','llm',...]). Installation registers tools and owns its teardown. */
export declare function installPlanner(ctx: Context, store: RedTeamStore, workers: PlannerWorkers, config: PlannerIntegrationConfig): PlannerInstallation;
