import type { IncomingMessage } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
import type { RedTeamStore } from '../store.js';
import { type ManagementOptions } from './operations.js';
export interface AssetManagementHttpOptions extends ManagementOptions {
    authenticate(request: IncomingMessage): boolean | 401 | 403 | Promise<boolean | 401 | 403>;
}
export declare function installAssetManagementHttp(ctx: Context, store: RedTeamStore, options: AssetManagementHttpOptions): {
    dispose: () => Promise<void>;
    assets: import("./assets.js").AssetManagementRuntime;
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
};
