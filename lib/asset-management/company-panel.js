import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import React from 'react';
import { Button, Checkbox, Input } from '@deepseek-ai/dsh-client-ui-primitives';
import { taskWorkspaceStyles } from '../task-workspace/styles.js';
import { request } from './client-api.js';
const errorText = (error) => error instanceof Error ? error.message : String(error);
const scopeLabels = { domain: '域名', ip: 'IP 地址', cidr: '网段', icp: '备案号', keyword: '关键词' };
function scopeValue(scope) { return scope.domain || scope.net || scope.value || scope.raw || ''; }
function scopeEditorText(scopes) {
    return scopes.map(scope => `${scope.kind}: ${scope.kind === 'ip' ? scopeValue(scope).split('/')[0] : scopeValue(scope)}`).join('\n');
}
function scopeInputs(value) {
    return value.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
        const typed = /^(domain|ip|cidr|icp|keyword)\s*:\s*(.*)$/i.exec(line);
        return typed ? { kind: typed[1].toLowerCase(), value: typed[2] } : line;
    });
}
function mutationMessage(label, result) {
    const parts = [label], added = result.scope_added ?? result.added, skipped = result.scope_skipped ?? result.skipped, invalid = result.scope_invalid ?? result.invalid;
    if (added !== undefined)
        parts.push(`范围规则：新增 ${added} 条，重复 ${skipped ?? 0} 条，无效 ${invalid ?? 0} 条。`);
    if (result.assets_deleted !== undefined)
        parts.push(`删除资产 ${result.assets_deleted} 条。`);
    if (result.updated !== undefined)
        parts.push(`更新了 ${result.updated} 条资产的公司归属。`);
    const errors = result.scope_errors ?? result.errors;
    if (errors?.length)
        parts.push(`以下范围未保存：\n${errors.join('\n')}`);
    if (result.warnings?.length)
        parts.push(result.warnings.join('\n'));
    return parts.join('\n');
}
/** Company mutations use the same authenticated native workspace API as the asset panel. */
export function CompanyPanel() {
    const [companies, setCompanies] = React.useState([]), [loaded, setLoaded] = React.useState(false);
    const [loading, setLoading] = React.useState(true), [busy, setBusy] = React.useState(false);
    const [loadError, setLoadError] = React.useState(''), [actionError, setActionError] = React.useState(''), [notice, setNotice] = React.useState('');
    const [selected, setSelected] = React.useState(''), [creating, setCreating] = React.useState(false), [query, setQuery] = React.useState('');
    const [revision, refresh] = React.useReducer((value) => value + 1, 0);
    const lifetime = React.useRef(null), mutationPending = React.useRef(false);
    React.useEffect(() => { const controller = new AbortController(); lifetime.current = controller; return () => controller.abort(); }, []);
    React.useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        setLoadError('');
        void request('companies', { signal: controller.signal }).then(rows => {
            if (!controller.signal.aborted) {
                setCompanies(rows);
                setLoaded(true);
            }
        }).catch(error => { if (!controller.signal.aborted)
            setLoadError(errorText(error)); }).finally(() => { if (!controller.signal.aborted)
            setLoading(false); });
        return () => controller.abort();
    }, [revision]);
    const mutate = async (path, body, label, method = 'POST') => {
        if (mutationPending.current)
            return;
        const signal = lifetime.current?.signal;
        if (!signal || signal.aborted)
            return;
        mutationPending.current = true;
        setBusy(true);
        setActionError('');
        setNotice('');
        try {
            const result = await request(path, { method, body, signal });
            if (signal.aborted)
                return;
            setNotice(mutationMessage(label, result));
            refresh();
            return result;
        }
        catch (error) {
            if (!signal.aborted)
                setActionError(errorText(error));
            return;
        }
        finally {
            mutationPending.current = false;
            if (!signal.aborted)
                setBusy(false);
        }
    };
    const filtered = companies.filter(company => company.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
    return _jsxs("section", { className: "tw-root", "aria-label": "\u516C\u53F8\u7BA1\u7406", children: [_jsx("style", { children: taskWorkspaceStyles }), _jsxs("header", { className: "tw-top", children: [_jsx("h2", { children: "\u516C\u53F8\u4E0E\u8303\u56F4" }), _jsxs("div", { className: "tw-actions", children: [_jsx(Button, { size: "sm", disabled: busy || loading, onClick: () => refresh(), children: loading ? '加载中…' : '刷新公司' }), _jsx(Button, { size: "sm", variant: "primary", disabled: busy, onClick: () => { setCreating(true); setSelected(''); setActionError(''); setNotice(''); }, children: "\u65B0\u5EFA\u516C\u53F8" })] })] }), loadError && _jsxs("div", { className: "tw-notice", role: "alert", children: ["\u516C\u53F8\u5217\u8868\u52A0\u8F7D\u5931\u8D25\uFF1A", loadError, " ", _jsx(Button, { size: "sm", disabled: busy || loading, onClick: () => refresh(), children: "\u91CD\u8BD5\u52A0\u8F7D\u516C\u53F8" })] }), actionError && _jsx("div", { className: "tw-notice", role: "alert", children: actionError }), notice && _jsx("div", { className: "tw-notice", role: "status", children: notice }), _jsxs("div", { className: "tw-toolbar", children: [_jsx(Input, { className: "tw-grow", "aria-label": "\u641C\u7D22\u516C\u53F8", placeholder: "\u641C\u7D22\u516C\u53F8\u540D\u79F0", value: query, disabled: busy, onChange: event => setQuery(event.target.value) }), _jsx(Button, { size: "sm", disabled: busy || loading, onClick: () => { void mutate('companies/reattribute', {}, '已重新计算公司归属。'); }, children: "\u91CD\u65B0\u8BA1\u7B97\u5F52\u5C5E" })] }), _jsxs("div", { className: "tw-scroll tw-stack", "aria-busy": busy || loading, children: [_jsx("p", { className: "tw-muted", children: "\u8303\u56F4\u7528\u4E8E\u81EA\u52A8\u5339\u914D\u8D44\u4EA7\u6240\u5C5E\u516C\u53F8\u3002\u57DF\u540D\u3001\u7F51\u6BB5\u548C\u5907\u6848\u53F7\u53C2\u4E0E\u5339\u914D\uFF1B\u5173\u952E\u8BCD\u7528\u4E8E\u63CF\u8FF0\u8303\u56F4\u3002" }), busy && _jsx("p", { role: "status", className: "tw-muted", children: "\u6B63\u5728\u4FDD\u5B58\uFF0C\u8BF7\u7A0D\u5019\u2026" }), creating && _jsx(NewCompany, { busy: busy, mutate: mutate, onCancel: () => setCreating(false), onCreated: id => { setCreating(false); setSelected(id); } }), selected && _jsx(CompanyDetail, { id: selected, assetCount: companies.find(company => company.id === selected)?.asset_count, revision: revision, busy: busy, mutate: mutate, onBack: () => setSelected(''), onDeleted: () => setSelected('') }, selected), !selected && !creating && _jsxs("div", { className: "tw-stack", children: [loading && !loaded ? _jsx("p", { role: "status", children: "\u6B63\u5728\u52A0\u8F7D\u516C\u53F8\u2026" }) : loaded && !filtered.length ? _jsxs("div", { className: "tw-empty", children: [_jsx("h3", { children: companies.length ? '没有匹配的公司' : '还没有公司' }), _jsx("p", { children: companies.length ? '调整搜索名称后重试。' : '创建公司并添加范围，已有资产会按范围重新匹配归属。' })] }) : null, filtered.map(company => _jsxs("article", { className: "tw-card tw-gap", children: [_jsxs("div", { className: "tw-card-head", children: [_jsx(Button, { size: "sm", className: "tw-task-button", disabled: busy, onClick: () => { setSelected(company.id); setActionError(''); setNotice(''); }, children: company.name }), _jsxs("span", { className: "tw-muted", children: [company.asset_count, " \u6761\u8D44\u4EA7"] })] }), _jsxs("p", { className: "tw-muted", children: [company.scope.length, " \u6761\u8303\u56F4\u89C4\u5219"] }), company.scope.length > 0 && _jsxs("p", { className: "tw-description tw-small", children: [company.scope.slice(0, 3).map(scopeValue).join(' · '), company.scope.length > 3 ? ' …' : ''] })] }, company.id))] })] })] });
}
function NewCompany({ busy, mutate, onCancel, onCreated }) {
    const [name, setName] = React.useState(''), [logo, setLogo] = React.useState(''), [scope, setScope] = React.useState('');
    async function submit(event) {
        event.preventDefault();
        const result = await mutate('companies', { name: name.trim(), ...(logo.trim() ? { logo: logo.trim() } : {}), scope: scopeInputs(scope) }, '公司已创建。');
        if (result?.id)
            onCreated(result.id);
    }
    return _jsxs("form", { className: "tw-card tw-stack", "aria-label": "\u65B0\u5EFA\u516C\u53F8", onSubmit: event => { void submit(event); }, children: [_jsx("h3", { children: "\u65B0\u5EFA\u516C\u53F8" }), _jsxs("fieldset", { disabled: busy, className: "tw-stack", children: [_jsxs("label", { className: "tw-field", children: [_jsx("span", { children: "\u516C\u53F8\u540D\u79F0" }), _jsx(Input, { "aria-label": "\u516C\u53F8\u540D\u79F0", required: true, value: name, onChange: event => setName(event.target.value), placeholder: "\u4F8B\u5982\uFF1A\u793A\u4F8B\u79D1\u6280" })] }), _jsxs("label", { className: "tw-field", children: [_jsx("span", { children: "Logo \u5730\u5740\uFF08\u53EF\u9009\uFF09" }), _jsx(Input, { "aria-label": "\u516C\u53F8 Logo \u5730\u5740", value: logo, onChange: event => setLogo(event.target.value), placeholder: "https://\u2026" })] }), _jsxs("label", { className: "tw-field", children: [_jsx("span", { children: "\u521D\u59CB\u8303\u56F4\uFF08\u6BCF\u884C\u4E00\u6761\uFF09" }), _jsx("textarea", { "aria-label": "\u521D\u59CB\u516C\u53F8\u8303\u56F4", rows: 6, value: scope, onChange: event => setScope(event.target.value), placeholder: 'example.com\n192.0.2.0/24\n京ICP备123号\nkeyword: 示例品牌' }), _jsx("small", { children: "\u652F\u6301\u57DF\u540D\u3001IP\u3001\u7F51\u6BB5\u3001\u5907\u6848\u53F7\u548C\u5173\u952E\u8BCD\u3002\u53EF\u7528 domain:\u3001ip:\u3001cidr:\u3001icp:\u3001keyword: \u660E\u786E\u7C7B\u578B\u3002" })] }), _jsxs("div", { className: "tw-actions", children: [_jsx(Button, { type: "submit", size: "sm", variant: "primary", disabled: !name.trim() || busy, children: busy ? '创建中…' : '创建公司' }), _jsx(Button, { type: "button", size: "sm", disabled: busy, onClick: onCancel, children: "\u53D6\u6D88\u521B\u5EFA" })] })] })] });
}
function CompanyDetail({ id, assetCount, revision, busy, mutate, onBack, onDeleted }) {
    const [detail, setDetail] = React.useState();
    const [loading, setLoading] = React.useState(true), [error, setError] = React.useState(''), [attempt, retry] = React.useReducer((value) => value + 1, 0);
    const [scope, setScope] = React.useState(''), [reset, setReset] = React.useState(false), [reason, setReason] = React.useState('');
    const [deleteAssets, setDeleteAssets] = React.useState(false), [confirming, setConfirming] = React.useState(false);
    const path = `companies/${encodeURIComponent(id)}`;
    React.useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        setError('');
        void request(path, { signal: controller.signal }).then(row => { if (!controller.signal.aborted)
            setDetail(row); })
            .catch(failure => { if (!controller.signal.aborted)
            setError(errorText(failure)); }).finally(() => { if (!controller.signal.aborted)
            setLoading(false); });
        return () => controller.abort();
    }, [path, revision, attempt]);
    async function save(event) {
        event.preventDefault();
        const result = await mutate(`${path}/scope`, { scope: scopeInputs(scope), reset, reason: reason.trim() }, reset ? '公司范围已替换。' : '已追加公司范围。');
        if (result) {
            setScope('');
            setReset(false);
            setReason('');
        }
    }
    const disabled = busy || loading || Boolean(error);
    return _jsxs("section", { className: "tw-card tw-stack", "aria-label": "\u516C\u53F8\u8BE6\u60C5", "aria-busy": loading || busy, children: [_jsxs("div", { className: "tw-inline", children: [_jsx("h3", { className: "tw-grow", children: detail?.company.name ?? '公司详情' }), _jsx(Button, { size: "sm", disabled: busy, onClick: onBack, children: "\u8FD4\u56DE\u516C\u53F8\u5217\u8868" })] }), loading && _jsx("p", { className: "tw-muted", role: "status", children: "\u6B63\u5728\u52A0\u8F7D\u516C\u53F8\u8BE6\u60C5\u2026" }), error && _jsxs("div", { className: "tw-notice", role: "alert", children: [error, " ", _jsx(Button, { size: "sm", disabled: busy || loading, onClick: () => retry(), children: "\u91CD\u8BD5\u516C\u53F8\u8BE6\u60C5" })] }), detail && _jsxs(_Fragment, { children: [_jsxs("p", { className: "tw-muted", children: [assetCount === undefined ? '' : `${assetCount} 条资产 · `, detail.scope.length, " \u6761\u8303\u56F4\u89C4\u5219"] }), detail.company.logo && _jsxs("p", { className: "tw-description tw-small tw-muted", children: ["Logo \u5730\u5740\uFF1A", detail.company.logo] }), _jsx("div", { className: "tw-gap", "aria-label": "\u5DF2\u4FDD\u5B58\u7684\u516C\u53F8\u8303\u56F4", children: !detail.scope.length ? _jsx("p", { className: "tw-muted", children: "\u5C1A\u672A\u8BBE\u7F6E\u8303\u56F4\u3002" }) : detail.scope.map(item => _jsxs("div", { className: "tw-record tw-gap", children: [_jsxs("div", { className: "tw-inline", children: [_jsx("span", { className: "tw-muted", children: scopeLabels[item.kind] ?? item.kind }), _jsx("span", { className: "tw-row-content", children: scopeValue(item) })] }), item.reason && _jsxs("p", { className: "tw-small tw-muted tw-description", children: ["\u5907\u6CE8\uFF1A", item.reason] })] }, item.id)) }), _jsxs("form", { className: "tw-section tw-stack", "aria-label": "\u7F16\u8F91\u516C\u53F8\u8303\u56F4", onSubmit: event => { void save(event); }, children: [_jsx("h3", { children: "\u7F16\u8F91\u8303\u56F4" }), _jsxs("fieldset", { disabled: disabled, className: "tw-stack", children: [_jsx(Checkbox, { label: "\u66FF\u6362\u5168\u90E8\u8303\u56F4", checked: reset, disabled: disabled, onChange: checked => { setReset(checked); setScope(checked ? scopeEditorText(detail.scope) : ''); } }), _jsxs("label", { className: "tw-field", children: [_jsxs("span", { children: [reset ? '替换后的范围' : '追加范围', "\uFF08\u6BCF\u884C\u4E00\u6761\uFF09"] }), _jsx("textarea", { "aria-label": "\u7F16\u8F91\u516C\u53F8\u8303\u56F4\u5185\u5BB9", rows: 6, value: scope, onChange: event => setScope(event.target.value), placeholder: 'example.com\n192.0.2.0/24\nkeyword: 示例品牌' }), _jsx("small", { children: reset ? '保存时覆盖全部现有规则；留空会清空范围，并重新计算自动归属。无效规则会阻止整次替换。' : '现有规则保持不变；重复规则会跳过，无效规则会在结果中列出。' })] }), _jsxs("label", { className: "tw-field", children: [_jsx("span", { children: "\u8303\u56F4\u53D8\u66F4\u5907\u6CE8\uFF08\u53EF\u9009\uFF09" }), _jsx(Input, { "aria-label": "\u8303\u56F4\u53D8\u66F4\u5907\u6CE8", value: reason, onChange: event => setReason(event.target.value) })] }), _jsx(Button, { type: "submit", size: "sm", variant: "primary", disabled: disabled || !reset && !scope.trim(), children: reset ? '保存替换范围' : '追加范围' })] })] }), _jsxs("section", { className: "tw-section tw-stack", "aria-label": "\u5220\u9664\u516C\u53F8", children: [_jsx("h3", { children: "\u5220\u9664\u516C\u53F8" }), _jsx("fieldset", { disabled: disabled || confirming, children: _jsx(Checkbox, { label: "\u540C\u65F6\u5220\u9664\u8BE5\u516C\u53F8\u5F53\u524D\u5F52\u5C5E\u7684\u5168\u90E8\u8D44\u4EA7", checked: deleteAssets, disabled: disabled || confirming, onChange: setDeleteAssets }) }), _jsx("p", { className: "tw-muted", children: deleteAssets ? '这些资产也会从当前任务引用中移除；漏洞的历史证据记录保留。' : '保留已有资产，删除公司范围，并按其他公司范围重新匹配资产归属。' }), confirming ? _jsxs("div", { className: "tw-gap", role: "group", "aria-label": "\u786E\u8BA4\u5220\u9664\u516C\u53F8", children: [_jsxs("p", { className: "tw-description", children: ["\u786E\u8BA4\u5220\u9664\u300C", detail.company.name, "\u300D", deleteAssets ? '及当前归属的全部资产' : '并保留资产', "\uFF1F"] }), _jsxs("div", { className: "tw-actions", children: [_jsxs(Button, { size: "sm", disabled: disabled, onClick: () => { void mutate(path, { delete_assets: deleteAssets }, '公司已删除。', 'DELETE').then(result => { if (result)
                                                    onDeleted(); }); }, children: ["\u786E\u8BA4\u5220\u9664\u516C\u53F8", deleteAssets ? '及资产' : ''] }), _jsx(Button, { size: "sm", disabled: busy, onClick: () => setConfirming(false), children: "\u53D6\u6D88\u5220\u9664" })] })] }) : _jsx(Button, { size: "sm", disabled: disabled, onClick: () => setConfirming(true), children: "\u5220\u9664\u516C\u53F8\u2026" })] })] })] });
}
