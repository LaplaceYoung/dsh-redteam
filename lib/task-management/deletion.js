import { detachTaskAssets } from '../shared-assets.js';
import { TaskManagementError } from './index.js';
/** Atomic data phase. The lifecycle caller must drain real task execution first. */
export function deleteManagedTaskData(state, taskId, options = {}) {
    for (const key of ['deleteAssets', 'deleteFindings'])
        if (options[key] !== undefined && typeof options[key] !== 'boolean')
            throw new TaskManagementError('invalid', `${key} must be boolean`);
    const result = { taskId, deleted: false, assetsDeleted: 0, assetsDetached: 0, findingsDeleted: 0 };
    const task = state.tasks.find(row => row.id === taskId);
    if (!task)
        return result;
    if (task.status === 'running' || state.intents.some(row => row.taskId === taskId && ['claimed', 'running'].includes(row.state)))
        throw new TaskManagementError('conflict', 'task execution must be drained before deletion');
    if (state.archives.some(row => row.taskId === taskId && !['failed', 'archive_failed'].includes(row.state)))
        throw new TaskManagementError('conflict', 'task has an active archive operation');
    const eventIds = new Set(state.notificationEvents.filter(row => row.snapshot.taskId === taskId).map(row => row.id));
    if (state.notificationDeliveries.some(row => eventIds.has(row.eventId) && row.state === 'sending'))
        throw new TaskManagementError('conflict', 'task has notification deliveries in flight');
    const assets = detachTaskAssets(state, taskId, { deleteExclusive: options.deleteAssets === true });
    result.assetsDeleted = assets.deleted.length;
    result.assetsDetached = assets.detached.length;
    if (options.deleteFindings) {
        result.findingsDeleted = state.findings.filter(row => row.taskId === taskId).length;
        state.findings = state.findings.filter(row => row.taskId !== taskId);
        state.notificationEvents = state.notificationEvents.filter(row => !eventIds.has(row.id));
        state.notificationDeliveries = state.notificationDeliveries.filter(row => !eventIds.has(row.eventId));
    }
    const retainedEvidence = new Set(state.findings.flatMap(row => row.evidenceIds));
    state.evidence = state.evidence.filter(row => row.taskId !== taskId || retainedEvidence.has(row.id));
    for (const key of ['nodes', 'edges', 'intents', 'traces', 'approvals', 'goals', 'constraints', 'scopes', 'interceptRules', 'reports', 'taskAssetRules']) {
        const rows = state[key];
        for (let i = rows.length - 1; i >= 0; i--)
            if (rows[i].taskId === taskId)
                rows.splice(i, 1);
    }
    state.tasks = state.tasks.filter(row => row.id !== taskId);
    for (const other of state.tasks)
        if (other.sourceTaskIds?.includes(taskId))
            other.sourceTaskIds = other.sourceTaskIds.filter(id => id !== taskId);
    state.archives = state.archives.filter(row => row.taskId !== taskId);
    // Disposable traffic and retained finding evidence are global stores with separate deletion APIs.
    result.deleted = true;
    return result;
}
