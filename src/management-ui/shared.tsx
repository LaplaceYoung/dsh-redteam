import React from 'react';
import { taskWorkspaceStyles } from '../task-workspace/styles.js';

export type Query = Record<string, string | number | boolean | null | undefined>;

/** Use the same base path as BetterSidebar, including reverse proxies and desktop URLs. */
export function apiUrl(path: string, query?: Query): URL {
  const base = new URL(document.baseURI); base.search = ''; base.hash = '';
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  const url = new URL(path.replace(/^\/+/, ''), base);
  for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  return url;
}

export async function requestJson<T>(path: string | URL, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (typeof init.body === 'string' && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(path instanceof URL ? path : apiUrl(path), { credentials: 'same-origin', cache: 'no-store', ...init, headers });
  if (response.status === 204 && response.ok) return undefined as T;
  const text = await response.text();
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new Error(`宿主未返回 JSON（HTTP ${response.status}），请检查插件路由是否已启用。`); }
  if (!response.ok) throw new Error(value && typeof value === 'object' && 'error' in value && typeof value.error === 'string' ? value.error : `请求失败（HTTP ${response.status}）`);
  return value as T;
}

export const errorMessage = (failure: unknown): string => failure instanceof Error ? failure.message : String(failure);

const managementStyles = `
.mg-root pre{max-width:100%;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px;line-height:1.6;background:var(--dsw-alias-bg-layer-1);padding:9px;border-radius:var(--dsw-radius-sm,6px);margin:0}
.mg-root table{width:100%;border-collapse:collapse;font:inherit}.mg-root th,.mg-root td{text-align:left;padding:7px 6px;border-bottom:1px solid var(--dsw-alias-border-l1);overflow-wrap:anywhere}.mg-root th{color:var(--dsw-alias-label-secondary);font-weight:500}.mg-table{overflow:auto}
.mg-root label{min-width:0}.mg-root .tw-toolbar>select{flex:1;min-width:110px}.mg-root .tw-field textarea{min-height:100px}.mg-root .tw-actions{row-gap:8px}.mg-root input[type=file]{max-width:100%;font:inherit}
.mg-list{display:flex;flex-direction:column;gap:8px}.mg-meta{display:flex;gap:5px 12px;flex-wrap:wrap;color:var(--dsw-alias-label-secondary);font-size:11px}.mg-code{font-family:ui-monospace,monospace}.mg-root a{color:var(--dsw-alias-state-business-primary)}
`;

export function ManagementPage({ title, description, actions, toolbar, loading, error, notice, children }: {
  title: string; description?: string; actions?: React.ReactNode; toolbar?: React.ReactNode;
  loading?: boolean; error?: string; notice?: string; children?: React.ReactNode;
}): React.ReactNode {
  return <section className="tw-root mg-root" aria-label={title}>
    <style>{taskWorkspaceStyles + managementStyles}</style>
    <header className="tw-top"><div className="tw-grow"><h2>{title}</h2>{description && <p className="tw-muted tw-small">{description}</p>}</div>{actions}</header>
    {toolbar && <div className="tw-toolbar">{toolbar}</div>}
    {error && <Notice tone="error">{error}</Notice>}{notice && <Notice tone="success">{notice}</Notice>}
    <div className="tw-scroll"><div className="tw-stack">{loading && <p role="status" className="tw-muted">正在加载…</p>}{children}</div></div>
  </section>;
}
export function Notice({ tone = 'info', children }: { tone?: 'info' | 'success' | 'error'; children?: React.ReactNode }): React.ReactNode {
  return <div className="tw-notice" role={tone === 'error' ? 'alert' : 'status'}>{children}</div>;
}
export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }): React.ReactNode {
  return <label className="tw-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}
export function JsonDetails({ value, summary = '查看详细数据', open = false }: { value: unknown; summary?: string; open?: boolean }): React.ReactNode {
  return <details open={open}><summary>{summary}</summary><pre>{JSON.stringify(value, null, 2)}</pre></details>;
}
