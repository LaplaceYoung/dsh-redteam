export interface AssetView extends Record<string, unknown> {
  id: string; type: string; domain?: string; ip?: string; url?: string; app_name?: string;
  company_id?: string; task_ids?: string[]; task_source?: string; task_source_summary?: string;
}
export interface CompanyScopeView { id: string; kind: string; domain?: string; net?: string; value?: string; raw?: string; reason?: string }
export interface CompanyView { id: string; name: string; logo?: string; scope: CompanyScopeView[]; asset_count: number }
export function managementEndpoint(path: string): URL {
  const base = new URL(document.baseURI); base.search = ''; base.hash = '';
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  return new URL(`api/redteam/asset-management/${path.replace(/^\/+/, '')}`, base);
}
export async function request<T = unknown>(path: string, options: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const response = await fetch(managementEndpoint(path), { method: options.method ?? 'GET', credentials: 'same-origin', cache: 'no-store', signal: options.signal,
    ...(options.body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options.body) }) });
  const body: unknown = await response.json();
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : `请求失败（HTTP ${response.status}）`;
    throw new Error(message);
  }
  // The authenticated same-version server owns these DTOs; error status is checked above.
  return body as T;
}
