import type { AssetInput } from '../graph-tools/assets.js';
export declare class ScopeSentryError extends Error {
    readonly status: number;
    readonly upstreamStatus?: number | undefined;
    constructor(message: string, status?: number, upstreamStatus?: number | undefined);
}
export interface ScopeSentrySink {
    insertAssets(assets: AssetInput[]): Promise<{
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
    upsertCompany(input: {
        name: string;
        roots: string[];
        source: string;
    }): Promise<unknown>;
    recomputeAttribution(): Promise<unknown>;
}
export interface ScopeSentryStatus {
    exists: boolean;
    configured: boolean;
    enabled: boolean;
    reachable: boolean;
    url: string;
    hasApiKey: boolean;
    tools: string[];
    error?: string;
}
export interface ScopeSentryPage {
    page?: number;
    size?: number;
    search?: string;
}
export interface ScopeSentrySyncInput {
    dimension: 'project' | 'task';
    targets: string[];
    asset_types?: string[];
    create_company?: boolean;
    page_size?: number;
}
export interface ScopeSentrySyncResult {
    ok: boolean;
    partial: boolean;
    synced: {
        subdomain: number;
        app: number;
        service: number;
        ip: number;
    };
    companies: string[];
    warnings: string[];
    errors: string[];
}
/** Mapping from ARTEX server/sync_scopesentry.go:ssIngest, using the existing global asset contract. */
export declare function scopeSentryAssets(assetType: string, value: unknown): AssetInput[];
/** One local configuration per RedTeam store; all remote work uses the real MCP SDK. */
export declare class ScopeSentryRuntime {
    private readonly sink;
    private readonly path;
    private readonly queueKey;
    private readonly lifetime;
    private readonly pending;
    constructor(configPath: string, sink: ScopeSentrySink);
    private config;
    private serial;
    ready(): Promise<void>;
    private view;
    configure(input: {
        url?: string;
        api_key?: string;
        enabled?: boolean;
    }, signal?: AbortSignal): Promise<ScopeSentryStatus>;
    private request;
    private connected;
    private call;
    status(signal?: AbortSignal): Promise<ScopeSentryStatus>;
    projects(input?: ScopeSentryPage, signal?: AbortSignal): Promise<{
        projects: Record<string, unknown>[];
        tag: Record<string, number>;
    }>;
    tasks(input?: ScopeSentryPage, signal?: AbortSignal): Promise<{
        tasks: Record<string, unknown>[];
    }>;
    sync(input: ScopeSentrySyncInput, signal?: AbortSignal): Promise<ScopeSentrySyncResult>;
    dispose(): Promise<void>;
}
