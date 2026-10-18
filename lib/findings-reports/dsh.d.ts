import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { RedTeamStore } from '../store.js';
import type { TaskLifecycleRuntime } from '../task-management/integration.js';
import { type TaskProfileResolver } from '../task-management/runtime-model.js';
import type { FindingsAccess } from './runtime.js';
export interface DshFindingsOptions {
    automaticReports?: boolean;
    trafficBindingEnabled?: () => boolean;
}
export type FindingsLifecycle = Pick<TaskLifecycleRuntime, 'taskForAgent' | 'start' | 'models'> & {
    /** Cross-scope read only lookup, preserving the owner's active parentTasks mapping. */
    resolveBinding?(agent: Agent): {
        taskId: string;
        parent?: Agent;
    } | undefined;
};
type Profiles = TaskProfileResolver;
/** Each factory captures the exact caller, never a process-global last Agent. */
export declare function installDshFindings(ctx: Context, store: RedTeamStore, lifecycle: FindingsLifecycle, profiles: Profiles, options?: DshFindingsOptions): {
    ready: Promise<{
        recovered: number;
    }>;
    resolveAccess: (agent: Agent) => FindingsAccess;
    dispose: () => Promise<void>;
    runtime: import("./runtime.js").FindingsRuntime;
    retests: import("./retests.js").FindingRetests | undefined;
};
export {};
