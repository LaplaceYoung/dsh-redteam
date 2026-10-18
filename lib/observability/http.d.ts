import type { IncomingMessage } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
import { ObservabilityRepository } from './repository.js';
export interface ObservabilityHttpOptions {
    path?: string;
    authenticate(request: IncomingMessage): boolean | 401 | 403 | Promise<boolean | 401 | 403>;
}
export declare function installObservabilityHttp(ctx: Context, store: {
    storagePath: string;
}, options: ObservabilityHttpOptions): {
    repository: ObservabilityRepository;
    ready: Promise<void>;
};
