import type { Context } from '@deepseek-ai/cordis';
import type { IncomingMessage } from 'node:http';
import type { RedTeamStore } from '../store.js';
import { EngineActivity } from './stats.js';
import { ServiceLogs } from './logs.js';
export interface HostVersionManager {
    check(input?: {
        force?: boolean;
    }): Promise<unknown>;
    apply(input: unknown): Promise<unknown>;
    rollback(input?: unknown): Promise<unknown>;
    stream?(listener: (event: unknown) => void): () => void;
    status?(): unknown;
}
export interface HostManagementOptions {
    path?: string;
    authenticate(request: IncomingMessage): boolean | 401 | 403 | Promise<boolean | 401 | 403>;
    version?: HostVersionManager;
    serviceVersion?: string;
    trafficEnabled?: () => boolean;
    llmConfigured?: () => boolean;
    resolveTaskId?: (request: unknown) => string | undefined;
    retention?: number;
}
export declare function installHostManagement(ctx: Context, store: RedTeamStore, options: HostManagementOptions): {
    logs: ServiceLogs;
    activity: EngineActivity;
    ready: Promise<void>;
    dispose: () => void;
};
