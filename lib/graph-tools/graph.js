import { randomUUID } from 'node:crypto';
import { directSourceTasks, requireManagedTask, TaskManagementError } from '../task-management/index.js';
import { intentAssetIds } from '../task-asset-runtime.js';
import { GraphAssetRuntime } from './assets.js';
import { sqlSubstringMatcher } from './traces.js';
import { digestIsCurrent, graphKind, graphState as stateOf } from './digest-state.js';
export { graphKind } from './digest-state.js';
export const terminalSourceStates = new Set(['done', 'blocked', 'exhausted', 'stopped']);
function mark(taskId, owner) {
    return owner === taskId ? {} : { source_task_id: owner, inherited: true };
}
export function graphOwners(state, taskId) {
    return [taskId, ...directSourceTasks(state, taskId).map(task => task.id)];
}
function visibleNodes(state, taskId) {
    const owners = new Set(graphOwners(state, taskId));
    return state.nodes.filter(node => owners.has(node.taskId) && (node.taskId === taskId || node.kind !== 'intent' || terminalSourceStates.has(stateOf(node))));
}
function compact(node, taskId) {
    return { id: node.id, state: stateOf(node), summary: node.label, ...mark(taskId, node.taskId) };
}
function required(value, name) {
    if (typeof value !== 'string' || !value.trim())
        throw new TaskManagementError('invalid', `${name} 不能为空`);
    return value;
}
function limitValue(value, fallback, max = Infinity) {
    if (value !== undefined && !Number.isInteger(value))
        throw new TaskManagementError('invalid', 'limit must be an integer');
    return Math.min(value !== undefined && value > 0 ? value : fallback, max);
}
function anchors(state, taskId, ids = []) {
    requireManagedTask(state, taskId);
    for (const id of ids) {
        if (!state.assets.some(asset => asset.id === id))
            throw new TaskManagementError('not_found', `asset not found: ${id}`);
    }
    return [...new Set(ids)];
}
function lineage(state, taskId, intent) {
    const edges = state.edges.filter(edge => edge.taskId === intent.taskId);
    const visible = new Set(visibleNodes(state, taskId).map(node => node.id));
    const parents = edges.filter(edge => edge.to === intent.id && ['derived_from', 'spawns'].includes(edge.relation) && visible.has(edge.from)).map(edge => edge.from);
    const yields = edges.filter(edge => edge.from === intent.id && edge.relation === 'yields' && visible.has(edge.to)).map(edge => edge.to);
    const assetIds = intentAssetIds(intent.input);
    return { id: intent.id, summary: intent.summary, state: intent.state, ...(assetIds.length ? { asset_ids: assetIds } : {}), ...(parents.length ? { parents } : {}), ...(yields.length ? { yields } : {}), ...mark(taskId, intent.taskId) };
}
function digestView(state, owner, cap, reader = owner) {
    const nodes = state.nodes.filter(node => node.taskId === owner), positions = new Map(state.nodes.map((node, index) => [node.id, index]));
    const edges = state.edges.filter(edge => edge.taskId === owner);
    const live = new Set(state.intents.filter(intent => intent.taskId === owner && ['open', 'claimed', 'running', 'paused'].includes(intent.state)).map(intent => intent.id));
    const hot = new Set(), stack = [...live], causal = edges.filter(edge => edge.relation !== 'covers');
    while (stack.length) {
        const id = stack.pop();
        if (hot.has(id))
            continue;
        hot.add(id);
        stack.push(...causal.filter(edge => edge.to === id).map(edge => edge.from));
    }
    for (const edge of causal)
        if (live.has(edge.from))
            hot.add(edge.to);
    const hidden = new Set();
    const digests = nodes.filter(node => graphKind(node) === 'digest' && stateOf(node) === 'active' && digestIsCurrent(state, node)).map(node => {
        const members = edges.filter(edge => edge.from === node.id && edge.relation === 'covers').map(edge => edge.to);
        for (const id of members)
            if (!hot.has(id))
                hidden.add(id);
        return { id: node.id, body: node.data.body, member_count: members.length, freshness: Math.max(-1, ...members.map(id => positions.get(id) ?? -1)), ...mark(reader, owner) };
    }).sort((a, b) => b.freshness - a.freshness);
    return { hidden, fields: digests.length ? { cold_digests: digests.slice(0, cap).map(({ freshness: _freshness, ...entry }) => entry), ...(digests.length > cap ? { cold_digests_more: digests.slice(cap).map(digest => digest.id) } : {}) } : {} };
}
/** ARTEX graph contracts on the store's durable node/edge records. */
export class GraphRuntime {
    store;
    options;
    constructor(store, options = {}) {
        this.store = store;
        this.options = options;
    }
    listFacts(taskId, args = {}) {
        const state = this.store.snapshot();
        const limit = limitValue(args.limit, 20, 100), match = sqlSubstringMatcher((args.q ?? '').trim());
        const nodes = visibleNodes(state, taskId).filter(node => graphKind(node) === 'fact' && match(node.label)).reverse();
        // UUIDs are opaque. The persisted append order supplies the monotonic cursor
        // ordering that PostgreSQL's sequence IDs provide in ARTEX.
        const cursor = args.before === undefined || args.before === 0 || args.before === '0' ? undefined : String(args.before);
        let page = nodes;
        if (cursor) {
            const index = state.nodes.findIndex(node => node.id === cursor);
            if (index < 0 || !visibleNodes(state, taskId).some(node => node.id === cursor))
                throw new TaskManagementError('invalid', 'before is not a visible node cursor');
            const positions = new Map(state.nodes.map((node, position) => [node.id, position]));
            page = nodes.filter(node => positions.get(node.id) < index);
        }
        const hasMore = page.length > limit;
        const facts = page.slice(0, limit).map(node => {
            const chars = Array.from(node.label);
            return { ...compact(node, taskId), ...(chars.length > 160 ? { summary: chars.slice(0, 160).join('') + '…', summary_truncated: true } : {}) };
        });
        return { facts, total: nodes.length, has_more: hasMore, ...(hasMore ? { next_before: facts[facts.length - 1].id } : {}) };
    }
    listFindings(taskId, args = {}) {
        const state = this.store.snapshot(), nodes = visibleNodes(state, taskId);
        return graphOwners(state, taskId).flatMap(owner => nodes.filter(node => node.taskId === owner && node.kind === 'finding').reverse().slice(0, 500)).flatMap(node => {
            const finding = state.findings.find(row => row.id === node.id || row.nodeId === node.id);
            if (args.severity && (finding?.severity ?? node.data.severity) !== args.severity || args.status && (finding?.status ?? node.data.status) !== args.status)
                return [];
            const from = state.edges.find(edge => edge.taskId === node.taskId && edge.to === node.id && edge.relation === 'yields' && nodes.some(parent => parent.id === edge.from && parent.kind === 'intent'));
            const intentId = from?.from ?? (nodes.some(parent => parent.id === finding?.intentId && parent.kind === 'intent') ? finding?.intentId : undefined);
            return [{ ...compact(node, taskId), task_id: node.taskId, finding_id: finding?.id ?? node.id, finding_node_id: node.id, traffic_count: finding?.trafficBindings?.length ?? 0,
                    vulnclass: finding?.vulnClass ?? node.data.vulnClass, severity: finding?.severity ?? node.data.severity,
                    ...(intentId ? { intent_id: intentId } : {}) }];
        });
    }
    nodeDetail(taskId, id) {
        required(id, 'id');
        const state = this.store.snapshot(), owners = graphOwners(state, taskId);
        const node = visibleNodes(state, taskId).find(row => row.id === id && row.kind !== 'asset');
        if (node) {
            const intent = state.intents.find(row => row.id === id && row.taskId === node.taskId);
            const finding = state.findings.find(row => (row.id === id || row.nodeId === id) && row.taskId === node.taskId);
            const evidence = state.evidence.find(row => row.id === id && row.taskId === node.taskId);
            return { id, task_id: node.taskId, kind: graphKind(node), state: stateOf(node),
                payload: { ...node.data, summary: node.label, ...(intent ? { ...intent.input, output: intent.output } : {}), ...(finding ? { ...finding, vulnclass: finding.vulnClass } : {}), ...(evidence ? { ...evidence } : {}) },
                anchors: node.data.asset_ids ?? node.data.assetIds ?? (intent ? intentAssetIds(intent.input) : finding?.assetIds ?? []),
                ...(finding ? { finding_id: finding.id, finding_node_id: id, traffic_count: finding.trafficBindings?.length ?? 0, traffic_ids: (finding.trafficBindings ?? []).map(binding => binding.snapshot.sourceTrafficId) } : {}), ...mark(taskId, node.taskId) };
        }
        const goal = state.goals.find(row => row.id === id && owners.includes(row.taskId));
        if (goal)
            return { id, task_id: goal.taskId, kind: 'goal', state: goal.state, payload: { text: goal.text, vulnclass: goal.vulnClass }, ...mark(taskId, goal.taskId) };
        const constraint = state.constraints.find(row => row.id === id && owners.includes(row.taskId));
        if (constraint)
            return { id, task_id: constraint.taskId, kind: 'constraint', state: 'active', payload: { text: constraint.text, mode: constraint.kind }, ...mark(taskId, constraint.taskId) };
        throw new TaskManagementError('not_found', `未找到探索节点 ${id}。资产请用 list_assets / asset_neighbors；来源任务的运行中意图不可读取。`);
    }
    expandDigest(taskId, id) {
        const state = this.store.snapshot(), node = visibleNodes(state, taskId).find(node => node.id === id && graphKind(node) === 'digest');
        if (!node)
            throw new TaskManagementError('not_found', `#${id} 不是本任务或直接关联任务的 digest 节点`);
        const positions = new Map(state.nodes.map((node, index) => [node.id, index]));
        const members = state.edges.filter(edge => edge.taskId === node.taskId && edge.from === id && edge.relation === 'covers').map(edge => edge.to).sort((a, b) => (positions.get(a) ?? -1) - (positions.get(b) ?? -1));
        const readable = visibleNodes(state, taskId);
        return { id, state: stateOf(node), body: node.data.body, ...mark(taskId, node.taskId), members: members.map(memberId => {
                const member = readable.find(row => row.taskId === node.taskId && row.id === memberId);
                return member ? { ...compact(member, taskId), ...(typeof member.data.confidence === 'string' ? { confidence: member.data.confidence } : {}) } : { id: memberId, missing: true, ...mark(taskId, node.taskId) };
            }) };
    }
    async recordFact(taskId, args, worker = 'worker') {
        const batch = Boolean(args.facts?.length), items = batch ? args.facts : [args];
        return this.store.transaction(state => {
            requireManagedTask(state, taskId);
            const ids = [], errors = {};
            for (const [index, item] of items.entries()) {
                try {
                    const summary = required(item.summary, 'summary');
                    const intentId = item.intent_id || args.intent_id;
                    if (intentId && !state.intents.some(intent => intent.id === intentId && intent.taskId === taskId))
                        throw new TaskManagementError('conflict', 'intent_id 必须是本任务的意图（关联任务意图只读）');
                    const assetIds = anchors(state, taskId, item.asset_ids);
                    const data = { ...item.data, state: 'confirmed', origin: worker, priority: 5, created_at: new Date().toISOString(), asset_ids: assetIds };
                    if (item.detail)
                        data.detail = item.detail;
                    if (item.evidence?.trim())
                        data.evidence = item.evidence.trim();
                    if (item.confidence?.trim())
                        data.confidence = item.confidence.trim();
                    if (intentId)
                        data.intentId = intentId;
                    const id = randomUUID();
                    state.nodes.push({ id, taskId, kind: 'fact', label: summary, data });
                    if (intentId)
                        state.edges.push({ id: randomUUID(), taskId, from: intentId, to: id, relation: 'yields' });
                    ids.push(id);
                }
                catch (error) {
                    if (!(error instanceof TaskManagementError))
                        throw error;
                    if (!batch)
                        throw error;
                    ids.push(0);
                    errors[String(index)] = error.message;
                }
            }
            return batch ? { ids, ...(Object.keys(errors).length ? { errors } : {}) } : { id: ids[0], message: `fact recorded: ${ids[0]}` };
        });
    }
    async addHint(taskId, args) {
        const batch = Boolean(args.hints?.length), items = batch ? args.hints : [args];
        const written = await this.store.transaction(state => {
            requireManagedTask(state, taskId);
            const ids = [], errors = {}, texts = [];
            for (const [index, item] of items.entries()) {
                try {
                    const text = required(item.text ?? item.summary, 'text');
                    if (item.traffic_refs?.length && !this.options.trafficBindingEnabled?.())
                        throw new TaskManagementError('invalid', 'Agent 自动绑定流量已关闭，未保存携带 traffic_refs 的提示');
                    const refs = [], seen = new Set();
                    for (const ref of item.traffic_refs ?? []) {
                        const trafficId = required(ref.traffic_id, 'traffic_id').trim(), role = ref.role || 'supporting';
                        if (!['baseline', 'proof', 'verification', 'supporting'].includes(role))
                            throw new TaskManagementError('invalid', `无效的流量用途 ${role}`);
                        if (!seen.has(trafficId)) {
                            refs.push({ traffic_id: trafficId, role, note: ref.note ?? '' });
                            seen.add(trafficId);
                        }
                    }
                    const assetIds = anchors(state, taskId, item.asset_ids), id = randomUUID();
                    // Existing storage and Planner represent hints as fact envelopes. The
                    // query adapter exposes the distinct ARTEX hint kind and excludes them from facts.
                    state.nodes.push({ id, taskId, kind: 'fact', label: text, data: { ...item.data, kind: 'strategic_hint', hint: true, text, state: 'active', origin: 'human', priority: 0, asset_ids: assetIds, created_at: new Date().toISOString(), ...(refs.length ? { traffic_refs: refs } : {}) } });
                    ids.push(id);
                    texts.push(text);
                }
                catch (error) {
                    if (!(error instanceof TaskManagementError))
                        throw error;
                    if (!batch)
                        throw error;
                    ids.push(0);
                    errors[String(index)] = error.message;
                }
            }
            return { ids, errors, texts };
        });
        if (written.texts.length)
            await this.options.notifyHint?.(taskId, written.texts);
        return batch ? { ids: written.ids, ...(Object.keys(written.errors).length ? { errors: written.errors } : {}) } : { id: written.ids[0], message: `hint added: ${written.ids[0]}` };
    }
    overview(taskId) {
        const state = this.store.snapshot(), task = requireManagedTask(state, taskId);
        const owners = graphOwners(state, taskId), nodes = state.nodes.filter(node => node.taskId === taskId).reverse();
        const intents = state.intents.filter(intent => intent.taskId === taskId).reverse();
        const facts = nodes.filter(node => graphKind(node) === 'fact'), findings = nodes.filter(node => node.kind === 'finding');
        const digests = digestView(state, taskId, 15);
        const open = intents.filter(intent => intent.state === 'open').reverse().sort((a, b) => Number(b.input.priority ?? 5) - Number(a.input.priority ?? 5));
        const done = intents.filter(intent => ['done', 'blocked', 'exhausted'].includes(intent.state));
        const summarize = (node) => {
            const from = state.edges.find(edge => edge.taskId === taskId && edge.to === node.id && edge.relation === 'yields');
            return { ...compact(node, taskId), ...(from ? { from_intent: from.from } : {}), ...(typeof node.data.confidence === 'string' ? { confidence: node.data.confidence } : {}) };
        };
        return { task: { description: task.description ?? task.title, goal: task.goal },
            goals: state.goals.filter(goal => goal.taskId === taskId).reverse().slice(0, 100).map(goal => ({ id: goal.id, state: goal.state, text: goal.text })),
            hints: nodes.filter(node => graphKind(node) === 'hint').slice(0, 50).map(node => ({ id: node.id, state: stateOf(node), text: node.label, ...(this.options.trafficBindingEnabled?.() && node.data.traffic_refs ? { traffic_refs: node.data.traffic_refs } : {}) })),
            open_intents: open.slice(0, 30).map(intent => lineage(state, taskId, intent)), frontier_open: open.length,
            running_intents: intents.filter(intent => intent.state === 'running' || intent.state === 'claimed').map(intent => lineage(state, taskId, intent)),
            done_intents_total: done.length, recent_done_intents: done.filter(intent => !digests.hidden.has(intent.id)).slice(0, 12).map(intent => lineage(state, taskId, intent)),
            facts: facts.length, findings_total: findings.length, recent_facts: facts.filter(node => !digests.hidden.has(node.id)).slice(0, 20).map(summarize), finding_list: findings.slice(0, 10).map(summarize), ...digests.fields,
            coverage: this.coverage(taskId, task.coverageEnabled !== false),
            related_tasks: owners.slice(1, 9).map(owner => this.relatedOverview(state, taskId, owner, Math.min(8000, Math.floor(48000 / (owners.length - 1))))) };
    }
    coverage(taskId, enabled, includeSources = true) {
        const coverage = new GraphAssetRuntime(this.store).coverage(taskId, includeSources);
        return enabled ? { ...coverage, ...(coverage.denominator ? {} : { status: '范围未锚定' }), note: '覆盖度只计事实锚定的资产；包含当前任务与直接来源任务，关联 scope 只读。' } : { host_count: coverage.host_count };
    }
    relatedOverview(state, taskId, owner, budget) {
        const source = requireManagedTask(state, owner), provenance = mark(taskId, owner);
        let remaining = budget, truncated = false;
        const take = (value, max) => {
            const chars = Array.from(value.trim()), size = Math.min(max, remaining);
            if (chars.length > size)
                truncated = true;
            const text = chars.length > size ? (size ? chars.slice(0, size - 1).join('') + '…' : '') : chars.join('');
            remaining -= Array.from(text).length;
            return text;
        };
        const nodes = state.nodes.filter(node => node.taskId === owner).reverse();
        const facts = nodes.filter(node => graphKind(node) === 'fact'), findings = nodes.filter(node => node.kind === 'finding'), hints = nodes.filter(node => graphKind(node) === 'hint');
        const goals = state.goals.filter(goal => goal.taskId === owner).reverse(), intents = state.intents.filter(intent => intent.taskId === owner && terminalSourceStates.has(intent.state)).reverse();
        const scopes = state.scopes.filter(scope => scope.taskId === owner);
        const digests = digestView(state, owner, 6, taskId);
        if (facts.length > 12 || findings.length > 6 || hints.length > 6 || goals.length > 8 || intents.length > 8 || scopes.length > 12)
            truncated = true;
        const result = { ...provenance,
            task: { description: take(source.description ?? source.title, 800), goal: take(source.goal, 800), status: source.status },
            goals: goals.slice(0, 8).map(goal => ({ id: goal.id, state: goal.state, text: take(goal.text, 400), ...provenance })),
            hints: hints.slice(0, 6).map(hint => ({ id: hint.id, state: stateOf(hint), text: take(hint.label, 400), ...provenance })),
            facts: facts.length, findings: findings.length,
            recent_findings: findings.slice(0, 6).map(node => ({ ...compact(node, taskId), summary: take(node.label, 400), vulnclass: node.data.vulnClass, severity: node.data.severity })),
            recent_facts: facts.slice(0, 12).filter(node => !digests.hidden.has(node.id)).map(node => {
                const from = state.edges.find(edge => edge.taskId === owner && edge.to === node.id && edge.relation === 'yields' && intents.some(intent => intent.id === edge.from));
                return { ...compact(node, taskId), summary: take(node.label, 400), ...(from ? { from_intent: from.from } : {}), ...(typeof node.data.confidence === 'string' ? { confidence: node.data.confidence } : {}) };
            }),
            recent_intent_results: intents.slice(0, 8).filter(intent => !digests.hidden.has(intent.id)).map(intent => {
                const traces = state.traces.filter(trace => trace.taskId === owner && trace.intentId === intent.id);
                const result = traces.reverse().find(trace => trace.kind === 'result');
                return { ...lineage(state, taskId, intent), summary: take(intent.summary, 400), ...(result ? { result_summary: take(result.summary, 800) } : {}) };
            }),
            asset_scope: scopes.slice(0, 12).map(scope => ({ kind: scope.kind, source: scope.source, value: take(scope.value, 400), ...(scope.companyId ? { company_id: scope.companyId } : {}) })),
            asset_scope_count: scopes.length, asset_coverage: this.coverage(owner, true, false),
            ...digests.fields,
            node_stats: nodes.reduce((counts, node) => { const kind = graphKind(node); counts[kind] = (counts[kind] ?? 0) + 1; return counts; }, {}),
        };
        return { ...result, ...(truncated ? { summary_truncated: true } : {}) };
    }
}
