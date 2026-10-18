export type SearchBackend = 'ddgs' | 'brave-free' | 'tavily' | 'deepseek';
export interface SystemSettings {
    web_search_enabled: boolean;
    web_search_backend: SearchBackend;
    web_search_proxy: string;
    llm_pool_enabled: boolean;
    llm_pool_bind_fallback: boolean;
    constraints_inject_planner: boolean;
    constraints_inject_worker: boolean;
    noa_compaction: boolean;
}
interface PrivateSettings extends SystemSettings {
    brave_search_api_key: string;
    tavily_search_api_key: string;
}
export interface PublicSystemSettings extends SystemSettings {
    brave_key_set: boolean;
    tavily_key_set: boolean;
}
export type SystemSettingsPatch = {
    [K in keyof PrivateSettings]?: PrivateSettings[K] | null;
};
/** Private sidecar owns only settings not already owned by traffic/task/platform runtimes. */
export declare class SystemSettingsStore {
    readonly storagePath: string;
    private readonly key;
    private get value();
    constructor(path: string);
    private read;
    load(): Promise<PublicSystemSettings>;
    snapshot(): PublicSystemSettings;
    /** Internal transport input. Never expose this object as a tool/API response. */
    searchConfig(): {
        enabled: boolean;
        backend: SearchBackend;
        braveAPIKey: string;
        tavilyAPIKey: string;
        proxy: string;
    };
    update(patch: SystemSettingsPatch): Promise<PublicSystemSettings>;
}
export interface PromptConstraint {
    taskId: string;
    kind: 'allow' | 'deny';
    text: string;
}
export declare function selectPromptConstraints<T extends PromptConstraint>(settings: Pick<SystemSettings, 'constraints_inject_planner' | 'constraints_inject_worker'>, constraints: readonly T[], taskId: string, role: 'planner' | 'worker'): T[];
export {};
