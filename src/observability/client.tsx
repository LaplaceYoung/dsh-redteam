import React from 'react';
import { Button, Checkbox, Input, SegmentedTabs, Tag } from '@deepseek-ai/dsh-client-ui-primitives';
import type { TabComponentProps } from 'dsh-better-sidebar/client/service';
import { errorMessage, JsonDetails, ManagementPage, requestJson } from '../management-ui/shared.js';

const root = '/api/redteam/observability';
type View = 'records' | 'commands' | 'usage' | 'tools';
type RecordRow = { id: string; taskId?: string; provider?: string; model?: string; profileId?: string; status: string; startedAt: string; durationMs?: number; usage?: Record<string, number> };
type Page<T> = { items: T[]; total: number; hasMore?: boolean };

export function ObservabilityTab({ visible }: TabComponentProps): React.ReactNode {
  const [view, setView] = React.useState<View>('records');
  const [enabled, setEnabled] = React.useState(false), [records, setRecords] = React.useState<Page<RecordRow>>({ items: [], total: 0 });
  const [data, setData] = React.useState<unknown>(), [error, setError] = React.useState(''), [notice, setNotice] = React.useState('');
  const [busy, setBusy] = React.useState(false), [taskId, setTaskId] = React.useState('');
  const refresh = React.useCallback(async () => {
    setBusy(true); setError('');
    try {
      const settings = await requestJson<{ enabled: boolean }>(`${root}/settings`); setEnabled(settings.enabled);
      if (view === 'records') setRecords(await requestJson<Page<RecordRow>>(`${root}/records?limit=50&offset=0${taskId ? `&task_id=${encodeURIComponent(taskId)}` : ''}`));
      else if (view === 'commands') setData(await requestJson(`${root}/commands?limit=100&offset=0${taskId ? `&task_id=${encodeURIComponent(taskId)}` : ''}`));
      else if (view === 'usage') setData(await requestJson(`${root}/usage?group=model`));
      else setData(await requestJson(`${root}/tool-stats`));
    } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  }, [taskId, view]);
  React.useEffect(() => { if (visible) void refresh(); }, [refresh, visible]);
  async function toggle(value: boolean) { setBusy(true); setError(''); try { await requestJson(`${root}/settings`, { method: 'PUT', body: JSON.stringify({ enabled: value }) }); setEnabled(value); setNotice(value ? '已开启调用录制' : '已关闭调用录制'); } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); } }
  async function deleteTaskRecords() { if (!taskId.trim() || !window.confirm('删除该任务的调用记录？')) return; setBusy(true); try { await requestJson(`${root}/records?task_id=${encodeURIComponent(taskId)}`, { method: 'DELETE' }); setNotice('已删除该任务的调试记录'); await refresh(); } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); } }
  const tabs = [{ value: 'records', label: 'LLM 记录', id: 'obs-records', panelId: 'obs-records-panel' }, { value: 'commands', label: '命令', id: 'obs-commands', panelId: 'obs-commands-panel' }, { value: 'usage', label: '用量', id: 'obs-usage', panelId: 'obs-usage-panel' }, { value: 'tools', label: '工具统计', id: 'obs-tools', panelId: 'obs-tools-panel' }] as const;
  return <ManagementPage title="调用记录与用量" description="查看规范化模型调用、命令结果和 token 汇总；原始传输仅在宿主 dispatcher 可用时提供。" loading={busy} error={error} notice={notice}
    actions={<Button size="sm" disabled={busy} onClick={() => void refresh()}>刷新</Button>}
    toolbar={<><SegmentedTabs label="观测视图" value={view} onChange={value => setView(value as View)} items={tabs} /><Checkbox label="开启 LLM 录制" checked={enabled} disabled={busy} onChange={value => void toggle(value)} /><label className="tw-inline"><span className="tw-muted">任务筛选</span><Input aria-label="任务筛选" value={taskId} onChange={event => setTaskId(event.target.value)} placeholder="task id" disabled={busy} /></label>{view === 'records' && <Button size="sm" disabled={busy || !taskId.trim()} onClick={() => void deleteTaskRecords()}>删除任务记录</Button>}</>}> 
    {view === 'records' ? <div className="mg-list">{records.items.length ? records.items.map(row => <article className="tw-card tw-stack" key={row.id}><div className="tw-card-head"><strong>{row.model || '未知模型'}</strong><Tag tone={row.status === 'ok' ? 'success' : 'danger'}>{row.status}</Tag></div><div className="mg-meta"><span>{row.taskId || '无任务'}</span><span>{row.provider || ''}</span><span>{new Date(row.startedAt).toLocaleString('zh-CN')}</span><span>{row.durationMs ?? 0} ms</span></div>{row.usage && <JsonDetails value={row.usage} summary="Token 用量" />}</article>) : <p className="tw-muted">暂无 LLM 记录。</p>}</div>
      : <JsonDetails value={data ?? []} open summary={view === 'commands' ? '命令记录' : view === 'usage' ? '模型/Token 汇总' : '工具统计'} />}
  </ManagementPage>;
}
