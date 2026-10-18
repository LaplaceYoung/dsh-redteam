import type { AssetManagementRuntime } from './assets.js';
export interface ManagementServices {
    assets: AssetManagementRuntime;
    companies: {
        list(): unknown;
        get(id: string): unknown;
        create(input: {
            name: string;
            logo?: string;
            scope?: unknown[];
        }): Promise<unknown>;
        scope(id: string, input: {
            scope: unknown[];
            reset?: boolean;
            reason?: string;
        }): Promise<unknown>;
        delete(id: string, deleteAssets: boolean): Promise<unknown>;
        reattribute(): Promise<unknown>;
    };
    tasks: {
        catalog(): unknown;
        attach(taskId: string, input: {
            asset_ids?: string[];
            source_summary?: string;
            scope?: unknown[];
        }): Promise<unknown>;
        detach(taskId: string, assetId: string): Promise<unknown>;
        intentAssets(taskId: string): unknown;
        refs(taskId: string, assetId: string): unknown;
    };
    scopesentry: {
        status(signal?: AbortSignal): Promise<unknown>;
        projects(input: {
            page?: number;
            size?: number;
            search?: string;
        }, signal?: AbortSignal): Promise<unknown>;
        tasks(input: {
            page?: number;
            size?: number;
            search?: string;
        }, signal?: AbortSignal): Promise<unknown>;
        sync(input: {
            dimension: string;
            targets: string[];
            asset_types?: string[];
            create_company?: boolean;
            page_size?: number;
        }, signal?: AbortSignal): Promise<unknown>;
        configure(input: {
            url?: string;
            api_key?: string;
            enabled?: boolean;
        }, signal?: AbortSignal): Promise<unknown>;
    };
    ready: Promise<unknown>;
    dispose(): Promise<void>;
}
export interface ManagementOptions {
    scopeSentryPath?: string;
    onTaskMutation?: (taskId: string) => void | Promise<void>;
}
export type ManagementResource = 'assets' | 'companies' | 'task-assets' | 'scopesentry';
export declare function executeManagement(services: ManagementServices, resource: ManagementResource, action: string, input: Record<string, unknown>, signal: AbortSignal, options?: ManagementOptions): Promise<unknown>;
