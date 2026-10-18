import React from 'react';
import { Button, Input, SegmentedTabs, Tag } from '@deepseek-ai/dsh-client-ui-primitives';
import type { TabComponentProps } from 'dsh-better-sidebar/client/service';
import { apiUrl, errorMessage, Field, ManagementPage, requestJson } from '../management-ui/shared.js';
import { WorkspaceFilesPanel } from './client-files.js';
import { SideQuestionsPanel } from './client-side.js';
import { ConfirmDelete, conversationPath, conversationUrl, dateTime, jsonBody, useOperation } from './client-common.js';

type Conversation = { id: string; sessionId: string; agentKey: string; title: string; profileId: string | null; taskId?: string; pinnedAt: string | null; updatedAt: string; };
type MessagePage = { events: Array<{ type?: string; text?: string; content?: unknown; [key: string]: unknown }>; cursor: number; hasMore: boolean };
type View = 'conversations' | 'files' | 'side';

export function ConversationWorkspaceTab({ visible, scope }: TabComponentProps): React.ReactNode {
  const [view, setView] = React.useState<View>('conversations');
  const [rows, setRows] = React.useState<Conversation[]>([]), [selected, setSelected] = React.useState('');
  const [error, setError] = React.useState(''), [notice, setNotice] = React.useState(''), [loading, setLoading] = React.useState(false);
  const [taskId, setTaskId] = React.useState(''), [agentKey, setAgentKey] = React.useState('mainagent');
  const [title, setTitle] = React.useState(''), [message, setMessage] = React.useState(''), [messages, setMessages] = React.useState<MessagePage>();
  const operation = useOperation();
  const current = rows.find(row => row.id === selected);
  const refresh = React.useCallback(async () => { setLoading(true); try { setRows(await requestJson<Conversation[]>(`${conversationPath}/conversations`)); setError(''); } catch (failure) { setError(errorMessage(failure)); } finally { setLoading(false); } }, []);
  React.useEffect(() => { if (visible) void refresh(); }, [refresh, visible]);
  React.useEffect(() => { if (!current || view !== 'conversations') return; const controller = new AbortController(); void requestJson<MessagePage>(apiUrl(conversationUrl(current.id, 'messages'), { cursor: 0, limit: 200 }), { signal: controller.signal }).then(setMessages).catch(failure => { if (!controller.signal.aborted) setError(errorMessage(failure)); }); return () => controller.abort(); }, [current?.id, view]);
  async function create(event: React.FormEvent) { event.preventDefault(); await operation.run(async () => { const row = await requestJson<Conversation>(`${conversationPath}/conversations`, jsonBody({ agent_key: agentKey.trim(), title: title.trim() || undefined, task_id: taskId.trim() || undefined })); setRows(current => [row, ...current]); setSelected(row.id); setTitle(''); setNotice('会话已创建'); }, '会话已创建'); }
  async function send(event: React.FormEvent) { event.preventDefault(); if (!current || !message.trim()) return; await operation.run(async () => { await requestJson(conversationUrl(current.id, 'send'), jsonBody({ message })); setMessage(''); const page = await requestJson<MessagePage>(apiUrl(conversationUrl(current.id, 'messages'), { cursor: 0, limit: 200 })); setMessages(page); }, '消息已发送'); }
  return <ManagementPage title="会话、文件与旁路" description={scope?.sessionId ? `当前 DSH 会话：${scope.sessionId}` : '管理独立会话和任务主对话。'} loading={loading || operation.busy} error={error || operation.error} notice={notice || operation.notice}
    actions={<Button size="sm" disabled={loading || operation.busy} onClick={() => void refresh()}>刷新</Button>}
    toolbar={<SegmentedTabs label="会话工作区视图" value={view} onChange={value => setView(value as View)} items={[{ value: 'conversations', label: '会话', id: 'conv-list', panelId: 'conv-list-panel' }, { value: 'files', label: '文件', id: 'conv-files', panelId: 'conv-files-panel' }, { value: 'side', label: '旁路问题', id: 'conv-side', panelId: 'conv-side-panel' }]} />}>
    {view === 'files' ? <WorkspaceFilesPanel visible={visible} initialPath={current?.taskId ? `tasks/${current.taskId}` : ''} /> : view === 'side' ? <SideQuestionsPanel parentKind={current?.taskId ? 'task' : 'conversation'} parentId={current?.taskId || current?.id || scope?.sessionId || ''} visible={visible && Boolean(current || scope?.sessionId)} /> : <>
      <form className="tw-card tw-stack" onSubmit={create}><h3>新建独立会话</h3><div className="tw-grid"><Field label="Agent 标识"><Input aria-label="Agent 标识" value={agentKey} onChange={event => setAgentKey(event.target.value)} /></Field><Field label="任务 ID（可选）"><Input aria-label="任务 ID（可选）" value={taskId} onChange={event => setTaskId(event.target.value)} /></Field><Field label="标题"><Input aria-label="会话标题" value={title} onChange={event => setTitle(event.target.value)} /></Field></div><Button type="submit" size="sm" variant="primary" disabled={operation.busy || !agentKey.trim()}>创建会话</Button></form>
      {!rows.length ? <p className="tw-muted">暂无会话。可创建独立会话，或从任务详情创建主会话。</p> : <div className="mg-list">{rows.map(row => <article className={`tw-card tw-stack${selected === row.id ? ' tw-card-selected' : ''}`} key={row.id}><div className="tw-card-head"><Button size="sm" className="tw-task-button" onClick={() => setSelected(row.id)}>{row.title}</Button><Tag tone="outline">{row.taskId ? '任务' : '独立'}</Tag></div><div className="mg-meta"><span>{row.agentKey}</span><span>{dateTime(row.updatedAt)}</span>{row.profileId && <span>profile {row.profileId}</span>}</div>{selected === row.id && <div className="tw-stack"><div className="tw-actions"><Button size="sm" disabled={operation.busy} onClick={() => void operation.run(async () => { await requestJson(conversationUrl(row.id, 'stop'), { method: 'POST', body: '{}' }); }, '已请求停止')}>停止运行</Button><ConfirmDelete label="删除会话" description="会话记录、旁路记录和关联运行将被删除。" disabled={operation.busy} onConfirm={() => operation.run(async () => { await requestJson(conversationUrl(row.id), { method: 'DELETE' }); setRows(current => current.filter(item => item.id !== row.id)); setSelected(''); }, '会话已删除')} /></div><div className="tw-record">{messages?.events.map((event, index) => <div className="tw-record" key={index}><div className="mg-meta">{String(event.type || 'event')}</div><p className="tw-description">{typeof event.text === 'string' ? event.text : JSON.stringify(event.content ?? event)}</p></div>)}</div><form className="tw-inline" onSubmit={send}><Input aria-label="发送消息" value={message} onChange={event => setMessage(event.target.value)} placeholder="输入消息" /><Button size="sm" type="submit" variant="primary" disabled={operation.busy || !message.trim()}>发送</Button></form><small className="tw-muted">真实 DSH session：{row.sessionId}</small></div>}</article>)}</div>}
    </>}
  </ManagementPage>;
}
