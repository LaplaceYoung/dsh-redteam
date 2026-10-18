import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from 'react';
import { Button, Input, Tag } from '@deepseek-ai/dsh-client-ui-primitives';
import { apiUrl, requestJson, errorMessage, Field, Notice, JsonDetails } from '../management-ui/shared.js';
import { ConfirmDelete, conversationPath, dateTime, jsonBody, useOperation } from './client-common.js';
export function SideQuestionsPanel({ parentKind, parentId, visible }) {
    const [explorationId, setExplorationId] = React.useState(''), [intentId, setIntentId] = React.useState('');
    const [scope, setScope] = React.useState({ exploration: '', intent: '' });
    return _jsxs("div", { className: "tw-stack", children: [parentKind === 'task' && _jsxs("form", { className: "tw-card tw-stack", onSubmit: event => { event.preventDefault(); setScope({ exploration: explorationId.trim(), intent: intentId.trim() }); }, children: [_jsx("h3", { children: "\u4EFB\u52A1\u65C1\u8DEF\u4E0A\u4E0B\u6587" }), _jsxs("div", { className: "tw-grid", children: [_jsx(Field, { label: "\u63A2\u7D22 ID\uFF08\u53EF\u9009\uFF09", children: _jsx(Input, { value: explorationId, onChange: event => setExplorationId(event.target.value) }) }), _jsx(Field, { label: "\u610F\u56FE ID\uFF08\u53EF\u9009\uFF09", children: _jsx(Input, { value: intentId, onChange: event => setIntentId(event.target.value) }) })] }), _jsx(Button, { size: "sm", type: "submit", children: "\u4F7F\u7528\u6B64\u4E0A\u4E0B\u6587" })] }), _jsx(SideSession, { parentKind: parentKind, parentId: parentId, scope: scope, visible: visible }, `${parentKind}:${parentId}:${scope.exploration}:${scope.intent}`)] });
}
function SideSession({ parentKind, parentId, scope, visible }) {
    const [data, setData] = React.useState(), [question, setQuestion] = React.useState('');
    const [revision, setRevision] = React.useState(0), [loadError, setLoadError] = React.useState(''), [streamError, setStreamError] = React.useState('');
    const [loading, setLoading] = React.useState(false), [activeId, setActiveId] = React.useState('');
    const operation = useOperation();
    const query = React.useMemo(() => ({ parent_kind: parentKind, parent_id: parentId, exploration_id: scope.exploration || undefined, intent_id: scope.intent || undefined }), [parentKind, parentId, scope.exploration, scope.intent]);
    React.useEffect(() => {
        if (!visible)
            return;
        const controller = new AbortController();
        setLoading(true);
        void requestJson(apiUrl(`${conversationPath}/side-questions`, query), { signal: controller.signal })
            .then(result => { if (!controller.signal.aborted) {
            setData(result);
            setActiveId(result.current?.id ?? '');
            setLoadError('');
        } })
            .catch(failure => { if (!controller.signal.aborted)
            setLoadError(errorMessage(failure)); })
            .finally(() => { if (!controller.signal.aborted)
            setLoading(false); });
        return () => controller.abort();
    }, [query, revision, visible]);
    React.useEffect(() => {
        if (!visible || !activeId)
            return;
        const events = new EventSource(apiUrl(`${conversationPath}/side-requests/${encodeURIComponent(activeId)}/events`).href, { withCredentials: true });
        setStreamError('');
        const onExchange = (event) => {
            try {
                const exchange = JSON.parse(event.data);
                if (exchange.id !== activeId || typeof exchange.sequence !== 'number' || typeof exchange.answer !== 'string')
                    throw new Error('旁路事件格式无效');
                setData(current => {
                    const old = current?.items.find(item => item.id === exchange.id);
                    if (old && old.sequence > exchange.sequence)
                        return current;
                    const items = [exchange, ...(current?.items.filter(item => item.id !== exchange.id) ?? [])].sort((a, b) => b.ordinal - a.ordinal);
                    return { ...current, items, current: exchange.status === 'running' ? exchange : undefined };
                });
                if (exchange.status !== 'running') {
                    events.close();
                    setActiveId('');
                }
            }
            catch (failure) {
                events.close();
                setStreamError(errorMessage(failure));
            }
        };
        events.addEventListener('exchange', onExchange);
        events.onerror = () => { events.close(); setStreamError('旁路事件连接已中断。点击刷新恢复当前结果，已提交的问题不会重复发送。'); };
        return () => events.close();
    }, [activeId, visible]);
    const running = !!activeId;
    return _jsxs("section", { className: "tw-stack", "aria-label": "\u65C1\u8DEF\u63D0\u95EE", children: [_jsxs("div", { className: "tw-card-head", children: [_jsxs("div", { className: "tw-grow", children: [_jsx("h3", { children: "\u65C1\u8DEF\u63D0\u95EE" }), _jsx("p", { className: "tw-muted", children: "\u57FA\u4E8E\u4E3B\u4F1A\u8BDD\u6700\u8FD1\u7684\u6A21\u578B\u4E0A\u4E0B\u6587\u56DE\u7B54\uFF0C\u4E0D\u5411\u4E3B Agent \u8FFD\u52A0\u6307\u4EE4\u3002" })] }), _jsx(Button, { size: "sm", disabled: loading || operation.busy, onClick: () => setRevision(value => value + 1), children: "\u5237\u65B0\u65C1\u8DEF" })] }), [loadError, streamError, operation.error].filter(Boolean).map((error, index) => _jsx(Notice, { tone: "error", children: error }, index)), operation.notice && _jsx(Notice, { tone: "success", children: operation.notice }), loading && _jsx("p", { role: "status", children: "\u6B63\u5728\u8BFB\u53D6\u65C1\u8DEF\u5386\u53F2\u2026" }), data?.snapshot ? _jsxs(Notice, { children: [data.snapshot.provider, " / ", data.snapshot.model, " \u00B7 \u4E0A\u4E0B\u6587\u65F6\u95F4 ", dateTime(data.snapshot.capturedAt), !data.snapshot.available && ` · ${data.snapshot.reason ?? '上下文暂不可用'}`] }) : !loading && _jsx(Notice, { children: "\u5C1A\u672A\u6355\u83B7\u6B64\u4E0A\u4E0B\u6587\u3002\u5148\u8FD0\u884C\u5BF9\u5E94\u4E3B\u4F1A\u8BDD\uFF0C\u518D\u5237\u65B0\u65C1\u8DEF\u3002" }), _jsxs("form", { className: "tw-stack", onSubmit: event => {
                    event.preventDefault();
                    void operation.run(async () => {
                        const exchange = await requestJson(`${conversationPath}/side-questions`, jsonBody({ ...query, question, client_request_id: crypto.randomUUID() }));
                        setQuestion('');
                        setData(current => ({ ...current, items: [exchange, ...(current?.items.filter(item => item.id !== exchange.id) ?? [])], current: exchange.status === 'running' ? exchange : undefined }));
                        setActiveId(exchange.status === 'running' ? exchange.id : '');
                    });
                }, children: [_jsx(Field, { label: "\u65C1\u8DEF\u95EE\u9898", children: _jsx("textarea", { "aria-label": "\u65C1\u8DEF\u95EE\u9898", rows: 4, maxLength: 4000, value: question, disabled: operation.busy, onChange: event => setQuestion(event.target.value), placeholder: "\u8BE2\u95EE\u5F53\u524D\u53D1\u73B0\u3001\u8FDB\u5C55\u6216\u51B3\u7B56\u4F9D\u636E" }) }), _jsxs("div", { className: "tw-actions", children: [_jsx(Button, { size: "sm", type: "submit", variant: "primary", disabled: !question.trim() || running || operation.busy || !data?.snapshot?.available, children: "\u63D0\u4EA4\u65C1\u8DEF\u95EE\u9898" }), running && _jsx(Button, { size: "sm", type: "button", disabled: operation.busy, onClick: () => { void operation.run(async () => { const exchange = await requestJson(`${conversationPath}/side-requests/${encodeURIComponent(activeId)}/cancel`, { method: 'POST' }); setData(current => ({ ...current, items: [exchange, ...(current?.items.filter(item => item.id !== exchange.id) ?? [])] })); setActiveId(''); }, '旁路请求已取消'); }, children: "\u53D6\u6D88\u65C1\u8DEF\u751F\u6210" }), _jsx(ConfirmDelete, { label: "\u6E05\u7A7A\u65C1\u8DEF\u5386\u53F2", description: "\u5C06\u6E05\u7A7A\u6B64\u7236\u4F1A\u8BDD\u4E0B\u7684\u65C1\u8DEF\u95EE\u9898\u548C\u56DE\u7B54\uFF1B\u6B63\u5728\u8FD0\u884C\u7684\u65C1\u8DEF\u4F1A\u88AB\u53D6\u6D88\u3002", disabled: operation.busy || !data?.items.length, onConfirm: () => operation.run(async () => { await requestJson(apiUrl(`${conversationPath}/side-questions`, query), { method: 'DELETE' }); setActiveId(''); setData(undefined); setRevision(value => value + 1); }, '旁路历史已清空') })] })] }), _jsx("div", { className: "mg-list", "aria-live": "polite", children: data?.items.map(exchange => _jsxs("article", { className: "tw-card tw-stack", children: [_jsxs("div", { className: "tw-card-head", children: [_jsx("strong", { className: "tw-title", children: exchange.question }), _jsx(Tag, { tone: exchange.status === 'failed' ? 'danger' : exchange.status === 'running' ? 'info' : 'outline', children: ({ running: '生成中', completed: '已完成', cancelled: '已取消', failed: '失败', interrupted: '已中断' })[exchange.status] })] }), _jsx("p", { className: "tw-description", children: exchange.answer || (exchange.status === 'running' ? '等待模型回答…' : '没有回答内容') }), exchange.error && _jsx(Notice, { tone: "error", children: exchange.error }), _jsxs("div", { className: "mg-meta", children: [_jsx("span", { children: dateTime(exchange.createdAt) }), _jsxs("span", { children: [exchange.model.provider, " / ", exchange.model.model] }), _jsxs("span", { children: ["\u8F93\u5165 ", exchange.usage.inputTokens, " / \u8F93\u51FA ", exchange.usage.outputTokens, " tokens"] })] }), exchange.context && _jsx(JsonDetails, { summary: "\u4E0A\u4E0B\u6587\u7528\u91CF\u8BE6\u60C5", value: exchange.context })] }, exchange.id)) }), data?.nextCursor !== undefined && _jsx(Button, { size: "sm", disabled: operation.busy, onClick: () => { void operation.run(async () => { const older = await requestJson(apiUrl(`${conversationPath}/side-questions`, { ...query, before: data.nextCursor })); setData(current => ({ ...current, items: [...(current?.items ?? []), ...older.items.filter(row => !current?.items.some(item => item.id === row.id))], nextCursor: older.nextCursor })); }); }, children: "\u52A0\u8F7D\u66F4\u65E9\u65C1\u8DEF\u95EE\u9898" })] });
}
