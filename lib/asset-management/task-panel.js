import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives';
import { taskWorkspaceStyles } from '../task-workspace/styles.js';
import { request } from './client-api.js';
const types = [['', '全部类型'], ['root_domain', '根域名'], ['subdomain', '子域名'], ['ip', 'IP'], ['app', '应用'], ['service', '服务'], ['endpoint', '接口']];
const errorText = (error) => error instanceof Error ? error.message : String(error);
const assetLabel = (asset) => asset.url || asset.domain || asset.ip || asset.app_name || asset.id;
export function TaskAssetPanel() {
    const [tasks, setTasks] = useState(), [taskId, setTaskId] = useState('');
    const [error, setError] = useState(''), [revision, setRevision] = useState(0);
    useEffect(() => {
        const controller = new AbortController();
        setError('');
        void request('tasks', { signal: controller.signal }).then(data => {
            if (controller.signal.aborted)
                return;
            setTasks(data.tasks);
            setTaskId(current => data.tasks.some(task => task.id === current) ? current : data.tasks[0]?.id ?? '');
        }).catch(error => { if (!controller.signal.aborted)
            setError(errorText(error)); });
        return () => controller.abort();
    }, [revision]);
    return _jsxs("section", { className: "tw-root", "aria-label": "\u4EFB\u52A1\u8D44\u4EA7", children: [_jsx("style", { children: taskWorkspaceStyles }), _jsxs("header", { className: "tw-top", children: [_jsx("h2", { children: "\u4EFB\u52A1\u8D44\u4EA7" }), _jsx(Button, { size: "sm", onClick: () => setRevision(value => value + 1), children: "\u5237\u65B0\u4EFB\u52A1" })] }), error && _jsxs("div", { className: "tw-notice", role: "alert", children: ["\u4EFB\u52A1\u52A0\u8F7D\u5931\u8D25\uFF1A", error] }), _jsx("div", { className: "tw-toolbar", children: _jsxs("label", { className: "tw-field tw-grow", children: [_jsx("span", { children: "\u9009\u62E9\u4EFB\u52A1" }), _jsxs("select", { "aria-label": "\u9009\u62E9\u4EFB\u52A1", value: taskId, onChange: event => setTaskId(event.target.value), disabled: !tasks?.length, children: [!tasks?.length && _jsx("option", { value: "", children: tasks ? '暂无任务' : '正在读取任务…' }), tasks?.map(task => _jsxs("option", { value: task.id, children: [task.title, " \u00B7 ", task.status] }, task.id))] })] }) }), taskId && tasks ? _jsx(TaskAssets, { taskId: taskId, tasks: tasks }, taskId) : tasks && _jsx("p", { className: "tw-empty", children: "\u8BF7\u5148\u5728\u4EFB\u52A1\u5DE5\u4F5C\u53F0\u521B\u5EFA\u4EFB\u52A1\u3002" })] });
}
function TaskAssets({ taskId, tasks }) {
    const [type, setType] = useState(''), [offset, setOffset] = useState(0), [revision, setRevision] = useState(0);
    const [page, setPage] = useState(), [targets, setTargets] = useState();
    const [loading, setLoading] = useState(true), [loadError, setLoadError] = useState('');
    const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
    const [ids, setIds] = useState(''), [summary, setSummary] = useState(''), [scope, setScope] = useState('');
    const [detaching, setDetaching] = useState(''), [selected, setSelected] = useState('');
    const [refs, setRefs] = useState(), [refsError, setRefsError] = useState('');
    const lifetime = useRef(null), pending = useRef(false);
    const base = `tasks/${encodeURIComponent(taskId)}`;
    const taskName = (id) => tasks.find(task => task.id === id)?.title ?? id;
    useEffect(() => {
        const controller = new AbortController();
        lifetime.current = controller;
        return () => controller.abort();
    }, []);
    useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        setLoadError('');
        setPage(undefined);
        setTargets(undefined);
        setSelected('');
        setDetaching('');
        const query = new URLSearchParams({ limit: '20', offset: String(offset), ...(type ? { type } : {}) });
        void Promise.all([
            request(`${base}/assets?${query}`, { signal: controller.signal }),
            request(`${base}/intent-assets`, { signal: controller.signal }),
        ]).then(([assets, intents]) => {
            if (controller.signal.aborted)
                return;
            if (offset && offset >= assets.total) {
                setOffset(Math.max(0, Math.floor((assets.total - 1) / 20) * 20));
                return;
            }
            setPage(assets);
            setTargets(intents.assets);
        }).catch(error => { if (!controller.signal.aborted)
            setLoadError(errorText(error)); })
            .finally(() => { if (!controller.signal.aborted)
            setLoading(false); });
        return () => controller.abort();
    }, [base, type, offset, revision]);
    useEffect(() => {
        setRefs(undefined);
        setRefsError('');
        if (!selected)
            return;
        const controller = new AbortController();
        void request(`${base}/assets/${encodeURIComponent(selected)}/refs`, { signal: controller.signal })
            .then(data => { if (!controller.signal.aborted)
            setRefs(data); })
            .catch(error => { if (!controller.signal.aborted)
            setRefsError(errorText(error)); });
        return () => controller.abort();
    }, [base, selected, revision]);
    async function mutate(path, method, body, describe, clear) {
        if (pending.current)
            return;
        pending.current = true;
        setBusy(true);
        setError('');
        setNotice('');
        const signal = lifetime.current?.signal;
        try {
            const result = await request(path, { method, ...(body === undefined ? {} : { body }), signal });
            if (signal?.aborted)
                return;
            setNotice(describe(result));
            clear();
            setRevision(value => value + 1);
        }
        catch (error) {
            if (!signal?.aborted)
                setError(errorText(error));
        }
        finally {
            pending.current = false;
            if (!signal?.aborted)
                setBusy(false);
        }
    }
    return _jsxs("div", { className: "tw-scroll tw-stack", children: [error && _jsx("div", { className: "tw-notice", role: "alert", children: error }), notice && _jsx("div", { className: "tw-notice", role: "status", children: notice }), busy && _jsx("p", { role: "status", children: "\u6B63\u5728\u4FDD\u5B58\u2026" }), _jsxs("details", { className: "tw-card", children: [_jsx("summary", { children: "\u5173\u8054\u5DF2\u6709\u5168\u5C40\u8D44\u4EA7" }), _jsx("form", { className: "tw-stack", onSubmit: event => {
                            event.preventDefault();
                            const assetIds = [...new Set(ids.split(/[\s,，]+/u).filter(Boolean))];
                            if (!assetIds.length || !summary.trim()) {
                                setError('请填写资产 ID 和关联来源说明。');
                                return;
                            }
                            void mutate(`${base}/assets`, 'POST', { asset_ids: assetIds, source_summary: summary.trim() }, result => `已关联 ${result.attached} 条资产，${result.existing} 条已关联资产的来源已更新。`, () => { setIds(''); setSummary(''); });
                        }, children: _jsxs("fieldset", { className: "tw-stack", disabled: busy, children: [_jsxs("label", { className: "tw-field", children: [_jsx("span", { children: "\u5168\u5C40\u8D44\u4EA7 ID" }), _jsx("textarea", { required: true, "aria-label": "\u5168\u5C40\u8D44\u4EA7 ID", value: ids, onChange: event => setIds(event.target.value), placeholder: "\u6BCF\u884C\u4E00\u4E2A ID\uFF0C\u4E5F\u53EF\u7528\u9017\u53F7\u5206\u9694\uFF1B\u6BCF\u6B21\u6700\u591A 100 \u6761" })] }), _jsxs("label", { className: "tw-field", children: [_jsx("span", { children: "\u6765\u6E90\u8BF4\u660E\uFF08\u5FC5\u586B\uFF09" }), _jsx(Input, { required: true, "aria-label": "\u5173\u8054\u6765\u6E90\u8BF4\u660E", value: summary, onChange: event => setSummary(event.target.value), placeholder: "\u4E3A\u4F55\u5C06\u8FD9\u4E9B\u8D44\u4EA7\u52A0\u5165\u5F53\u524D\u4EFB\u52A1" })] }), _jsx(Button, { type: "submit", size: "sm", variant: "primary", children: "\u5173\u8054\u8D44\u4EA7" })] }) })] }), _jsxs("details", { className: "tw-card", children: [_jsx("summary", { children: "\u6309\u8303\u56F4\u767B\u8BB0\u6D4B\u8BD5\u8D44\u4EA7" }), _jsx("form", { className: "tw-stack", onSubmit: event => {
                            event.preventDefault();
                            const lines = scope.split(/\r?\n/u).map(line => line.trim()).filter(Boolean);
                            if (!lines.length) {
                                setError('请填写至少一条范围。');
                                return;
                            }
                            void mutate(`${base}/assets`, 'POST', { scope: lines }, result => `新增 ${result.scopes_added} 条范围，${result.scopes_existing} 条已存在；关联 ${result.assets_linked} 条资产，${result.assets_existing} 条已关联。`, () => setScope(''));
                        }, children: _jsxs("fieldset", { disabled: busy, className: "tw-stack", children: [_jsxs("label", { className: "tw-field", children: [_jsx("span", { children: "\u8303\u56F4\uFF08\u6BCF\u884C\u4E00\u6761\uFF09" }), _jsx("textarea", { required: true, "aria-label": "\u4EFB\u52A1\u8D44\u4EA7\u8303\u56F4", value: scope, onChange: event => setScope(event.target.value), placeholder: 'example.com\n192.0.2.10\n192.0.2.0/24' }), _jsx("small", { children: "\u652F\u6301\u57DF\u540D\u3001IP\u3001CIDR\u3001ICP\u5907\u6848\u53CA\u5173\u952E\u8BCD\u3002\u57DF\u540D\u548C IP \u4F1A\u5173\u8054\u8D44\u4EA7\uFF1B\u5176\u4ED6\u89C4\u5219\u767B\u8BB0\u4E3A\u4EFB\u52A1\u8303\u56F4\u3002\u4EFB\u4E00\u6761\u65E0\u6548\u65F6\u6574\u6279\u4E0D\u4FDD\u5B58\u3002" })] }), _jsx(Button, { type: "submit", size: "sm", variant: "primary", children: "\u767B\u8BB0\u8303\u56F4" })] }) })] }), _jsxs("div", { className: "tw-actions", children: [_jsxs("label", { className: "tw-field tw-grow", children: [_jsx("span", { children: "\u8D44\u4EA7\u7C7B\u578B" }), _jsx("select", { value: type, disabled: busy, "aria-label": "\u4EFB\u52A1\u8D44\u4EA7\u7C7B\u578B", onChange: event => { setType(event.target.value); setOffset(0); }, children: types.map(([value, label]) => _jsx("option", { value: value, children: label }, value)) })] }), _jsx(Button, { size: "sm", disabled: busy || loading, onClick: () => setRevision(value => value + 1), children: "\u5237\u65B0\u8D44\u4EA7" })] }), loadError && _jsxs("div", { className: "tw-notice", role: "alert", children: ["\u52A0\u8F7D\u5931\u8D25\uFF1A", loadError] }), loading && _jsx("p", { role: "status", children: "\u6B63\u5728\u8BFB\u53D6\u4EFB\u52A1\u8D44\u4EA7\u4E0E\u610F\u56FE\u76EE\u6807\u2026" }), page && _jsxs(_Fragment, { children: [_jsxs("p", { className: "tw-muted", children: ["\u5171 ", page.total, " \u6761\u5173\u8054\u8D44\u4EA7"] }), !page.assets.length && _jsx("p", { className: "tw-empty", children: "\u5F53\u524D\u7B5B\u9009\u4E0B\u6CA1\u6709\u5173\u8054\u8D44\u4EA7\u3002" }), page.assets.map(asset => _jsxs("article", { className: "tw-card tw-gap", children: [_jsx("strong", { className: "tw-title", children: assetLabel(asset) }), _jsxs("p", { className: "tw-small tw-muted tw-description", children: [asset.type, " \u00B7 ", asset.id] }), _jsxs("p", { className: "tw-description", children: ["\u6765\u6E90\uFF1A", asset.task_source || '未记录', asset.task_source_summary ? ` · ${asset.task_source_summary}` : ''] }), _jsxs("div", { className: "tw-actions", children: [_jsx(Button, { size: "sm", disabled: busy, onClick: () => setSelected(value => value === asset.id ? '' : asset.id), children: selected === asset.id ? '收起引用' : '查看引用' }), _jsx(Button, { size: "sm", disabled: busy, onClick: () => setDetaching(asset.id), children: "\u89E3\u9664\u5173\u8054" })] }), detaching === asset.id && _jsxs("div", { className: "tw-gap", role: "group", "aria-label": "\u786E\u8BA4\u89E3\u9664\u5173\u8054", children: [_jsxs("p", { children: ["\u786E\u8BA4\u4ECE\u5F53\u524D\u4EFB\u52A1\u79FB\u9664 ", assetLabel(asset), "\uFF1F\u5168\u5C40\u8D44\u4EA7\u548C\u5386\u53F2\u5F15\u7528\u4F1A\u4FDD\u7559\u3002"] }), _jsxs("div", { className: "tw-actions", children: [_jsx(Button, { size: "sm", disabled: busy, onClick: () => { void mutate(`${base}/assets/${encodeURIComponent(asset.id)}`, 'DELETE', undefined, () => '已解除任务关联，保留全局资产和历史引用。', () => setDetaching('')); }, children: "\u786E\u8BA4\u89E3\u9664\u5173\u8054" }), _jsx(Button, { size: "sm", disabled: busy, onClick: () => setDetaching(''), children: "\u53D6\u6D88" })] })] }), selected === asset.id && _jsx("section", { className: "tw-section tw-gap", "aria-label": "\u8D44\u4EA7\u5F15\u7528", children: refsError ? _jsxs("div", { role: "alert", children: ["\u5F15\u7528\u52A0\u8F7D\u5931\u8D25\uFF1A", refsError, _jsx(Button, { size: "sm", onClick: () => setSelected(''), children: "\u5173\u95ED\u540E\u91CD\u8BD5" })] }) : !refs ? _jsx("p", { role: "status", children: "\u6B63\u5728\u8BFB\u53D6\u5F15\u7528\u2026" }) : ['intents', 'facts', 'findings'].map((kind, index) => _jsxs("div", { className: "tw-gap", children: [_jsxs("h3", { children: [['意图', '事实', '发现'][index], " \u00B7 ", refs[kind].length] }), refs[kind].map(ref => _jsxs("div", { className: "tw-record", children: [_jsx("p", { className: "tw-description", children: ref.summary || ref.id }), _jsxs("p", { className: "tw-small tw-muted tw-description", children: [ref.state, " \u00B7 ", ref.id, " \u00B7 ", ref.inherited && ref.source_task_id ? `继承自 ${taskName(ref.source_task_id)}（${ref.source_task_id}）` : '当前任务'] })] }, ref.id))] }, kind)) })] }, asset.id)), _jsxs("div", { className: "tw-actions", children: [_jsx(Button, { size: "sm", disabled: busy || loading || offset === 0, onClick: () => setOffset(value => Math.max(0, value - 20)), children: "\u4E0A\u4E00\u9875" }), _jsxs("span", { children: ["\u7B2C ", Math.floor(offset / 20) + 1, " \u9875"] }), _jsx(Button, { size: "sm", disabled: busy || loading || offset + 20 >= page.total, onClick: () => setOffset(value => value + 20), children: "\u4E0B\u4E00\u9875" })] })] }), targets && _jsxs("section", { className: "tw-section tw-stack", "aria-label": "\u610F\u56FE\u8D44\u4EA7", children: [_jsxs("h3", { children: ["\u610F\u56FE\u76EE\u6807\u4E0E\u6765\u6E90 \u00B7 ", targets.length] }), _jsx("p", { className: "tw-muted", children: "\u5305\u62EC\u5F53\u524D\u4EFB\u52A1\u7684\u610F\u56FE\u76EE\u6807\u53CA\u76F4\u63A5\u6765\u6E90\u4EFB\u52A1\u7684\u5DF2\u7EC8\u7ED3\u610F\u56FE\uFF1B\u5386\u53F2\u76EE\u6807\u53EF\u80FD\u5DF2\u89E3\u9664\u8D44\u4EA7\u5173\u8054\u3002" }), !targets.length && _jsx("p", { className: "tw-muted", children: "\u5C1A\u65E0\u610F\u56FE\u8D44\u4EA7\u3002" }), targets.map(target => _jsxs("article", { className: "tw-card tw-gap", children: [_jsx("strong", { className: "tw-title", children: target.label }), _jsxs("p", { className: "tw-small tw-description", children: [target.type, " \u00B7 \u8D44\u4EA7 ", target.asset_id, " \u00B7 \u610F\u56FE ", target.intent_id] }), _jsxs("p", { className: "tw-description", children: [target.inherited ? '继承来源任务' : '当前任务', "\uFF1A", taskName(target.source_task_id), "\uFF08", target.source_task_id, "\uFF09"] }), _jsxs("p", { className: "tw-description", children: ["\u6765\u6E90\uFF1A", target.source, " \u00B7 ", target.source_summary] }), target.source_node_id && _jsxs("p", { className: "tw-small tw-description", children: ["\u6765\u6E90\u8282\u70B9\uFF1A", target.source_node_id] })] }, `${target.source_task_id}:${target.intent_id}:${target.asset_id}`))] })] });
}
