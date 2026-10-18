import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import React from 'react';
import { Button, Checkbox, Input, SegmentedTabs } from '@deepseek-ai/dsh-client-ui-primitives';
import { taskWorkspaceStyles } from '../task-workspace/styles.js';
import { request } from './client-api.js';
import { CompanyPanel } from './company-panel.js';
import { TaskAssetPanel } from './task-panel.js';
import { ScopeSentryPanel } from './scopesentry-panel.js';
const kinds = { root_domain: '根域名', subdomain: '子域名', ip: 'IP', app: '应用', service: '服务', endpoint: '端点' };
const label = (asset) => asset.url || asset.domain || asset.ip || asset.app_name || asset.id;
const errorText = (error) => error instanceof Error ? error.message : String(error);
const styles = `${taskWorkspaceStyles}.am-json{white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.6 var(--ds-font-family-code,monospace);max-height:320px;overflow:auto;margin:0}.am-select{min-width:0;max-width:100%}.am-assets{display:grid;gap:8px}.am-field{display:grid;gap:5px}.am-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.am-editor{display:grid;gap:10px}.am-editor textarea{min-height:100px;resize:vertical}.am-check{display:flex;gap:8px;align-items:flex-start}.am-label{overflow-wrap:anywhere;min-width:0;flex:1}.am-actions{display:flex;flex-wrap:wrap;gap:6px}`;
/** Native BetterSidebar tab. All changes use the owner-authenticated management routes. */
export function AssetManagementTab(props) {
    const [view, setView] = React.useState('assets');
    const id = React.useId();
    return _jsxs("section", { className: "tw-root", "aria-label": "\u8D44\u4EA7\u7BA1\u7406", children: [_jsx("style", { children: styles }), _jsx("header", { className: "tw-top", children: _jsx("h2", { children: "\u8D44\u4EA7\u7BA1\u7406" }) }), _jsx("div", { className: "tw-toolbar", children: _jsx(SegmentedTabs, { label: "\u8D44\u4EA7\u7BA1\u7406\u89C6\u56FE", value: view, onChange: value => setView(value), items: [
                        { value: 'assets', label: '全局资产', id: `${id}-assets`, panelId: `${id}-assets-panel` },
                        { value: 'companies', label: '公司范围', id: `${id}-companies`, panelId: `${id}-companies-panel` },
                        { value: 'tasks', label: '任务资产', id: `${id}-tasks`, panelId: `${id}-tasks-panel` },
                        { value: 'sync', label: 'ScopeSentry', id: `${id}-sync`, panelId: `${id}-sync-panel` },
                    ] }) }), _jsx("main", { className: "tw-scroll", role: "tabpanel", id: `${id}-${view}-panel`, "aria-labelledby": `${id}-${view}`, children: props.visible !== false && (view === 'assets' ? _jsx(AssetsPanel, {}) : view === 'companies' ? _jsx(CompanyPanel, {}) : view === 'tasks' ? _jsx(TaskAssetPanel, {}) : _jsx(ScopeSentryPanel, {})) })] });
}
function AssetsPanel() {
    const [type, setType] = React.useState('root_domain'), [dsl, setDsl] = React.useState(''), [search, setSearch] = React.useState(''), [company, setCompany] = React.useState(''), [page, setPage] = React.useState(0);
    const [data, setData] = React.useState(), [companies, setCompanies] = React.useState([]);
    const [selected, setSelected] = React.useState([]), [editing, setEditing] = React.useState(), [detail, setDetail] = React.useState();
    const [confirmDelete, setConfirmDelete] = React.useState(false), [busy, setBusy] = React.useState(false), [error, setError] = React.useState(''), [notice, setNotice] = React.useState('');
    const sequence = React.useRef(0), busyRef = React.useRef(false), life = React.useRef(new AbortController());
    React.useEffect(() => { const controller = new AbortController(); life.current = controller; return () => controller.abort(); }, []);
    const refresh = React.useCallback(async () => {
        const n = ++sequence.current;
        try {
            const params = new URLSearchParams({ type, limit: '30', offset: String(page * 30) });
            if (search)
                params.set('dsl', search);
            if (company && !search)
                params.set('company_id', company);
            const [rows, owners] = await Promise.all([request(`assets?${params}`, { signal: life.current.signal }), request('companies', { signal: life.current.signal })]);
            if (life.current.signal.aborted || n !== sequence.current)
                return;
            setData(rows);
            setCompanies(owners);
            setError('');
            setSelected(current => current.filter(id => rows.assets.some(asset => asset.id === id)));
            if (page > 0 && page * 30 >= rows.total)
                setPage(Math.max(0, Math.ceil(rows.total / 30) - 1));
        }
        catch (failure) {
            if (!life.current.signal.aborted && n === sequence.current)
                setError(errorText(failure));
        }
    }, [type, search, company, page]);
    React.useEffect(() => { void refresh(); }, [refresh]);
    async function change(work, success) {
        if (busyRef.current)
            return false;
        busyRef.current = true;
        setBusy(true);
        setError('');
        setNotice('');
        ++sequence.current;
        try {
            await work();
            if (life.current.signal.aborted)
                return false;
            setNotice(success);
            await refresh();
            return true;
        }
        catch (failure) {
            if (!life.current.signal.aborted)
                setError(errorText(failure));
            return false;
        }
        finally {
            busyRef.current = false;
            if (!life.current.signal.aborted)
                setBusy(false);
        }
    }
    return _jsxs("div", { className: "tw-stack", children: [error && _jsx("p", { role: "alert", className: "tw-notice", children: error }), notice && _jsx("p", { role: "status", className: "tw-notice", children: notice }), _jsxs("div", { className: "am-toolbar", children: [_jsx(Button, { size: "sm", variant: "primary", disabled: busy, onClick: () => setEditing('new'), children: "\u767B\u8BB0\u8D44\u4EA7" }), _jsx(Button, { size: "sm", disabled: busy, onClick: () => { void refresh(); }, children: "\u5237\u65B0" }), _jsx("span", { className: "tw-muted", children: data ? `共 ${data.total} 条` : '正在加载…' })] }), _jsxs("form", { className: "am-toolbar", onSubmit: event => { event.preventDefault(); setSearch(dsl); setPage(0); }, children: [_jsx("select", { "aria-label": "\u8D44\u4EA7\u7C7B\u578B", disabled: busy, value: type, onChange: event => { setType(event.target.value); setPage(0); setSelected([]); }, children: Object.entries(kinds).map(([value, text]) => _jsx("option", { value: value, children: text }, value)) }), _jsxs("select", { "aria-label": "\u6309\u516C\u53F8\u7B5B\u9009", className: "am-select", disabled: busy || !!search, value: company, onChange: event => { setCompany(event.target.value); setPage(0); }, children: [_jsx("option", { value: "", children: "\u5168\u90E8\u516C\u53F8" }), companies.map(row => _jsx("option", { value: row.id, children: row.name }, row.id))] }), _jsx(Input, { "aria-label": "\u8D44\u4EA7 DSL \u7B5B\u9009", value: dsl, onChange: event => setDsl(event.target.value), placeholder: 'domain="example.com"', disabled: busy }), _jsx(Button, { size: "sm", type: "submit", disabled: busy, children: "\u7B5B\u9009" })] }), search && _jsx("p", { className: "tw-muted", children: "\u5DF2\u5E94\u7528 DSL \u6761\u4EF6\uFF1B\u516C\u53F8\u4E0B\u62C9\u7B5B\u9009\u5728\u6E05\u7A7A DSL \u540E\u751F\u6548\u3002" }), editing && _jsx(AssetEditor, { asset: editing === 'new' ? undefined : editing, companies: companies, busy: busy, onCancel: () => setEditing(undefined), onSave: async (asset) => {
                    const ok = await change(async () => { const result = await request('assets', { method: 'POST', body: { assets: [asset] }, signal: life.current.signal }); if (result.errors.length)
                        throw new Error(result.errors.map(row => row.error).join('\n')); }, '资产已保存');
                    if (ok)
                        setEditing(undefined);
                    return ok;
                } }, editing === 'new' ? 'new' : editing.id), !!selected.length && _jsxs("div", { className: "tw-card tw-stack", children: [_jsxs("div", { className: "am-toolbar", children: [_jsxs("span", { children: ["\u5DF2\u9009\u62E9 ", selected.length, " \u6761\u8D44\u4EA7"] }), _jsx(Button, { size: "sm", disabled: busy, onClick: () => setConfirmDelete(true), children: "\u6279\u91CF\u5220\u9664" })] }), confirmDelete && _jsxs(_Fragment, { children: [_jsxs("p", { children: ["\u786E\u8BA4\u5220\u9664\u8FD9 ", selected.length, " \u6761\u5168\u5C40\u8D44\u4EA7\uFF1F\u76F8\u5173\u4EFB\u52A1\u5173\u8054\u548C\u5B9E\u65F6\u951A\u70B9\u4F1A\u79FB\u9664\uFF0C\u6F0F\u6D1E\u5386\u53F2\u8BC1\u636E\u4FDD\u7559\u3002"] }), _jsxs("div", { className: "am-actions", children: [_jsx(Button, { size: "sm", disabled: busy, onClick: () => { void change(() => request('assets', { method: 'DELETE', body: { ids: selected }, signal: life.current.signal }), '已删除所选资产').then(ok => { if (ok) {
                                            setSelected([]);
                                            setConfirmDelete(false);
                                            setDetail(undefined);
                                        } }); }, children: "\u786E\u8BA4\u5220\u9664" }), _jsx(Button, { size: "sm", disabled: busy, onClick: () => setConfirmDelete(false), children: "\u53D6\u6D88" })] })] })] }), _jsxs("div", { className: "am-assets", children: [data?.assets.length === 0 && _jsx("p", { className: "tw-muted", children: "\u6CA1\u6709\u7B26\u5408\u6761\u4EF6\u7684\u8D44\u4EA7\u3002" }), data?.assets.map(asset => _jsxs("article", { className: "tw-card tw-stack", children: [_jsxs("div", { className: "am-check", children: [_jsx(Checkbox, { checked: selected.includes(asset.id), disabled: busy, onChange: checked => { setConfirmDelete(false); setSelected(ids => checked === true ? [...ids, asset.id] : ids.filter(id => id !== asset.id)); }, label: `选择资产 ${label(asset)}` }), _jsxs("div", { className: "am-label", children: [_jsx("strong", { children: label(asset) }), _jsxs("p", { className: "tw-muted tw-small", children: [companies.find(row => row.id === asset.company_id)?.name ?? '未归属公司', " \u00B7 ", (asset.task_ids ?? []).length, " \u4E2A\u4EFB\u52A1"] })] })] }), _jsxs("div", { className: "am-actions", children: [_jsx(Button, { size: "sm", disabled: busy, onClick: () => setEditing(asset), children: "\u7F16\u8F91" }), _jsx(Button, { size: "sm", disabled: busy, onClick: () => { void change(async () => setDetail(await request(`assets/${encodeURIComponent(asset.id)}`, { signal: life.current.signal })), '已读取资产详情'); }, children: "\u8BE6\u60C5" })] })] }, asset.id))] }), _jsxs("div", { className: "am-toolbar", children: [_jsx(Button, { size: "sm", disabled: busy || page === 0, onClick: () => setPage(page - 1), children: "\u4E0A\u4E00\u9875" }), _jsxs("span", { children: ["\u7B2C ", page + 1, " \u9875"] }), _jsx(Button, { size: "sm", disabled: busy || !data || (page + 1) * 30 >= data.total, onClick: () => setPage(page + 1), children: "\u4E0B\u4E00\u9875" })] }), detail && _jsxs("section", { className: "tw-card tw-stack", children: [_jsxs("div", { className: "am-toolbar", children: [_jsx("h3", { children: "\u8D44\u4EA7\u8BE6\u60C5" }), _jsx(Button, { size: "sm", onClick: () => setDetail(undefined), children: "\u5173\u95ED\u8BE6\u60C5" })] }), _jsxs("p", { className: "tw-muted", children: ["\u8D44\u4EA7 ID\uFF1A", detail.id] }), _jsx("pre", { className: "am-json", children: JSON.stringify(detail, null, 2) })] })] });
}
function AssetEditor({ asset, companies, busy, onCancel, onSave }) {
    const [kind, setKind] = React.useState(asset?.type ?? 'root_domain');
    const [fields, setFields] = React.useState(() => Object.fromEntries(Object.entries({ ...asset, ...(typeof asset?.app_description === 'string' ? { description: asset.app_description } : {}), ...(asset?.type === 'endpoint' && asset.ip ? { service_ip: asset.ip } : {}) }).filter(([, v]) => typeof v === 'string' || typeof v === 'number').map(([k, v]) => [k, String(v)])));
    const [extra, setExtra] = React.useState(''), [error, setError] = React.useState('');
    const common = kind === 'app' ? ['app_name', 'bundle_id', 'app_icp', 'category', 'description'] : kind === 'ip' ? ['ip'] : kind === 'endpoint' ? ['url', 'method', 'service_ip'] : kind === 'service' ? (fields.url ? ['url', 'ip', 'page_title', 'status_code'] : ['url', 'domain', 'ip', 'port', 'service_name']) : kind === 'subdomain' ? ['domain', 'record_type', 'icp'] : ['domain', 'icp'];
    const names = { app_name: '应用名称', bundle_id: 'Bundle ID', record_type: 'DNS 记录类型', app_icp: '应用 ICP', category: '分类', description: '描述', ip: 'IP 地址', service_ip: '服务 IP', url: 'URL', method: 'HTTP 方法', status_code: 'HTTP 状态码', domain: '域名', port: '端口', service_name: '服务名称', page_title: '页面标题', icp: 'ICP' };
    const identity = kind === 'app' ? ['app_name', 'bundle_id'] : kind === 'ip' ? ['ip'] : kind === 'endpoint' ? ['url', 'method'] : kind === 'service' ? (asset?.url ? ['url'] : ['url', 'domain', 'ip', 'port', 'service_name']) : kind === 'subdomain' ? ['domain', 'record_type'] : ['domain'];
    return _jsxs("form", { className: "tw-card am-editor", onSubmit: event => {
            event.preventDefault();
            setError('');
            try {
                const input = { type: kind };
                if (extra.trim()) {
                    const parsed = JSON.parse(extra);
                    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
                        throw new Error('扩展字段必须是 JSON 对象');
                    Object.assign(input, parsed);
                }
                input.type = kind;
                for (const key of [...common, ...(kind === 'app' ? ['company_id'] : [])])
                    if (fields[key])
                        input[key] = ['port', 'status_code'].includes(key) ? Number(fields[key]) : fields[key];
                if (asset)
                    for (const key of identity) {
                        if (fields[key])
                            input[key] = key === 'port' ? Number(fields[key]) : fields[key];
                        else
                            delete input[key];
                    }
                void onSave(input);
            }
            catch (failure) {
                setError(errorText(failure));
            }
        }, children: [_jsx("h3", { children: asset ? '编辑资产' : '登记资产' }), _jsxs("label", { className: "am-field", children: ["\u7C7B\u578B", _jsx("select", { value: kind, disabled: busy || !!asset, onChange: event => { setKind(event.target.value); setFields({}); }, children: Object.entries(kinds).map(([value, text]) => _jsx("option", { value: value, children: text }, value)) })] }), asset && _jsx("p", { className: "tw-muted", children: "\u8EAB\u4EFD\u5B57\u6BB5\u4FDD\u6301\u4E0D\u53D8\uFF1B\u767B\u8BB0\u540C\u4E00\u81EA\u7136\u952E\u4F1A\u66F4\u65B0\u73B0\u6709\u8D44\u4EA7\u3002" }), common.map(key => _jsxs("label", { className: "am-field", children: [names[key], _jsx(Input, { value: fields[key] ?? '', disabled: busy || !!asset && identity.includes(key), onChange: event => setFields({ ...fields, [key]: event.target.value }) })] }, key)), kind === 'app' && _jsxs("label", { className: "am-field", children: ["\u516C\u53F8", _jsxs("select", { value: fields.company_id ?? '', disabled: busy, onChange: event => setFields({ ...fields, company_id: event.target.value }), children: [_jsx("option", { value: "", children: "\u4FDD\u6301\u539F\u5F52\u5C5E\u6216\u6309\u8303\u56F4\u5339\u914D" }), companies.map(row => _jsx("option", { value: row.id, children: row.name }, row.id))] })] }), _jsxs("details", { children: [_jsx("summary", { children: "\u6269\u5C55\u5B57\u6BB5\uFF08JSON\uFF09" }), _jsx("textarea", { "aria-label": "\u8D44\u4EA7\u6269\u5C55\u5B57\u6BB5 JSON", value: extra, disabled: busy, onChange: event => setExtra(event.target.value), placeholder: '{"technologies":["nginx"]}' })] }), error && _jsx("p", { role: "alert", children: error }), _jsxs("div", { className: "am-actions", children: [_jsx(Button, { type: "submit", size: "sm", variant: "primary", disabled: busy, children: "\u4FDD\u5B58\u8D44\u4EA7" }), _jsx(Button, { type: "button", size: "sm", disabled: busy, onClick: onCancel, children: "\u53D6\u6D88" })] })] });
}
