import type { RedTeamStore } from '../store.js';
import type { Asset, RedTeamSnapshot } from '../types.js';
export interface AssetInput {
    type: string;
    domain?: string;
    icp?: string;
    record_type?: string;
    record_value?: string[];
    ip?: string;
    bound_domains?: string[];
    open_ports?: Array<{
        port: number;
        service?: string;
    }>;
    app_name?: string;
    bundle_id?: string;
    category?: string;
    description?: string;
    app_icp?: string;
    company_id?: string;
    url?: string;
    technologies?: string[];
    status_code?: number;
    content_length?: number;
    page_title?: string;
    favicon_mmh3?: string;
    auth?: Record<string, unknown>[];
    service_name?: string;
    service_ip?: string;
    port?: number;
    proto?: string;
    method?: string;
    params?: Record<string, unknown>[];
}
export interface ListAssetsInput {
    dsl?: string;
    type?: string;
    id?: string;
    ids?: string[];
    limit?: number;
    offset?: number;
}
export type AssetRow = Record<string, unknown> & {
    id: string;
    type: string;
    task_ids: string[];
    last_seen: string;
};
/** Go's normalizeURL preserves explicit default ports, path spelling and query order. */
export declare function normalizeAssetURL(raw: string): string;
export declare function parseAssetInput(value: unknown): AssetInput;
export declare function normalizeAsset(input: AssetInput): {
    kind: string;
    value: string;
    metadata: Record<string, unknown>;
};
export declare function assetKey(asset: Pick<Asset, 'kind' | 'value' | 'metadata'>): string;
/** Projects legacy generic assets without rewriting their persisted representation. */
export declare function assetRow(asset: Asset, taskId?: string): AssetRow;
export declare function scopedAssets(state: RedTeamSnapshot, taskId: string, includeAnchors?: boolean): Asset[];
type Predicate = (row: AssetRow) => boolean;
/** Small recursive-descent parser matching ARTEX AND > OR precedence and quoted tokens. */
export declare function compileAssetDSL(dsl: string): Predicate;
export declare class GraphAssetRuntime {
    private readonly store;
    constructor(store: RedTeamStore);
    insertAssets(taskId: string, assets: unknown[], options?: {
        ownerIntentId?: string;
    }): Promise<{
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
    listAssets(taskId: string, args?: ListAssetsInput): {
        count: number;
        assets: AssetRow[];
    };
    listUntestedAssets(taskId: string, args?: {
        type?: string;
        page?: number;
        page_size?: number;
    }): {
        assets: {
            id: string;
            type: string;
            label: string;
        }[];
        total: number;
        page: number;
        page_size: number;
    };
    coverage(taskId: string, includeSources?: boolean): {
        denominator: number;
        tested: number;
        pct: number | null;
        by_type: {
            type: string;
            total: number;
            tested: number;
        }[];
        host_count: number;
        scope_rows: number;
    };
    assetNeighbors(taskId: string, args: {
        id: string;
        limit?: number;
        offset?: number;
    }): {
        asset: AssetRow;
        assets: AssetRow[];
        total: number;
        limit: number;
        offset: number;
    };
}
export {};
