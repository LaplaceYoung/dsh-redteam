import { randomUUID } from 'node:crypto';
import { assetKey, assetRow, normalizeAsset } from '../graph-tools/assets.js';
import { assetTaskIds, associateTaskAsset, detachTaskAssets } from '../shared-assets.js';
import { assertAssetInsertionAllowed, intentAssetIds } from '../task-asset-runtime.js';
import { AssetManagementError } from './validation.js';
import { attributedCompanyForAsset, parseCompanyScopeInputs } from './companies.js';
const terminal = new Set(['done', 'blocked', 'exhausted', 'stopped']);
const manualScopeSummary = '用户在测试资产页手工新增';
function requireTask(state, id) {
    if (typeof id !== 'string' || !id.trim())
        throw new AssetManagementError('task ID is required');
    const task = state.tasks.find(row => row.id === id);
    if (!task)
        throw new AssetManagementError('task not found', 404);
    return task;
}
function identifier(id) {
    if (typeof id !== 'string' || !id.trim())
        throw new AssetManagementError('asset ID is required');
}
function summary(value, required = false) {
    if (typeof value !== 'string')
        throw new AssetManagementError('source_summary must be a string');
    const normalized = value.trim();
    if (required && !normalized)
        throw new AssetManagementError('source_summary is required');
    if (Array.from(normalized).length > 500)
        throw new AssetManagementError('source summary exceeds 500 characters');
    return normalized;
}
function normalizeIds(values) {
    if (!Array.isArray(values) || !values.length)
        throw new AssetManagementError('asset_ids is required');
    values.forEach(identifier);
    const ids = [...new Set(values)];
    if (ids.length > 100)
        throw new AssetManagementError('at most 100 assets per request');
    return ids;
}
function provenance(asset, taskId) {
    const rows = asset.metadata.task_sources;
    if (!Array.isArray(rows))
        return undefined;
    return rows.find((row) => !!row && typeof row === 'object' && !Array.isArray(row) && row.task_id === taskId);
}
const string = (value) => typeof value === 'string' ? value : '';
function liveSourceNode(state, source) {
    const id = source?.node_id;
    return typeof id === 'string' && state.nodes.some(node => node.id === id) ? id : undefined;
}
function compareIds(a, b) {
    if (/^\d+$/.test(a) && /^\d+$/.test(b))
        return BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0;
    return a < b ? -1 : a > b ? 1 : 0;
}
function contextTasks(state, taskId) {
    const task = requireTask(state, taskId), live = new Set(state.tasks.map(row => row.id));
    return new Set([taskId, ...(task.sourceTaskIds ?? []).filter(id => live.has(id))]);
}
function anchors(state, node) {
    const ids = new Set(intentAssetIds(node.data));
    const intent = state.intents.find(row => row.id === node.id && row.taskId === node.taskId);
    if (intent)
        for (const id of intentAssetIds(intent.input))
            ids.add(id);
    const finding = state.findings.find(row => (row.nodeId ?? row.id) === node.id && row.taskId === node.taskId);
    if (finding)
        for (const id of finding.assetIds)
            ids.add(id);
    for (const edge of state.edges)
        if (edge.taskId === node.taskId && edge.relation === 'anchors') {
            if (edge.from === node.id)
                ids.add(edge.to);
            if (edge.to === node.id)
                ids.add(edge.from);
        }
    return ids;
}
function nodeState(state, node) {
    if (node.kind === 'intent')
        return state.intents.find(row => row.id === node.id)?.state ?? string(node.data.state);
    if (node.kind === 'finding')
        return state.findings.find(row => (row.nodeId ?? row.id) === node.id)?.status ?? string(node.data.state ?? node.data.status);
    return string(node.data.state);
}
function label(asset) {
    const row = assetRow(asset);
    switch (asset.kind) {
        case 'root_domain':
        case 'subdomain': return string(row.domain);
        case 'ip': return string(row.ip);
        case 'app': return string(row.app_name) || asset.value;
        case 'service': return string(row.url) || `${string(row.domain) || string(row.ip)}${row.port === undefined ? '' : `:${row.port}`}` || string(row.service_name) || `#${asset.id}`;
        case 'endpoint': return string(row.url) || `#${asset.id}`;
        default: return `#${asset.id}`;
    }
}
/** Global assets keep their identity; membership and provenance live in shared metadata. */
export class TaskAssetRuntime {
    store;
    constructor(store) {
        this.store = store;
    }
    async attach(taskId, assetIds, sourceSummary) {
        const ids = normalizeIds(assetIds), note = summary(sourceSummary, true);
        return this.store.transaction(state => {
            requireTask(state, taskId);
            const assets = ids.map(id => {
                const asset = state.assets.find(row => row.id === id);
                if (!asset)
                    throw new AssetManagementError(`asset not found: ${id}`, 404);
                return asset;
            });
            const existing = assets.filter(asset => assetTaskIds(asset).includes(taskId)).length;
            // Manual reattachment deliberately clears an earlier source node, like ARTEX's ON CONFLICT.
            for (const asset of assets)
                associateTaskAsset(asset, taskId, { source: 'manual', summary: note });
            return { requested: ids.length, attached: ids.length - existing, existing };
        });
    }
    async detach(taskId, assetId) {
        identifier(assetId);
        return this.store.transaction(state => {
            requireTask(state, taskId);
            const result = detachTaskAssets(state, taskId, { deleteExclusive: false, candidates: new Set([assetId]) });
            if (!result.detached.length)
                throw new AssetManagementError('asset is not associated with this task', 404);
            return { detached: assetId };
        });
    }
    async setSource(taskId, assetId, input) {
        identifier(assetId);
        if (typeof input.source !== 'string')
            throw new AssetManagementError('source must be a string');
        const source = input.source.trim().toLowerCase() || 'system', note = summary(input.sourceSummary);
        await this.store.transaction(state => {
            requireTask(state, taskId);
            const asset = state.assets.find(row => row.id === assetId);
            if (!asset || !assetTaskIds(asset).includes(taskId))
                throw new AssetManagementError('task or asset association does not exist');
            if (input.sourceNodeId !== undefined && !state.nodes.some(node => node.id === input.sourceNodeId && node.taskId === taskId))
                throw new AssetManagementError('source node must belong to the task');
            const nodeId = input.sourceNodeId ?? liveSourceNode(state, provenance(asset, taskId));
            associateTaskAsset(asset, taskId, { source, summary: note, ...(nodeId ? { node_id: nodeId } : {}) });
        });
    }
    async registerScopes(taskId, inputs) {
        if (!Array.isArray(inputs) || !inputs.length)
            throw new AssetManagementError('scope is required');
        const parsed = parseCompanyScopeInputs(inputs);
        if (parsed.invalid)
            throw new AssetManagementError(parsed.errors.join('; '));
        return this.store.transaction(state => {
            requireTask(state, taskId);
            const mutation = { requested: inputs.length, assets_linked: 0, assets_existing: 0, scopes_added: 0, scopes_existing: 0 };
            const at = new Date().toISOString();
            for (const rule of parsed.rules) {
                if (rule.kind === 'domain' || rule.kind === 'ip') {
                    const normalized = normalizeAsset(rule.kind === 'domain' ? { type: 'root_domain', domain: rule.domain ?? rule.value } : { type: 'ip', ip: (rule.net ?? rule.value).split('/')[0] });
                    const key = assetKey(normalized);
                    let asset = state.assets.find(row => assetKey(row) === key);
                    const existing = !!asset && assetTaskIds(asset).includes(taskId);
                    assertAssetInsertionAllowed(state, { ...normalized, taskId });
                    if (!asset) {
                        asset = { ...normalized, id: randomUUID(), taskId, source: 'user', createdAt: at };
                        state.assets.push(asset);
                    }
                    asset.metadata.last_seen = at;
                    if (!asset.companyId || asset.metadata.company_source === 'scope') {
                        const company = attributedCompanyForAsset(state, asset);
                        if (company) {
                            asset.companyId = company;
                            asset.metadata.company_source = 'scope';
                        }
                    }
                    const sourceNode = liveSourceNode(state, provenance(asset, taskId));
                    associateTaskAsset(asset, taskId, { source: 'manual', summary: manualScopeSummary, ...(sourceNode ? { node_id: sourceNode } : {}) });
                    if (existing)
                        mutation.assets_existing++;
                    else
                        mutation.assets_linked++;
                }
                const kind = rule.kind === 'domain' ? 'root_domain' : rule.kind;
                const value = rule.kind === 'domain' ? rule.domain ?? rule.value : rule.net ?? rule.value;
                const scope = state.scopes.find(row => row.taskId === taskId && row.kind === kind && row.value === value);
                if (scope)
                    mutation.scopes_existing++;
                else {
                    state.scopes.push({ id: randomUUID(), taskId, kind, value, source: 'human', reason: manualScopeSummary, createdAt: at });
                    mutation.scopes_added++;
                }
            }
            return mutation;
        });
    }
    intentAssets(taskId) {
        const state = this.store.snapshot(), context = contextTasks(state, taskId), result = [];
        for (const node of state.nodes) {
            if (node.kind !== 'intent' || !context.has(node.taskId))
                continue;
            const inherited = node.taskId !== taskId;
            if (inherited && !terminal.has(nodeState(state, node)))
                continue;
            for (const id of anchors(state, node)) {
                const asset = state.assets.find(row => row.id === id);
                if (!asset)
                    continue;
                const source = provenance(asset, node.taskId), sourceNode = liveSourceNode(state, source);
                result.push({ intent_id: node.id, asset_id: asset.id, type: asset.kind, label: label(asset),
                    source: string(source?.source) || 'anchor', source_summary: string(source?.summary) || '意图在黑板中锚定该资产',
                    ...(sourceNode ? { source_node_id: sourceNode } : {}), source_task_id: node.taskId, inherited });
            }
        }
        return { assets: result.sort((a, b) => Number(a.inherited) - Number(b.inherited) || compareIds(b.intent_id, a.intent_id) || compareIds(a.asset_id, b.asset_id)) };
    }
    refs(taskId, assetId) {
        identifier(assetId);
        const state = this.store.snapshot(), context = contextTasks(state, taskId);
        const result = { intents: [], facts: [], findings: [] };
        if (!state.assets.some(asset => asset.id === assetId))
            return result;
        for (const node of [...state.nodes].sort((a, b) => compareIds(b.id, a.id))) {
            if (!context.has(node.taskId) || !['intent', 'fact', 'finding'].includes(node.kind) || !anchors(state, node).has(assetId))
                continue;
            const inherited = node.taskId !== taskId, stateName = nodeState(state, node);
            if (inherited && node.kind === 'intent' && !terminal.has(stateName))
                continue;
            const ref = { id: node.id, kind: node.kind, state: stateName, summary: string(node.data.summary).trim() ? string(node.data.summary) : string(node.data.text).trim() ? string(node.data.text) : node.label,
                ...(inherited ? { source_task_id: node.taskId, inherited: true } : {}) };
            if (node.kind === 'intent')
                result.intents.push(ref);
            else if (node.kind === 'fact')
                result.facts.push(ref);
            else
                result.findings.push(ref);
        }
        return result;
    }
}
