import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from 'react';
import { Button, Checkbox, Input } from '@deepseek-ai/dsh-client-ui-primitives';
import { taskWorkspaceStyles } from '../task-workspace/styles.js';
import { request } from './client-api.js';
const assetTypes = [{ key: 'subdomain', label: '子域名及关联 IP' }, { key: 'service', label: '服务' }, { key: 'app', label: '应用' }];
const pageSize = 50;
function targets(rows, dimension) {
    return rows.map(row => {
        const id = dimension === 'project' ? row.id : row.name;
        if (typeof id !== 'string' || !id.trim())
            throw new Error(`ScopeSentry 返回的${dimension === 'project' ? '项目缺少 ID' : '任务缺少名称'}`);
        const name = typeof row.name === 'string' && row.name ? row.name : id;
        const detail = typeof row.AssetCount === 'number' ? `${row.AssetCount} 个资产` : typeof row.status === 'string' || typeof row.status === 'number' ? `状态：${row.status}` : '';
        return { id, name, detail };
    });
}
const message = (error) => error instanceof Error ? error.message : String(error);
export function ScopeSentryPanel() {
    const [status, setStatus] = React.useState(null);
    const [url, setUrl] = React.useState(''), [apiKey, setApiKey] = React.useState(''), [enabled, setEnabled] = React.useState(true);
    const [dimension, setDimension] = React.useState('project');
    const [search, setSearch] = React.useState(''), [appliedSearch, setAppliedSearch] = React.useState('');
    const [page, setPage] = React.useState(1), [rows, setRows] = React.useState([]), [loaded, setLoaded] = React.useState(false);
    const [selected, setSelected] = React.useState([]), [chosenTypes, setChosenTypes] = React.useState(['subdomain', 'service', 'app']);
    const [createCompany, setCreateCompany] = React.useState(true);
    const [statusBusy, setStatusBusy] = React.useState(true), [configBusy, setConfigBusy] = React.useState(false);
    const [listBusy, setListBusy] = React.useState(false), [syncBusy, setSyncBusy] = React.useState(false);
    const [error, setError] = React.useState(''), [notice, setNotice] = React.useState('');
    const [result, setResult] = React.useState(null);
    const mounted = React.useRef(false), requests = React.useRef(new Set()), syncRequest = React.useRef(null);
    const busy = statusBusy || configBusy || listBusy || syncBusy;
    const ready = Boolean(status?.configured && status.enabled);
    function controller() { const value = new AbortController(); requests.current.add(value); return value; }
    async function loadTargets(nextDimension, nextPage, query) {
        const pending = controller();
        setListBusy(true);
        setError('');
        setSelected([]);
        setRows([]);
        setLoaded(false);
        try {
            const params = new URLSearchParams({ page: String(nextPage), size: String(pageSize), ...(query ? { search: query } : {}) });
            let nextRows;
            if (nextDimension === 'project') {
                const response = await request(`scopesentry/projects?${params}`, { signal: pending.signal });
                nextRows = targets(response.projects, nextDimension);
            }
            else {
                const response = await request(`scopesentry/tasks?${params}`, { signal: pending.signal });
                nextRows = targets(response.tasks, nextDimension);
            }
            if (!mounted.current || pending.signal.aborted)
                return;
            setRows(nextRows);
            setPage(nextPage);
            setAppliedSearch(query);
            setLoaded(true);
        }
        catch (failure) {
            if (mounted.current && !pending.signal.aborted)
                setError(`加载目标失败：${message(failure)}`);
        }
        finally {
            requests.current.delete(pending);
            if (mounted.current && !pending.signal.aborted)
                setListBusy(false);
        }
    }
    async function refreshStatus() {
        const pending = controller();
        setStatusBusy(true);
        setError('');
        try {
            const next = await request('scopesentry/status', { signal: pending.signal });
            if (!mounted.current || pending.signal.aborted)
                return;
            setStatus(next);
            setEnabled(next.exists ? next.enabled : true);
            if (next.configured && next.enabled)
                await loadTargets(dimension, 1, search.trim());
            else {
                setRows([]);
                setSelected([]);
                setLoaded(false);
            }
        }
        catch (failure) {
            if (mounted.current && !pending.signal.aborted)
                setError(`读取数据源状态失败：${message(failure)}`);
        }
        finally {
            requests.current.delete(pending);
            if (mounted.current && !pending.signal.aborted)
                setStatusBusy(false);
        }
    }
    React.useEffect(() => {
        mounted.current = true;
        void refreshStatus();
        return () => { mounted.current = false; for (const pending of requests.current)
            pending.abort(); requests.current.clear(); };
    }, []);
    async function save(event) {
        event.preventDefault();
        if (busy)
            return;
        const pending = controller();
        setConfigBusy(true);
        setError('');
        setNotice('');
        setResult(null);
        try {
            const next = await request('scopesentry/datasource', {
                method: 'POST', signal: pending.signal,
                body: { ...(url.trim() ? { url: url.trim() } : {}), ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}), enabled },
            });
            if (!mounted.current || pending.signal.aborted)
                return;
            setApiKey('');
            setUrl('');
            setStatus(next);
            setEnabled(next.enabled);
            setNotice(next.reachable ? '配置已保存，连接正常。' : next.enabled ? '配置已保存，连接检查未通过。' : '配置已保存，数据源已停用。');
            setRows([]);
            setSelected([]);
            setLoaded(false);
            if (next.configured && next.enabled && next.reachable)
                await loadTargets(dimension, 1, search.trim());
        }
        catch (failure) {
            if (mounted.current && !pending.signal.aborted)
                setError(`保存配置失败：${message(failure)}`);
        }
        finally {
            requests.current.delete(pending);
            if (mounted.current && !pending.signal.aborted)
                setConfigBusy(false);
        }
    }
    function changeDimension(next) {
        if (next === dimension || busy)
            return;
        setDimension(next);
        setSearch('');
        setAppliedSearch('');
        setPage(1);
        setSelected([]);
        setResult(null);
        setNotice('');
        if (ready)
            void loadTargets(next, 1, '');
    }
    async function synchronize() {
        if (busy || !ready || !selected.length || !chosenTypes.length || syncRequest.current)
            return;
        const pending = controller();
        syncRequest.current = pending;
        setSyncBusy(true);
        setError('');
        setNotice('');
        setResult(null);
        try {
            const response = await request('scopesentry/sync', {
                method: 'POST', signal: pending.signal,
                body: { dimension, targets: selected, asset_types: chosenTypes, create_company: dimension === 'project' && createCompany, page_size: 100 },
            });
            if (mounted.current && !pending.signal.aborted)
                setResult(response);
        }
        catch (failure) {
            if (mounted.current) {
                if (pending.signal.aborted)
                    setNotice('同步请求已取消；取消前已写入的资产会保留。');
                else
                    setError(`同步失败：${message(failure)}`);
            }
        }
        finally {
            requests.current.delete(pending);
            if (syncRequest.current === pending)
                syncRequest.current = null;
            if (mounted.current)
                setSyncBusy(false);
        }
    }
    const resultFailed = result !== null && (!result.ok || result.errors.length > 0);
    return _jsxs("section", { className: "tw-stack", "aria-label": "ScopeSentry \u8D44\u4EA7\u540C\u6B65", children: [_jsx("style", { children: taskWorkspaceStyles }), error && _jsx("div", { className: "tw-notice", role: "alert", children: error }), notice && _jsx("div", { className: "tw-notice", role: "status", children: notice }), _jsxs("section", { className: "tw-card tw-stack", "aria-label": "ScopeSentry \u6570\u636E\u6E90\u914D\u7F6E", children: [_jsxs("div", { className: "tw-card-head", children: [_jsx("h3", { children: "ScopeSentry \u6570\u636E\u6E90" }), _jsx(Button, { type: "button", size: "sm", variant: "outline", disabled: busy, onClick: () => { void refreshStatus(); }, children: statusBusy ? '检查中…' : '检查连接' })] }), _jsxs("div", { className: "tw-gap", "aria-live": "polite", children: [_jsx("p", { children: statusBusy ? '正在读取数据源状态…' : status === null ? '尚未取得数据源状态' : !status.exists || !status.configured ? '尚未配置完整的数据源' : !status.enabled ? '数据源已停用' : status.reachable ? '已连接' : '连接失败' }), status?.error && _jsx("p", { className: "tw-description", role: "alert", children: status.error }), status?.url && _jsxs("p", { className: "tw-muted tw-description", children: ["\u5F53\u524D\u5730\u5740\uFF1A", status.url] }), status?.hasApiKey && _jsx("p", { className: "tw-muted", children: "\u5DF2\u4FDD\u5B58 API Key\uFF1B\u7559\u7A7A\u4F1A\u4FDD\u7559\u73B0\u6709\u5BC6\u94A5\u3002" }), status?.tools.length ? _jsxs("details", { children: [_jsxs("summary", { children: ["\u5DF2\u53D1\u73B0 ", status.tools.length, " \u4E2A\u5DE5\u5177"] }), _jsx("p", { className: "tw-description", children: status.tools.join('、') })] }) : null] }), _jsx("form", { className: "tw-stack", onSubmit: event => { void save(event); }, children: _jsxs("fieldset", { className: "tw-stack", disabled: busy, children: [_jsxs("label", { className: "tw-field", children: [_jsx("span", { children: "MCP \u5730\u5740" }), _jsx(Input, { "aria-label": "ScopeSentry MCP \u5730\u5740", type: "url", autoComplete: "off", placeholder: status?.url ? '留空保留当前地址' : 'https://scopesentry.example/mcp', required: !status?.url && enabled, value: url, onChange: event => setUrl(event.target.value) }), _jsx("small", { children: "\u586B\u5199\u65B0\u5730\u5740\u53EF\u66FF\u6362\u5F53\u524D\u5730\u5740\u3002" })] }), _jsxs("label", { className: "tw-field", children: [_jsx("span", { children: "API Key" }), _jsx(Input, { "aria-label": "ScopeSentry API Key", type: "password", autoComplete: "new-password", placeholder: status?.hasApiKey ? '留空保留现有密钥' : '输入 API Key', required: !status?.hasApiKey && enabled, value: apiKey, onChange: event => setApiKey(event.target.value) })] }), _jsx(Checkbox, { label: "\u542F\u7528 ScopeSentry \u6570\u636E\u6E90", checked: enabled, onChange: setEnabled, disabled: busy }), _jsx("div", { className: "tw-actions", children: _jsx(Button, { type: "submit", variant: "primary", size: "sm", children: configBusy ? '保存中…' : '保存配置' }) })] }) })] }), _jsxs("section", { className: "tw-card tw-stack", "aria-label": "\u9009\u62E9\u540C\u6B65\u76EE\u6807", children: [_jsx("h3", { children: "\u9009\u62E9\u9879\u76EE\u6216\u4EFB\u52A1" }), !ready && _jsx("p", { className: "tw-muted", children: "\u914D\u7F6E\u5E76\u542F\u7528\u6570\u636E\u6E90\u540E\uFF0C\u53EF\u52A0\u8F7D\u9879\u76EE\u6216\u4EFB\u52A1\u3002" }), _jsxs("div", { className: "tw-actions", "aria-label": "\u540C\u6B65\u7EF4\u5EA6", children: [_jsx(Button, { type: "button", size: "sm", variant: dimension === 'project' ? 'primary' : 'outline', "aria-pressed": dimension === 'project', disabled: busy, onClick: () => changeDimension('project'), children: "\u6309\u9879\u76EE" }), _jsx(Button, { type: "button", size: "sm", variant: dimension === 'task' ? 'primary' : 'outline', "aria-pressed": dimension === 'task', disabled: busy, onClick: () => changeDimension('task'), children: "\u6309\u4EFB\u52A1" })] }), _jsxs("form", { className: "tw-inline", onSubmit: event => { event.preventDefault(); if (!busy && ready)
                            void loadTargets(dimension, 1, search.trim()); }, children: [_jsx(Input, { className: "tw-grow", "aria-label": "\u641C\u7D22 ScopeSentry \u9879\u76EE\u6216\u4EFB\u52A1", placeholder: dimension === 'project' ? '搜索项目' : '搜索任务', disabled: !ready || busy, value: search, onChange: event => setSearch(event.target.value) }), _jsx(Button, { type: "submit", size: "sm", variant: "outline", disabled: !ready || busy, children: listBusy ? '加载中…' : '搜索 / 加载' })] }), listBusy ? _jsx("p", { role: "status", children: "\u6B63\u5728\u52A0\u8F7D\u76EE\u6807\u2026" }) : loaded && rows.length === 0 ? _jsxs("p", { className: "tw-muted", children: ["\u672C\u9875\u6CA1\u6709\u5339\u914D\u7684", dimension === 'project' ? '项目' : '任务', "\u3002"] }) : rows.length > 0 ? _jsxs("div", { className: "tw-gap", children: [_jsx(Checkbox, { label: `选择本页全部 ${rows.length} 项`, checked: rows.every(row => selected.includes(row.id)), disabled: busy, onChange: checked => setSelected(checked ? rows.map(row => row.id) : []) }), rows.map(row => _jsxs("div", { className: "tw-record tw-gap", children: [_jsx(Checkbox, { className: "tw-title", label: row.name, checked: selected.includes(row.id), disabled: busy, onChange: checked => setSelected(current => checked ? [...current, row.id] : current.filter(id => id !== row.id)) }), row.detail && _jsx("p", { className: "tw-muted tw-small", children: row.detail }), dimension === 'project' && _jsx("p", { className: "tw-muted tw-small tw-description", children: row.id })] }, row.id))] }) : null, _jsxs("div", { className: "tw-actions", children: [_jsx(Button, { type: "button", size: "sm", disabled: !ready || busy || page <= 1, onClick: () => { void loadTargets(dimension, page - 1, appliedSearch); }, children: "\u4E0A\u4E00\u9875" }), _jsxs("span", { className: "tw-muted", children: ["\u7B2C ", page, " \u9875 \u00B7 \u6BCF\u9875 ", pageSize, " \u9879"] }), _jsx(Button, { type: "button", size: "sm", disabled: !ready || busy || !loaded || rows.length < pageSize, onClick: () => { void loadTargets(dimension, page + 1, appliedSearch); }, children: "\u4E0B\u4E00\u9875" })] }), _jsx("p", { className: "tw-muted tw-small", children: "\u5206\u9875\u3001\u641C\u7D22\u6216\u5207\u6362\u7EF4\u5EA6\u540E\u9700\u91CD\u65B0\u9009\u62E9\u76EE\u6807\u3002" })] }), _jsxs("section", { className: "tw-card tw-stack", "aria-label": "\u540C\u6B65\u9009\u9879", children: [_jsx("h3", { children: "\u540C\u6B65\u5185\u5BB9" }), _jsxs("fieldset", { className: "tw-gap", disabled: busy || !ready, children: [assetTypes.map(type => _jsx(Checkbox, { label: type.label, checked: chosenTypes.includes(type.key), disabled: busy || !ready, onChange: checked => setChosenTypes(current => checked ? [...current, type.key] : current.filter(value => value !== type.key)) }, type.key)), dimension === 'project' && _jsx(Checkbox, { label: "\u6309\u9879\u76EE\u521B\u5EFA\u516C\u53F8\u53CA\u8303\u56F4\uFF0C\u5E76\u66F4\u65B0\u8D44\u4EA7\u5F52\u5C5E", checked: createCompany, onChange: setCreateCompany, disabled: busy || !ready })] }), _jsxs("p", { className: "tw-muted", children: ["\u5DF2\u9009\u62E9 ", selected.length, " \u4E2A", dimension === 'project' ? '项目' : '任务', "\u3001", chosenTypes.length, " \u7C7B\u8D44\u4EA7\u3002\u6BCF\u4E2A\u76EE\u6807\u6BCF\u7C7B\u8D44\u4EA7\u6700\u591A\u540C\u6B65 5000 \u6761\u3002"] }), _jsxs("div", { className: "tw-actions", children: [_jsx(Button, { type: "button", size: "sm", variant: "primary", disabled: !ready || busy || selected.length === 0 || chosenTypes.length === 0, onClick: () => { void synchronize(); }, children: syncBusy ? '正在同步…' : '同步所选目标' }), syncBusy && _jsx(Button, { type: "button", size: "sm", variant: "outline", onClick: () => syncRequest.current?.abort(), children: "\u53D6\u6D88\u540C\u6B65" })] })] }), result && _jsxs("section", { className: "tw-card tw-stack", "aria-label": "ScopeSentry \u540C\u6B65\u7ED3\u679C", children: [_jsx("h3", { role: resultFailed ? 'alert' : 'status', children: resultFailed ? '同步存在失败' : result.partial || result.warnings.length > 0 ? '同步完成（部分结果）' : '同步完成' }), _jsx("p", { className: "tw-muted", children: "\u4EE5\u4E0B\u662F\u6210\u529F\u5165\u5E93\u6216\u66F4\u65B0\u7684\u8BB0\u5F55\u6570\uFF0C\u5305\u542B\u5DF2\u5B58\u5728\u8D44\u4EA7\u7684\u66F4\u65B0\u3002" }), _jsxs("dl", { className: "tw-kv", children: [_jsx("dt", { children: "\u5B50\u57DF\u540D" }), _jsx("dd", { children: result.synced.subdomain }), _jsx("dt", { children: "\u5173\u8054 IP" }), _jsx("dd", { children: result.synced.ip }), _jsx("dt", { children: "\u670D\u52A1" }), _jsx("dd", { children: result.synced.service }), _jsx("dt", { children: "\u5E94\u7528" }), _jsx("dd", { children: result.synced.app })] }), result.companies.length > 0 && _jsxs("div", { className: "tw-gap", children: [_jsx("h3", { children: "\u516C\u53F8" }), _jsx("p", { className: "tw-description", children: result.companies.join('、') })] }), result.warnings.length > 0 && _jsxs("div", { className: "tw-gap", children: [_jsx("h3", { children: "\u63D0\u9192" }), _jsx("ul", { children: result.warnings.map((warning, index) => _jsx("li", { className: "tw-description", children: warning }, index)) })] }), result.errors.length > 0 && _jsxs("div", { className: "tw-gap", role: "alert", children: [_jsx("h3", { children: "\u9519\u8BEF" }), _jsx("ul", { children: result.errors.map((failure, index) => _jsx("li", { className: "tw-description", children: failure }, index)) })] })] })] });
}
