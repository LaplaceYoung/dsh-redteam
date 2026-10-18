import type { RedTeamSnapshot } from '../types.js';
export interface TaskDeleteOptions {
    deleteAssets?: boolean;
    deleteFindings?: boolean;
}
export interface TaskDeleteResult {
    taskId: string;
    deleted: boolean;
    assetsDeleted: number;
    assetsDetached: number;
    findingsDeleted: number;
}
/** Atomic data phase. The lifecycle caller must drain real task execution first. */
export declare function deleteManagedTaskData(state: RedTeamSnapshot, taskId: string, options?: TaskDeleteOptions): TaskDeleteResult;
