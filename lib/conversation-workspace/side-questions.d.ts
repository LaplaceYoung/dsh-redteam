import type { Context } from '@deepseek-ai/cordis';
import { type GenerateOptions, type TokenUsage } from '@deepseek-ai/dsh-llm';
import { type SideContextInfo, type SideMemory } from './side-questions-context.js';
export type SideParent = {
    kind: 'conversation';
    id: string;
} | {
    kind: 'task';
    id: string;
    explorationId?: string;
    intentId?: string;
};
export interface SideSnapshot {
    parent: SideParent;
    capturedAt: string;
    version: number;
    identity: string;
    windowTokens: number;
    request: GenerateOptions;
}
export interface SideExchange {
    id: string;
    parent: SideParent;
    clientRequestId: string;
    generation: number;
    ordinal: number;
    question: string;
    answer: string;
    status: 'running' | 'completed' | 'cancelled' | 'failed' | 'interrupted';
    error?: string;
    model: {
        provider: string;
        model: string;
        identity: string;
    };
    snapshotAt: string;
    createdAt: string;
    sequence: number;
    usage: TokenUsage;
    context?: SideContextInfo;
}
export interface SideSession {
    parent: SideParent;
    generation: number;
    snapshot: SideSnapshot;
    memory: SideMemory;
    exchanges: SideExchange[];
}
export interface SideTaskArchive {
    version: 1;
    taskId: string;
    ordinal: number;
    sessions: SideSession[];
}
export interface SideQuestionsOptions {
    directory: string;
    parentForSession(sessionId: string): SideParent | undefined | Promise<SideParent | undefined>;
    parentExists(parent: SideParent): boolean | Promise<boolean>;
    /** Include an opaque configuration revision to invalidate changed profiles; never credentials. */
    modelIdentity?(request: Pick<GenerateOptions, 'provider' | 'model' | 'reasoningEffort' | 'maxTokens'>, parent: SideParent): string | Promise<string>;
    prepareQuestion?(parent: SideParent, question: string): string | Promise<string>;
    outputTokens?: number;
    onError?(error: unknown): void;
}
export declare class SideQuestionError extends Error {
    readonly status: number;
    constructor(status: number, message: string);
}
export declare const sideParentKey: (parent: SideParent) => string;
/** Original ARTEX side questions are one-shot LLM calls, not child Agents.
 * Only the original native Agent owns its Session; this service cannot steer,
 * cancel, append to, or execute tools on that Agent.
 */
export declare class SideQuestionService {
    private readonly ctx;
    private readonly options;
    private state;
    private queue;
    private readonly runs;
    private readonly blockedTasks;
    private readonly blockedParents;
    private readonly latest;
    private readonly listeners;
    private readonly captureVersions;
    private readonly captureParents;
    private readonly sessionCaptures;
    private stopped;
    private unhook?;
    private unhookSession?;
    private readonly path;
    private constructor();
    static open(ctx: Context, options: SideQuestionsOptions): Promise<SideQuestionService>;
    private report;
    private serial;
    private persist;
    private isBlocked;
    private assertParent;
    private identity;
    private capture;
    private saveSnapshot;
    subscribe(listener: (exchange: SideExchange) => void): () => void;
    private publish;
    list(parent: SideParent, options?: {
        before?: number;
        limit?: number;
    }): Promise<{
        items: SideExchange[];
        current?: SideExchange;
        nextCursor?: number;
        snapshot?: {
            capturedAt: string;
            provider: string;
            model: string;
            available: boolean;
            reason?: string;
        };
    }>;
    get(id: string): Promise<SideExchange | undefined>;
    /** Caller owns the task archive/admission barrier. This only drains writes. */
    quiesceTask(taskId: string): Promise<void>;
    exportTaskArchive(taskId: string): Promise<SideTaskArchive>;
    private planTaskArchive;
    preflightTaskArchive(taskId: string, data: unknown): Promise<void>;
    restoreTaskArchive(taskId: string, data: unknown): Promise<void>;
    ask(parent: SideParent, input: {
        clientRequestId: string;
        question: string;
    }): Promise<SideExchange>;
    private update;
    private run;
    wait(id: string): Promise<SideExchange | undefined>;
    cancel(id: string): Promise<SideExchange>;
    private deletion;
    prepareTaskDelete(taskId: string): Promise<{
        commit(): Promise<void>;
        rollback(): Promise<void>;
    }>;
    prepareParentDelete(parent: SideParent): Promise<{
        commit(): Promise<void>;
        rollback(): Promise<void>;
    }>;
    clear(parent: SideParent): Promise<void>;
    dispose(): Promise<void>;
}
export declare function installSideQuestions(ctx: Context, options: SideQuestionsOptions): Promise<SideQuestionService>;
