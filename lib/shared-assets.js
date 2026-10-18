import { randomUUID } from 'node:crypto';
import { assetKey } from './graph-tools/assets.js';
const strings = (value) => Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
function sources(asset) {
    const value = asset.metadata.task_sources;
    return Array.isArray(value) ? value.filter((item) => !!item && typeof item === 'object' && !Array.isArray(item)) : [];
}
export function assetTaskIds(asset) {
    return [...new Set([asset.taskId, ...strings(asset.metadata.task_ids), ...sources(asset).flatMap(row => typeof row.task_id === 'string' ? [row.task_id] : [])])].filter(id => id !== 'global');
}
export function associateTaskAsset(asset, taskId, source) {
    asset.metadata.task_ids = [...new Set([...assetTaskIds(asset), taskId])];
    if (source)
        asset.metadata.task_sources = [...sources(asset).filter(row => row.task_id !== taskId), { ...structuredClone(source), task_id: taskId }];
}
/** Only the task's own graph contributes anchors; source-task visibility is not ownership. */
export function taskAssetReferences(state, taskId) {
    const ids = new Set();
    const add = (data) => { for (const key of ['asset_ids', 'assetIds'])
        for (const id of strings(data[key]))
            ids.add(id); };
    for (const node of state.nodes)
        if (node.taskId === taskId && node.kind !== 'asset')
            add(node.data);
    for (const intent of state.intents)
        if (intent.taskId === taskId)
            add(intent.input);
    for (const finding of state.findings)
        if (finding.taskId === taskId)
            for (const id of finding.assetIds)
                ids.add(id);
    const assets = new Set(state.assets.map(asset => asset.id));
    for (const edge of state.edges)
        if (edge.taskId === taskId) {
            if (assets.has(edge.from))
                ids.add(edge.from);
            if (assets.has(edge.to))
                ids.add(edge.to);
        }
    return ids;
}
export function taskAssets(state, taskId) {
    const refs = taskAssetReferences(state, taskId);
    return state.assets.filter(asset => assetTaskIds(asset).includes(taskId) || refs.has(asset.id));
}
/** Call before removing task graph rows so anchor-only ownership is still visible. */
export function detachTaskAssets(state, taskId, options) {
    const candidates = options.candidates ?? new Set(taskAssets(state, taskId).map(asset => asset.id));
    const others = state.tasks.filter(task => task.id !== taskId);
    const live = new Set(others.map(task => task.id));
    const refs = new Set(others.flatMap(task => [...taskAssetReferences(state, task.id)]));
    const deleted = [], detached = [];
    for (const asset of state.assets) {
        if (!candidates.has(asset.id))
            continue;
        const memberships = assetTaskIds(asset);
        if (options.deleteExclusive && !(options.preserveCompanyAssets && asset.companyId) && !memberships.some(id => live.has(id)) && !refs.has(asset.id)) {
            deleted.push(asset.id);
            continue;
        }
        if (!memberships.includes(taskId))
            continue;
        const remaining = memberships.filter(id => id !== taskId);
        asset.metadata.task_ids = remaining;
        if (asset.metadata.task_sources !== undefined)
            asset.metadata.task_sources = sources(asset).filter(row => row.task_id !== taskId);
        if (asset.taskId === taskId)
            asset.taskId = remaining.find(id => live.has(id)) ?? 'global';
        detached.push(asset.id);
    }
    const removed = new Set(deleted);
    state.assets = state.assets.filter(asset => !removed.has(asset.id));
    state.nodes = state.nodes.filter(node => !(node.kind === 'asset' && removed.has(node.id)));
    return { deleted, detached };
}
/** Restore memberships without applying stale business fields to the live global asset. */
export function restoreTaskAssets(state, taskId, archived) {
    const mapping = new Map(), warnings = [];
    for (const old of archived) {
        const existing = state.assets.find(asset => assetKey(asset) === assetKey(old));
        const source = sources(old).find(row => row.task_id === taskId);
        if (existing) {
            associateTaskAsset(existing, taskId, source);
            mapping.set(old.id, existing.id);
            if (old.id !== existing.id)
                warnings.push(`Asset ${old.id} reused live natural-key asset ${existing.id}`);
            continue;
        }
        const restored = structuredClone(old);
        if (state.assets.some(asset => asset.id === restored.id) || state.nodes.some(node => node.id === restored.id && node.kind !== 'asset')) {
            restored.id = randomUUID();
            warnings.push(`Asset ID ${old.id} was occupied; restored as ${restored.id}`);
        }
        // Other task links in the package are historical. Only this restoration owns a new link.
        if (restored.taskId !== taskId && restored.taskId !== 'global')
            restored.taskId = taskId;
        if (restored.metadata.task_ids !== undefined || restored.taskId === 'global')
            restored.metadata.task_ids = [taskId];
        if (restored.metadata.task_sources !== undefined)
            restored.metadata.task_sources = source ? [structuredClone(source)] : [];
        state.assets.push(restored);
        mapping.set(old.id, restored.id);
    }
    return { mapping, warnings };
}
export function remapTaskAssetReferences(tables, mapping) {
    const remap = (id) => mapping.get(id) ?? id;
    const fields = (data) => {
        for (const key of ['asset_ids', 'assetIds'])
            if (Array.isArray(data[key]))
                data[key] = [...new Set(strings(data[key]).map(remap))];
    };
    // Asset graph nodes are projections of live rows; syncRecordGraph regenerates them.
    tables.nodes = tables.nodes.filter(node => node.kind !== 'asset');
    for (const node of tables.nodes) {
        fields(node.data);
    }
    for (const intent of tables.intents) {
        fields(intent.input);
        if (intent.output)
            fields(intent.output);
    }
    for (const finding of tables.findings)
        finding.assetIds = [...new Set(finding.assetIds.map(remap))];
    for (const edge of tables.edges) {
        edge.from = remap(edge.from);
        edge.to = remap(edge.to);
    }
}
