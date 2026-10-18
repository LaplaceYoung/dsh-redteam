import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { taskWorkspaceStyles } from '../task-workspace/styles.js';
/** Use the same base path as BetterSidebar, including reverse proxies and desktop URLs. */
export function apiUrl(path, query) {
    const base = new URL(document.baseURI);
    base.search = '';
    base.hash = '';
    if (!base.pathname.endsWith('/'))
        base.pathname += '/';
    const url = new URL(path.replace(/^\/+/, ''), base);
    for (const [key, value] of Object.entries(query ?? {}))
        if (value !== undefined && value !== null)
            url.searchParams.set(key, String(value));
    return url;
}
export async function requestJson(path, init = {}) {
    const headers = new Headers(init.headers);
    if (typeof init.body === 'string' && !headers.has('content-type'))
        headers.set('content-type', 'application/json');
    const response = await fetch(path instanceof URL ? path : apiUrl(path), { credentials: 'same-origin', cache: 'no-store', ...init, headers });
    if (response.status === 204 && response.ok)
        return undefined;
    const text = await response.text();
    let value;
    try {
        value = JSON.parse(text);
    }
    catch {
        throw new Error(`宿主未返回 JSON（HTTP ${response.status}），请检查插件路由是否已启用。`);
    }
    if (!response.ok)
        throw new Error(value && typeof value === 'object' && 'error' in value && typeof value.error === 'string' ? value.error : `请求失败（HTTP ${response.status}）`);
    return value;
}
export const errorMessage = (failure) => failure instanceof Error ? failure.message : String(failure);
const managementStyles = `
.mg-root pre{max-width:100%;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px;line-height:1.6;background:var(--dsw-alias-bg-layer-1);padding:9px;border-radius:var(--dsw-radius-sm,6px);margin:0}
.mg-root table{width:100%;border-collapse:collapse;font:inherit}.mg-root th,.mg-root td{text-align:left;padding:7px 6px;border-bottom:1px solid var(--dsw-alias-border-l1);overflow-wrap:anywhere}.mg-root th{color:var(--dsw-alias-label-secondary);font-weight:500}.mg-table{overflow:auto}
.mg-root label{min-width:0}.mg-root .tw-toolbar>select{flex:1;min-width:110px}.mg-root .tw-field textarea{min-height:100px}.mg-root .tw-actions{row-gap:8px}.mg-root input[type=file]{max-width:100%;font:inherit}
.mg-list{display:flex;flex-direction:column;gap:8px}.mg-meta{display:flex;gap:5px 12px;flex-wrap:wrap;color:var(--dsw-alias-label-secondary);font-size:11px}.mg-code{font-family:ui-monospace,monospace}.mg-root a{color:var(--dsw-alias-state-business-primary)}
`;
export function ManagementPage({ title, description, actions, toolbar, loading, error, notice, children }) {
    return _jsxs("section", { className: "tw-root mg-root", "aria-label": title, children: [_jsx("style", { children: taskWorkspaceStyles + managementStyles }), _jsxs("header", { className: "tw-top", children: [_jsxs("div", { className: "tw-grow", children: [_jsx("h2", { children: title }), description && _jsx("p", { className: "tw-muted tw-small", children: description })] }), actions] }), toolbar && _jsx("div", { className: "tw-toolbar", children: toolbar }), error && _jsx(Notice, { tone: "error", children: error }), notice && _jsx(Notice, { tone: "success", children: notice }), _jsx("div", { className: "tw-scroll", children: _jsxs("div", { className: "tw-stack", children: [loading && _jsx("p", { role: "status", className: "tw-muted", children: "\u6B63\u5728\u52A0\u8F7D\u2026" }), children] }) })] });
}
export function Notice({ tone = 'info', children }) {
    return _jsx("div", { className: "tw-notice", role: tone === 'error' ? 'alert' : 'status', children: children });
}
export function Field({ label, hint, children }) {
    return _jsxs("label", { className: "tw-field", children: [_jsx("span", { children: label }), children, hint && _jsx("small", { children: hint })] });
}
export function JsonDetails({ value, summary = '查看详细数据', open = false }) {
    return _jsxs("details", { open: open, children: [_jsx("summary", { children: summary }), _jsx("pre", { children: JSON.stringify(value, null, 2) })] });
}
