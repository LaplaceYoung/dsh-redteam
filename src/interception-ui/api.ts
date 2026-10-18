import type { JudgeConfig, Rule, RuleInput } from '../interception/model.js';
import type { InterceptRecord } from '../interception/repository.js';

export type { JudgeConfig, Rule, RuleInput, InterceptRecord };
export interface Settings { enabledTools: string[]; judge: JudgeConfig }
export interface RecordPage { total: number; items: InterceptRecord[] }
export interface Execution { sessionId: string; callId: string; rootCallId: string; toolName: string; toolInput: unknown; execution: InterceptRecord['execution'] }
export class HttpError extends Error { constructor(message: string, readonly status: number) { super(message); } }
export function endpoint(path: string): URL {
  const base = new URL(document.baseURI); base.search = ''; base.hash = '';
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  return new URL(`api/redteam/interception/${path}`, base);
}
export async function request<T>(path: string, options: { method?: 'POST' | 'PUT' | 'DELETE'; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const response = await fetch(endpoint(path), { method: options.method ?? 'GET', credentials: 'same-origin', cache: 'no-store', signal: options.signal,
    ...(options.method ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options.body ?? {}) } : {}) });
  const body: unknown = await response.json();
  if (!response.ok) {
    const message = typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string' ? body.error
      : response.status === 409 ? '这条审批已由其他操作处理，已重新读取最新状态。' : `请求失败（HTTP ${response.status}）`;
    throw new HttpError(message, response.status);
  }
  return body as T;
}
export function listPath(view: 'pending' | 'history', taskId: string, page: number): string {
  const query = new URLSearchParams({ offset: String(page * 30), limit: '30' });
  if (taskId.trim()) query.set('task_id', taskId.trim());
  return `${view}?${query}`;
}
