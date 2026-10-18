import type { RedTeamStore } from '../store.js';
export interface TaskAssetMutation {
    requested: number;
    attached: number;
    existing: number;
}
export interface TaskAssetScopeMutation {
    requested: number;
    assets_linked: number;
    assets_existing: number;
    scopes_added: number;
    scopes_existing: number;
}
export interface TaskAssetSource {
    source: string;
    sourceSummary: string;
    sourceNodeId?: string;
}
export interface IntentAsset {
    intent_id: string;
    asset_id: string;
    type: string;
    label: string;
    source: string;
    source_summary: string;
    source_node_id?: string;
    source_task_id: string;
    inherited: boolean;
}
export interface TaskAssetRef {
    id: string;
    kind: string;
    state: string;
    summary: string;
    source_task_id?: string;
    inherited?: boolean;
}
/** Global assets keep their identity; membership and provenance live in shared metadata. */
export declare class TaskAssetRuntime {
    readonly store: RedTeamStore;
    constructor(store: RedTeamStore);
    attach(taskId: string, assetIds: string[], sourceSummary: string): Promise<TaskAssetMutation>;
    detach(taskId: string, assetId: string): Promise<{
        detached: string;
    }>;
    setSource(taskId: string, assetId: string, input: TaskAssetSource): Promise<void>;
    registerScopes(taskId: string, inputs: unknown[]): Promise<TaskAssetScopeMutation>;
    intentAssets(taskId: string): {
        assets: IntentAsset[];
    };
    refs(taskId: string, assetId: string): {
        intents: TaskAssetRef[];
        facts: TaskAssetRef[];
        findings: TaskAssetRef[];
    };
}
