import { type GenerateOptions, type LlmFailure, type StreamChunk } from '@deepseek-ai/dsh-llm';
export interface PoolProfile {
    id: string;
    name: string;
    provider: string;
    model: string;
    maxTokens?: number;
    reasoningEffort?: string;
}
export interface PoolProfileSource {
    list(): Promise<{
        profiles: PoolProfile[];
        activeProfileId: string | null;
    }>;
}
export interface RetryRule {
    attempts: number;
    interval_ms: number;
}
export interface ModelRetryPolicy {
    connect: RetryRule;
    empty: RetryRule;
    stream: RetryRule;
    breaker: RetryRule;
    intent: RetryRule;
}
export interface ProfilePoolPolicy {
    priority: number;
    excluded: boolean;
    ratePerSecond: number;
    ratePerMinute: number;
    windowTokens: number;
    retry: Pick<ModelRetryPolicy, 'connect' | 'empty' | 'stream'>;
}
export interface ModelHealthState {
    fails: number;
    trips: number;
    openUntil: number;
    lastError: string;
    lastAt: number;
}
export type ModelStream = (options: GenerateOptions) => AsyncIterable<StreamChunk>;
export interface PoolSelection {
    profileId: string;
    bound?: boolean;
    enabled: boolean;
    bindFallback: boolean;
}
export interface ModelHealthOptions {
    storagePath: string;
    profiles: PoolProfileSource;
    /** Dispatches through the actual DSH runtime; never a model-catalog lookup. */
    stream: ModelStream;
    now?: () => number;
    sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}
/** DSH exposes typed status/code facts; provider message text is diagnostic only. */
export declare function classifyModelFailure(failure: LlmFailure, signal?: AbortSignal): 'hard' | 'transient' | 'none';
/** One shared instance per installation: rebuilds of a task's chain retain limiter and breaker state. */
export declare class ModelHealthRuntime {
    private readonly options;
    private readonly shared;
    private get state();
    private set state(value);
    private get writes();
    private set writes(value);
    private get limiterLocks();
    private get requests();
    private get retryAfter();
    private get decoratedRequests();
    private get roundRobin();
    private set roundRobin(value);
    private readonly now;
    private readonly sleep;
    private constructor();
    static open(options: ModelHealthOptions): Promise<ModelHealthRuntime>;
    private persist;
    private profile;
    profilePolicy(id: string): ProfilePoolPolicy;
    retryPolicy(): ModelRetryPolicy;
    resolvedRetry(id: string): ModelRetryPolicy;
    setProfilePolicy(id: string, policy: ProfilePoolPolicy): Promise<ProfilePoolPolicy>;
    setRetryPolicy(policy: ModelRetryPolicy): Promise<ModelRetryPolicy>;
    health(id: string): ModelHealthState;
    reset(id?: string): Promise<void>;
    /** Called after successful profile deletion, retaining other profile IDs unchanged. */
    forget(id: string): Promise<void>;
    status(): Promise<{
        chain: {
            profile_id: string;
            name: string;
            provider: string;
            model: string;
            active: boolean;
            priority: number;
            excluded: boolean;
            state: string;
            fails: number;
            trips: number;
            cooldown_secs: number;
            last_error: string;
            last_at: string | null;
            policy: ProfilePoolPolicy;
        }[];
        retry: ModelRetryPolicy;
    }>;
    private pass;
    private trip;
    private acquire;
    private chain;
    /** Native Agent hooks call this before request header/model source are committed. */
    selectProfile(selection: PoolSelection, tried?: readonly string[], estimatedTokens?: number, advanceRotation?: boolean): Promise<PoolProfile | null>;
    /** One failed logical attempt, after same-provider retries, shared by all task routers. */
    recordFailure(profileId: string, failure: LlmFailure, outputCommitted: boolean, signal?: AbortSignal): Promise<boolean>;
    private route;
    /** DSH waterfall seam: preserves the frozen request and adapter/source identity. */
    decorateStream(options: GenerateOptions, profileId: string, next: () => AsyncIterable<StreamChunk>, recordHealth?: boolean): AsyncGenerator<StreamChunk>;
    /** No replay after any chunk is delivered, including block-start and usage. */
    stream(options: GenerateOptions, selection: PoolSelection, dispatch?: ModelStream, recordHealth?: boolean): AsyncGenerator<StreamChunk>;
    /** A real, bounded completion. Never declares success from catalog membership. */
    probe(profileId: string, signal?: AbortSignal): Promise<{
        ok: boolean;
        profile_id: string;
        elapsed_ms: number;
        response: string;
        failure?: LlmFailure;
    }>;
}
