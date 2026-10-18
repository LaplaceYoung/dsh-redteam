import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import React from 'react';
import { Button, Checkbox, Input, SegmentedTabs, Tag } from '@deepseek-ai/dsh-client-ui-primitives';
import { errorMessage, JsonDetails, ManagementPage, requestJson } from '../management-ui/shared.js';
const root = '/api/redteam/observability';
export function ObservabilityTab({ visible }) {
    const [view, setView] = React.useState('records');
    const [enabled, setEnabled] = React.useState(false), [records, setRecords] = React.useState({ items: [], total: 0 });
    const [data, setData] = React.useState(), [error, setError] = React.useState(''), [notice, setNotice] = React.useState('');
    const [busy, setBusy] = React.useState(false), [taskId, setTaskId] = React.useState('');
    const refresh = React.useCallback(async () => {
        setBusy(true);
        setError('');
        try {
            const settings = await requestJson(`${root}/settings`);
            setEnabled(settings.enabled);
            if (view === 'records')
                setRecords(await requestJson(`${root}/records?limit=50&offset=0${taskId ? `&task_id=${encodeURIComponent(taskId)}` : ''}`));
            else if (view === 'commands')
                setData(await requestJson(`${root}/commands?limit=100&offset=0${taskId ? `&task_id=${encodeURIComponent(taskId)}` : ''}`));
            else if (view === 'usage')
                setData(await requestJson(`${root}/usage?group=model`));
            else
                setData(await requestJson(`${root}/tool-stats`));
        }
        catch (failure) {
            setError(errorMessage(failure));
        }
        finally {
            setBusy(false);
        }
    }, [taskId, view]);
    React.useEffect(() => { if (visible)
        void refresh(); }, [refresh, visible]);
    async function toggle(value) { setBusy(true); setError(''); try {
        await requestJson(`${root}/settings`, { method: 'PUT', body: JSON.stringify({ enabled: value }) });
        setEnabled(value);
        setNotice(value ? '已开启调用录制' : '已关闭调用录制');
    }
    catch (failure) {
        setError(errorMessage(failure));
    }
    finally {
        setBusy(false);
    } }
    async function deleteTaskRecords() { if (!taskId.trim() || !window.confirm('删除该任务的调用记录？'))
        return; setBusy(true); try {
        await requestJson(`${root}/records?task_id=${encodeURIComponent(taskId)}`, { method: 'DELETE' });
        setNotice('已删除该任务的调试记录');
        await refresh();
    }
    catch (failure) {
        setError(errorMessage(failure));
    }
    finally {
        setBusy(false);
    } }
    const tabs = [{ value: 'records', label: 'LLM 记录', id: 'obs-records', panelId: 'obs-records-panel' }, { value: 'commands', label: '命令', id: 'obs-commands', panelId: 'obs-commands-panel' }, { value: 'usage', label: '用量', id: 'obs-usage', panelId: 'obs-usage-panel' }, { value: 'tools', label: '工具统计', id: 'obs-tools', panelId: 'obs-tools-panel' }];
    return _jsx(ManagementPage, { title: "\u8C03\u7528\u8BB0\u5F55\u4E0E\u7528\u91CF", description: "\u67E5\u770B\u89C4\u8303\u5316\u6A21\u578B\u8C03\u7528\u3001\u547D\u4EE4\u7ED3\u679C\u548C token \u6C47\u603B\uFF1B\u539F\u59CB\u4F20\u8F93\u4EC5\u5728\u5BBF\u4E3B dispatcher \u53EF\u7528\u65F6\u63D0\u4F9B\u3002", loading: busy, error: error, notice: notice, actions: _jsx(Button, { size: "sm", disabled: busy, onClick: () => void refresh(), children: "\u5237\u65B0" }), toolbar: _jsxs(_Fragment, { children: [_jsx(SegmentedTabs, { label: "\u89C2\u6D4B\u89C6\u56FE", value: view, onChange: value => setView(value), items: tabs }), _jsx(Checkbox, { label: "\u5F00\u542F LLM \u5F55\u5236", checked: enabled, disabled: busy, onChange: value => void toggle(value) }), _jsxs("label", { className: "tw-inline", children: [_jsx("span", { className: "tw-muted", children: "\u4EFB\u52A1\u7B5B\u9009" }), _jsx(Input, { "aria-label": "\u4EFB\u52A1\u7B5B\u9009", value: taskId, onChange: event => setTaskId(event.target.value), placeholder: "task id", disabled: busy })] }), view === 'records' && _jsx(Button, { size: "sm", disabled: busy || !taskId.trim(), onClick: () => void deleteTaskRecords(), children: "\u5220\u9664\u4EFB\u52A1\u8BB0\u5F55" })] }), children: view === 'records' ? _jsx("div", { className: "mg-list", children: records.items.length ? records.items.map(row => _jsxs("article", { className: "tw-card tw-stack", children: [_jsxs("div", { className: "tw-card-head", children: [_jsx("strong", { children: row.model || '未知模型' }), _jsx(Tag, { tone: row.status === 'ok' ? 'success' : 'danger', children: row.status })] }), _jsxs("div", { className: "mg-meta", children: [_jsx("span", { children: row.taskId || '无任务' }), _jsx("span", { children: row.provider || '' }), _jsx("span", { children: new Date(row.startedAt).toLocaleString('zh-CN') }), _jsxs("span", { children: [row.durationMs ?? 0, " ms"] })] }), row.usage && _jsx(JsonDetails, { value: row.usage, summary: "Token \u7528\u91CF" })] }, row.id)) : _jsx("p", { className: "tw-muted", children: "\u6682\u65E0 LLM \u8BB0\u5F55\u3002" }) })
            : _jsx(JsonDetails, { value: data ?? [], open: true, summary: view === 'commands' ? '命令记录' : view === 'usage' ? '模型/Token 汇总' : '工具统计' }) });
}
