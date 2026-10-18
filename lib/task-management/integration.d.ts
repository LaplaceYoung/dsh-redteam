import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm';
import type { RedTeamStore } from '../store.js';
import type { PlannerInstallation, PlannerStatus } from '../planner/integration.js';
import { TaskModelRouter, type TaskModelRole, type TaskProfileResolver, type TaskModelRouterOptions } from './runtime-model.js';
import { type TaskDeleteOptions, type TaskDeleteResult } from './deletion.js';
/** These are execution operations: callers must supply the real Planner installation. */
export interface LifecyclePlanner extends Pick<PlannerInstallation, 'start' | 'pause' | 'status'> {
    park(taskId: string, parent: Agent): Promise<void>;
    beginSettling(taskId: string, parent: Agent): Promise<void>;
    finalize(taskId: string, parent: Agent, signal: AbortSignal): Promise<{
        met: boolean;
    }>;
}
export interface TaskLifecycleOptions {
    concurrency: number;
    enabled?: boolean;
    autoPoll?: boolean;
    pollMs?: number;
    now?: () => Date;
    onError?: (error: unknown, taskId?: string) => void;
    /** Fence/drain other task writers; commit/rollback owns releasing that fence. */
    prepareTaskDelete?: (taskId: string) => Promise<{
        commit(): Promise<void>;
        rollback(): Promise<void>;
    }>;
}
/** Conversation attribution can exist before an execution owner is chosen. */
export interface TaskAgentBinding {
    owner: TaskLifecycleRuntime;
    taskId: string;
    settling: boolean;
    parent?: Agent;
}
/** Owns actual admissions, model-call clock stamps and FINAL coordination, across agent scopes. */
export declare class TaskLifecycleRuntime {
    readonly store: RedTeamStore;
    readonly planner: LifecyclePlanner;
    readonly models: TaskModelRouter;
    private readonly options;
    private readonly lifetime;
    private readonly parentTasks;
    private readonly active;
    private readonly errors;
    private timer?;
    private tick?;
    private readonly now;
    private readonly startPlanner;
    private readonly pausePlanner;
    private policy;
    constructor(store: RedTeamStore, planner: LifecyclePlanner, models: TaskModelRouter, options: TaskLifecycleOptions);
    private owned;
    get disposed(): boolean;
    admission(): {
        enabled: boolean;
        limit: number;
    };
    setAdmission(policy: {
        enabled: boolean;
        limit: number;
    }): Promise<void>;
    private peers;
    private binding;
    private serial;
    private report;
    bindParent(taskId: string, parent: Agent): void;
    /** Attach a chat segment without claiming the task's Planner execution owner. */
    attachConversation(taskId: string, agent: Agent): () => void;
    /** Resume persisted task clocks/FIFO after resolving their actual DSH parent Agent handles. */
    recover(resolveParent: (taskId: string) => Promise<Agent | undefined>): Promise<string[]>;
    taskForAgent(agentId: string): {
        binding: TaskAgentBinding;
        role: 'mainagent' | 'worker';
    } | undefined;
    private readiness;
    start(taskId: string, parent: Agent, action?: 'start' | 'resume' | 'rerun'): Promise<PlannerStatus>;
    private launch;
    pause(taskId: string, parent: Agent): Promise<PlannerStatus>;
    deleteTask(taskId: string, parent: Agent, options?: TaskDeleteOptions): Promise<TaskDeleteResult>;
    private assertModelCall;
    beforeModelCall(taskId: string, role: TaskModelRole, final?: boolean): Promise<void>;
    /** Wrap the actual provider stream so active-call accounting ends on failure, abort and consumer return. */
    trackStream(taskId: string, role: TaskModelRole, stream: () => AsyncIterable<StreamChunk>, final?: boolean): AsyncIterable<StreamChunk>;
    modelStream(call: {
        taskId: string;
        parent: Agent;
        request: GenerateOptions;
        signal: AbortSignal;
        final?: boolean;
        role?: 'planner' | 'goals';
    }): AsyncIterable<StreamChunk>;
    /** One deterministic pass; the production timer invokes this same path. */
    step(): Promise<void>;
    private launchFinal;
    flush(taskId?: string): Promise<void>;
    private arm;
    dispose(): Promise<void>;
}
/** Install in the same scope as Planner; root hooks filter exact parent/child task bindings. */
export declare function installTaskLifecycle(ctx: Context, store: RedTeamStore, planner: LifecyclePlanner, options: TaskLifecycleOptions & {
    profiles: TaskProfileResolver;
    modelHealth?: TaskModelRouterOptions['modelHealth'];
    poolSettings?: TaskModelRouterOptions['poolSettings'];
}): TaskLifecycleRuntime;
