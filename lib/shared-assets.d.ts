import type { Asset, RedTeamSnapshot } from './types.js';
type AssetState = Pick<RedTeamSnapshot, 'assets' | 'tasks' | 'nodes' | 'edges' | 'intents' | 'findings'>;
export declare function assetTaskIds(asset: Asset): string[];
export declare function associateTaskAsset(asset: Asset, taskId: string, source?: Record<string, unknown>): void;
/** Only the task's own graph contributes anchors; source-task visibility is not ownership. */
export declare function taskAssetReferences(state: AssetState, taskId: string): Set<string>;
export declare function taskAssets(state: AssetState, taskId: string): Asset[];
/** Call before removing task graph rows so anchor-only ownership is still visible. */
export declare function detachTaskAssets(state: AssetState, taskId: string, options: {
    deleteExclusive: boolean;
    preserveCompanyAssets?: boolean;
    candidates?: ReadonlySet<string>;
}): {
    deleted: string[];
    detached: string[];
};
/** Restore memberships without applying stale business fields to the live global asset. */
export declare function restoreTaskAssets(state: AssetState, taskId: string, archived: readonly Asset[]): {
    mapping: Map<string, string>;
    warnings: string[];
};
export declare function remapTaskAssetReferences(tables: Pick<RedTeamSnapshot, 'nodes' | 'edges' | 'intents' | 'findings'>, mapping: ReadonlyMap<string, string>): void;
export {};
