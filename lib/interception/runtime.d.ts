import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ToolExecution, PreToolDecision } from '@deepseek-ai/dsh-tools';
import type { RedTeamStore } from '../store.js';
import type { TaskProfileResolver } from '../task-management/runtime-model.js';
import { InterceptionRepository } from './repository.js';
export interface InterceptionOptions {
    path?: string;
    profiles?: Pick<TaskProfileResolver, 'resolveProfile' | 'resolveGlobal'>;
    taskForAgent?: (agent: Agent) => {
        taskId: string;
        worker: boolean;
    } | undefined;
    /** Only explicitly selected current human text is accepted; never pass generated task prompts. */
    humanMessage?: (agent: Agent) => string | undefined;
    onError?: (error: unknown) => void;
}
export declare class InterceptionRuntime {
    private readonly ctx;
    private readonly store;
    private readonly options;
    readonly repository: InterceptionRepository;
    readonly ready: Promise<void>;
    private readonly lifetime;
    private readonly bindings;
    private readonly results;
    private readonly dispatched;
    private readonly operations;
    private readonly disposers;
    constructor(ctx: Context, store: RedTeamStore, options?: InterceptionOptions);
    private track;
    private reason;
    task(exec: ToolExecution): {
        taskId: string;
        worker: boolean;
    } | undefined;
    private judge;
    preExecute(exec: ToolExecution, next: () => Promise<PreToolDecision>): Promise<PreToolDecision>;
    private applyDecision;
    requestApproval(exec: ToolExecution, taskId: string, action: string): Promise<PreToolDecision>;
    private recordResult;
    flush(): Promise<void>;
    dispose(): Promise<void>;
}
