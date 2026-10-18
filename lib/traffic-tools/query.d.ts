import type { RedTeamStore } from '../store.js';
export interface TrafficMessage {
    headers?: Record<string, string>;
    headerFields?: [string, string][];
    startLine?: string;
    body?: string | null;
    bodyBase64?: string;
    bodySha256?: string;
    bodyLength?: number;
    binary?: boolean;
}
export interface TrafficFilter {
    task_id?: string;
    worker_session_id?: string;
    host?: string;
    method?: string;
    q?: string;
    body?: string;
    path?: string;
    status?: string;
    resp_min?: number;
    resp_max?: number;
    sort?: 'ts' | 'status' | 'resp_len';
    order?: 'asc' | 'desc';
    page?: number;
    size?: number;
}
export interface TrafficSearch {
    host: string;
    contains?: string;
    body_contains?: string;
    limit?: number;
    page?: number;
    task_id?: string;
    worker_session_id?: string;
}
export declare class TrafficQuery {
    private readonly store;
    readonly blobRoot: string;
    constructor(store: RedTeamStore);
    deleteHost(host: string): Promise<import("./deletion.js").TrafficDeletionResult>;
    deleteHostsExact(hosts: string[]): Promise<import("./deletion.js").TrafficDeletionResult>;
    deleteAll(): Promise<import("./deletion.js").TrafficDeletionResult>;
    private rows;
    private row;
    private readBlob;
    private capturedText;
    search(filter: TrafficSearch): Promise<{
        id: string;
        method: string;
        url: string;
        status: number;
        resp_len: number;
    }[]>;
    page(filter?: TrafficFilter): Promise<{
        count: number;
        total: number;
        page: number;
        size: number;
        exchanges: {
            id: string;
            ts: string;
            host: string;
            method: string;
            url_template: string;
            url: string;
            status: number;
            content_type: string;
            resp_len: number;
            task_id: string | undefined;
            worker_session_id: string | undefined;
            error: string | undefined;
        }[];
    }>;
    detail(id: string): {
        request: TrafficMessage;
        response: TrafficMessage | null;
        id: string;
        ts: string;
        host: string;
        method: string;
        url_template: string;
        url: string;
        status: number;
        content_type: string;
        resp_len: number;
        task_id: string | undefined;
        worker_session_id: string | undefined;
        error: string | undefined;
    };
    get(id: string): string;
    body(id: string, side: 'request' | 'response', offset?: number, length?: number): Promise<{
        offset: number;
        length: number;
        total: number;
        base64: string;
        text: string | undefined;
        binary: boolean;
    }>;
    blob(hash: string, offset?: number, length?: number): Promise<{
        offset: number;
        length: number;
        total: number;
        base64: string;
        text: string | undefined;
        binary: boolean;
    }>;
    stats(binding?: {
        task_id?: string;
        worker_session_id?: string;
    }): {
        count: number;
        request_bytes: number;
        response_bytes: number;
        methods: Record<string, number>;
        statuses: Record<string, number>;
        hosts: {
            host: string;
            count: number;
        }[];
    };
}
