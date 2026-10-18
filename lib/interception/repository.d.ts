import type { TokenUsage } from '@deepseek-ai/dsh-llm';
import { type Action, type JudgeConfig, type Rule, type RuleInput, type ReviewInput } from './model.js';
export interface InterceptRecord {
    id: string;
    taskId?: string;
    sessionId: string;
    callId: string;
    rootCallId: string;
    toolName: string;
    toolInput: unknown;
    ruleId?: string;
    ruleName?: string;
    status: 'pending' | 'allowed' | 'denied' | 'timeout';
    action: Action;
    decisionSource: 'rule' | 'model' | 'manual';
    reason: string;
    createdAt: string;
    decidedAt?: string;
    effectiveAction?: 'allow' | 'deny';
    decisionReason?: string;
    inputDigest: string;
    configDigest: string;
    modelInput?: ReviewInput;
    modelInputDigest?: string;
    modelFallback?: boolean;
    profileId?: string;
    execution: {
        status: 'pending' | 'succeeded' | 'failed' | 'not_executed' | 'unknown';
        output?: string;
        truncated?: boolean;
        completedAt?: string;
    };
    usage?: unknown;
}
export interface JudgeCall {
    id: string;
    taskId?: string;
    sessionId: string;
    provider: string;
    model: string;
    startedAt: string;
    finishedAt?: string;
    status: 'running' | 'succeeded' | 'failed' | 'cancelled' | 'unknown';
    usage?: TokenUsage;
    error?: string;
}
export interface InterceptionState {
    version: 1;
    nextOrder: number;
    rules: Rule[];
    records: InterceptRecord[];
    enabledTools: string[];
    judge: JudgeConfig;
    judgeCalls: JudgeCall[];
}
export declare const digest: (value: unknown) => string;
export declare function validateRecord(row: InterceptRecord): void;
/** One atomic file and serialized mutation lane per canonical path, shared by all Agent scopes. */
export declare class InterceptionRepository {
    readonly path: string;
    private readonly lane;
    constructor(path: string);
    private read;
    snapshot(): Promise<InterceptionState>;
    transaction<T>(mutate: (state: InterceptionState) => T): Promise<T>;
    /** Restart cannot resume the original in-memory tool call. Never leave a phantom live approval. */
    initialize(legacyRules?: readonly {
        id: string;
        taskId?: string;
        name: string;
        enabled: boolean;
        priority: number;
        matchTarget: string;
        matchType: string;
        pattern: string;
        action: string;
        message?: string;
        createdAt: string;
        updatedAt: string;
    }[]): Promise<void>;
    upsertRule(input: RuleInput, id?: string): Promise<Rule>;
    deleteRule(id: string): Promise<void>;
    toggleRule(id: string, enabled: boolean): Promise<Rule>;
    configure(input: {
        enabledTools?: string[];
        judge?: JudgeConfig;
    }): Promise<void>;
    add(input: Omit<InterceptRecord, 'id' | 'createdAt'>): Promise<InterceptRecord>;
    detail(id: string): Promise<InterceptRecord>;
    decide(id: string, allowed: boolean, options?: {
        timeout?: boolean;
        reason?: string;
        expectedTaskId?: string;
    }): Promise<{
        resolved: boolean;
        record: InterceptRecord;
    }>;
    wait(id: string, signal: AbortSignal): Promise<InterceptRecord>;
    complete(id: string, execution: InterceptRecord['execution']): Promise<void>;
    startJudge(input: Pick<JudgeCall, 'taskId' | 'sessionId' | 'provider' | 'model'>): Promise<string>;
    updateJudge(id: string, patch: Pick<JudgeCall, 'usage'> & Partial<Pick<JudgeCall, 'status' | 'error' | 'finishedAt'>>): Promise<void>;
    judgeUsage(days?: number, now?: Date): Promise<{
        calls: number;
        input_tokens: number;
        output_tokens: number;
        cache_read_tokens: number;
        cache_write_tokens: number;
        daily: {
            date: string;
            calls: number;
            input_tokens: number;
            output_tokens: number;
        }[];
    }>;
}
