import React from 'react';
import { Button, Checkbox, Input, SegmentedTabs, Tag, type SegmentedTab } from '@deepseek-ai/dsh-client-ui-primitives';
import type { TabComponentProps } from 'dsh-better-sidebar/client/service';
import type { RedTeamTask } from '../types.js';
import { TASK_WORKSPACE_PATH, type TaskWorkspace, type TaskWorkspaceAction, type TaskWorkspaceResult } from './contracts.js';
import { CategorySelect, Field, NewTaskForm, TemplateForm } from './forms.js';
import { ConstraintsEditor, DeleteAction, GoalsEditor } from './records.js';
import { ModelsEditor } from './models.js';
import { taskWorkspaceStyles } from './styles.js';

const statuses: Record<RedTeamTask['status'], string> = { draft: '草稿', running: '运行中', paused: '已暂停', done: '已完成', failed: '失败', timeout: '已超时' };
const time = (value?: string) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚未开始';
// Match BetterSidebar's HTTP base handling, including desktop dsh-app and reverse-proxy prefixes.
function endpoint(): URL {
  const base = new URL(document.baseURI); base.search = ''; base.hash = '';
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  return new URL(TASK_WORKSPACE_PATH.replace(/^\/+/, ''), base);
}
function TaskStatus({ task }: { task: RedTeamTask }) {
  return <Tag tone={task.queued ? 'warning' : task.status === 'done' ? 'success' : task.status === 'running' ? 'info' : ['failed', 'timeout'].includes(task.status) ? 'danger' : 'outline'}>{task.queued ? '排队中' : statuses[task.status]}</Tag>;
}
function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function workspace(value: unknown): TaskWorkspace {
  if (!object(value) || value.version !== 1 || !object(value.agent) || !object(value.catalog) || !object(value.admission)
    || !['tasks', 'categories', 'templates', 'goals', 'constraints', 'scopes', 'companies', 'profiles'].every(key => Array.isArray(value[key]))
    || !Array.isArray(value.catalog.providers) || !Array.isArray(value.catalog.models)) throw new Error('宿主返回了不支持的任务工作台数据，请刷新或检查插件版本。');
  return value as unknown as TaskWorkspace;
}
async function responseBody(response: Response): Promise<unknown> {
  const body: unknown = await response.json();
  if (!response.ok) throw new Error(object(body) && typeof body.error === 'string' ? body.error : `请求失败（HTTP ${response.status}）`);
  return body;
}

/** Registered as a BetterSidebar TabDescriptor.component; its scope owns every execution request. */
export function TaskWorkspaceTab(props: TabComponentProps): React.ReactNode {
  const sessionId = props.scope?.sessionId;
  return <section className="tw-root" aria-label="任务工作台"><style>{taskWorkspaceStyles}</style>{sessionId
    ? <ScopedWorkspace key={sessionId} sessionId={sessionId} visible={props.visible} />
    : <div className="tw-empty"><h2>任务工作台</h2><p>请先打开一个 DSH 会话。工作台会使用该会话的 Agent 和模型执行任务。</p></div>}</section>;
}

function ScopedWorkspace({ sessionId, visible }: { sessionId: string; visible: boolean }) {
  const [data, setData] = React.useState<TaskWorkspace>();
  const [error, setError] = React.useState('');
  const [loadError, setLoadError] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const busyRef = React.useRef(false);
  const pendingActions = React.useRef(new Set<string>());
  const pendingExecution = React.useRef(0);
  const readSequence = React.useRef(0);
  const latestAction = React.useRef(0);
  const [view, setView] = React.useState<'tasks' | 'create' | 'library'>('tasks');
  const [selected, setSelected] = React.useState('');
  const [query, setQuery] = React.useState('');
  const [category, setCategory] = React.useState('');
  const [filter, setFilter] = React.useState('');
  const active = React.useRef(true);
  React.useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const refresh = React.useCallback(async (signal?: AbortSignal) => {
    if (busyRef.current && pendingExecution.current === 0) return;
    const sequence = ++readSequence.current;
    try {
      const url = endpoint(); url.searchParams.set('sessionId', sessionId);
      const result = workspace(await responseBody(await fetch(url, { credentials: 'same-origin', cache: 'no-store', signal })));
      if (active.current && !signal?.aborted && sequence === readSequence.current) { setData(result); setLoadError(''); }
    } catch (failure) { if (active.current && !signal?.aborted && sequence === readSequence.current) setLoadError(failure instanceof Error ? failure.message : String(failure)); }
  }, [sessionId]);
  React.useEffect(() => {
    if (!visible) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const poll = async () => { await refresh(controller.signal); if (!controller.signal.aborted) timer = setTimeout(() => { void poll(); }, 4000); };
    void poll(); return () => { controller.abort(); clearTimeout(timer); };
  }, [refresh, visible]);
  async function action(input: TaskWorkspaceAction, success = '操作已完成'): Promise<TaskWorkspaceResult | undefined> {
    const actionKey = `${input.action}:${'taskId' in input ? input.taskId : ''}`;
    if (pendingActions.current.has(actionKey) || (busyRef.current && input.action !== 'task.pause')) return;
    const actionSequence = ++latestAction.current;
    const execution = ['task.start', 'task.resume', 'task.rerun', 'task.pause'].includes(input.action);
    pendingActions.current.add(actionKey);
    if (execution) pendingExecution.current++;
    busyRef.current = true; ++readSequence.current; setBusy(true); setError(''); setNotice('');
    try {
      const body = await responseBody(await fetch(endpoint(), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, sessionId }) }));
      if (!object(body)) throw new Error('宿主返回了无效的操作结果。');
      const result = { workspace: workspace(body.workspace), ...(typeof body.taskId === 'string' ? { taskId: body.taskId } : {}) };
      if (active.current && actionSequence === latestAction.current) { ++readSequence.current; setData(result.workspace); setLoadError(''); setNotice(success); if (input.action === 'task.delete') setSelected(''); }
      return result;
    } catch (failure) { if (active.current && actionSequence === latestAction.current) setError(failure instanceof Error ? failure.message : String(failure)); return undefined; }
    finally { pendingActions.current.delete(actionKey); if (execution) pendingExecution.current--; busyRef.current = pendingActions.current.size > 0; if (active.current) setBusy(busyRef.current); }
  }
  const act = async (input: TaskWorkspaceAction) => !!await action(input);
  const task = data?.tasks.find(row => row.id === selected);
  const tasks = data?.tasks.filter(row => (!query.trim() || `${row.title} ${row.description ?? ''} ${row.goal}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    && (!category || (category === 'uncategorized' ? !row.categoryId : row.categoryId === category))
    && (!filter || (filter === 'queued' ? row.queued : !row.queued && row.status === filter))) ?? [];
  return <>
    <header className="tw-top"><div className="tw-grow"><h2>{view === 'create' ? '新建任务' : view === 'library' ? '模板与分类' : '任务工作台'}</h2>{data && <span className="tw-muted tw-small">{data.tasks.length} 个任务 · {data.tasks.filter(row => row.queued).length} 个排队</span>}</div>
      {(selected || view !== 'tasks') ? <Button size="sm" disabled={busy} onClick={() => { setSelected(''); setView('tasks'); setNotice(''); }}>返回任务</Button> : <Button size="sm" variant="primary" disabled={!data || busy} onClick={() => setView('create')}>新建任务</Button>}
    </header>
    {error && <div className="tw-notice" role="alert">{error} <Button size="sm" disabled={busy} onClick={() => { void refresh(); }}>重新加载</Button></div>}
    {loadError && <div className="tw-notice" role="alert">同步失败：{loadError} <Button size="sm" disabled={busy} onClick={() => { void refresh(); }}>重试同步</Button></div>}
    {notice && <div className="tw-notice" role="status">{notice}</div>}
    {busy && <div className="tw-notice" role="status">正在处理操作，请等待宿主返回结果…</div>}
    {!data ? <div className="tw-empty">{loadError ? '任务数据未加载。' : '正在读取任务…'}</div> : <>
      <div className="tw-notice tw-small" aria-label="当前执行会话">{data.agent.available ? <>当前会话 · {data.agent.provider} / {data.agent.model}<br /><span title={sessionId}>{sessionId}</span></> : <>当前会话尚不能执行任务：{data.agent.error ?? '请先在 DSH 中选择模型并激活 Agent。'}</>}</div>
      {view === 'tasks' && !selected && <div className="tw-toolbar"><Input className="tw-grow" aria-label="搜索任务" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索任务" /><Button size="sm" disabled={busy} onClick={() => setView('library')}>模板与分类</Button>
        <select aria-label="按分类筛选" value={category} onChange={event => setCategory(event.target.value)}><option value="">全部分类</option><option value="uncategorized">未分类</option>{data.categories.map(row => <option value={row.id} key={row.id}>{row.name}（{row.taskCount}）</option>)}</select>
        <select aria-label="按状态筛选" value={filter} onChange={event => setFilter(event.target.value)}><option value="">全部状态</option><option value="queued">排队中</option>{Object.entries(statuses).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
      </div>}
      <main className="tw-scroll">
        {view === 'create' ? <NewTaskForm categories={data.categories} templates={data.templates} tasks={data.tasks} busy={busy} onCancel={() => setView('tasks')} onCreate={async input => { const result = await action({ action: 'task.create', input }, '任务已创建，尚未启动。'); if (result?.taskId) { setSelected(result.taskId); setView('tasks'); } return !!result; }} />
          : view === 'library' ? <Library workspace={data} busy={busy} act={act} />
          : selected ? task ? <TaskDetail key={task.id} task={task} workspace={data} busy={busy} act={act} /> : <div className="tw-empty">该任务已不存在。<Button size="sm" onClick={() => setSelected('')}>返回列表</Button></div>
          : <div className="tw-stack">{tasks.length === 0 ? <div className="tw-empty"><h3>{data.tasks.length ? '没有匹配的任务' : '开始一个任务'}</h3><p>{data.tasks.length ? '调整搜索、分类或状态筛选。' : '从描述或模板创建任务，检查目标后再启动。'}</p>{!data.tasks.length && <Button variant="primary" size="sm" onClick={() => setView('create')}>创建第一个任务</Button>}</div> : tasks.map(row => <article key={row.id} className="tw-card tw-gap" aria-label={`任务：${row.title}`}>
            <div className="tw-card-head"><Button className="tw-task-button" size="sm" onClick={() => { setSelected(row.id); setNotice(''); }}>{row.pinnedAt ? '置顶 · ' : ''}{row.title}</Button><TaskStatus task={row} /></div>
            <p className="tw-description tw-muted">{row.goal || row.description}</p><div className="tw-inline tw-small tw-muted"><span>{data.categories.find(item => item.id === row.categoryId)?.name ?? '未分类'}</span><span>· 更新于 {time(row.updatedAt)}</span></div>
            {row.queued && <p className="tw-small tw-muted">{row.queueMode === 'resume' ? '等待恢复' : '等待初始化'} · 排队时间 {time(row.queuedAt)}</p>}
          </article>)}</div>}
      </main>
    </>}
  </>;
}

type DetailTab = 'overview' | 'goals' | 'constraints' | 'models';
function TaskDetail({ task, workspace, busy, act }: { task: RedTeamTask; workspace: TaskWorkspace; busy: boolean; act: (input: TaskWorkspaceAction) => Promise<boolean> }) {
  const [tab, setTab] = React.useState<DetailTab>('overview');
  const [renaming, setRenaming] = React.useState(false);
  const [title, setTitle] = React.useState(task.title);
  const [deleteAssets, setDeleteAssets] = React.useState(false);
  const [deleteFindings, setDeleteFindings] = React.useState(false);
  const id = React.useId();
  const items: [SegmentedTab<DetailTab>, ...SegmentedTab<DetailTab>[]] = (['overview', 'goals', 'constraints', 'models'] as const).map(value => ({ value, label: { overview: '概览', goals: '目标', constraints: '约束', models: '模型链' }[value], id: `${id}-${value}`, panelId: `${id}-${value}-panel` })) as [SegmentedTab<DetailTab>, ...SegmentedTab<DetailTab>[]];
  // A start waits for the real first model round. Polling and pause remain available while it runs.
  const executionDisabled = !workspace.agent.available || (busy && task.status !== 'running');
  const taskAction = task.status === 'paused' ? 'task.resume' : ['done', 'failed', 'timeout'].includes(task.status) ? 'task.rerun' : 'task.start';
  const actionLabel = task.status === 'paused' ? '恢复任务' : ['done', 'failed', 'timeout'].includes(task.status) ? '重新运行' : '启动任务';
  return <div className="tw-stack">
    <div className="tw-card-head"><h2 className="tw-title">{task.title}</h2><TaskStatus task={task} /></div>
    <div className="tw-actions">{task.status === 'running' ? <Button size="sm" variant="outline" disabled={executionDisabled} onClick={() => { void act({ action: 'task.pause', taskId: task.id }); }}>{task.queued ? '暂停排队' : '暂停任务'}</Button> : <Button size="sm" variant="primary" disabled={executionDisabled} onClick={() => { void act({ action: taskAction, taskId: task.id }); }}>{actionLabel}</Button>}
      <Button size="sm" disabled={busy} onClick={() => { void act({ action: 'task.metadata', taskId: task.id, patch: { pinned: !task.pinnedAt } }); }}>{task.pinnedAt ? '取消置顶' : '置顶任务'}</Button>
    </div>
    {task.queued && <div className="tw-card tw-muted" role="status">任务正在排队。{workspace.admission.enabled ? `最多同时运行 ${workspace.admission.limit} 个任务；` : ''}模型就绪且获得名额后自动{task.queueMode === 'resume' ? '恢复' : '启动'}。</div>}
    <SegmentedTabs items={items} value={tab} onChange={setTab} label="任务详情" />
    <section id={`${id}-${tab}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab}`} className="tw-stack">
      {tab === 'overview' && <>
        <div className="tw-inline"><h3 className="tw-grow">任务信息</h3><Button size="sm" disabled={busy} onClick={() => { setTitle(task.title); setRenaming(value => !value); }}>重命名</Button></div>
        {renaming && <form className="tw-inline" onSubmit={event => { event.preventDefault(); void act({ action: 'task.metadata', taskId: task.id, patch: { title } }).then(ok => { if (ok) setRenaming(false); }); }}><Input aria-label="修改任务名称" className="tw-grow" required maxLength={200} value={title} disabled={busy} onChange={event => setTitle(event.target.value)} /><Button size="sm" type="submit" disabled={busy}>保存名称</Button></form>}
        <Field label="任务分类"><CategorySelect categories={workspace.categories} value={task.categoryId ?? ''} onChange={categoryId => { if (!busy) void act({ action: 'task.category', taskIds: [task.id], categoryId: categoryId || null }); }} /></Field>
        <h3>描述</h3><p className="tw-description">{task.description || '无描述'}</p><h3>原始目标</h3><p className="tw-description">{task.goal || '未设置目标，按直投意图执行。'}</p>
        <dl className="tw-kv"><dt>创建时间</dt><dd>{time(task.createdAt)}</dd><dt>首次运行</dt><dd>{time(task.firstRunAt)}</dd><dt>截止时间</dt><dd>{task.deadlineAt ? time(task.deadlineAt) : (task.timeoutSeconds ? `首次执行后 ${task.timeoutSeconds} 秒` : '不限时')}</dd><dt>完成时间</dt><dd>{task.completedAt ? time(task.completedAt) : '尚未完成'}</dd><dt>任务 ID</dt><dd>{task.id}</dd></dl>
        {!!task.sourceTaskIds?.length && <section className="tw-gap"><h3>来源任务</h3>{task.sourceTaskIds.map(sourceId => <p className="tw-muted" key={sourceId}>{workspace.tasks.find(row => row.id === sourceId)?.title ?? sourceId}</p>)}</section>}
        <details className="tw-section"><summary>删除任务</summary><div className="tw-stack">
          <p className="tw-muted">停止任务后删除任务和探索记录。默认保留全局资产、独立发现及其证据；流量由流量管理单独删除。</p>
          <Checkbox checked={deleteAssets} onChange={setDeleteAssets} label="同时删除没有其他任务引用的资产" />
          <Checkbox checked={deleteFindings} onChange={setDeleteFindings} label="同时删除此任务的发现" />
          <DeleteAction label={`删除任务 ${task.title}`} disabled={busy || !workspace.agent.available} onDelete={() => act({ action: 'task.delete', taskId: task.id, deleteAssets, deleteFindings })} />
        </div></details>
      </>}
      {tab === 'goals' && <GoalsEditor goals={workspace.goals.filter(row => row.taskId === task.id)} busy={busy} onSave={(goalId, text) => act(goalId ? { action: 'goal.update', taskId: task.id, id: goalId, text } : { action: 'goal.create', taskId: task.id, text })} onDelete={goalId => act({ action: 'goal.delete', taskId: task.id, id: goalId })} />}
      {tab === 'constraints' && <ConstraintsEditor constraints={workspace.constraints.filter(row => row.taskId === task.id)} scopes={workspace.scopes.filter(row => row.taskId === task.id)} busy={busy} onSave={(constraintId, text, kind) => act(constraintId ? { action: 'constraint.update', taskId: task.id, id: constraintId, text, kind } : { action: 'constraint.create', taskId: task.id, text, kind })} onDelete={constraintId => act({ action: 'constraint.delete', taskId: task.id, id: constraintId })} />}
      {tab === 'models' && <ModelsEditor key={task.id} task={task} workspace={workspace} busy={busy} act={act} />}
    </section>
  </div>;
}

function Library({ workspace, busy, act }: { workspace: TaskWorkspace; busy: boolean; act: (input: TaskWorkspaceAction) => Promise<boolean> }) {
  const [categoryName, setCategoryName] = React.useState('');
  const [editingCategory, setEditingCategory] = React.useState('');
  const [templateId, setTemplateId] = React.useState<string>();
  const template = workspace.templates.find(row => row.id === templateId);
  return <div className="tw-stack"><h3>分类</h3>
    {workspace.categories.length === 0 && <p className="tw-muted">创建分类后，可在任务列表筛选和整理任务。</p>}
    {workspace.categories.map(row => <div className="tw-record tw-gap" key={row.id}><div className="tw-inline"><strong className="tw-grow">{row.name}</strong><Tag>{row.taskCount} 个任务</Tag><Button size="sm" disabled={busy} onClick={() => { setEditingCategory(row.id); setCategoryName(row.name); }}>重命名分类</Button></div><DeleteAction label={`删除分类 ${row.name}`} disabled={busy} onDelete={() => act({ action: 'category.delete', id: row.id })} /></div>)}
    <form className="tw-inline" aria-label="分类编辑表单" onSubmit={event => { event.preventDefault(); void act(editingCategory ? { action: 'category.rename', id: editingCategory, name: categoryName } : { action: 'category.create', name: categoryName }).then(ok => { if (ok) { setCategoryName(''); setEditingCategory(''); } }); }}>
      <Input className="tw-grow" aria-label="分类名称" maxLength={80} required disabled={busy} value={categoryName} onChange={event => setCategoryName(event.target.value)} placeholder="分类名称" /><Button size="sm" type="submit" disabled={busy}>{editingCategory ? '保存分类' : '添加分类'}</Button>{editingCategory && <Button size="sm" type="button" onClick={() => { setEditingCategory(''); setCategoryName(''); }}>取消</Button>}
    </form><p className="tw-small tw-muted">删除分类保留任务和模板，并将其移至未分类。</p>
    <div className="tw-inline tw-section"><h3 className="tw-grow">任务模板</h3><Button size="sm" disabled={busy} onClick={() => setTemplateId('new')}>新建模板</Button></div>
    {templateId !== undefined && <TemplateForm key={templateId} value={template} categories={workspace.categories} busy={busy} onCancel={() => setTemplateId(undefined)} onSave={async input => { const ok = await act(template ? { action: 'template.update', id: template.id, patch: input } : { action: 'template.create', input }); if (ok) setTemplateId(undefined); return ok; }} />}
    {!workspace.templates.length && templateId === undefined && <p className="tw-muted">将常用描述和目标保存为模板，创建任务时直接套用。</p>}
    {workspace.templates.map(row => <article className="tw-card tw-gap" key={row.id} aria-label={`模板：${row.name}`}><div className="tw-card-head"><strong>{row.name}</strong><Tag>{workspace.categories.find(item => item.id === row.categoryId)?.name ?? '未分类'}</Tag></div><p className="tw-description tw-muted">{row.goal}</p><div className="tw-actions"><Button size="sm" disabled={busy} onClick={() => setTemplateId(row.id)}>编辑模板</Button><DeleteAction label={`删除模板 ${row.name}`} disabled={busy} onDelete={() => act({ action: 'template.delete', id: row.id })} /></div></article>)}
  </div>;
}
