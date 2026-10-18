import type { ReaRunResult } from './types.js';
import type { RedTeamStore } from './store.js';
interface ReaConfig {
    command?: string;
}
export declare class ReaRuntime {
    private readonly store;
    private readonly config;
    constructor(store: RedTeamStore, config?: ReaConfig);
    analyze(taskId: string, target: string, provider?: string): Promise<ReaRunResult>;
    run(taskId: string, args: string[], target?: string, command?: string): Promise<ReaRunResult>;
    manifest(): Promise<unknown>;
    private execute;
}
export {};
