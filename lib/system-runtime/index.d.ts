import type { Context } from '@deepseek-ai/cordis';
import type { RedTeamStore } from '../store.js';
import type { PlatformPrepareRun } from '../platform/contracts.js';
import { SystemSettingsStore } from './settings.js';
import { type WebSearchClientOptions } from './web-search.js';
import { ModelHealthRuntime, type PoolProfileSource } from './model-health.js';
import { installCompactionHost, type CompactionHostOptions } from './compaction-host.js';
export * from './settings.js';
export * from './web-search.js';
export * from './model-health.js';
export * from './host-profile-adapter.js';
export * from './model-attribution.js';
export * from './compaction.js';
export * from './compaction-host.js';
export interface DeepSeekSearchCredentials {
    deepSeekBaseURL: string;
    deepSeekAPIKey: string;
    deepSeekModel: string;
}
export interface SystemRuntimeOptions {
    profiles: PoolProfileSource;
    root?: string;
    /** Resolve the active DSH provider's real credentials afresh for each request. Never return these to tools. */
    resolveDeepSeekCredentials?: () => DeepSeekSearchCredentials | Promise<DeepSeekSearchCredentials>;
    search?: WebSearchClientOptions;
    compaction?: Pick<CompactionHostOptions, 'projectionBoundary' | 'contextWindow'>;
}
export interface SearchTestInput {
    web_search_backend?: string;
    web_search_proxy?: string;
    brave_search_api_key?: string;
    tavily_search_api_key?: string;
}
export declare class SystemRuntime {
    private readonly ctx;
    private readonly store;
    private readonly options;
    readonly settings: SystemSettingsStore;
    models: ModelHealthRuntime;
    compaction?: ReturnType<typeof installCompactionHost>;
    private readonly lifetime;
    private readonly pending;
    private readonly cleanup;
    constructor(ctx: Context, store: Pick<RedTeamStore, 'storagePath' | 'snapshot'>, options: SystemRuntimeOptions);
    constraints(taskId: string, role: 'planner' | 'worker'): import("../types.js").Constraint[];
    searchAvailable(): boolean;
    private searchConfiguration;
    private runSearch;
    search(query: string, limit?: number, signal?: AbortSignal): Promise<import("./web-search.js").SearchResult[]>;
    testSearch(input?: SearchTestInput, signal?: AbortSignal): Promise<{
        ok: boolean;
        backend: string;
        count?: number;
        error?: string;
    }>;
    /** Source-compatible search surface snapshots at run construction; constraint reads remain per step. */
    wrapPrepareRun(prepare: PlatformPrepareRun): PlatformPrepareRun;
    initialize(): Promise<void>;
    install(): Promise<void>;
    dispose(): Promise<void>;
}
export declare function installSystemRuntime(ctx: Context, store: Pick<RedTeamStore, 'storagePath' | 'snapshot'>, options: SystemRuntimeOptions): Promise<SystemRuntime>;
