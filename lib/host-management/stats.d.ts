import type { RedTeamSnapshot } from '../types.js';
export declare class HostManagementError extends Error {
    readonly status: number;
    constructor(status: number, message: string);
}
export declare class EngineActivity {
    private readonly now;
    private calls;
    private touched;
    constructor(now?: () => number);
    touch(taskId: string): void;
    begin(taskId: string): () => void;
    stats(state: RedTeamSnapshot, taskId: string | undefined, configured: boolean, trafficEnabled: boolean): Record<string, unknown>;
}
