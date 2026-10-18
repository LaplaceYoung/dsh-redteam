import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from 'react';
import { Button, Checkbox, Input } from '@deepseek-ai/dsh-client-ui-primitives';
export function Field({ label, hint, children }) {
    return _jsxs("label", { className: "tw-field", children: [_jsx("span", { children: label }), children, hint && _jsx("small", { children: hint })] });
}
export function CategorySelect({ categories, value, onChange, label = '任务分类' }) {
    return _jsxs("select", { "aria-label": label, value: value, onChange: event => onChange(event.target.value), children: [_jsx("option", { value: "", children: "\u672A\u5206\u7C7B" }), categories.map(row => _jsx("option", { value: row.id, children: row.name }, row.id))] });
}
export function NewTaskForm({ categories, templates, tasks, busy, onCreate, onCancel }) {
    const [templateId, setTemplateId] = React.useState('');
    const [title, setTitle] = React.useState('');
    const [description, setDescription] = React.useState('');
    const [goal, setGoal] = React.useState('');
    const [categoryId, setCategoryId] = React.useState('');
    const [timeout, setTimeout] = React.useState('0');
    const [heartbeat, setHeartbeat] = React.useState('600');
    const [coverage, setCoverage] = React.useState(true);
    const [seed, setSeed] = React.useState(false);
    const [sources, setSources] = React.useState([]);
    const template = templates.find(row => row.id === templateId);
    function useTemplate(id) {
        setTemplateId(id);
        const selected = templates.find(row => row.id === id);
        if (selected) {
            setDescription(selected.description);
            setGoal(selected.goal);
            setCategoryId(selected.categoryId ?? '');
        }
    }
    return _jsx("form", { className: "tw-stack", "aria-label": "\u65B0\u5EFA\u4EFB\u52A1\u8868\u5355", onSubmit: event => {
            event.preventDefault();
            void onCreate({ ...(title.trim() ? { title: title.trim() } : {}), description, goal, categoryId: categoryId || null,
                ...(templateId ? { templateId } : {}), timeoutSeconds: Number(timeout), planHeartbeatSeconds: Number(heartbeat),
                coverageEnabled: coverage, seedFirstIntent: seed, sourceTaskIds: sources });
        }, children: _jsxs("fieldset", { disabled: busy, className: "tw-stack", children: [_jsxs("div", { className: "tw-grid", children: [_jsx(Field, { label: "\u4F7F\u7528\u6A21\u677F", children: _jsxs("select", { "aria-label": "\u4F7F\u7528\u6A21\u677F", value: templateId, onChange: event => useTemplate(event.target.value), children: [_jsx("option", { value: "", children: "\u7A7A\u767D\u4EFB\u52A1" }), templates.map(row => _jsx("option", { value: row.id, children: row.name }, row.id))] }) }), _jsx(Field, { label: "\u4EFB\u52A1\u5206\u7C7B", children: _jsx(CategorySelect, { categories: categories, value: categoryId, onChange: setCategoryId }) })] }), template && _jsxs("p", { className: "tw-muted tw-small", children: ["\u6A21\u677F\u5305\u542B ", template.interceptRules.length, " \u6761\u8D44\u4EA7\u89C4\u5219\uFF0C\u521B\u5EFA\u65F6\u4E00\u5E76\u5E94\u7528\u3002"] }), _jsx(Field, { label: "\u4EFB\u52A1\u540D\u79F0", hint: "\u7559\u7A7A\u65F6\u4ECE\u4EFB\u52A1\u63CF\u8FF0\u751F\u6210\u540D\u79F0\u3002", children: _jsx(Input, { "aria-label": "\u4EFB\u52A1\u540D\u79F0", maxLength: 200, value: title, onChange: event => setTitle(event.target.value), placeholder: "\u4F8B\u5982\uFF1A\u6838\u9A8C\u6D4B\u8BD5\u73AF\u5883\u7684\u767B\u5F55\u6D41\u7A0B" }) }), _jsx(Field, { label: "\u4EFB\u52A1\u63CF\u8FF0", children: _jsx("textarea", { "aria-label": "\u4EFB\u52A1\u63CF\u8FF0", required: true, maxLength: 16000, rows: 4, value: description, onChange: event => setDescription(event.target.value), placeholder: "\u8BF4\u660E\u6388\u6743\u76EE\u6807\u3001\u80CC\u666F\u548C\u9700\u8981\u6267\u884C\u7684\u5DE5\u4F5C\u3002" }) }), _jsx(Field, { label: "\u4EFB\u52A1\u76EE\u6807", hint: "Planner \u4F1A\u5206\u89E3\u4E3A\u53EF\u9A8C\u8BC1\u76EE\u6807\uFF1B\u65E0\u76EE\u6807\u7684\u76F4\u6295\u4EFB\u52A1\u53EF\u7559\u7A7A\u3002", children: _jsx("textarea", { "aria-label": "\u4EFB\u52A1\u76EE\u6807", maxLength: 16000, rows: 3, value: goal, onChange: event => setGoal(event.target.value), placeholder: "\u5199\u660E\u9884\u671F\u7ED3\u679C\u548C\u9A8C\u6536\u6761\u4EF6\u3002" }) }), _jsxs("details", { children: [_jsx("summary", { children: "\u6267\u884C\u8BBE\u7F6E\u4E0E\u6765\u6E90\u4EFB\u52A1" }), _jsxs("div", { className: "tw-stack", children: [_jsxs("div", { className: "tw-grid", children: [_jsx(Field, { label: "\u4EFB\u52A1\u65F6\u9650\uFF08\u79D2\uFF09", hint: "0 \u8868\u793A\u4E0D\u9650\u65F6\uFF1B\u4ECE\u5B9E\u9645\u6A21\u578B\u8FD0\u884C\u5F00\u59CB\u8BA1\u65F6\u3002", children: _jsx(Input, { "aria-label": "\u4EFB\u52A1\u65F6\u9650\uFF08\u79D2\uFF09", type: "number", min: 0, step: 1, required: true, value: timeout, onChange: event => setTimeout(event.target.value) }) }), _jsx(Field, { label: "Planner \u5FC3\u8DF3\uFF08\u79D2\uFF09", hint: "\u81F3\u5C11 600 \u79D2\u3002", children: _jsx(Input, { "aria-label": "Planner \u5FC3\u8DF3\uFF08\u79D2\uFF09", type: "number", min: 600, step: 1, required: true, value: heartbeat, onChange: event => setHeartbeat(event.target.value) }) })] }), _jsx(Checkbox, { checked: coverage, onChange: setCoverage, label: "\u542F\u7528\u8986\u76D6\u5206\u6790" }), _jsx(Checkbox, { checked: seed, onChange: setSeed, label: "\u5C06\u63CF\u8FF0\u4F5C\u4E3A\u9996\u4E2A\u610F\u56FE\u76F4\u63A5\u6267\u884C" }), tasks.length > 0 && _jsxs("div", { className: "tw-gap", children: [_jsx("span", { children: "\u53EA\u8BFB\u5F15\u7528\u6765\u6E90\u4EFB\u52A1\u7684\u4E8B\u5B9E\u548C\u53D1\u73B0" }), tasks.map(row => _jsx(Checkbox, { checked: sources.includes(row.id), label: row.title, onChange: checked => setSources(values => checked ? [...values, row.id] : values.filter(id => id !== row.id)) }, row.id))] })] })] }), _jsxs("div", { className: "tw-actions", children: [_jsx(Button, { type: "submit", size: "sm", variant: "primary", children: busy ? '正在创建…' : '创建任务' }), _jsx(Button, { type: "button", size: "sm", onClick: onCancel, children: "\u53D6\u6D88" })] }), _jsx("p", { className: "tw-muted tw-small", children: "\u521B\u5EFA\u540E\u53EF\u68C0\u67E5\u76EE\u6807\u4E0E\u6A21\u578B\u914D\u7F6E\uFF0C\u518D\u4ECE\u5F53\u524D\u4F1A\u8BDD\u542F\u52A8\u3002" })] }) });
}
export function TemplateForm({ value, categories, busy, onSave, onCancel }) {
    const [name, setName] = React.useState(value?.name ?? '');
    const [description, setDescription] = React.useState(value?.description ?? '');
    const [goal, setGoal] = React.useState(value?.goal ?? '');
    const [categoryId, setCategoryId] = React.useState(value?.categoryId ?? '');
    return _jsx("form", { className: "tw-stack", "aria-label": "\u4EFB\u52A1\u6A21\u677F\u8868\u5355", onSubmit: event => { event.preventDefault(); void onSave({ name, description, goal, categoryId: categoryId || null, interceptRules: value?.interceptRules ?? [] }); }, children: _jsxs("fieldset", { disabled: busy, className: "tw-stack", children: [_jsx(Field, { label: "\u6A21\u677F\u540D\u79F0", children: _jsx(Input, { "aria-label": "\u6A21\u677F\u540D\u79F0", required: true, maxLength: 120, value: name, onChange: event => setName(event.target.value) }) }), _jsx(Field, { label: "\u6A21\u677F\u5206\u7C7B", children: _jsx(CategorySelect, { label: "\u6A21\u677F\u5206\u7C7B", categories: categories, value: categoryId, onChange: setCategoryId }) }), _jsx(Field, { label: "\u6A21\u677F\u63CF\u8FF0", children: _jsx("textarea", { "aria-label": "\u6A21\u677F\u63CF\u8FF0", required: true, maxLength: 16000, value: description, onChange: event => setDescription(event.target.value), rows: 3 }) }), _jsx(Field, { label: "\u6A21\u677F\u76EE\u6807", children: _jsx("textarea", { "aria-label": "\u6A21\u677F\u76EE\u6807", required: true, maxLength: 16000, value: goal, onChange: event => setGoal(event.target.value), rows: 3 }) }), value && value.interceptRules.length > 0 && _jsxs("p", { className: "tw-muted", children: ["\u4FDD\u7559\u6A21\u677F\u73B0\u6709\u7684 ", value.interceptRules.length, " \u6761\u8D44\u4EA7\u89C4\u5219\u3002"] }), _jsxs("div", { className: "tw-actions", children: [_jsx(Button, { type: "submit", variant: "primary", size: "sm", children: "\u4FDD\u5B58\u6A21\u677F" }), _jsx(Button, { type: "button", size: "sm", onClick: onCancel, children: "\u53D6\u6D88\u7F16\u8F91" })] })] }) });
}
