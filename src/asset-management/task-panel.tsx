import React, { useEffect, useRef, useState } from 'react';
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives';
import { taskWorkspaceStyles } from '../task-workspace/styles.js';
import { request, type AssetView } from './client-api.js';
import type { IntentAsset, TaskAssetMutation, TaskAssetRef, TaskAssetScopeMutation } from './task-assets.js';

interface TaskOption { id: string; title: string; status: string }
interface AssetPage { assets: AssetView[]; total: number; count: number }
interface Refs { intents: TaskAssetRef[]; facts: TaskAssetRef[]; findings: TaskAssetRef[] }
const types = [['', '全部类型'], ['root_domain', '根域名'], ['subdomain', '子域名'], ['ip', 'IP'], ['app', '应用'], ['service', '服务'], ['endpoint', '接口']];
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const assetLabel = (asset: AssetView) => asset.url || asset.domain || asset.ip || asset.app_name || asset.id;

export function TaskAssetPanel(): React.ReactNode {
  const [tasks, setTasks] = useState<TaskOption[]>(), [taskId, setTaskId] = useState('');
  const [error, setError] = useState(''), [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    void request<{ tasks: TaskOption[] }>('tasks', { signal: controller.signal }).then(data => {
      if (controller.signal.aborted) return;
      setTasks(data.tasks);
      setTaskId(current => data.tasks.some(task => task.id === current) ? current : data.tasks[0]?.id ?? '');
    }).catch(error => { if (!controller.signal.aborted) setError(errorText(error)); });
    return () => controller.abort();
  }, [revision]);
  return <section className="tw-root" aria-label="任务资产"><style>{taskWorkspaceStyles}</style>
    <header className="tw-top"><h2>任务资产</h2><Button size="sm" onClick={() => setRevision(value => value + 1)}>刷新任务</Button></header>
    {error && <div className="tw-notice" role="alert">任务加载失败：{error}</div>}
    <div className="tw-toolbar"><label className="tw-field tw-grow"><span>选择任务</span><select aria-label="选择任务" value={taskId} onChange={event => setTaskId(event.target.value)} disabled={!tasks?.length}>
      {!tasks?.length && <option value="">{tasks ? '暂无任务' : '正在读取任务…'}</option>}
      {tasks?.map(task => <option key={task.id} value={task.id}>{task.title} · {task.status}</option>)}
    </select></label></div>
    {taskId && tasks ? <TaskAssets key={taskId} taskId={taskId} tasks={tasks} /> : tasks && <p className="tw-empty">请先在任务工作台创建任务。</p>}
  </section>;
}

function TaskAssets({ taskId, tasks }: { taskId: string; tasks: TaskOption[] }): React.ReactNode {
  const [type, setType] = useState(''), [offset, setOffset] = useState(0), [revision, setRevision] = useState(0);
  const [page, setPage] = useState<AssetPage>(), [targets, setTargets] = useState<IntentAsset[]>();
  const [loading, setLoading] = useState(true), [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [ids, setIds] = useState(''), [summary, setSummary] = useState(''), [scope, setScope] = useState('');
  const [detaching, setDetaching] = useState(''), [selected, setSelected] = useState('');
  const [refs, setRefs] = useState<Refs>(), [refsError, setRefsError] = useState('');
  const lifetime = useRef<AbortController | null>(null), pending = useRef(false);
  const base = `tasks/${encodeURIComponent(taskId)}`;
  const taskName = (id: string) => tasks.find(task => task.id === id)?.title ?? id;
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setLoadError(''); setPage(undefined); setTargets(undefined); setSelected(''); setDetaching('');
    const query = new URLSearchParams({ limit: '20', offset: String(offset), ...(type ? { type } : {}) });
    void Promise.all([
      request<AssetPage>(`${base}/assets?${query}`, { signal: controller.signal }),
      request<{ assets: IntentAsset[] }>(`${base}/intent-assets`, { signal: controller.signal }),
    ]).then(([assets, intents]) => {
      if (controller.signal.aborted) return;
      if (offset && offset >= assets.total) { setOffset(Math.max(0, Math.floor((assets.total - 1) / 20) * 20)); return; }
      setPage(assets); setTargets(intents.assets);
    }).catch(error => { if (!controller.signal.aborted) setLoadError(errorText(error)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [base, type, offset, revision]);
  useEffect(() => {
    setRefs(undefined); setRefsError('');
    if (!selected) return;
    const controller = new AbortController();
    void request<Refs>(`${base}/assets/${encodeURIComponent(selected)}/refs`, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setRefs(data); })
      .catch(error => { if (!controller.signal.aborted) setRefsError(errorText(error)); });
    return () => controller.abort();
  }, [base, selected, revision]);
  async function mutate<T>(path: string, method: 'POST' | 'DELETE', body: unknown, describe: (result: T) => string, clear: () => void) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    const signal = lifetime.current?.signal;
    try {
      const result = await request<T>(path, { method, ...(body === undefined ? {} : { body }), signal });
      if (signal?.aborted) return;
      setNotice(describe(result)); clear(); setRevision(value => value + 1);
    } catch (error) { if (!signal?.aborted) setError(errorText(error)); }
    finally { pending.current = false; if (!signal?.aborted) setBusy(false); }
  }
  return <div className="tw-scroll tw-stack">
    {error && <div className="tw-notice" role="alert">{error}</div>}{notice && <div className="tw-notice" role="status">{notice}</div>}
    {busy && <p role="status">正在保存…</p>}
    <details className="tw-card"><summary>关联已有全局资产</summary>
      <form className="tw-stack" onSubmit={event => {
        event.preventDefault();
        const assetIds = [...new Set(ids.split(/[\s,，]+/u).filter(Boolean))];
        if (!assetIds.length || !summary.trim()) { setError('请填写资产 ID 和关联来源说明。'); return; }
        void mutate<TaskAssetMutation>(`${base}/assets`, 'POST', { asset_ids: assetIds, source_summary: summary.trim() }, result => `已关联 ${result.attached} 条资产，${result.existing} 条已关联资产的来源已更新。`, () => { setIds(''); setSummary(''); });
      }}><fieldset className="tw-stack" disabled={busy}>
        <label className="tw-field"><span>全局资产 ID</span><textarea required aria-label="全局资产 ID" value={ids} onChange={event => setIds(event.target.value)} placeholder="每行一个 ID，也可用逗号分隔；每次最多 100 条" /></label>
        <label className="tw-field"><span>来源说明（必填）</span><Input required aria-label="关联来源说明" value={summary} onChange={event => setSummary(event.target.value)} placeholder="为何将这些资产加入当前任务" /></label>
        <Button type="submit" size="sm" variant="primary">关联资产</Button>
      </fieldset></form>
    </details>
    <details className="tw-card"><summary>按范围登记测试资产</summary><form className="tw-stack" onSubmit={event => {
      event.preventDefault(); const lines = scope.split(/\r?\n/u).map(line => line.trim()).filter(Boolean);
      if (!lines.length) { setError('请填写至少一条范围。'); return; }
      void mutate<TaskAssetScopeMutation>(`${base}/assets`, 'POST', { scope: lines }, result => `新增 ${result.scopes_added} 条范围，${result.scopes_existing} 条已存在；关联 ${result.assets_linked} 条资产，${result.assets_existing} 条已关联。`, () => setScope(''));
    }}><fieldset disabled={busy} className="tw-stack">
      <label className="tw-field"><span>范围（每行一条）</span><textarea required aria-label="任务资产范围" value={scope} onChange={event => setScope(event.target.value)} placeholder={'example.com\n192.0.2.10\n192.0.2.0/24'} /><small>支持域名、IP、CIDR、ICP备案及关键词。域名和 IP 会关联资产；其他规则登记为任务范围。任一条无效时整批不保存。</small></label>
      <Button type="submit" size="sm" variant="primary">登记范围</Button>
    </fieldset></form></details>
    <div className="tw-actions"><label className="tw-field tw-grow"><span>资产类型</span><select value={type} disabled={busy} aria-label="任务资产类型" onChange={event => { setType(event.target.value); setOffset(0); }}>{types.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <Button size="sm" disabled={busy || loading} onClick={() => setRevision(value => value + 1)}>刷新资产</Button></div>
    {loadError && <div className="tw-notice" role="alert">加载失败：{loadError}</div>}
    {loading && <p role="status">正在读取任务资产与意图目标…</p>}
    {page && <><p className="tw-muted">共 {page.total} 条关联资产</p>{!page.assets.length && <p className="tw-empty">当前筛选下没有关联资产。</p>}
      {page.assets.map(asset => <article className="tw-card tw-gap" key={asset.id}>
        <strong className="tw-title">{assetLabel(asset)}</strong><p className="tw-small tw-muted tw-description">{asset.type} · {asset.id}</p>
        <p className="tw-description">来源：{asset.task_source || '未记录'}{asset.task_source_summary ? ` · ${asset.task_source_summary}` : ''}</p>
        <div className="tw-actions"><Button size="sm" disabled={busy} onClick={() => setSelected(value => value === asset.id ? '' : asset.id)}>{selected === asset.id ? '收起引用' : '查看引用'}</Button><Button size="sm" disabled={busy} onClick={() => setDetaching(asset.id)}>解除关联</Button></div>
        {detaching === asset.id && <div className="tw-gap" role="group" aria-label="确认解除关联"><p>确认从当前任务移除 {assetLabel(asset)}？全局资产和历史引用会保留。</p><div className="tw-actions"><Button size="sm" disabled={busy} onClick={() => { void mutate<{ detached: string }>(`${base}/assets/${encodeURIComponent(asset.id)}`, 'DELETE', undefined, () => '已解除任务关联，保留全局资产和历史引用。', () => setDetaching('')); }}>确认解除关联</Button><Button size="sm" disabled={busy} onClick={() => setDetaching('')}>取消</Button></div></div>}
        {selected === asset.id && <section className="tw-section tw-gap" aria-label="资产引用">
          {refsError ? <div role="alert">引用加载失败：{refsError}<Button size="sm" onClick={() => setSelected('')}>关闭后重试</Button></div> : !refs ? <p role="status">正在读取引用…</p> : (['intents', 'facts', 'findings'] as const).map((kind, index) => <div className="tw-gap" key={kind}><h3>{['意图', '事实', '发现'][index]} · {refs[kind].length}</h3>{refs[kind].map(ref => <div key={ref.id} className="tw-record"><p className="tw-description">{ref.summary || ref.id}</p><p className="tw-small tw-muted tw-description">{ref.state} · {ref.id} · {ref.inherited && ref.source_task_id ? `继承自 ${taskName(ref.source_task_id)}（${ref.source_task_id}）` : '当前任务'}</p></div>)}</div>)}
        </section>}
      </article>)}
      <div className="tw-actions"><Button size="sm" disabled={busy || loading || offset === 0} onClick={() => setOffset(value => Math.max(0, value - 20))}>上一页</Button><span>第 {Math.floor(offset / 20) + 1} 页</span><Button size="sm" disabled={busy || loading || offset + 20 >= page.total} onClick={() => setOffset(value => value + 20)}>下一页</Button></div>
    </>}
    {targets && <section className="tw-section tw-stack" aria-label="意图资产"><h3>意图目标与来源 · {targets.length}</h3><p className="tw-muted">包括当前任务的意图目标及直接来源任务的已终结意图；历史目标可能已解除资产关联。</p>
      {!targets.length && <p className="tw-muted">尚无意图资产。</p>}{targets.map(target => <article className="tw-card tw-gap" key={`${target.source_task_id}:${target.intent_id}:${target.asset_id}`}>
        <strong className="tw-title">{target.label}</strong><p className="tw-small tw-description">{target.type} · 资产 {target.asset_id} · 意图 {target.intent_id}</p>
        <p className="tw-description">{target.inherited ? '继承来源任务' : '当前任务'}：{taskName(target.source_task_id)}（{target.source_task_id}）</p>
        <p className="tw-description">来源：{target.source} · {target.source_summary}</p>{target.source_node_id && <p className="tw-small tw-description">来源节点：{target.source_node_id}</p>}
      </article>)}
    </section>}
  </div>;
}
