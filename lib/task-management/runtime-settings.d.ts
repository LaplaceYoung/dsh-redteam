import type { Context } from '@deepseek-ai/cordis';
import type { RedTeamStore } from '../store.js';
import type { TaskLifecycleRuntime } from './integration.js';
export interface TaskAdmissionSettings {
    enabled: boolean;
    limit: number;
}
type Runtime = Pick<TaskLifecycleRuntime, 'setAdmission'>;
/** Persists settings before notifying every attached agent scope sharing this store directory. */
export declare class TaskAdmissionRegistry {
    readonly storagePath: string;
    private readonly key;
    private readonly fallback;
    constructor(store: Pick<RedTeamStore, 'storagePath'>, fallback?: TaskAdmissionSettings);
    private serial;
    private read;
    get(): Promise<TaskAdmissionSettings>;
    attach(runtime: Runtime): Promise<() => void>;
    update(patch: Partial<TaskAdmissionSettings>): Promise<TaskAdmissionSettings>;
}
export declare function installTaskAdmissionSettings(ctx: Context, store: RedTeamStore, lifecycle: Runtime, fallback?: TaskAdmissionSettings): Promise<{
    registry: TaskAdmissionRegistry;
    dispose: () => void;
}>;
export {};
