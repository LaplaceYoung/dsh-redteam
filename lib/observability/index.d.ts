import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { GenerateOptions } from '@deepseek-ai/dsh-llm';
import { ObservabilityRepository } from './repository.js';
import type { Attribution, RecordFilter } from './model.js';
export { ObservabilityRepository } from './repository.js';
export type { Attribution, CommandRow, LlmRecord, RecordFilter, UsageRow } from './model.js';
export { installObservabilityHttp } from './http.js';
/** Auxiliary calls without a durable session carry explicit identity across asynchronous work. */
export declare function withObservation<T>(identity: Attribution, call: () => T): T;
/** Stream factories are lazy: keep attribution active for every next/return, including external consumers. */
export declare function withObservationStream<T>(identity: Attribution, create: () => AsyncIterable<T>): AsyncGenerator<T>;
export interface ObservabilityOptions {
    path?: string;
    resolveCall(request: GenerateOptions): Attribution | undefined;
    resolveAgent(agent: Agent): Attribution | undefined;
    onError?(error: unknown): void;
}
export declare function installObservability(ctx: Context, store: {
    storagePath: string;
}, options: ObservabilityOptions): {
    repository: ObservabilityRepository;
    ready: Promise<void>;
    flush: () => Promise<void>;
    dispose: () => Promise<void>;
};
export declare function validateFilter(value: unknown): RecordFilter;
