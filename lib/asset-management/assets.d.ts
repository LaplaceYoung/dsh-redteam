import type { RedTeamStore } from '../store.js';
import type { RedTeamSnapshot } from '../types.js';
import { GraphAssetRuntime } from '../graph-tools/assets.js';
export interface AssetFilter {
    type?: string;
    dsl?: string;
    task_id?: string;
    company_id?: string;
    limit?: number;
    offset?: number;
}
/** Mirrors assets DELETE CASCADE for live anchors; finding evidence retains historical IDs. */
export declare function deleteAssetsInState(state: RedTeamSnapshot, ids: ReadonlySet<string>): number;
export declare class AssetManagementRuntime {
    readonly store: RedTeamStore;
    readonly graph: GraphAssetRuntime;
    constructor(store: RedTeamStore);
    list(filter?: AssetFilter): {
        count: number;
        total: number;
        assets: import("../graph-tools/assets.js").AssetRow[];
    };
    get(id: string): import("../graph-tools/assets.js").AssetRow;
    counts(taskId?: string): Record<string, number>;
    insert(assets: unknown[], taskId?: string, source?: string, summary?: string): Promise<{
        results: {
            index: number;
            id: string;
            type: string;
        }[];
        errors: {
            index: number;
            error: string;
        }[];
    }>;
    delete(ids: string[]): Promise<{
        deleted: number;
    }>;
}
