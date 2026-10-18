import { directSourceTasks, TaskManagementError } from '../task-management/index.js';
const terminalSourceStates = new Set(['done', 'blocked', 'exhausted', 'stopped']);
const localIndexStates = new Set(['running', 'done', 'blocked', 'exhausted', 'stopped', 'failed']);
function record(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}
function string(value) { return typeof value === 'string' ? value : ''; }
function provenance(taskId, owner) { return owner === taskId ? {} : { source_task_id: owner, inherited: true }; }
function limit(value, fallback) {
    if (value !== undefined && !Number.isSafeInteger(value))
        throw new TaskManagementError('invalid', 'limit must be an integer');
    return value !== undefined && value > 0 ? value : fallback;
}
function firstLine(value) {
    const chars = Array.from(value.trim().split('\n', 1)[0]);
    return chars.length > 100 ? chars.slice(0, 100).join('') + '…' : chars.join('');
}
function kind(trace) {
    const explicit = string(trace.data?.activityKind) || string(trace.data?.kind);
    if (explicit)
        return explicit;
    switch (trace.data?.event) {
        case 'tool/call': return 'tool_use';
        case 'tool/result': return 'tool_result';
        case 'turn/end': return 'result';
        default: return trace.kind;
    }
}
function visible(trace) { return !['thinking', 'usage'].includes(kind(trace)); }
function textContent(value) {
    if (typeof value === 'string')
        return value;
    if (!Array.isArray(value))
        return '';
    return value.flatMap(block => { const item = record(block); return item?.type === 'text' && typeof item.text === 'string' ? [item.text] : []; }).join('\n');
}
function detail(trace, intent) {
    const data = trace.data;
    if (!data)
        return '';
    if (typeof data.detail === 'string')
        return data.detail;
    const payload = record(data.payload);
    if (data.event === 'tool/call')
        return string(payload?.arguments);
    if (data.event === 'tool/result')
        return textContent(record(payload?.message)?.content);
    // Legacy DSH turn/end rows store only event metadata. Use the matching turn's
    // final visible output; never attach a later turn's output to an earlier row.
    if (data.event === 'turn/end')
        return payload?.turn === intent.output?.turn ? textContent(intent.output?.content) : '';
    if (typeof data.text === 'string')
        return data.text;
    if (data.content !== undefined)
        return textContent(data.content);
    return JSON.stringify(data);
}
function errorFlag(trace) {
    const message = record(record(trace.data?.payload)?.message);
    return trace.data?.is_error === true || trace.data?.isError === true || message?.isError === true || trace.kind === 'error';
}
function toolName(trace, traces) {
    const explicit = string(trace.data?.tool);
    if (explicit)
        return explicit;
    const payload = record(trace.data?.payload);
    if (trace.data?.event === 'tool/call')
        return string(payload?.name);
    if (trace.data?.event === 'tool/result') {
        const callId = record(payload?.message)?.toolCallId;
        if (typeof callId === 'string') {
            const call = traces.find(row => row.taskId === trace.taskId && row.intentId === trace.intentId && row.worker === trace.worker && row.data?.event === 'tool/call' && record(row.data.payload)?.callId === callId);
            return string(record(call?.data?.payload)?.name);
        }
    }
    return '';
}
// ARTEX uses ILIKE '%q%': preserve its %, _ and backslash pattern semantics.
export function sqlSubstringMatcher(q) {
    let pattern = '';
    const chars = Array.from(q);
    const literal = (char) => char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (let i = 0; i < chars.length; i++) {
        const char = chars[i];
        if (char === '\\' && i + 1 < chars.length)
            pattern += literal(chars[++i]);
        else if (char === '%')
            pattern += '[\\s\\S]*';
        else if (char === '_')
            pattern += '[\\s\\S]';
        else
            pattern += literal(char);
    }
    const regex = new RegExp(pattern, 'iu');
    return value => regex.test(value);
}
/** Read-only ARTEX trace queries over the durable store, with direct-source isolation. */
export class GraphTraceRuntime {
    store;
    constructor(store) {
        this.store = store;
    }
    view(taskId) {
        const state = this.store.snapshot();
        const owners = [taskId, ...directSourceTasks(state, taskId).map(task => task.id)];
        const intents = state.intents.filter(intent => owners.includes(intent.taskId) && (intent.taskId === taskId || terminalSourceStates.has(intent.state)));
        return { state, owners, intents };
    }
    requireIntent(intents, id) {
        if (typeof id !== 'string' || !id.trim())
            throw new TaskManagementError('invalid', 'intent_id 必填');
        const intent = intents.find(row => row.id === id);
        if (!intent)
            throw new TaskManagementError('not_found', 'intent_id 不属于本任务或其直接关联任务的可读意图');
        return intent;
    }
    steps(state, intent) {
        // UUIDs are opaque; durable insertion order provides ARTEX's ascending sequence order.
        return state.traces.filter(trace => trace.taskId === intent.taskId && trace.intentId === intent.id && visible(trace));
    }
    step(taskId, state, intent, trace, full = false) {
        return { step_id: trace.id, kind: kind(trace), tool: toolName(trace, state.traces), is_error: errorFlag(trace),
            ...(full ? { detail: detail(trace, intent) } : { summary: firstLine(trace.summary) }), ...provenance(taskId, trace.taskId) };
    }
    getWorkerTrace(taskId, args) {
        const { state, intents } = this.view(taskId), intent = this.requireIntent(intents, args.intent_id);
        const rows = this.steps(state, intent), inherited = provenance(taskId, intent.taskId);
        if (args.step_ids && args.step_ids.length > 0) {
            // ARTEX deduplicates valid identifiers before applying the detail cap. DSH
            // identifiers are opaque strings instead of positive PostgreSQL integers.
            const ids = [...new Set(args.step_ids.flatMap(id => {
                    if (typeof id === 'number')
                        return Number.isSafeInteger(id) && id > 0 ? [String(id)] : [];
                    if (typeof id !== 'string' || !id.trim())
                        return [];
                    const value = id.trim();
                    return /^-?\d+$/.test(value) && BigInt(value) <= 0n ? [] : [value];
                }))];
            const returned = ids.slice(0, 5), omitted = ids.slice(5);
            return { intent_id: intent.id, steps: rows.filter(row => returned.includes(row.id)).map(row => this.step(taskId, state, intent, row, true)), returned_step_ids: returned,
                ...(omitted.length ? { omitted_step_ids: omitted, notice: `每次最多取 5 个步骤的完整内容，本次处理前 ${returned.length} 个；未取的 ${omitted.length} 个为 ${omitted.join(', ')}。需要继续时可用这些 step_id 再调用。` } : {}), ...inherited };
        }
        const query = args.q ?? '', search = query.trim().length > 0, match = sqlSubstringMatcher(query);
        return { intent_id: intent.id, steps: rows.filter(row => !search || match(row.summary) || match(detail(row, intent)))
                .slice(0, limit(args.limit, search ? 100 : 500)).map(row => this.step(taskId, state, intent, row)), ...inherited };
    }
    getWorkerOutput(taskId, args) {
        const { state, intents } = this.view(taskId), intent = this.requireIntent(intents, args.intent_id);
        const rows = this.steps(state, intent).slice(0, 1000);
        const chosen = rows.filter(row => kind(row) === 'result').at(-1) ?? rows.filter(row => kind(row) === 'text').at(-1);
        const inherited = provenance(taskId, intent.taskId);
        if (!chosen)
            return intent.taskId === taskId ? '（该 work 尚无任何输出）' : { intent_id: intent.id, final_text: '（该 work 尚无任何输出）', ...inherited };
        return { intent_id: intent.id, final_text: detail(chosen, intent) || chosen.summary, summary: chosen.summary, is_error: errorFlag(chosen), ...inherited };
    }
    searchAllWorkerTraces(taskId, args, ownerIntentId) {
        if (typeof args.q !== 'string' || !args.q.trim())
            throw new TaskManagementError('invalid', 'q 必填');
        const { state, intents } = this.view(taskId), match = sqlSubstringMatcher(args.q);
        const hits = state.traces.flatMap(trace => {
            const intent = intents.find(row => row.id === trace.intentId && row.taskId === trace.taskId);
            if (!intent || !visible(trace) || intent.taskId === taskId && intent.id === ownerIntentId || !match(trace.summary) && !match(detail(trace, intent)))
                return [];
            return [{ intent_id: intent.id, worker: trace.worker, ...this.step(taskId, state, intent, trace) }];
        }).slice(0, limit(args.limit, 100));
        return { query: args.q, hits };
    }
    listWorkerTraces(taskId, args = {}) {
        const { state, owners, intents } = this.view(taskId), q = (args.q ?? '').trim().toLowerCase();
        const allowed = new Set(intents.map(intent => intent.id));
        const works = owners.flatMap(owner => state.intents.filter(intent => intent.taskId === owner).reverse().slice(0, 500))
            .filter(intent => allowed.has(intent.id) && localIndexStates.has(intent.state) && intent.summary.toLowerCase().includes(q))
            .slice(0, limit(args.limit, 50)).map(intent => ({ intent_id: intent.id, summary: intent.summary, state: intent.state, ...provenance(taskId, intent.taskId) }));
        return { works };
    }
}
