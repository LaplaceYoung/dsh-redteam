import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import React from 'react';
import { Button, Input, SegmentedTabs, Tag } from '@deepseek-ai/dsh-client-ui-primitives';
import { taskWorkspaceStyles } from '../task-workspace/styles.js';
import { JudgeSettings, RuleForm } from './forms.js';
import { request, listPath } from './api.js';
const labels = { pending: '待审批', allowed: '已允许', denied: '已拒绝', timeout: '已超时' };
const executionLabels = { pending: '等待工具结果', succeeded: '调用成功', failed: '调用失败', not_executed: '未执行', unknown: '结果未知' };
const sourceLabels = { rule: '规则', model: '模型判定', manual: '人工' };
const actionLabels = { allow: '允许', deny: '拒绝', ask: '人工审批' };
const styles = `${taskWorkspaceStyles}.ia-json{white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.6 var(--ds-font-family-code,monospace);background:var(--dsw-alias-interactive-bg-hover);padding:8px;border-radius:var(--dsw-radius-sm);margin:0;max-height:420px;overflow:auto}.ia-record-button{text-align:left;white-space:normal;justify-content:flex-start!important;width:100%}.ia-detail{border-top:1px solid var(--dsw-alias-border-l1);padding-top:12px}.ia-reason{white-space:pre-wrap;overflow-wrap:anywhere}.ia-pager{display:flex;align-items:center;justify-content:space-between;gap:8px}`;
const time = (value) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚未决定';
const errorText = (error) => error instanceof Error ? error.message : String(error);
function Json({ value }) { return _jsx("pre", { className: "ia-json", children: JSON.stringify(value, null, 2) }); }
/** Human decisions are sent only to the authenticated HTTP surface. */
export function InterceptionTab(props) {
    const id = React.useId();
    const [view, setView] = React.useState('pending'), [taskId, setTaskId] = React.useState(''), [page, setPage] = React.useState(0);
    const [records, setRecords] = React.useState({ total: 0, items: [] }), [rules, setRules] = React.useState([]), [settings, setSettings] = React.useState();
    const [selected, setSelected] = React.useState(''), [detail, setDetail] = React.useState(), [execution, setExecution] = React.useState();
    const [editing, setEditing] = React.useState(), [deleteId, setDeleteId] = React.useState('');
    const [loaded, setLoaded] = React.useState(false), [loadError, setLoadError] = React.useState(''), [error, setError] = React.useState(''), [notice, setNotice] = React.useState(''), [busy, setBusy] = React.useState(false);
    const sequence = React.useRef(0), busyRef = React.useRef(false), alive = React.useRef(true);
    const selectedRef = React.useRef(selected);
    selectedRef.current = selected;
    React.useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    const refresh = React.useCallback(async (signal) => {
        if (busyRef.current)
            return;
        const current = ++sequence.current;
        try {
            if (view === 'pending' || view === 'history') {
                const [rows, record] = await Promise.all([request(listPath(view, taskId, page), { signal }), selected ? request(`records/${encodeURIComponent(selected)}`, { signal }) : undefined]);
                if (signal?.aborted || !alive.current || current !== sequence.current)
                    return;
                setRecords(rows);
                setDetail(record);
                if (page > 0 && page * 30 >= rows.total)
                    setPage(Math.max(0, Math.ceil(rows.total / 30) - 1));
                if (record && execution)
                    setExecution(previous => previous ? { ...previous, execution: record.execution } : previous);
            }
            else if (view === 'rules') {
                const rows = await request('rules', { signal });
                if (signal?.aborted || !alive.current || current !== sequence.current)
                    return;
                setRules(rows);
            }
            else {
                const value = await request('settings', { signal });
                if (signal?.aborted || !alive.current || current !== sequence.current)
                    return;
                setSettings(value);
            }
            setLoaded(true);
            setLoadError('');
        }
        catch (failure) {
            if (!signal?.aborted && alive.current && current === sequence.current)
                setLoadError(errorText(failure));
        }
    }, [view, taskId, page, selected, Boolean(execution)]);
    const latestRefresh = React.useRef(refresh);
    latestRefresh.current = refresh;
    React.useEffect(() => {
        if (props.visible === false)
            return;
        const controller = new AbortController();
        let timer;
        const poll = async () => { await refresh(controller.signal); if (!controller.signal.aborted && (view === 'pending' || view === 'history'))
            timer = setTimeout(() => { void poll(); }, 2000); };
        void poll();
        return () => { controller.abort(); clearTimeout(timer); };
    }, [refresh, props.visible]);
    async function mutate(path, method, body, message) {
        if (busyRef.current)
            return false;
        busyRef.current = true;
        ++sequence.current;
        setBusy(true);
        setError('');
        setNotice('');
        let success = false;
        try {
            await request(path, { method, body });
            if (alive.current)
                setNotice(message);
            success = true;
        }
        catch (failure) {
            if (alive.current)
                setError(errorText(failure));
        }
        finally {
            busyRef.current = false;
            if (alive.current) {
                setBusy(false);
                await latestRefresh.current();
            }
        }
        return success;
    }
    function changeView(value) {
        if (busyRef.current || value === view)
            return;
        ++sequence.current;
        setView(value);
        setPage(0);
        setLoaded(false);
        setError('');
        setNotice('');
        setEditing(undefined);
        setDeleteId('');
        if (value === 'settings')
            setSettings(undefined);
    }
    async function openExecution(record) {
        setError('');
        try {
            const result = await request(`records/${encodeURIComponent(record.id)}/execution`);
            if (alive.current && selectedRef.current === record.id)
                setExecution(result);
        }
        catch (failure) {
            if (alive.current && selectedRef.current === record.id)
                setError(errorText(failure));
        }
    }
    return _jsxs("section", { className: "tw-root", "aria-label": "\u4EBA\u5DE5\u5BA1\u6279\u5DE5\u4F5C\u53F0", children: [_jsx("style", { children: styles }), _jsxs("header", { className: "tw-top", children: [_jsx("h2", { children: "\u5DE5\u5177\u5BA1\u6279" }), _jsx(Button, { size: "sm", disabled: busy, onClick: () => { void refresh(); }, children: "\u5237\u65B0" })] }), _jsx("div", { className: "tw-toolbar", children: _jsx(SegmentedTabs, { label: "\u5BA1\u6279\u89C6\u56FE", value: view, onChange: changeView, items: [
                        { value: 'pending', label: '待审批', id: `${id}-pending`, panelId: `${id}-pending-panel` },
                        { value: 'history', label: '历史', id: `${id}-history`, panelId: `${id}-history-panel` },
                        { value: 'rules', label: '规则', id: `${id}-rules`, panelId: `${id}-rules-panel` },
                        { value: 'settings', label: '设置', id: `${id}-settings`, panelId: `${id}-settings-panel` },
                    ] }) }), loadError && _jsxs("div", { className: "tw-notice", role: "alert", children: ["\u540C\u6B65\u5931\u8D25\uFF1A", loadError, "\u3002\u4FDD\u7559\u5DF2\u52A0\u8F7D\u6570\u636E\u3002"] }), error && _jsx("div", { className: "tw-notice", role: "alert", children: error }), notice && _jsx("div", { className: "tw-notice", role: "status", children: notice }), _jsxs("div", { className: "tw-scroll tw-stack", role: "tabpanel", id: `${id}-${view}-panel`, "aria-labelledby": `${id}-${view}`, children: [!loaded && !loadError && _jsx("div", { role: "status", children: "\u6B63\u5728\u52A0\u8F7D\u5BA1\u6279\u6570\u636E\u2026" }), (view === 'pending' || view === 'history') && _jsxs(_Fragment, { children: [_jsx(Input, { "aria-label": "\u6309\u4EFB\u52A1 ID \u7B5B\u9009\u5BA1\u6279", placeholder: "\u6309\u4EFB\u52A1 ID \u7B5B\u9009", value: taskId, onChange: event => { setTaskId(event.target.value); setPage(0); setSelected(''); setDetail(undefined); setExecution(undefined); } }), _jsxs("p", { className: "tw-muted", children: [view === 'pending' ? '待人工决定' : '全部审批记录', " \u00B7 ", records.total, " \u6761"] }), loaded && records.items.length === 0 && _jsx("p", { className: "tw-empty", children: view === 'pending' ? '当前没有待处理的审批。' : '没有匹配的审批记录。' }), records.items.map(record => _jsxs("div", { className: `tw-card ${selected === record.id ? 'tw-card-selected' : ''}`, children: [_jsxs(Button, { size: "sm", className: "ia-record-button", onClick: () => { setSelected(record.id); setDetail(undefined); setExecution(undefined); }, "aria-label": `查看审批 ${record.toolName} ${record.id}`, children: [record.toolName, " \u00B7 ", labels[record.status]] }), _jsxs("p", { className: "tw-small tw-muted", children: [record.taskId ?? '未关联任务', " \u00B7 ", time(record.createdAt)] }), _jsx("p", { className: "ia-reason", children: record.reason })] }, record.id)), records.total > 30 && _jsxs("nav", { className: "ia-pager", "aria-label": "\u5BA1\u6279\u5206\u9875", children: [_jsx(Button, { size: "sm", disabled: page === 0, onClick: () => setPage(value => value - 1), children: "\u4E0A\u4E00\u9875" }), _jsxs("span", { children: [page + 1, " / ", Math.ceil(records.total / 30), " \u9875"] }), _jsx(Button, { size: "sm", disabled: (page + 1) * 30 >= records.total, onClick: () => setPage(value => value + 1), children: "\u4E0B\u4E00\u9875" })] }), detail && detail.id === selected && _jsxs("section", { className: "ia-detail tw-stack", "aria-label": "\u5BA1\u6279\u8BE6\u60C5", children: [_jsxs("div", { className: "tw-card-head", children: [_jsx("h3", { children: detail.toolName }), _jsx(Tag, { tone: detail.status === 'pending' ? 'warning' : detail.effectiveAction === 'allow' ? 'success' : 'danger', children: labels[detail.status] })] }), _jsxs("dl", { className: "tw-kv", children: [_jsx("dt", { children: "\u5BA1\u6279 ID" }), _jsx("dd", { children: detail.id }), _jsx("dt", { children: "\u4EFB\u52A1" }), _jsx("dd", { children: detail.taskId ?? '未关联任务' }), _jsx("dt", { children: "\u5224\u5B9A\u6765\u6E90" }), _jsx("dd", { children: sourceLabels[detail.decisionSource] }), _jsx("dt", { children: "\u5339\u914D\u89C4\u5219" }), _jsx("dd", { children: detail.ruleName ?? detail.ruleId ?? '无' }), _jsx("dt", { children: "\u51B3\u5B9A\u65F6\u95F4" }), _jsx("dd", { children: time(detail.decidedAt) })] }), _jsxs("div", { children: [_jsx("h3", { children: "\u5224\u5B9A\u7406\u7531" }), _jsx("p", { className: "ia-reason", children: detail.reason }), detail.decisionReason && _jsx("p", { className: "ia-reason", children: detail.decisionReason })] }), _jsxs("div", { children: [_jsx("h3", { children: "\u5B8C\u6574\u5DE5\u5177\u53C2\u6570" }), _jsx(Json, { value: detail.toolInput })] }), detail.status === 'pending' && _jsxs("div", { className: "tw-actions", children: [_jsx(Button, { size: "sm", variant: "primary", disabled: busy, onClick: () => { void mutate(`records/${encodeURIComponent(detail.id)}/decide`, 'POST', { allowed: true, ...(detail.taskId ? { taskId: detail.taskId } : {}) }, '已允许这条工具调用'); }, children: "\u5141\u8BB8\u672C\u6B21\u8C03\u7528" }), _jsx(Button, { size: "sm", disabled: busy, onClick: () => { void mutate(`records/${encodeURIComponent(detail.id)}/decide`, 'POST', { allowed: false, ...(detail.taskId ? { taskId: detail.taskId } : {}) }, '已拒绝这条工具调用'); }, children: "\u62D2\u7EDD\u672C\u6B21\u8C03\u7528" })] }), _jsxs("div", { children: [_jsxs("h3", { children: ["\u8C03\u7528\u7ED3\u679C \u00B7 ", executionLabels[detail.execution.status]] }), detail.execution.output !== undefined && _jsx("pre", { className: "ia-json", children: detail.execution.output }), detail.execution.truncated && _jsx("p", { className: "tw-muted", children: "\u4FDD\u5B58\u7684\u7ED3\u679C\u5DF2\u622A\u65AD\uFF0C\u53EF\u524D\u5F80\u4F1A\u8BDD\u67E5\u770B\u539F\u59CB\u8C03\u7528\u3002" })] }), _jsxs("div", { className: "tw-actions", children: [_jsx(Button, { size: "sm", onClick: () => { void openExecution(detail); }, children: "\u67E5\u770B\u6267\u884C\u5173\u8054" }), execution && props.onSubagentJump && _jsx(Button, { size: "sm", onClick: () => props.onSubagentJump?.(execution.sessionId), children: "\u6253\u5F00\u8C03\u7528\u4F1A\u8BDD" })] }), execution && _jsx(Json, { value: execution }), _jsxs("details", { children: [_jsx("summary", { children: "\u5B8C\u6574\u5224\u5B9A\u8BB0\u5F55\u4E0E\u6A21\u578B\u8F93\u5165" }), _jsx(Json, { value: detail })] })] })] }), view === 'rules' && (editing ? _jsx(RuleForm, { value: editing === 'new' ? undefined : editing, onCancel: () => setEditing(undefined), onSaved: () => { setEditing(undefined); setNotice('规则已保存'); void refresh(); } }, editing === 'new' ? 'new' : editing.id) : _jsxs(_Fragment, { children: [_jsx(Button, { size: "sm", onClick: () => setEditing('new'), children: "\u65B0\u5EFA\u89C4\u5219" }), _jsx("p", { className: "tw-muted", children: "\u6309\u4F18\u5148\u7EA7\u964D\u5E8F\u6267\u884C\uFF1B\u540C\u4F18\u5148\u7EA7\u4FDD\u6301\u521B\u5EFA\u987A\u5E8F\u3002" }), loaded && rules.length === 0 && _jsx("p", { children: "\u5C1A\u65E0\u62E6\u622A\u89C4\u5219\u3002" }), rules.map(rule => _jsxs("article", { className: "tw-card tw-stack", "aria-label": `规则 ${rule.name}`, children: [_jsxs("div", { className: "tw-card-head", children: [_jsx("h3", { children: rule.name }), _jsx(Tag, { tone: rule.enabled ? 'info' : 'outline', children: rule.enabled ? '已启用' : '已停用' })] }), _jsxs("p", { children: [rule.taskId ?? '所有任务', " \u00B7 \u4F18\u5148\u7EA7 ", rule.priority, " \u00B7 ", rule.matchTarget === 'tool_name' ? '工具名称' : '工具参数', " / ", rule.matchType === 'regex' ? '正则表达式' : '包含字符串', " \u2192 ", actionLabels[rule.action]] }), _jsx("pre", { className: "ia-json", children: rule.pattern }), _jsx("p", { className: "ia-reason", children: rule.message }), _jsxs("div", { className: "tw-actions", children: [_jsx(Button, { size: "sm", disabled: busy, onClick: () => setEditing(rule), children: "\u7F16\u8F91\u89C4\u5219" }), _jsx(Button, { size: "sm", disabled: busy, onClick: () => { void mutate(`rules/${encodeURIComponent(rule.id)}/toggle`, 'POST', { enabled: !rule.enabled }, rule.enabled ? '规则已停用' : '规则已启用'); }, children: rule.enabled ? '停用规则' : '启用规则' }), _jsx(Button, { size: "sm", disabled: busy, onClick: () => setDeleteId(rule.id), children: "\u5220\u9664\u89C4\u5219" })] }), deleteId === rule.id && _jsxs("div", { className: "tw-actions", children: [_jsxs("span", { children: ["\u5220\u9664\u300C", rule.name, "\u300D\uFF1F"] }), _jsx(Button, { size: "sm", disabled: busy, onClick: () => { void mutate(`rules/${encodeURIComponent(rule.id)}`, 'DELETE', {}, '规则已删除').then(success => { if (success)
                                                    setDeleteId(''); }); }, children: "\u786E\u8BA4\u5220\u9664\u89C4\u5219" }), _jsx(Button, { size: "sm", onClick: () => setDeleteId(''), children: "\u53D6\u6D88\u5220\u9664" })] })] }, rule.id))] })), view === 'settings' && settings && _jsx(JudgeSettings, { initial: settings })] })] });
}
