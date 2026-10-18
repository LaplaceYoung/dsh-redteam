import type { Context } from '@deepseek-ai/cordis';
import { type LlmRuntime } from '@deepseek-ai/dsh-llm';
import type { RedTeamStore } from '../store.js';
import { type TaskLLMChainState } from './llm-chain.js';
import type { TaskModelRole, TaskModelRoute, TaskProfileResolver, TaskProfileSelection } from './runtime-model.js';
export interface TaskModelProfile {
    id: string;
    name: string;
    provider: string;
    model: string;
    maxTokens?: number;
    reasoningEffort?: string;
    createdAt: string;
    updatedAt: string;
}
export interface TaskModelProfileInput {
    id?: string;
    name: string;
    provider: string;
    model: string;
    maxTokens?: number;
    reasoningEffort?: string;
}
export interface TaskModelProfileState {
    version: 1;
    profiles: TaskModelProfile[];
    roleBindings: Partial<Record<TaskModelRole, string>>;
    activeProfileId: string | null;
    /** Durable intent spanning the profile file and the task store. Replayed idempotently on access. */
    pendingDeletion: string | null;
}
type ProfileLlmService = Pick<LlmRuntime, 'listProviders' | 'listModels' | 'resolveModelInfo'>;
/** Independent IDs/configuration; provider-owned credentials and transport settings are never copied. */
export declare class TaskProfileRegistry implements TaskProfileResolver {
    private readonly store;
    private readonly llm;
    readonly storagePath: string;
    private readonly lockKey;
    constructor(store: RedTeamStore, llm: ProfileLlmService);
    private serial;
    private save;
    private state;
    private finishDeletion;
    private route;
    private availability;
    list(): Promise<TaskModelProfileState>;
    listAvailable(): Promise<Array<TaskModelProfile & {
        available: boolean;
        reason?: string;
    }>>;
    availableProfileIds(): Promise<Set<string>>;
    providerCatalog(): Promise<{
        providers: ReturnType<ProfileLlmService['listProviders']>;
        models: Awaited<ReturnType<ProfileLlmService['listModels']>>;
    }>;
    upsert(input: TaskModelProfileInput): Promise<TaskModelProfile>;
    delete(profileId: string): Promise<{
        deleted: string;
    }>;
    bind(role: TaskModelRole, profileId: string | null): Promise<TaskModelProfileState['roleBindings']>;
    setActive(profileId: string | null): Promise<TaskModelProfileState>;
    setTaskChain(taskId: string, profileIds: readonly string[], activeProfileId?: string | null): Promise<TaskLLMChainState>;
    createManagedTask(input: Parameters<RedTeamStore['createManagedTask']>[0]): ReturnType<RedTeamStore['createManagedTask']>;
    private resolveId;
    resolveProfile(profileId: string): Promise<TaskModelRoute | null>;
    resolveBinding(_taskId: string, role: TaskModelRole): Promise<TaskModelRoute | null>;
    resolveGlobal(): Promise<TaskModelRoute | null>;
    resolveBindingSelection(_taskId: string, role: TaskModelRole): Promise<TaskProfileSelection | null>;
    resolveGlobalSelection(): Promise<TaskProfileSelection | null>;
}
export interface TaskProfileInstallation {
    resolver: TaskProfileRegistry;
    registry: TaskProfileRegistry;
    disposers: Array<() => void>;
    dispose(): void;
}
/** Install after llm/tools injection. Calls perform awaited recovery before exposing persistent state. */
export declare function installTaskProfiles(ctx: Context, store: RedTeamStore): TaskProfileInstallation;
export {};
