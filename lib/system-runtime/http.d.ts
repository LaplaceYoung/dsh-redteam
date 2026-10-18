import type { IncomingMessage } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
import type { RedTeamStore } from '../store.js';
import { SystemRuntime, type SystemRuntimeOptions } from './index.js';
export declare const SYSTEM_RUNTIME_PATH = "/api/redteam/system";
export interface SystemRuntimeHttpOptions extends SystemRuntimeOptions {
    authenticate(request: IncomingMessage): boolean | 401 | 403 | Promise<boolean | 401 | 403>;
}
/** UI-only hosts use the same durable/shared services without registering agent tools. */
export declare function installSystemRuntimeHttp(ctx: Context, store: Pick<RedTeamStore, 'storagePath' | 'snapshot'>, options: SystemRuntimeHttpOptions): {
    runtime: SystemRuntime;
    ready: Promise<void>;
    dispose: () => Promise<void>;
};
