export interface ReaSessionOptions { environment?: Record<string, string | undefined> }
export interface ReaSessionRequest { signal?: AbortSignal; onProgress?: (progress: { progressToken: string; progress: number; message?: string }) => void | Promise<void> }
export interface ReaToolResult {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
}
export interface ReaNativeSession {
  readonly operations: readonly string[];
  readonly prompts: readonly string[];
  describeTool(name: string): { name: string; title?: string; description?: string; annotations?: Record<string, unknown>; inputSchema: Record<string, unknown>; outputSchema?: Record<string, unknown> };
  invoke(operation: string, input?: unknown, request?: ReaSessionRequest): Promise<ReaToolResult>;
  listCommands(): Promise<readonly string[]>;
  describeCommand(name: string): Promise<NativeCliDescription>;
  invokeCommand(name: string, input?: NativeCliInput, request?: NativeCliRequest): Promise<NativeCliResult>;
  getPrompt(name: string, input?: Record<string, string>): Promise<unknown>;
  completePrompt(name: string, argument: string, value: string, context?: { arguments?: Record<string, string> }, request?: ReaSessionRequest): Promise<{ completion: { values: string[]; total?: number; hasMore: boolean } }>;
  status(): unknown;
  close(): Promise<void>;
}
export function createReaSession(options?: ReaSessionOptions): Promise<ReaNativeSession>;
export function projectAnalysisError(error: Error): Record<string, unknown>;
import type { NativeCliDescription, NativeCliInput, NativeCliRequest, NativeCliResult } from './cli/runtime.mjs';
