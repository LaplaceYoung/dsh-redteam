/** ARTEX task_context.go/task_llm.go contracts. Persist each returned state atomically. */
export interface TaskLLMProfile {
    profileId: string;
    position: number;
    status: 'ready' | 'quota_exhausted';
    lastError: string;
    exhaustedAt: string | null;
}
export interface TaskLLMChainState {
    profiles: TaskLLMProfile[];
    activeProfileId: string | null;
    legacyProfileId: string | null;
    revision: number;
}
export interface TaskLLMTransition {
    previousProfileId: string;
    nextProfileId: string | null;
    chainExhausted: boolean;
    advanced: boolean;
    stale: boolean;
}
export declare function emptyTaskLLMChain(): TaskLLMChainState;
/** Call inside the host transaction with its authoritative profile registry. Terminal tasks may edit chains. */
export declare function replaceTaskLLMProfiles(state: TaskLLMChainState, profileIds: readonly string[], availableProfileIds: ReadonlySet<string>, activeProfileId?: string | null): TaskLLMChainState;
/** Use the revision captured at model selection. Omit only for legacy, non-snapshot callers. */
export declare function markTaskLLMProfileQuotaExhausted(state: TaskLLMChainState, profileId: string, reason: string, now: Date, revision?: number): {
    state: TaskLLMChainState;
    transition: TaskLLMTransition;
};
export declare function taskLLMChainView(state: TaskLLMChainState): {
    profileIds: string[];
    failoverState: 'default' | 'ready' | 'chain_exhausted';
    failoverReason: string;
};
/** The host evaluates credentials/provider construction; this module never stores API keys. */
export interface TaskLLMProfileAvailability {
    id: string;
    name: string;
    format: string;
    model: string;
    available: boolean;
    reason?: string;
}
export interface TaskLLMResolution {
    profileId?: string;
    name: string;
    format: string;
    model: string;
    source: 'agent_binding' | 'task_chain' | 'global_profile' | 'environment' | 'global';
    available: boolean;
    reason?: string;
    /** Non-null only for task-chain selections, hence the only path that may mutate failover state. */
    failoverProfileId: string | null;
    revision: number;
}
export interface TaskLLMResolutionInput {
    state: TaskLLMChainState;
    agentBinding: TaskLLMProfileAvailability | null;
    profiles: ReadonlyMap<string, TaskLLMProfileAvailability>;
    globalProfile: TaskLLMProfileAvailability | null;
    environment: {
        name: string;
        format: string;
        model: string;
    } | null;
}
/** A loader error must propagate before invoking this function; missing and invalid providers are distinct from I/O failure. */
export declare function resolveTaskRoleLLM(input: TaskLLMResolutionInput): TaskLLMResolution;
export declare function isQuotaExhaustedMessage(message: string): boolean;
/** Only use after persisting the quota transition. Replaying committed output could duplicate tool side effects. */
export declare function taskLLMReplayDecision(transition: TaskLLMTransition, outputCommitted: boolean): {
    replay: boolean;
    emitTransition: boolean;
};
