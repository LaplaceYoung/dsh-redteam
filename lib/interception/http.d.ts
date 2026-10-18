import type { IncomingMessage } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
import type { RedTeamStore } from '../store.js';
import { InterceptionRepository } from './repository.js';
export interface InterceptionHttpOptions {
    path?: string;
    /** Must call the actual DSH connection admission service and require the owner principal. */
    authenticate(request: IncomingMessage): boolean | 401 | 403 | Promise<boolean | 401 | 403>;
}
/** Custom webServer routes do not inherit /api auth; composition must supply real admission. */
export declare function installInterceptionHttp(ctx: Context, store: RedTeamStore, options: InterceptionHttpOptions): {
    repository: InterceptionRepository;
    ready: Promise<void>;
};
