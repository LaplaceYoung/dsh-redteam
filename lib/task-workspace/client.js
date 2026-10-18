import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import React from 'react';
import { Button, Checkbox, Input, SegmentedTabs, Tag } from '@deepseek-ai/dsh-client-ui-primitives';
import { TASK_WORKSPACE_PATH } from './contracts.js';
import { CategorySelect, Field, NewTaskForm, TemplateForm } from './forms.js';
import { ConstraintsEditor, DeleteAction, GoalsEditor } from './records.js';
import { ModelsEditor } from './models.js';
import { taskWorkspaceStyles } from './styles.js';
const statuses = { draft: '草稿', running: '运行中', paused: '已暂停', done: '已完成', failed: '失败', timeout: '已超时' };
const time = (value) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚未开始';
// Match BetterSidebar's HTTP base handling, including desktop dsh-app and reverse-proxy prefixes.
function endpoint() {
    const base = new URL(document.baseURI);
    base.search = '';
    base.hash = '';
    if (!base.pathname.endsWith('/'))
        base.pathname += '/';
    return new URL(TASK_WORKSPACE_PATH.replace(/^\/+/, ''), base);
}
function TaskStatus({ task }) {
    return _jsx(Tag, { tone: task.queued ? 'warning' : task.status === 'done' ? 'success' : task.status === 'running' ? 'info' : ['failed', 'timeout'].includes(task.status) ? 'danger' : 'outline', children: task.queued ? '排队中' : statuses[task.status] });
}
function object(value) { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function workspace(value) {
    if (!object(value) || value.version !== 1 || !object(value.agent) || !object(value.catalog) || !object(value.admission)
        || !['tasks', 'categories', 'templates', 'goals', 'constraints', 'scopes', 'companies', 'profiles'].every(key => Array.isArray(value[key]))
        || !Array.isArray(value.catalog.providers) || !Array.isArray(value.catalog.models))
        throw new Error('宿主返回了不支持的任务工作台数据，请刷新或检查插件版本。');
    return value;
}
async function responseBody(response) {
    const body = await response.json();
    if (!response.ok)
        throw new Error(object(body) && typeof body.error === 'string' ? body.error : `请求失败（HTTP ${response.status}）`);
    return body;
}
/** Registered as a BetterSidebar TabDescriptor.component; its scope owns every execution request. */
export function TaskWorkspaceTab(props) {
    const sessionId = props.scope?.sessionId;
    return _jsxs("section", { className: "tw-root", "aria-label": "\u4EFB\u52A1\u5DE5\u4F5C\u53F0", children: [_jsx("style", { children: taskWorkspaceStyles }), sessionId
                ? _jsx(ScopedWorkspace, { sessionId: sessionId, visible: props.visible }, sessionId)
                : _jsxs("div", { className: "tw-empty", children: [_jsx("h2", { children: "\u4EFB\u52A1\u5DE5\u4F5C\u53F0" }), _jsx("p", { children: "\u8BF7\u5148\u6253\u5F00\u4E00\u4E2A DSH \u4F1A\u8BDD\u3002\u5DE5\u4F5C\u53F0\u4F1A\u4F7F\u7528\u8BE5\u4F1A\u8BDD\u7684 Agent \u548C\u6A21\u578B\u6267\u884C\u4EFB\u52A1\u3002" })] })] });
}
function ScopedWorkspace({ sessionId, visible }) {
    const [data, setData] = React.useState();
    const [error, setError] = React.useState('');
    const [loadError, setLoadError] = React.useState('');
    const [notice, setNotice] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const busyRef = React.useRef(false);
    const pendingActions = React.useRef(new Set());
    const pendingExecution = React.useRef(0);
    const readSequence = React.useRef(0);
    const latestAction = React.useRef(0);
    const [view, setView] = React.useState('tasks');
    const [selected, setSelected] = React.useState('');
    const [query, setQuery] = React.useState('');
    const [category, setCategory] = React.useState('');
    const [filter, setFilter] = React.useState('');
    const active = React.useRef(true);
    React.useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
    const refresh = React.useCallback(async (signal) => {
        if (busyRef.current && pendingExecution.current === 0)
            return;
        const sequence = ++readSequence.current;
        try {
            const url = endpoint();
            url.searchParams.set('sessionId', sessionId);
            const result = workspace(await responseBody(await fetch(url, { credentials: 'same-origin', cache: 'no-store', signal })));
            if (active.current && !signal?.aborted && sequence === readSequence.current) {
                setData(result);
                setLoadError('');
            }
        }
        catch (failure) {
            if (active.current && !signal?.aborted && sequence === readSequence.current)
                setLoadError(failure instanceof Error ? failure.message : String(failure));
        }
    }, [sessionId]);
    React.useEffect(() => {
        if (!visible)
            return;
        const controller = new AbortController();
        let timer;
        const poll = async () => { await refresh(controller.signal); if (!controller.signal.aborted)
            timer = setTimeout(() => { void poll(); }, 4000); };
        void poll();
        return () => { controller.abort(); clearTimeout(timer); };
    }, [refresh, visible]);
    async function action(input, success = '操作已完成') {
        const actionKey = `${input.action}:${'taskId' in input ? input.taskId : ''}`;
        if (pendingActions.current.has(actionKey) || (busyRef.current && input.action !== 'task.pause'))
            return;
        const actionSequence = ++latestAction.current;
        const execution = ['task.start', 'task.resume', 'task.rerun', 'task.pause'].includes(input.action);
        pendingActions.current.add(actionKey);
        if (execution)
            pendingExecution.current++;
        busyRef.current = true;
        ++readSequence.current;
        setBusy(true);
        setError('');
        setNotice('');
        try {
            const body = await responseBody(await fetch(endpoint(), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, sessionId }) }));
            if (!object(body))
                throw new Error('宿主返回了无效的操作结果。');
            const result = { workspace: workspace(body.workspace), ...(typeof body.taskId === 'string' ? { taskId: body.taskId } : {}) };
            if (active.current && actionSequence === latestAction.current) {
                ++readSequence.current;
                setData(result.workspace);
                setLoadError('');
                setNotice(success);
                if (input.action === 'task.delete')
                    setSelected('');
            }
            return result;
        }
        catch (failure) {
            if (active.current && actionSequence === latestAction.current)
                setError(failure instanceof Error ? failure.message : String(failure));
            return undefined;
        }
        finally {
            pendingActions.current.delete(actionKey);
            if (execution)
                pendingExecution.current--;
            busyRef.current = pendingActions.current.size > 0;
            if (active.current)
                setBusy(busyRef.current);
        }
    }
    const act = async (input) => !!await action(input);
    const task = data?.tasks.find(row => row.id === selected);
    const tasks = data?.tasks.filter(row => (!query.trim() || `${row.title} ${row.description ?? ''} ${row.goal}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
        && (!category || (category === 'uncategorized' ? !row.categoryId : row.categoryId === category))
        && (!filter || (filter === 'queued' ? row.queued : !row.queued && row.status === filter))) ?? [];
    return _jsxs(_Fragment, { children: [_jsxs("header", { className: "tw-top", children: [_jsxs("div", { className: "tw-grow", children: [_jsx("h2", { children: view === 'create' ? '新建任务' : view === 'library' ? '模板与分类' : '任务工作台' }), data && _jsxs("span", { className: "tw-muted tw-small", children: [data.tasks.length, " \u4E2A\u4EFB\u52A1 \u00B7 ", data.tasks.filter(row => row.queued).length, " \u4E2A\u6392\u961F"] })] }), (selected || view !== 'tasks') ? _jsx(Button, { size: "sm", disabled: busy, onClick: () => { setSelected(''); setView('tasks'); setNotice(''); }, children: "\u8FD4\u56DE\u4EFB\u52A1" }) : _jsx(Button, { size: "sm", variant: "primary", disabled: !data || busy, onClick: () => setView('create'), children: "\u65B0\u5EFA\u4EFB\u52A1" })] }), error && _jsxs("div", { className: "tw-notice", role: "alert", children: [error, " ", _jsx(Button, { size: "sm", disabled: busy, onClick: () => { void refresh(); }, children: "\u91CD\u65B0\u52A0\u8F7D" })] }), loadError && _jsxs("div", { className: "tw-notice", role: "alert", children: ["\u540C\u6B65\u5931\u8D25\uFF1A", loadError, " ", _jsx(Button, { size: "sm", disabled: busy, onClick: () => { void refresh(); }, children: "\u91CD\u8BD5\u540C\u6B65" })] }), notice && _jsx("div", { className: "tw-notice", role: "status", children: notice }), busy && _jsx("div", { className: "tw-notice", role: "status", children: "\u6B63\u5728\u5904\u7406\u64CD\u4F5C\uFF0C\u8BF7\u7B49\u5F85\u5BBF\u4E3B\u8FD4\u56DE\u7ED3\u679C\u2026" }), !data ? _jsx("div", { className: "tw-empty", children: loadError ? '任务数据未加载。' : '正在读取任务…' }) : _jsxs(_Fragment, { children: [_jsx("div", { className: "tw-notice tw-small", "aria-label": "\u5F53\u524D\u6267\u884C\u4F1A\u8BDD", children: data.agent.available ? _jsxs(_Fragment, { children: ["\u5F53\u524D\u4F1A\u8BDD \u00B7 ", data.agent.provider, " / ", data.agent.model, _jsx("br", {}), _jsx("span", { title: sessionId, children: sessionId })] }) : _jsxs(_Fragment, { children: ["\u5F53\u524D\u4F1A\u8BDD\u5C1A\u4E0D\u80FD\u6267\u884C\u4EFB\u52A1\uFF1A", data.agent.error ?? '请先在 DSH 中选择模型并激活 Agent。'] }) }), view === 'tasks' && !selected && _jsxs("div", { className: "tw-toolbar", children: [_jsx(Input, { className: "tw-grow", "aria-label": "\u641C\u7D22\u4EFB\u52A1", type: "search", value: query, onChange: event => setQuery(event.target.value), placeholder: "\u641C\u7D22\u4EFB\u52A1" }), _jsx(Button, { size: "sm", disabled: busy, onClick: () => setView('library'), children: "\u6A21\u677F\u4E0E\u5206\u7C7B" }), _jsxs("select", { "aria-label": "\u6309\u5206\u7C7B\u7B5B\u9009", value: category, onChange: event => setCategory(event.target.value), children: [_jsx("option", { value: "", children: "\u5168\u90E8\u5206\u7C7B" }), _jsx("option", { value: "uncategorized", children: "\u672A\u5206\u7C7B" }), data.categories.map(row => _jsxs("option", { value: row.id, children: [row.name, "\uFF08", row.taskCount, "\uFF09"] }, row.id))] }), _jsxs("select", { "aria-label": "\u6309\u72B6\u6001\u7B5B\u9009", value: filter, onChange: event => setFilter(event.target.value), children: [_jsx("option", { value: "", children: "\u5168\u90E8\u72B6\u6001" }), _jsx("option", { value: "queued", children: "\u6392\u961F\u4E2D" }), Object.entries(statuses).map(([value, label]) => _jsx("option", { value: value, children: label }, value))] })] }), _jsx("main", { className: "tw-scroll", children: view === 'create' ? _jsx(NewTaskForm, { categories: data.categories, templates: data.templates, tasks: data.tasks, busy: busy, onCancel: () => setView('tasks'), onCreate: async (input) => { const result = await action({ action: 'task.create', input }, '任务已创建，尚未启动。'); if (result?.taskId) {
                                setSelected(result.taskId);
                                setView('tasks');
                            } return !!result; } })
                            : view === 'library' ? _jsx(Library, { workspace: data, busy: busy, act: act })
                                : selected ? task ? _jsx(TaskDetail, { task: task, workspace: data, busy: busy, act: act }, task.id) : _jsxs("div", { className: "tw-empty", children: ["\u8BE5\u4EFB\u52A1\u5DF2\u4E0D\u5B58\u5728\u3002", _jsx(Button, { size: "sm", onClick: () => setSelected(''), children: "\u8FD4\u56DE\u5217\u8868" })] })
                                    : _jsx("div", { className: "tw-stack", children: tasks.length === 0 ? _jsxs("div", { className: "tw-empty", children: [_jsx("h3", { children: data.tasks.length ? '没有匹配的任务' : '开始一个任务' }), _jsx("p", { children: data.tasks.length ? '调整搜索、分类或状态筛选。' : '从描述或模板创建任务，检查目标后再启动。' }), !data.tasks.length && _jsx(Button, { variant: "primary", size: "sm", onClick: () => setView('create'), children: "\u521B\u5EFA\u7B2C\u4E00\u4E2A\u4EFB\u52A1" })] }) : tasks.map(row => _jsxs("article", { className: "tw-card tw-gap", "aria-label": `任务：${row.title}`, children: [_jsxs("div", { className: "tw-card-head", children: [_jsxs(Button, { className: "tw-task-button", size: "sm", onClick: () => { setSelected(row.id); setNotice(''); }, children: [row.pinnedAt ? '置顶 · ' : '', row.title] }), _jsx(TaskStatus, { task: row })] }), _jsx("p", { className: "tw-description tw-muted", children: row.goal || row.description }), _jsxs("div", { className: "tw-inline tw-small tw-muted", children: [_jsx("span", { children: data.categories.find(item => item.id === row.categoryId)?.name ?? '未分类' }), _jsxs("span", { children: ["\u00B7 \u66F4\u65B0\u4E8E ", time(row.updatedAt)] })] }), row.queued && _jsxs("p", { className: "tw-small tw-muted", children: [row.queueMode === 'resume' ? '等待恢复' : '等待初始化', " \u00B7 \u6392\u961F\u65F6\u95F4 ", time(row.queuedAt)] })] }, row.id)) }) })] })] });
}
function TaskDetail({ task, workspace, busy, act }) {
    const [tab, setTab] = React.useState('overview');
    const [renaming, setRenaming] = React.useState(false);
    const [title, setTitle] = React.useState(task.title);
    const [deleteAssets, setDeleteAssets] = React.useState(false);
    const [deleteFindings, setDeleteFindings] = React.useState(false);
    const id = React.useId();
    const items = ['overview', 'goals', 'constraints', 'models'].map(value => ({ value, label: { overview: '概览', goals: '目标', constraints: '约束', models: '模型链' }[value], id: `${id}-${value}`, panelId: `${id}-${value}-panel` }));
    // A start waits for the real first model round. Polling and pause remain available while it runs.
    const executionDisabled = !workspace.agent.available || (busy && task.status !== 'running');
    const taskAction = task.status === 'paused' ? 'task.resume' : ['done', 'failed', 'timeout'].includes(task.status) ? 'task.rerun' : 'task.start';
    const actionLabel = task.status === 'paused' ? '恢复任务' : ['done', 'failed', 'timeout'].includes(task.status) ? '重新运行' : '启动任务';
    return _jsxs("div", { className: "tw-stack", children: [_jsxs("div", { className: "tw-card-head", children: [_jsx("h2", { className: "tw-title", children: task.title }), _jsx(TaskStatus, { task: task })] }), _jsxs("div", { className: "tw-actions", children: [task.status === 'running' ? _jsx(Button, { size: "sm", variant: "outline", disabled: executionDisabled, onClick: () => { void act({ action: 'task.pause', taskId: task.id }); }, children: task.queued ? '暂停排队' : '暂停任务' }) : _jsx(Button, { size: "sm", variant: "primary", disabled: executionDisabled, onClick: () => { void act({ action: taskAction, taskId: task.id }); }, children: actionLabel }), _jsx(Button, { size: "sm", disabled: busy, onClick: () => { void act({ action: 'task.metadata', taskId: task.id, patch: { pinned: !task.pinnedAt } }); }, children: task.pinnedAt ? '取消置顶' : '置顶任务' })] }), task.queued && _jsxs("div", { className: "tw-card tw-muted", role: "status", children: ["\u4EFB\u52A1\u6B63\u5728\u6392\u961F\u3002", workspace.admission.enabled ? `最多同时运行 ${workspace.admission.limit} 个任务；` : '', "\u6A21\u578B\u5C31\u7EEA\u4E14\u83B7\u5F97\u540D\u989D\u540E\u81EA\u52A8", task.queueMode === 'resume' ? '恢复' : '启动', "\u3002"] }), _jsx(SegmentedTabs, { items: items, value: tab, onChange: setTab, label: "\u4EFB\u52A1\u8BE6\u60C5" }), _jsxs("section", { id: `${id}-${tab}-panel`, role: "tabpanel", "aria-labelledby": `${id}-${tab}`, className: "tw-stack", children: [tab === 'overview' && _jsxs(_Fragment, { children: [_jsxs("div", { className: "tw-inline", children: [_jsx("h3", { className: "tw-grow", children: "\u4EFB\u52A1\u4FE1\u606F" }), _jsx(Button, { size: "sm", disabled: busy, onClick: () => { setTitle(task.title); setRenaming(value => !value); }, children: "\u91CD\u547D\u540D" })] }), renaming && _jsxs("form", { className: "tw-inline", onSubmit: event => { event.preventDefault(); void act({ action: 'task.metadata', taskId: task.id, patch: { title } }).then(ok => { if (ok)
                                    setRenaming(false); }); }, children: [_jsx(Input, { "aria-label": "\u4FEE\u6539\u4EFB\u52A1\u540D\u79F0", className: "tw-grow", required: true, maxLength: 200, value: title, disabled: busy, onChange: event => setTitle(event.target.value) }), _jsx(Button, { size: "sm", type: "submit", disabled: busy, children: "\u4FDD\u5B58\u540D\u79F0" })] }), _jsx(Field, { label: "\u4EFB\u52A1\u5206\u7C7B", children: _jsx(CategorySelect, { categories: workspace.categories, value: task.categoryId ?? '', onChange: categoryId => { if (!busy)
                                        void act({ action: 'task.category', taskIds: [task.id], categoryId: categoryId || null }); } }) }), _jsx("h3", { children: "\u63CF\u8FF0" }), _jsx("p", { className: "tw-description", children: task.description || '无描述' }), _jsx("h3", { children: "\u539F\u59CB\u76EE\u6807" }), _jsx("p", { className: "tw-description", children: task.goal || '未设置目标，按直投意图执行。' }), _jsxs("dl", { className: "tw-kv", children: [_jsx("dt", { children: "\u521B\u5EFA\u65F6\u95F4" }), _jsx("dd", { children: time(task.createdAt) }), _jsx("dt", { children: "\u9996\u6B21\u8FD0\u884C" }), _jsx("dd", { children: time(task.firstRunAt) }), _jsx("dt", { children: "\u622A\u6B62\u65F6\u95F4" }), _jsx("dd", { children: task.deadlineAt ? time(task.deadlineAt) : (task.timeoutSeconds ? `首次执行后 ${task.timeoutSeconds} 秒` : '不限时') }), _jsx("dt", { children: "\u5B8C\u6210\u65F6\u95F4" }), _jsx("dd", { children: task.completedAt ? time(task.completedAt) : '尚未完成' }), _jsx("dt", { children: "\u4EFB\u52A1 ID" }), _jsx("dd", { children: task.id })] }), !!task.sourceTaskIds?.length && _jsxs("section", { className: "tw-gap", children: [_jsx("h3", { children: "\u6765\u6E90\u4EFB\u52A1" }), task.sourceTaskIds.map(sourceId => _jsx("p", { className: "tw-muted", children: workspace.tasks.find(row => row.id === sourceId)?.title ?? sourceId }, sourceId))] }), _jsxs("details", { className: "tw-section", children: [_jsx("summary", { children: "\u5220\u9664\u4EFB\u52A1" }), _jsxs("div", { className: "tw-stack", children: [_jsx("p", { className: "tw-muted", children: "\u505C\u6B62\u4EFB\u52A1\u540E\u5220\u9664\u4EFB\u52A1\u548C\u63A2\u7D22\u8BB0\u5F55\u3002\u9ED8\u8BA4\u4FDD\u7559\u5168\u5C40\u8D44\u4EA7\u3001\u72EC\u7ACB\u53D1\u73B0\u53CA\u5176\u8BC1\u636E\uFF1B\u6D41\u91CF\u7531\u6D41\u91CF\u7BA1\u7406\u5355\u72EC\u5220\u9664\u3002" }), _jsx(Checkbox, { checked: deleteAssets, onChange: setDeleteAssets, label: "\u540C\u65F6\u5220\u9664\u6CA1\u6709\u5176\u4ED6\u4EFB\u52A1\u5F15\u7528\u7684\u8D44\u4EA7" }), _jsx(Checkbox, { checked: deleteFindings, onChange: setDeleteFindings, label: "\u540C\u65F6\u5220\u9664\u6B64\u4EFB\u52A1\u7684\u53D1\u73B0" }), _jsx(DeleteAction, { label: `删除任务 ${task.title}`, disabled: busy || !workspace.agent.available, onDelete: () => act({ action: 'task.delete', taskId: task.id, deleteAssets, deleteFindings }) })] })] })] }), tab === 'goals' && _jsx(GoalsEditor, { goals: workspace.goals.filter(row => row.taskId === task.id), busy: busy, onSave: (goalId, text) => act(goalId ? { action: 'goal.update', taskId: task.id, id: goalId, text } : { action: 'goal.create', taskId: task.id, text }), onDelete: goalId => act({ action: 'goal.delete', taskId: task.id, id: goalId }) }), tab === 'constraints' && _jsx(ConstraintsEditor, { constraints: workspace.constraints.filter(row => row.taskId === task.id), scopes: workspace.scopes.filter(row => row.taskId === task.id), busy: busy, onSave: (constraintId, text, kind) => act(constraintId ? { action: 'constraint.update', taskId: task.id, id: constraintId, text, kind } : { action: 'constraint.create', taskId: task.id, text, kind }), onDelete: constraintId => act({ action: 'constraint.delete', taskId: task.id, id: constraintId }) }), tab === 'models' && _jsx(ModelsEditor, { task: task, workspace: workspace, busy: busy, act: act }, task.id)] })] });
}
function Library({ workspace, busy, act }) {
    const [categoryName, setCategoryName] = React.useState('');
    const [editingCategory, setEditingCategory] = React.useState('');
    const [templateId, setTemplateId] = React.useState();
    const template = workspace.templates.find(row => row.id === templateId);
    return _jsxs("div", { className: "tw-stack", children: [_jsx("h3", { children: "\u5206\u7C7B" }), workspace.categories.length === 0 && _jsx("p", { className: "tw-muted", children: "\u521B\u5EFA\u5206\u7C7B\u540E\uFF0C\u53EF\u5728\u4EFB\u52A1\u5217\u8868\u7B5B\u9009\u548C\u6574\u7406\u4EFB\u52A1\u3002" }), workspace.categories.map(row => _jsxs("div", { className: "tw-record tw-gap", children: [_jsxs("div", { className: "tw-inline", children: [_jsx("strong", { className: "tw-grow", children: row.name }), _jsxs(Tag, { children: [row.taskCount, " \u4E2A\u4EFB\u52A1"] }), _jsx(Button, { size: "sm", disabled: busy, onClick: () => { setEditingCategory(row.id); setCategoryName(row.name); }, children: "\u91CD\u547D\u540D\u5206\u7C7B" })] }), _jsx(DeleteAction, { label: `删除分类 ${row.name}`, disabled: busy, onDelete: () => act({ action: 'category.delete', id: row.id }) })] }, row.id)), _jsxs("form", { className: "tw-inline", "aria-label": "\u5206\u7C7B\u7F16\u8F91\u8868\u5355", onSubmit: event => { event.preventDefault(); void act(editingCategory ? { action: 'category.rename', id: editingCategory, name: categoryName } : { action: 'category.create', name: categoryName }).then(ok => { if (ok) {
                    setCategoryName('');
                    setEditingCategory('');
                } }); }, children: [_jsx(Input, { className: "tw-grow", "aria-label": "\u5206\u7C7B\u540D\u79F0", maxLength: 80, required: true, disabled: busy, value: categoryName, onChange: event => setCategoryName(event.target.value), placeholder: "\u5206\u7C7B\u540D\u79F0" }), _jsx(Button, { size: "sm", type: "submit", disabled: busy, children: editingCategory ? '保存分类' : '添加分类' }), editingCategory && _jsx(Button, { size: "sm", type: "button", onClick: () => { setEditingCategory(''); setCategoryName(''); }, children: "\u53D6\u6D88" })] }), _jsx("p", { className: "tw-small tw-muted", children: "\u5220\u9664\u5206\u7C7B\u4FDD\u7559\u4EFB\u52A1\u548C\u6A21\u677F\uFF0C\u5E76\u5C06\u5176\u79FB\u81F3\u672A\u5206\u7C7B\u3002" }), _jsxs("div", { className: "tw-inline tw-section", children: [_jsx("h3", { className: "tw-grow", children: "\u4EFB\u52A1\u6A21\u677F" }), _jsx(Button, { size: "sm", disabled: busy, onClick: () => setTemplateId('new'), children: "\u65B0\u5EFA\u6A21\u677F" })] }), templateId !== undefined && _jsx(TemplateForm, { value: template, categories: workspace.categories, busy: busy, onCancel: () => setTemplateId(undefined), onSave: async (input) => { const ok = await act(template ? { action: 'template.update', id: template.id, patch: input } : { action: 'template.create', input }); if (ok)
                    setTemplateId(undefined); return ok; } }, templateId), !workspace.templates.length && templateId === undefined && _jsx("p", { className: "tw-muted", children: "\u5C06\u5E38\u7528\u63CF\u8FF0\u548C\u76EE\u6807\u4FDD\u5B58\u4E3A\u6A21\u677F\uFF0C\u521B\u5EFA\u4EFB\u52A1\u65F6\u76F4\u63A5\u5957\u7528\u3002" }), workspace.templates.map(row => _jsxs("article", { className: "tw-card tw-gap", "aria-label": `模板：${row.name}`, children: [_jsxs("div", { className: "tw-card-head", children: [_jsx("strong", { children: row.name }), _jsx(Tag, { children: workspace.categories.find(item => item.id === row.categoryId)?.name ?? '未分类' })] }), _jsx("p", { className: "tw-description tw-muted", children: row.goal }), _jsxs("div", { className: "tw-actions", children: [_jsx(Button, { size: "sm", disabled: busy, onClick: () => setTemplateId(row.id), children: "\u7F16\u8F91\u6A21\u677F" }), _jsx(DeleteAction, { label: `删除模板 ${row.name}`, disabled: busy, onDelete: () => act({ action: 'template.delete', id: row.id }) })] })] }, row.id))] });
}
