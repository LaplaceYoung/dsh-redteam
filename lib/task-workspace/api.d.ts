import type { IncomingMessage } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { RedTeamStore } from '../store.js';
import type { TaskLifecycleRuntime } from '../task-management/integration.js';
import type { TaskProfileRegistry } from '../task-management/runtime-profiles.js';
import { type TaskWorkspaceAction } from './contracts.js';
export interface TaskWorkspaceApiOptions {
    profiles: TaskProfileRegistry;
    /** The host authentication service must check the actual incoming request. */
    authenticate(request: IncomingMessage): boolean | 401 | 403 | Promise<boolean | 401 | 403>;
    lifecycleForAgent(agent: Agent): Pick<TaskLifecycleRuntime, 'start' | 'pause' | 'deleteTask' | 'admission'> | undefined;
    admission(): {
        enabled: boolean;
        limit: number;
    } | Promise<{
        enabled: boolean;
        limit: number;
    }>;
    notify?(taskId: string): void;
}
/** Validate HTTP data before it reaches typed domain services. */
export declare function parseTaskWorkspaceAction(value: unknown): TaskWorkspaceAction;
export declare function installTaskWorkspaceApi(ctx: Context, store: RedTeamStore, options: TaskWorkspaceApiOptions): {
    dispose(): void;
};
