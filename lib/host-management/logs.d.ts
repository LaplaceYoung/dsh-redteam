export interface ServiceLog {
    seq: number;
    db_id: number;
    ts: string;
    level: string;
    tag: string;
    text: string;
}
/** One bounded durable journal per host installation, with a monotonic restart-safe cursor. */
export declare class ServiceLogs {
    readonly path: string;
    readonly retention: number;
    private rows;
    private sequence;
    private tail;
    private failure;
    private listeners;
    readonly ready: Promise<void>;
    constructor(path: string, retention?: number);
    private load;
    append(input: Omit<ServiceLog, 'seq' | 'db_id'>): Promise<void>;
    flush(): Promise<void>;
    recent(since?: number, limit?: number): Promise<{
        items: ServiceLog[];
        cursor: number;
        latest: number;
        truncated: boolean;
    }>;
    history(before?: number, limit?: number): Promise<{
        items: ServiceLog[];
        has_more: boolean;
        retention: number;
    }>;
    subscribe(listener: (row: ServiceLog) => void): () => void;
}
