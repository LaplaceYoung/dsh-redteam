import React from 'react';
import { Button, Input, Tag } from '@deepseek-ai/dsh-client-ui-primitives';
import { apiUrl, requestJson, errorMessage, Field, Notice, JsonDetails } from '../management-ui/shared.js';
import type { SideExchange } from './side-questions.js';
import { ConfirmDelete, conversationPath, dateTime, jsonBody, useOperation } from './client-common.js';

interface SidePage { items: SideExchange[]; current?: SideExchange; nextCursor?: number; snapshot?: { capturedAt: string; provider: string; model: string; available: boolean; reason?: string } }
export function SideQuestionsPanel({ parentKind, parentId, visible }: { parentKind: 'task' | 'conversation'; parentId: string; visible: boolean }) {
  const [explorationId, setExplorationId] = React.useState(''), [intentId, setIntentId] = React.useState('');
  const [scope, setScope] = React.useState({ exploration: '', intent: '' });
  return <div className="tw-stack">
    {parentKind === 'task' && <form className="tw-card tw-stack" onSubmit={event => { event.preventDefault(); setScope({ exploration: explorationId.trim(), intent: intentId.trim() }); }}><h3>任务旁路上下文</h3>
      <div className="tw-grid"><Field label="探索 ID（可选）"><Input value={explorationId} onChange={event => setExplorationId(event.target.value)} /></Field><Field label="意图 ID（可选）"><Input value={intentId} onChange={event => setIntentId(event.target.value)} /></Field></div>
      <Button size="sm" type="submit">使用此上下文</Button></form>}
    <SideSession key={`${parentKind}:${parentId}:${scope.exploration}:${scope.intent}`} parentKind={parentKind} parentId={parentId} scope={scope} visible={visible} />
  </div>;
}
function SideSession({ parentKind, parentId, scope, visible }: { parentKind: 'task' | 'conversation'; parentId: string; scope: { exploration: string; intent: string }; visible: boolean }) {
  const [data, setData] = React.useState<SidePage>(), [question, setQuestion] = React.useState('');
  const [revision, setRevision] = React.useState(0), [loadError, setLoadError] = React.useState(''), [streamError, setStreamError] = React.useState('');
  const [loading, setLoading] = React.useState(false), [activeId, setActiveId] = React.useState('');
  const operation = useOperation();
  const query = React.useMemo(() => ({ parent_kind: parentKind, parent_id: parentId, exploration_id: scope.exploration || undefined, intent_id: scope.intent || undefined }), [parentKind, parentId, scope.exploration, scope.intent]);
  React.useEffect(() => {
    if (!visible) return;
    const controller = new AbortController(); setLoading(true);
    void requestJson<SidePage>(apiUrl(`${conversationPath}/side-questions`, query), { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) { setData(result); setActiveId(result.current?.id ?? ''); setLoadError(''); } })
      .catch(failure => { if (!controller.signal.aborted) setLoadError(errorMessage(failure)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, revision, visible]);
  React.useEffect(() => {
    if (!visible || !activeId) return;
    const events = new EventSource(apiUrl(`${conversationPath}/side-requests/${encodeURIComponent(activeId)}/events`).href, { withCredentials: true });
    setStreamError('');
    const onExchange = (event: MessageEvent<string>) => {
      try {
        const exchange: SideExchange = JSON.parse(event.data);
        if (exchange.id !== activeId || typeof exchange.sequence !== 'number' || typeof exchange.answer !== 'string') throw new Error('旁路事件格式无效');
        setData(current => {
          const old = current?.items.find(item => item.id === exchange.id);
          if (old && old.sequence > exchange.sequence) return current;
          const items = [exchange, ...(current?.items.filter(item => item.id !== exchange.id) ?? [])].sort((a, b) => b.ordinal - a.ordinal);
          return { ...current, items, current: exchange.status === 'running' ? exchange : undefined };
        });
        if (exchange.status !== 'running') { events.close(); setActiveId(''); }
      } catch (failure) { events.close(); setStreamError(errorMessage(failure)); }
    };
    events.addEventListener('exchange', onExchange as EventListener);
    events.onerror = () => { events.close(); setStreamError('旁路事件连接已中断。点击刷新恢复当前结果，已提交的问题不会重复发送。'); };
    return () => events.close();
  }, [activeId, visible]);
  const running = !!activeId;
  return <section className="tw-stack" aria-label="旁路提问">
    <div className="tw-card-head"><div className="tw-grow"><h3>旁路提问</h3><p className="tw-muted">基于主会话最近的模型上下文回答，不向主 Agent 追加指令。</p></div><Button size="sm" disabled={loading || operation.busy} onClick={() => setRevision(value => value + 1)}>刷新旁路</Button></div>
    {[loadError, streamError, operation.error].filter(Boolean).map((error, index) => <Notice tone="error" key={index}>{error}</Notice>)}{operation.notice && <Notice tone="success">{operation.notice}</Notice>}
    {loading && <p role="status">正在读取旁路历史…</p>}
    {data?.snapshot ? <Notice>{data.snapshot.provider} / {data.snapshot.model} · 上下文时间 {dateTime(data.snapshot.capturedAt)}{!data.snapshot.available && ` · ${data.snapshot.reason ?? '上下文暂不可用'}`}</Notice> : !loading && <Notice>尚未捕获此上下文。先运行对应主会话，再刷新旁路。</Notice>}
    <form className="tw-stack" onSubmit={event => { event.preventDefault(); void operation.run(async () => {
      const exchange = await requestJson<SideExchange>(`${conversationPath}/side-questions`, jsonBody({ ...query, question, client_request_id: crypto.randomUUID() }));
      setQuestion(''); setData(current => ({ ...current, items: [exchange, ...(current?.items.filter(item => item.id !== exchange.id) ?? [])], current: exchange.status === 'running' ? exchange : undefined }));
      setActiveId(exchange.status === 'running' ? exchange.id : '');
    }); }}>
      <Field label="旁路问题"><textarea aria-label="旁路问题" rows={4} maxLength={4000} value={question} disabled={operation.busy} onChange={event => setQuestion(event.target.value)} placeholder="询问当前发现、进展或决策依据" /></Field>
      <div className="tw-actions"><Button size="sm" type="submit" variant="primary" disabled={!question.trim() || running || operation.busy || !data?.snapshot?.available}>提交旁路问题</Button>
        {running && <Button size="sm" type="button" disabled={operation.busy} onClick={() => { void operation.run(async () => { const exchange = await requestJson<SideExchange>(`${conversationPath}/side-requests/${encodeURIComponent(activeId)}/cancel`, { method: 'POST' }); setData(current => ({ ...current, items: [exchange, ...(current?.items.filter(item => item.id !== exchange.id) ?? [])] })); setActiveId(''); }, '旁路请求已取消'); }}>取消旁路生成</Button>}
        <ConfirmDelete label="清空旁路历史" description="将清空此父会话下的旁路问题和回答；正在运行的旁路会被取消。" disabled={operation.busy || !data?.items.length} onConfirm={() => operation.run(async () => { await requestJson(apiUrl(`${conversationPath}/side-questions`, query), { method: 'DELETE' }); setActiveId(''); setData(undefined); setRevision(value => value + 1); }, '旁路历史已清空')} />
      </div>
    </form>
    <div className="mg-list" aria-live="polite">{data?.items.map(exchange => <article key={exchange.id} className="tw-card tw-stack"><div className="tw-card-head"><strong className="tw-title">{exchange.question}</strong><Tag tone={exchange.status === 'failed' ? 'danger' : exchange.status === 'running' ? 'info' : 'outline'}>{({ running: '生成中', completed: '已完成', cancelled: '已取消', failed: '失败', interrupted: '已中断' })[exchange.status]}</Tag></div>
      <p className="tw-description">{exchange.answer || (exchange.status === 'running' ? '等待模型回答…' : '没有回答内容')}</p>{exchange.error && <Notice tone="error">{exchange.error}</Notice>}
      <div className="mg-meta"><span>{dateTime(exchange.createdAt)}</span><span>{exchange.model.provider} / {exchange.model.model}</span><span>输入 {exchange.usage.inputTokens} / 输出 {exchange.usage.outputTokens} tokens</span></div>{exchange.context && <JsonDetails summary="上下文用量详情" value={exchange.context} />}
    </article>)}</div>
    {data?.nextCursor !== undefined && <Button size="sm" disabled={operation.busy} onClick={() => { void operation.run(async () => { const older = await requestJson<SidePage>(apiUrl(`${conversationPath}/side-questions`, { ...query, before: data.nextCursor })); setData(current => ({ ...current, items: [...(current?.items ?? []), ...older.items.filter(row => !current?.items.some(item => item.id === row.id))], nextCursor: older.nextCursor })); }); }}>加载更早旁路问题</Button>}
  </section>;
}
