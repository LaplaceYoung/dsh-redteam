import type { GenerateOptions, LlmFailure, LlmProviderInfo, StreamChunk } from '@deepseek-ai/dsh-llm';
import type { RedTeamStore } from '../store.js';
import type { ModelHealthRuntime } from '../system-runtime/model-health.js';
import { type TaskLLMTransition } from './llm-chain.js';
export type TaskModelRole = 'mainagent' | 'planner' | 'worker' | 'goals' | 'reporter' | 'retester';
export type TaskModelRoute = Pick<GenerateOptions, 'provider' | 'model' | 'maxTokens' | 'reasoningEffort'>;
export interface TaskProfileSelection {
    profileId: string;
    route: TaskModelRoute;
}
export interface TaskModelPoolAttempt {
    triedProfileIds: string[];
    estimatedTokens?: number;
}
export interface TaskProfileResolver {
    /** Resolve from the host's authoritative configuration, not from an inferred profile id. */
    resolveProfile(profileId: string): TaskModelRoute | null | Promise<TaskModelRoute | null>;
    resolveBinding(taskId: string, role: TaskModelRole): TaskModelRoute | null | Promise<TaskModelRoute | null>;
    resolveGlobal?(): TaskModelRoute | null | Promise<TaskModelRoute | null>;
    /** Atomic identity plus route prevents same-route profiles from sharing the wrong health state. */
    resolveBindingSelection?(taskId: string, role: TaskModelRole): TaskProfileSelection | null | Promise<TaskProfileSelection | null>;
    resolveGlobalSelection?(): TaskProfileSelection | null | Promise<TaskProfileSelection | null>;
}
export interface TaskModelService {
    listProviders(): readonly LlmProviderInfo[];
    stream(request: GenerateOptions): AsyncIterable<StreamChunk>;
}
interface TaskModelSelectionBase {
    taskId: string;
    role: TaskModelRole;
    profileId: string | null;
    revision: number;
    source: 'agent_binding' | 'task_chain' | 'global_profile' | 'parent';
    /** Original profile remains the head when a global pool selects a backup. */
    poolHeadProfileId?: string;
}
export type TaskModelSelection = TaskModelSelectionBase & ({
    available: true;
    route: TaskModelRoute;
    reason?: never;
    chainExhausted?: never;
} | {
    available: false;
    route?: never;
    reason: string;
    chainExhausted: boolean;
});
export interface TaskModelFailureResult {
    handled: boolean;
    replay: boolean;
    transition?: TaskLLMTransition;
}
export interface TaskModelRouterOptions {
    now?: () => Date;
    /** Called only after an actual advance was durably committed. */
    onTransition?: (selection: TaskModelSelection, transition: TaskLLMTransition, failure: unknown) => void | Promise<void>;
    modelHealth?: ModelHealthRuntime;
    poolSettings?: () => {
        llm_pool_enabled: boolean;
        llm_pool_bind_fallback: boolean;
    };
}
export declare class TaskModelRuntimeError extends Error {
    readonly taskId: string;
    readonly outputCommitted: boolean;
    readonly chainExhausted: boolean;
    readonly routerHandled = true;
    constructor(message: string, taskId: string, outputCommitted: boolean, chainExhausted: boolean, cause?: unknown);
}
/** Metadata may be buffered, but any delivered model/tool content closes the replay window. */
export declare function taskModelChunkCommitsOutput(chunk: StreamChunk): boolean;
/** Hand-built Planner requests use stream(); loop-owned requests use selectRoute()/recordFailure() in Agent hooks. */
export declare class TaskModelRouter {
    private readonly store;
    private readonly llm;
    private readonly resolver;
    private readonly options;
    constructor(store: Pick<RedTeamStore, 'snapshot' | 'transaction'>, llm: TaskModelService, resolver: TaskProfileResolver, options?: TaskModelRouterOptions);
    private chain;
    private available;
    private baseRoute;
    private poolSelection;
    selectRoute(taskId: string, parent: TaskModelRoute, role: TaskModelRole, attempt?: TaskModelPoolAttempt): Promise<TaskModelSelection>;
    /** Never changes the frozen request's route; actual failover happens in selectRoute. */
    decorateStream(request: GenerateOptions, selection: TaskModelSelection, next: () => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk>;
    recordFailure(selection: TaskModelSelection, failure: LlmFailure | unknown, outputCommitted: boolean, attempt?: TaskModelPoolAttempt): Promise<TaskModelFailureResult>;
    stream(taskId: string, role: TaskModelRole, request: GenerateOptions, parent?: TaskModelRoute, beforeDispatch?: () => Promise<void>): AsyncIterable<StreamChunk>;
}
export {};
