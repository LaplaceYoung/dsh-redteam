import React from 'react';
import { Button, Input, SegmentedTabs, Tag } from '@deepseek-ai/dsh-client-ui-primitives';
import type { TabComponentProps } from 'dsh-better-sidebar/client/service';
import { taskWorkspaceStyles } from '../task-workspace/styles.js';
import { JudgeSettings, RuleForm } from './forms.js';
import { request, listPath, type InterceptRecord, type RecordPage, type Rule, type Settings, type Execution } from './api.js';

type View = 'pending' | 'history' | 'rules' | 'settings';
const labels = { pending: '待审批', allowed: '已允许', denied: '已拒绝', timeout: '已超时' };
const executionLabels = { pending: '等待工具结果', succeeded: '调用成功', failed: '调用失败', not_executed: '未执行', unknown: '结果未知' };
const sourceLabels = { rule: '规则', model: '模型判定', manual: '人工' };
const actionLabels = { allow: '允许', deny: '拒绝', ask: '人工审批' };
const styles = `${taskWorkspaceStyles}.ia-json{white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.6 var(--ds-font-family-code,monospace);background:var(--dsw-alias-interactive-bg-hover);padding:8px;border-radius:var(--dsw-radius-sm);margin:0;max-height:420px;overflow:auto}.ia-record-button{text-align:left;white-space:normal;justify-content:flex-start!important;width:100%}.ia-detail{border-top:1px solid var(--dsw-alias-border-l1);padding-top:12px}.ia-reason{white-space:pre-wrap;overflow-wrap:anywhere}.ia-pager{display:flex;align-items:center;justify-content:space-between;gap:8px}`;
const time = (value?: string) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚未决定';
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
function Json({ value }: { value: unknown }) { return <pre className="ia-json">{JSON.stringify(value, null, 2)}</pre>; }

/** Human decisions are sent only to the authenticated HTTP surface. */
export function InterceptionTab(props: TabComponentProps): React.ReactNode {
  const id = React.useId();
  const [view, setView] = React.useState<View>('pending'), [taskId, setTaskId] = React.useState(''), [page, setPage] = React.useState(0);
  const [records, setRecords] = React.useState<RecordPage>({ total: 0, items: [] }), [rules, setRules] = React.useState<Rule[]>([]), [settings, setSettings] = React.useState<Settings>();
  const [selected, setSelected] = React.useState(''), [detail, setDetail] = React.useState<InterceptRecord>(), [execution, setExecution] = React.useState<Execution>();
  const [editing, setEditing] = React.useState<Rule | 'new'>(), [deleteId, setDeleteId] = React.useState('');
  const [loaded, setLoaded] = React.useState(false), [loadError, setLoadError] = React.useState(''), [error, setError] = React.useState(''), [notice, setNotice] = React.useState(''), [busy, setBusy] = React.useState(false);
  const sequence = React.useRef(0), busyRef = React.useRef(false), alive = React.useRef(true);
  const selectedRef = React.useRef(selected); selectedRef.current = selected;
  React.useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const refresh = React.useCallback(async (signal?: AbortSignal) => {
    if (busyRef.current) return;
    const current = ++sequence.current;
    try {
      if (view === 'pending' || view === 'history') {
        const [rows, record] = await Promise.all([request<RecordPage>(listPath(view, taskId, page), { signal }), selected ? request<InterceptRecord>(`records/${encodeURIComponent(selected)}`, { signal }) : undefined]);
        if (signal?.aborted || !alive.current || current !== sequence.current) return;
        setRecords(rows); setDetail(record);
        if (page > 0 && page * 30 >= rows.total) setPage(Math.max(0, Math.ceil(rows.total / 30) - 1));
        if (record && execution) setExecution(previous => previous ? { ...previous, execution: record.execution } : previous);
      } else if (view === 'rules') {
        const rows = await request<Rule[]>('rules', { signal });
        if (signal?.aborted || !alive.current || current !== sequence.current) return;
        setRules(rows);
      } else {
        const value = await request<Settings>('settings', { signal });
        if (signal?.aborted || !alive.current || current !== sequence.current) return;
        setSettings(value);
      }
      setLoaded(true); setLoadError('');
    } catch (failure) { if (!signal?.aborted && alive.current && current === sequence.current) setLoadError(errorText(failure)); }
  }, [view, taskId, page, selected, Boolean(execution)]);
  const latestRefresh = React.useRef(refresh); latestRefresh.current = refresh;
  React.useEffect(() => {
    if (props.visible === false) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const poll = async () => { await refresh(controller.signal); if (!controller.signal.aborted && (view === 'pending' || view === 'history')) timer = setTimeout(() => { void poll(); }, 2000); };
    void poll(); return () => { controller.abort(); clearTimeout(timer); };
  }, [refresh, props.visible]);
  async function mutate(path: string, method: 'POST' | 'PUT' | 'DELETE', body: unknown, message: string): Promise<boolean> {
    if (busyRef.current) return false;
    busyRef.current = true; ++sequence.current; setBusy(true); setError(''); setNotice('');
    let success = false;
    try { await request(path, { method, body }); if (alive.current) setNotice(message); success = true; }
    catch (failure) { if (alive.current) setError(errorText(failure)); }
    finally { busyRef.current = false; if (alive.current) { setBusy(false); await latestRefresh.current(); } }
    return success;
  }
  function changeView(value: string) {
    if (busyRef.current || value === view) return;
    ++sequence.current; setView(value as View); setPage(0); setLoaded(false); setError(''); setNotice(''); setEditing(undefined); setDeleteId('');
    if (value === 'settings') setSettings(undefined);
  }
  async function openExecution(record: InterceptRecord) {
    setError('');
    try { const result = await request<Execution>(`records/${encodeURIComponent(record.id)}/execution`); if (alive.current && selectedRef.current === record.id) setExecution(result); }
    catch (failure) { if (alive.current && selectedRef.current === record.id) setError(errorText(failure)); }
  }
  return <section className="tw-root" aria-label="人工审批工作台"><style>{styles}</style>
    <header className="tw-top"><h2>工具审批</h2><Button size="sm" disabled={busy} onClick={() => { void refresh(); }}>刷新</Button></header>
    <div className="tw-toolbar"><SegmentedTabs label="审批视图" value={view} onChange={changeView} items={[
      { value: 'pending', label: '待审批', id: `${id}-pending`, panelId: `${id}-pending-panel` },
      { value: 'history', label: '历史', id: `${id}-history`, panelId: `${id}-history-panel` },
      { value: 'rules', label: '规则', id: `${id}-rules`, panelId: `${id}-rules-panel` },
      { value: 'settings', label: '设置', id: `${id}-settings`, panelId: `${id}-settings-panel` },
    ]} /></div>
    {loadError && <div className="tw-notice" role="alert">同步失败：{loadError}。保留已加载数据。</div>}{error && <div className="tw-notice" role="alert">{error}</div>}{notice && <div className="tw-notice" role="status">{notice}</div>}
    <div className="tw-scroll tw-stack" role="tabpanel" id={`${id}-${view}-panel`} aria-labelledby={`${id}-${view}`}>
      {!loaded && !loadError && <div role="status">正在加载审批数据…</div>}
      {(view === 'pending' || view === 'history') && <>
        <Input aria-label="按任务 ID 筛选审批" placeholder="按任务 ID 筛选" value={taskId} onChange={event => { setTaskId(event.target.value); setPage(0); setSelected(''); setDetail(undefined); setExecution(undefined); }} />
        <p className="tw-muted">{view === 'pending' ? '待人工决定' : '全部审批记录'} · {records.total} 条</p>
        {loaded && records.items.length === 0 && <p className="tw-empty">{view === 'pending' ? '当前没有待处理的审批。' : '没有匹配的审批记录。'}</p>}
        {records.items.map(record => <div key={record.id} className={`tw-card ${selected === record.id ? 'tw-card-selected' : ''}`}>
          <Button size="sm" className="ia-record-button" onClick={() => { setSelected(record.id); setDetail(undefined); setExecution(undefined); }} aria-label={`查看审批 ${record.toolName} ${record.id}`}>{record.toolName} · {labels[record.status]}</Button>
          <p className="tw-small tw-muted">{record.taskId ?? '未关联任务'} · {time(record.createdAt)}</p><p className="ia-reason">{record.reason}</p>
        </div>)}
        {records.total > 30 && <nav className="ia-pager" aria-label="审批分页"><Button size="sm" disabled={page === 0} onClick={() => setPage(value => value - 1)}>上一页</Button><span>{page + 1} / {Math.ceil(records.total / 30)} 页</span><Button size="sm" disabled={(page + 1) * 30 >= records.total} onClick={() => setPage(value => value + 1)}>下一页</Button></nav>}
        {detail && detail.id === selected && <section className="ia-detail tw-stack" aria-label="审批详情">
          <div className="tw-card-head"><h3>{detail.toolName}</h3><Tag tone={detail.status === 'pending' ? 'warning' : detail.effectiveAction === 'allow' ? 'success' : 'danger'}>{labels[detail.status]}</Tag></div>
          <dl className="tw-kv"><dt>审批 ID</dt><dd>{detail.id}</dd><dt>任务</dt><dd>{detail.taskId ?? '未关联任务'}</dd><dt>判定来源</dt><dd>{sourceLabels[detail.decisionSource]}</dd><dt>匹配规则</dt><dd>{detail.ruleName ?? detail.ruleId ?? '无'}</dd><dt>决定时间</dt><dd>{time(detail.decidedAt)}</dd></dl>
          <div><h3>判定理由</h3><p className="ia-reason">{detail.reason}</p>{detail.decisionReason && <p className="ia-reason">{detail.decisionReason}</p>}</div>
          <div><h3>完整工具参数</h3><Json value={detail.toolInput} /></div>
          {detail.status === 'pending' && <div className="tw-actions"><Button size="sm" variant="primary" disabled={busy} onClick={() => { void mutate(`records/${encodeURIComponent(detail.id)}/decide`, 'POST', { allowed: true, ...(detail.taskId ? { taskId: detail.taskId } : {}) }, '已允许这条工具调用'); }}>允许本次调用</Button><Button size="sm" disabled={busy} onClick={() => { void mutate(`records/${encodeURIComponent(detail.id)}/decide`, 'POST', { allowed: false, ...(detail.taskId ? { taskId: detail.taskId } : {}) }, '已拒绝这条工具调用'); }}>拒绝本次调用</Button></div>}
          <div><h3>调用结果 · {executionLabels[detail.execution.status]}</h3>{detail.execution.output !== undefined && <pre className="ia-json">{detail.execution.output}</pre>}{detail.execution.truncated && <p className="tw-muted">保存的结果已截断，可前往会话查看原始调用。</p>}</div>
          <div className="tw-actions"><Button size="sm" onClick={() => { void openExecution(detail); }}>查看执行关联</Button>{execution && props.onSubagentJump && <Button size="sm" onClick={() => props.onSubagentJump?.(execution.sessionId)}>打开调用会话</Button>}</div>
          {execution && <Json value={execution} />}
          <details><summary>完整判定记录与模型输入</summary><Json value={detail} /></details>
        </section>}
      </>}
      {view === 'rules' && (editing ? <RuleForm key={editing === 'new' ? 'new' : editing.id} value={editing === 'new' ? undefined : editing} onCancel={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); setNotice('规则已保存'); void refresh(); }} /> : <>
        <Button size="sm" onClick={() => setEditing('new')}>新建规则</Button><p className="tw-muted">按优先级降序执行；同优先级保持创建顺序。</p>
        {loaded && rules.length === 0 && <p>尚无拦截规则。</p>}{rules.map(rule => <article key={rule.id} className="tw-card tw-stack" aria-label={`规则 ${rule.name}`}>
          <div className="tw-card-head"><h3>{rule.name}</h3><Tag tone={rule.enabled ? 'info' : 'outline'}>{rule.enabled ? '已启用' : '已停用'}</Tag></div>
          <p>{rule.taskId ?? '所有任务'} · 优先级 {rule.priority} · {rule.matchTarget === 'tool_name' ? '工具名称' : '工具参数'} / {rule.matchType === 'regex' ? '正则表达式' : '包含字符串'} → {actionLabels[rule.action]}</p><pre className="ia-json">{rule.pattern}</pre><p className="ia-reason">{rule.message}</p>
          <div className="tw-actions"><Button size="sm" disabled={busy} onClick={() => setEditing(rule)}>编辑规则</Button><Button size="sm" disabled={busy} onClick={() => { void mutate(`rules/${encodeURIComponent(rule.id)}/toggle`, 'POST', { enabled: !rule.enabled }, rule.enabled ? '规则已停用' : '规则已启用'); }}>{rule.enabled ? '停用规则' : '启用规则'}</Button><Button size="sm" disabled={busy} onClick={() => setDeleteId(rule.id)}>删除规则</Button></div>
          {deleteId === rule.id && <div className="tw-actions"><span>删除「{rule.name}」？</span><Button size="sm" disabled={busy} onClick={() => { void mutate(`rules/${encodeURIComponent(rule.id)}`, 'DELETE', {}, '规则已删除').then(success => { if (success) setDeleteId(''); }); }}>确认删除规则</Button><Button size="sm" onClick={() => setDeleteId('')}>取消删除</Button></div>}
        </article>)}
      </>)}
      {view === 'settings' && settings && <JudgeSettings initial={settings} />}
    </div>
  </section>;
}
