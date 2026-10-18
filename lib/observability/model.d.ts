import type { GenerateOptions, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm';
import type { WireRecord } from './wire.js';
export interface Attribution {
    taskId?: string;
    explorationId?: string;
    intentId?: string;
    role?: string;
    profileId?: string;
    agentId?: string;
    runId?: string;
    sessionId?: string;
}
export interface UsageRow extends Attribution {
    id: string;
    startedAt: string;
    endedAt: string;
    durationMs: number;
    provider: string;
    model: string;
    purpose?: GenerateOptions['purpose'];
    status: 'ok' | 'error' | 'aborted';
    usage: TokenUsage;
    error?: unknown;
}
export interface LlmRecord extends UsageRow {
    request: Omit<GenerateOptions, 'signal'>;
    chunks: StreamChunk[];
    /** Adapter chunks are never relabelled as HTTP/SSE wire bytes. */
    wire: WireRecord;
}
export interface CommandRow extends Attribution {
    id: string;
    callId: string;
    rootCallId: string;
    tool: string;
    input: unknown;
    startedAt: string;
    endedAt: string;
    /** Undefined if an earlier host guard settled before pre-execute observation. */
    durationMs?: number;
    status: 'running' | 'ok' | 'error' | 'denied' | 'timeout' | 'aborted';
    dispatched: boolean;
    truncated: boolean;
    exitCode?: number;
    result: unknown;
}
export interface ObservabilityState {
    version: 1;
    recording: boolean;
    usage: UsageRow[];
    records: LlmRecord[];
    commands: CommandRow[];
}
export interface RecordFilter {
    taskId?: string;
    sessionId?: string;
    agentId?: string;
    runId?: string;
    profileId?: string;
    role?: string;
    model?: string;
    provider?: string;
    status?: string;
    tool?: string;
    q?: string;
    from?: string;
    until?: string;
    offset?: number;
    limit?: number;
}
export declare function matches(row: UsageRow | CommandRow, filter: RecordFilter): boolean;
export declare function page<T>(rows: T[], filter: RecordFilter): {
    total: number;
    items: T[];
};
