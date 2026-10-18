import { type CommandRow, type LlmRecord, type ObservabilityState, type RecordFilter, type UsageRow } from './model.js';
/** A canonical file lane is shared by independent Agent/preset/UI instances. */
export declare class ObservabilityRepository {
    readonly path: string;
    private readonly lane;
    constructor(path: string);
    private read;
    snapshot(): Promise<ObservabilityState>;
    private transaction;
    setRecording(enabled: boolean): Promise<{
        enabled: boolean;
    }>;
    appendCall(usage: UsageRow, record?: LlmRecord): Promise<void>;
    appendCommand(row: CommandRow): Promise<void>;
    records(filter?: RecordFilter): Promise<{
        total: number;
        items: {
            wire: import("./wire.js").WireRecord;
            id: string;
            startedAt: string;
            endedAt: string;
            durationMs: number;
            provider: string;
            model: string;
            purpose?: import("@deepseek-ai/dsh-llm").GenerateOptions["purpose"];
            status: "ok" | "error" | "aborted";
            usage: import("@deepseek-ai/dsh-llm").TokenUsage;
            error?: unknown;
            taskId?: string;
            explorationId?: string;
            intentId?: string;
            role?: string;
            profileId?: string;
            agentId?: string;
            runId?: string;
            sessionId?: string;
        }[];
    }>;
    detail(id: string): Promise<LlmRecord>;
    commands(filter?: RecordFilter): Promise<{
        total: number;
        items: CommandRow[];
    }>;
    tasks(): Promise<{
        taskId: string;
        count: number;
    }[]>;
    /** Debug trace deletion intentionally preserves the always-on billing ledger. */
    deleteRecords(taskId: string): Promise<number>;
    deleteTask(taskId: string): Promise<void>;
    toolStats(filter?: RecordFilter): Promise<{
        tool: string;
        calls: number;
        errors: number;
        denied: number;
        timeouts: number;
        aborted: number;
        truncated: number;
        durationMs: number;
    }[]>;
    usage(filter?: RecordFilter, group?: 'model' | 'profile' | 'day'): Promise<{
        key: string;
        provider?: string;
        model?: string;
        profileId?: string;
        day?: string;
        calls: number;
        failed: number;
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens: number;
        cacheWriteTokens: number;
        reasoningTokens: number;
        durationMs: number;
    }[]>;
}
