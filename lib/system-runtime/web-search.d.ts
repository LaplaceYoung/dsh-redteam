export type WebSearchBackend = 'ddgs' | 'brave-free' | 'tavily' | 'deepseek';
export interface SearchResult {
    title: string;
    url: string;
    description: string;
    position: number;
}
export interface WebSearchConfig {
    backend?: string;
    braveAPIKey?: string;
    tavilyAPIKey?: string;
    deepSeekBaseURL?: string;
    deepSeekAPIKey?: string;
    deepSeekModel?: string;
    /** Independent search egress. Empty always means direct, including with a global dispatcher configured. */
    proxy?: string;
    /** PEM file appended to system trust roots. */
    caCert?: string;
    insecureTLS?: boolean;
}
export interface WebSearchClientOptions {
    /** Explicit endpoint overrides support local protocol fixtures and private search gateways. */
    endpoints?: Partial<Record<Exclude<WebSearchBackend, 'deepseek'>, string>>;
}
export declare class WebSearchHTTPError extends Error {
    readonly backend: WebSearchBackend;
    readonly status: number;
    constructor(backend: WebSearchBackend, status: number);
}
export declare function deepSeekMessagesURL(base: string): string;
/** Same protocol and transport for the agent tool and settings connectivity probe. */
export declare class WebSearchClient {
    readonly backend: WebSearchBackend;
    private readonly dispatcher;
    private readonly endpoint;
    private readonly key;
    private readonly model;
    constructor(config: WebSearchConfig, options?: WebSearchClientOptions);
    close(): Promise<void>;
    probe(query?: string, limit?: number, signal?: AbortSignal): Promise<SearchResult[]>;
    search(query: string, limit?: number, signal?: AbortSignal): Promise<SearchResult[]>;
}
