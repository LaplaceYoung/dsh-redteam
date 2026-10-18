import type { JudgeConfig, Rule, RuleInput } from '../interception/model.js';
import type { InterceptRecord } from '../interception/repository.js';
export type { JudgeConfig, Rule, RuleInput, InterceptRecord };
export interface Settings {
    enabledTools: string[];
    judge: JudgeConfig;
}
export interface RecordPage {
    total: number;
    items: InterceptRecord[];
}
export interface Execution {
    sessionId: string;
    callId: string;
    rootCallId: string;
    toolName: string;
    toolInput: unknown;
    execution: InterceptRecord['execution'];
}
export declare class HttpError extends Error {
    readonly status: number;
    constructor(message: string, status: number);
}
export declare function endpoint(path: string): URL;
export declare function request<T>(path: string, options?: {
    method?: 'POST' | 'PUT' | 'DELETE';
    body?: unknown;
    signal?: AbortSignal;
}): Promise<T>;
export declare function listPath(view: 'pending' | 'history', taskId: string, page: number): string;
