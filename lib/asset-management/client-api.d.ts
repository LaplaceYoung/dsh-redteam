export interface AssetView extends Record<string, unknown> {
    id: string;
    type: string;
    domain?: string;
    ip?: string;
    url?: string;
    app_name?: string;
    company_id?: string;
    task_ids?: string[];
    task_source?: string;
    task_source_summary?: string;
}
export interface CompanyScopeView {
    id: string;
    kind: string;
    domain?: string;
    net?: string;
    value?: string;
    raw?: string;
    reason?: string;
}
export interface CompanyView {
    id: string;
    name: string;
    logo?: string;
    scope: CompanyScopeView[];
    asset_count: number;
}
export declare function managementEndpoint(path: string): URL;
export declare function request<T = unknown>(path: string, options?: {
    method?: string;
    body?: unknown;
    signal?: AbortSignal;
}): Promise<T>;
