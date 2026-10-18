import type { Context } from '@deepseek-ai/cordis';
import type { GenerateOptions } from '@deepseek-ai/dsh-llm';
import type { PlatformPrepareRun, PlatformRunInput, PreparedPlatformRun } from '../platform/contracts.js';
import { type CompactionRuntimeOptions, type NoaCompactionRun } from './compaction.js';
export interface CompactionHostOptions extends CompactionRuntimeOptions {
    contextWindow?: (input: PlatformRunInput) => number | undefined;
    /** Prefer an existing provider wrapper calling projectRequest to avoid a second llm/stream dispatch. */
    projectionBoundary?: 'llm-stream' | 'provider-wrapper';
}
export interface PreparedCompactionRun extends PreparedPlatformRun {
    /** Context-manager identity only. Never substitute this for the real DSH sessionId. */
    runId: string;
    transformRequest(request: GenerateOptions): GenerateOptions;
}
/** Enumerable symbol survives route/signal object spreads but never enters provider JSON. */
export declare const NOA_PROJECTED_REQUEST: unique symbol;
/** Observers check after iteration and record the inner projected call instead of this outer envelope. */
export declare function isNoaRedispatchedRequest(request: GenerateOptions): boolean;
/** Installs real stream projection and mutual exclusion with the public DSH compaction service. */
export declare function installCompactionHost(ctx: Context, options: CompactionHostOptions): {
    projectRequest: (request: GenerateOptions) => GenerateOptions;
    getRun: (sessionId: string) => NoaCompactionRun | undefined;
    noteUsage(request: GenerateOptions, inputTokens: number): void;
    recoverOverflow(request: GenerateOptions, error: unknown): GenerateOptions | undefined;
    wrapPrepareRun(prepare: PlatformPrepareRun): PlatformPrepareRun;
    dispose(): void;
};
