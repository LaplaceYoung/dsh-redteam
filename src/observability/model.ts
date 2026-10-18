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
export function matches(row: UsageRow | CommandRow, filter: RecordFilter): boolean {
  for (const key of ['taskId', 'sessionId', 'agentId', 'runId', 'profileId', 'role', 'status'] as const) if (filter[key] && row[key] !== filter[key]) return false;
  if ('model' in row && (filter.model && row.model !== filter.model || filter.provider && row.provider !== filter.provider)) return false;
  if ('tool' in row && (filter.tool && row.tool !== filter.tool || filter.q && !JSON.stringify([row.tool, row.input, row.result]).toLowerCase().includes(filter.q.toLowerCase()))) return false;
  return (!filter.from || row.startedAt >= filter.from) && (!filter.until || row.startedAt < filter.until);
}
export function page<T>(rows: T[], filter: RecordFilter): { total: number; items: T[] } {
  const offset = filter.offset ?? 0, limit = filter.limit ?? 50;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('Invalid pagination');
  return { total: rows.length, items: rows.slice().reverse().slice(offset, offset + limit) };
}
