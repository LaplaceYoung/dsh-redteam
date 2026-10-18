import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from 'react';
import { Button, Checkbox, Input } from '@deepseek-ai/dsh-client-ui-primitives';
import { Field } from '../task-workspace/forms.js';
import { request } from './api.js';
const freshRule = () => ({ name: '', enabled: true, priority: 0, matchTarget: 'tool_name', matchType: 'string', pattern: '', action: 'ask', message: '', timeoutEnabled: true, timeoutSeconds: 300, timeoutAction: 'deny' });
function ActionSelect({ label, value, change, ask = true }) {
    return _jsxs("select", { "aria-label": label, value: value, onChange: event => change(event.target.value), children: [_jsx("option", { value: "allow", children: "\u5141\u8BB8" }), _jsx("option", { value: "deny", children: "\u62D2\u7EDD" }), ask && _jsx("option", { value: "ask", children: "\u4EBA\u5DE5\u5BA1\u6279" })] });
}
export function RuleForm({ value, onSaved, onCancel }) {
    const [form, setForm] = React.useState(() => value ? { name: value.name, enabled: value.enabled, priority: value.priority, matchTarget: value.matchTarget, matchType: value.matchType, pattern: value.pattern, action: value.action, message: value.message, timeoutEnabled: value.timeoutEnabled, timeoutSeconds: value.timeoutSeconds, timeoutAction: value.timeoutAction, ...(value.taskId ? { taskId: value.taskId } : {}) } : freshRule());
    const [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
    const patch = (update) => setForm(current => ({ ...current, ...update }));
    async function save(event) {
        event.preventDefault();
        if (busy)
            return;
        setBusy(true);
        setError('');
        try {
            await request(`rules${value ? '/' + encodeURIComponent(value.id) : ''}`, { method: value ? 'PUT' : 'POST', body: form });
            onSaved();
        }
        catch (failure) {
            setError(failure instanceof Error ? failure.message : String(failure));
        }
        finally {
            setBusy(false);
        }
    }
    return _jsxs("form", { className: "tw-stack", "aria-label": value ? '编辑拦截规则' : '新建拦截规则', onSubmit: event => { void save(event); }, children: [error && _jsx("div", { role: "alert", children: error }), _jsxs("fieldset", { disabled: busy, className: "tw-stack", children: [_jsx(Field, { label: "\u89C4\u5219\u540D\u79F0", children: _jsx(Input, { "aria-label": "\u89C4\u5219\u540D\u79F0", required: true, value: form.name, onChange: event => patch({ name: event.target.value }) }) }), _jsx(Field, { label: "\u4EFB\u52A1 ID", hint: "\u7559\u7A7A\u5E94\u7528\u4E8E\u6240\u6709\u4EFB\u52A1\u3002", children: _jsx(Input, { "aria-label": "\u89C4\u5219\u4EFB\u52A1 ID", value: form.taskId ?? '', onChange: event => { const taskId = event.target.value; setForm(current => { const next = { ...current }; if (taskId)
                                next.taskId = taskId;
                            else
                                delete next.taskId; return next; }); } }) }), _jsx(Checkbox, { label: "\u542F\u7528\u89C4\u5219", checked: form.enabled, onChange: enabled => patch({ enabled }) }), _jsxs("div", { className: "tw-grid", children: [_jsx(Field, { label: "\u4F18\u5148\u7EA7", hint: "\u6570\u503C\u8D8A\u5927\u8D8A\u5148\u5339\u914D\u3002", children: _jsx(Input, { "aria-label": "\u4F18\u5148\u7EA7", type: "number", step: 1, required: true, value: form.priority, onChange: event => patch({ priority: Number(event.target.value) }) }) }), _jsx(Field, { label: "\u5339\u914D\u5BF9\u8C61", children: _jsxs("select", { "aria-label": "\u5339\u914D\u5BF9\u8C61", value: form.matchTarget, onChange: event => patch({ matchTarget: event.target.value }), children: [_jsx("option", { value: "tool_name", children: "\u5DE5\u5177\u540D\u79F0" }), _jsx("option", { value: "tool_input", children: "\u5DE5\u5177\u53C2\u6570" })] }) }), _jsx(Field, { label: "\u5339\u914D\u65B9\u5F0F", children: _jsxs("select", { "aria-label": "\u5339\u914D\u65B9\u5F0F", value: form.matchType, onChange: event => patch({ matchType: event.target.value }), children: [_jsx("option", { value: "string", children: "\u5305\u542B\u5B57\u7B26\u4E32" }), _jsx("option", { value: "regex", children: "\u6B63\u5219\u8868\u8FBE\u5F0F\uFF08RE2\uFF09" })] }) }), _jsx(Field, { label: "\u547D\u4E2D\u540E\u64CD\u4F5C", children: _jsx(ActionSelect, { label: "\u547D\u4E2D\u540E\u64CD\u4F5C", value: form.action, change: action => patch({ action: action }) }) })] }), _jsx(Field, { label: "\u5339\u914D\u8868\u8FBE\u5F0F", children: _jsx("textarea", { "aria-label": "\u5339\u914D\u8868\u8FBE\u5F0F", rows: 3, required: true, value: form.pattern, onChange: event => patch({ pattern: event.target.value }) }) }), _jsx(Field, { label: "\u5224\u5B9A\u8BF4\u660E", children: _jsx("textarea", { "aria-label": "\u5224\u5B9A\u8BF4\u660E", rows: 3, value: form.message, onChange: event => patch({ message: event.target.value }) }) }), _jsx(Checkbox, { label: "\u542F\u7528\u5BA1\u6279\u8D85\u65F6", checked: form.timeoutEnabled, onChange: timeoutEnabled => patch({ timeoutEnabled }) }), _jsxs("div", { className: "tw-grid", children: [_jsx(Field, { label: "\u5BA1\u6279\u8D85\u65F6\uFF08\u79D2\uFF09", children: _jsx(Input, { "aria-label": "\u5BA1\u6279\u8D85\u65F6\uFF08\u79D2\uFF09", type: "number", step: 1, required: true, value: form.timeoutSeconds, onChange: event => patch({ timeoutSeconds: Number(event.target.value) }) }) }), _jsx(Field, { label: "\u8D85\u65F6\u64CD\u4F5C", children: _jsx(ActionSelect, { label: "\u8D85\u65F6\u64CD\u4F5C", ask: false, value: form.timeoutAction, change: timeoutAction => patch({ timeoutAction: timeoutAction }) }) })] }), _jsxs("div", { className: "tw-actions", children: [_jsx(Button, { type: "submit", size: "sm", variant: "primary", children: busy ? '保存中…' : '保存规则' }), _jsx(Button, { type: "button", size: "sm", onClick: onCancel, children: "\u53D6\u6D88" })] })] })] });
}
export function JudgeSettings({ initial }) {
    const [judge, setJudge] = React.useState(initial.judge), [tools, setTools] = React.useState(initial.enabledTools.join('\n'));
    const [busy, setBusy] = React.useState(false), [error, setError] = React.useState(''), [notice, setNotice] = React.useState('');
    const patch = (value) => setJudge(current => ({ ...current, ...value }));
    async function save(event) {
        event.preventDefault();
        if (busy)
            return;
        setBusy(true);
        setError('');
        setNotice('');
        try {
            const saved = await request('settings', { method: 'PUT', body: { enabledTools: tools.split('\n').map(row => row.trim()).filter(Boolean), judge } });
            setTools(saved.enabledTools.join('\n'));
            setJudge(saved.judge);
            setNotice('审批设置已保存');
        }
        catch (failure) {
            setError(failure instanceof Error ? failure.message : String(failure));
        }
        finally {
            setBusy(false);
        }
    }
    return _jsxs("form", { "aria-label": "\u5BA1\u6279\u8BBE\u7F6E", className: "tw-stack", onSubmit: event => { void save(event); }, children: [error && _jsx("div", { role: "alert", children: error }), notice && _jsx("div", { role: "status", children: notice }), _jsxs("fieldset", { disabled: busy, className: "tw-stack", children: [_jsx(Field, { label: "\u7EB3\u5165\u62E6\u622A\u7684\u5DE5\u5177", hint: "\u6BCF\u884C\u4E00\u4E2A\u51C6\u786E\u5DE5\u5177\u540D\uFF1B\u7559\u7A7A\u8868\u793A\u6CA1\u6709\u5DE5\u5177\u8FDB\u5165\u62E6\u622A\u3002", children: _jsx("textarea", { "aria-label": "\u7EB3\u5165\u62E6\u622A\u7684\u5DE5\u5177", rows: 5, value: tools, onChange: event => setTools(event.target.value) }) }), _jsx(Checkbox, { label: "\u542F\u7528\u6A21\u578B\u5224\u5B9A", checked: judge.enabled, onChange: enabled => patch({ enabled }) }), _jsx(Field, { label: "\u5224\u5B9A\u6A21\u578B\u914D\u7F6E ID", hint: "\u586B\u5199\u4EFB\u52A1\u5DE5\u4F5C\u53F0\u4E2D\u5DF2\u6CE8\u518C\u7684\u6A21\u578B\u914D\u7F6E ID\uFF1B\u7559\u7A7A\u6309\u8FD0\u884C\u65F6\u9ED8\u8BA4\u6A21\u578B\u8DEF\u7531\u3002", children: _jsx(Input, { "aria-label": "\u5224\u5B9A\u6A21\u578B\u914D\u7F6E ID", value: judge.profileId ?? '', onChange: event => patch({ profileId: event.target.value || null }) }) }), _jsx(Field, { label: "\u5224\u5B9A\u63D0\u793A\u8BCD", hint: "\u7559\u7A7A\u6062\u590D\u539F\u7248\u9ED8\u8BA4\u63D0\u793A\u8BCD\uFF1B\u670D\u52A1\u4F1A\u4FDD\u7559\u8F93\u5165\u8FB9\u754C\u548C\u8F93\u51FA\u5951\u7EA6\u3002", children: _jsx("textarea", { "aria-label": "\u5224\u5B9A\u63D0\u793A\u8BCD", rows: 12, value: judge.prompt, onChange: event => patch({ prompt: event.target.value }) }) }), _jsxs("div", { className: "tw-grid", children: [_jsx(Field, { label: "\u6A21\u578B\u5224\u5B9A\u8D85\u65F6\uFF08\u79D2\uFF09", children: _jsx(Input, { "aria-label": "\u6A21\u578B\u5224\u5B9A\u8D85\u65F6\uFF08\u79D2\uFF09", required: true, type: "number", min: 1, step: 1, value: judge.timeoutSeconds, onChange: event => patch({ timeoutSeconds: Number(event.target.value) }) }) }), _jsx(Field, { label: "\u6A21\u578B\u5224\u5B9A\u5931\u8D25\u65F6", children: _jsx(ActionSelect, { label: "\u6A21\u578B\u5224\u5B9A\u5931\u8D25\u65F6", value: judge.failAction, change: failAction => patch({ failAction: failAction }) }) }), _jsx(Field, { label: "\u6A21\u578B\u8F6C\u4EBA\u5DE5\u8D85\u65F6\uFF08\u79D2\uFF09", children: _jsx(Input, { "aria-label": "\u6A21\u578B\u8F6C\u4EBA\u5DE5\u8D85\u65F6\uFF08\u79D2\uFF09", required: true, type: "number", min: 1, step: 1, value: judge.askTimeoutSeconds, onChange: event => patch({ askTimeoutSeconds: Number(event.target.value) }) }) }), _jsx(Field, { label: "\u6A21\u578B\u8F6C\u4EBA\u5DE5\u8D85\u65F6\u64CD\u4F5C", children: _jsx(ActionSelect, { label: "\u6A21\u578B\u8F6C\u4EBA\u5DE5\u8D85\u65F6\u64CD\u4F5C", ask: false, value: judge.askTimeoutAction, change: askTimeoutAction => patch({ askTimeoutAction: askTimeoutAction }) }) })] }), _jsx(Button, { type: "submit", size: "sm", variant: "primary", children: busy ? '保存中…' : '保存审批设置' })] })] });
}
