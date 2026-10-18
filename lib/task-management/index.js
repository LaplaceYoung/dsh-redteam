import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { emptyTaskLLMChain, replaceTaskLLMProfiles } from './llm-chain.js';
export * from './llm-chain.js';
export class TaskManagementError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'TaskManagementError';
    }
}
const fail = (code, message) => { throw new TaskManagementError(code, message); };
const stamp = (now) => now.toISOString();
function text(value, field, max, collapse = false) {
    if (typeof value !== 'string')
        return fail('invalid', `${field} must be a string`);
    const result = collapse ? value.trim().split(/\s+/u).join(' ') : value.trim();
    if (!result || [...result].length > max)
        return fail('invalid', `${field} must contain 1-${max} characters`);
    return result;
}
function integer(value, field) {
    if (!Number.isSafeInteger(value))
        return fail('invalid', `${field} must be an integer`);
    return value;
}
function ids(values, limit, field) {
    if (!Array.isArray(values) || values.length > limit || values.some(v => typeof v !== 'string' || !v.trim()))
        return fail('invalid', `${field} must contain at most ${limit} valid ids`);
    const normalized = values.map(v => v.trim());
    if (new Set(normalized).size !== normalized.length)
        return fail('invalid', `${field} contains duplicate ids`);
    return normalized;
}
export function requireManagedTask(state, id) {
    return state.tasks.find(t => t.id === id) ?? fail('not_found', `task not found: ${id}`);
}
function requireCategory(state, id) {
    if (id !== null && !state.taskCategories.some(c => c.id === id))
        fail('not_found', `task category not found: ${id}`);
}
export function emptyTaskManagement() { return { taskCategories: [], taskTemplates: [], taskAssetRules: [] }; }
/** Call only at the persisted-data boundary; never reset existing collections. */
export function initializeTaskManagement(state) {
    state.taskCategories ??= [];
    state.taskTemplates ??= [];
    state.taskAssetRules ??= [];
    for (const task of state.tasks) {
        task.description ??= task.title;
        task.sourceTaskIds ??= [];
        task.companyIds ??= [];
        task.timeoutSeconds ??= 0;
        task.planHeartbeatSeconds ??= 600;
        task.coverageEnabled ??= true;
        task.seedFirstIntent ??= false;
        task.queued ??= false;
        task.llmChain ??= emptyTaskLLMChain();
    }
}
function categoryName(state, value, except) {
    const name = text(value, 'category name', 80, true);
    if (state.taskCategories.some(c => c.id !== except && c.name.toLowerCase() === name.toLowerCase()))
        fail('conflict', 'task category name already exists');
    return name;
}
export function createTaskCategory(state, name, now = new Date()) {
    const row = { id: randomUUID(), name: categoryName(state, name), createdAt: stamp(now), updatedAt: stamp(now) };
    state.taskCategories.push(row);
    return row;
}
export function renameTaskCategory(state, id, name, now = new Date()) {
    const row = state.taskCategories.find(c => c.id === id) ?? fail('not_found', `task category not found: ${id}`);
    row.name = categoryName(state, name, id);
    row.updatedAt = stamp(now);
    return row;
}
export function listTaskCategories(state) {
    return state.taskCategories.map(c => ({ ...c, taskCount: state.tasks.filter(t => t.categoryId === c.id).length })).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
export function deleteTaskCategory(state, id) {
    const i = state.taskCategories.findIndex(c => c.id === id);
    if (i < 0)
        return false;
    state.taskCategories.splice(i, 1);
    for (const row of [...state.tasks, ...state.taskTemplates])
        if (row.categoryId === id)
            row.categoryId = null;
    return true;
}
/** ARTEX batch move skips vanished task ids, returns the ids actually moved. */
export function setTasksCategory(state, taskIds, categoryId) {
    if (!taskIds.length)
        fail('invalid', 'task ids are required');
    const selected = ids([...new Set(taskIds)], 100, 'task ids');
    requireCategory(state, categoryId);
    const moved = [];
    for (const task of state.tasks)
        if (selected.includes(task.id)) {
            task.categoryId = categoryId;
            moved.push(task.id);
        }
    return moved;
}
export function setTaskCategory(state, taskId, categoryId) {
    const task = requireManagedTask(state, taskId);
    requireCategory(state, categoryId);
    task.categoryId = categoryId;
    return task;
}
export function normalizeTaskRule(input) {
    const pattern = text(input.pattern, 'rule pattern', Number.MAX_SAFE_INTEGER);
    const action = input.action || 'block';
    if (action !== 'block' && action !== 'allow')
        fail('invalid', 'rule action must be block or allow');
    if (typeof input.enabled !== 'boolean')
        fail('invalid', 'rule enabled must be boolean');
    const kinds = ['exact_domain', 'exact_ip', 'exact_url', 'fuzzy_domain', 'fuzzy_ip', 'fuzzy_url', 'cidr'];
    if (!kinds.includes(input.kind))
        fail('invalid', 'invalid rule kind');
    if (input.kind === 'exact_ip' && !isIP(pattern))
        fail('invalid', 'invalid exact_ip');
    if (input.kind === 'cidr') {
        const [address, prefix, extra] = pattern.split('/');
        const family = isIP(address);
        if (extra !== undefined || !family || prefix === undefined || !/^\d+$/.test(prefix) || Number(prefix) > (family === 4 ? 32 : 128))
            fail('invalid', 'invalid cidr');
    }
    return { enabled: input.enabled, action, kind: input.kind, pattern, note: input.note ?? '' };
}
function templateInput(state, input, except) {
    const name = text(input.name, 'template name', 120, true);
    if (state.taskTemplates.some(t => t.id !== except && t.name.toLowerCase() === name.toLowerCase()))
        fail('conflict', 'task template name already exists');
    const categoryId = input.categoryId ?? null;
    requireCategory(state, categoryId);
    return { name, description: text(input.description, 'description', 16000), goal: text(input.goal, 'goal', 16000), categoryId, interceptRules: (input.interceptRules ?? []).map(normalizeTaskRule) };
}
export function createTaskTemplate(state, input, now = new Date()) {
    const row = { ...templateInput(state, input), id: randomUUID(), createdAt: stamp(now), updatedAt: stamp(now) };
    state.taskTemplates.push(row);
    return row;
}
export function patchTaskTemplate(state, id, patch, now = new Date()) {
    const row = state.taskTemplates.find(t => t.id === id) ?? fail('not_found', `task template not found: ${id}`);
    if (!['name', 'description', 'goal', 'categoryId', 'interceptRules'].some(key => Object.hasOwn(patch, key)))
        fail('invalid', 'no template fields supplied');
    const next = templateInput(state, { ...row, ...patch }, id);
    Object.assign(row, next, { updatedAt: stamp(now) });
    return row;
}
export function listTaskTemplates(state) {
    return structuredClone(state.taskTemplates).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
}
export function deleteTaskTemplate(state, id) {
    const i = state.taskTemplates.findIndex(t => t.id === id);
    if (i < 0)
        return false;
    state.taskTemplates.splice(i, 1);
    return true;
}
/** Caller adds origin graph/goals and company asset links in the same store transaction. */
export function createManagedTask(state, input, now = new Date(), companyIds = [], availableProfileIds = new Set()) {
    const template = input.templateId === undefined ? undefined : state.taskTemplates.find(t => t.id === input.templateId) ?? fail('not_found', 'task template not found');
    const categoryId = input.categoryId === undefined ? template?.categoryId ?? null : input.categoryId;
    requireCategory(state, categoryId);
    const sources = ids(input.sourceTaskIds ?? [], 8, 'source task ids');
    for (const id of sources)
        requireManagedTask(state, id);
    const companies = ids([...new Set(input.companyIds ?? [])], 32, 'company ids');
    for (const id of companies)
        if (!companyIds.includes(id))
            fail('not_found', `company not found: ${id}`);
    if (input.parentRef !== undefined)
        requireManagedTask(state, input.parentRef);
    const rules = (input.interceptRules ?? template?.interceptRules ?? []).map(normalizeTaskRule);
    const llmChain = input.llmProfileIds?.length ? { ...replaceTaskLLMProfiles(emptyTaskLLMChain(), input.llmProfileIds, availableProfileIds), revision: 0 } : emptyTaskLLMChain();
    const description = input.description ?? template?.description ?? input.title ?? '';
    const normalizedDescription = description.trim() ? description : '未命名任务';
    const row = {
        id: randomUUID(), title: input.title?.trim() ?? '', description: normalizedDescription, goal: input.goal ?? template?.goal ?? '',
        status: 'draft', createdAt: stamp(now), updatedAt: stamp(now), categoryId, sourceTaskIds: sources, companyIds: companies,
        parentRef: input.parentRef, timeoutSeconds: Math.max(0, integer(input.timeoutSeconds ?? 0, 'timeout seconds')),
        planHeartbeatSeconds: Math.max(600, integer(input.planHeartbeatSeconds ?? 600, 'plan heartbeat seconds')),
        coverageEnabled: input.coverageEnabled ?? true, seedFirstIntent: input.seedFirstIntent ?? false, queued: false, llmChain,
    };
    state.tasks.push(row);
    state.taskAssetRules.push(...rules.map(rule => ({ ...rule, id: randomUUID(), taskId: row.id, createdAt: stamp(now), updatedAt: stamp(now) })));
    return row;
}
export function patchTaskMetadata(state, id, patch, now = new Date()) {
    const task = requireManagedTask(state, id);
    if (patch.title === undefined && patch.pinned === undefined)
        fail('invalid', 'title or pinned is required');
    const title = patch.title === undefined ? undefined : text(patch.title, 'task title', 200);
    if (patch.pinned !== undefined && typeof patch.pinned !== 'boolean')
        fail('invalid', 'pinned must be boolean');
    if (title !== undefined)
        task.title = title;
    if (patch.pinned === true)
        task.pinnedAt ??= stamp(now);
    if (patch.pinned === false)
        delete task.pinnedAt;
    task.updatedAt = stamp(now);
    return task;
}
export function listManagedTasks(state) {
    return structuredClone(state.tasks).reverse().sort((a, b) => Number(!!b.pinnedAt) - Number(!!a.pinnedAt) || (b.pinnedAt ?? '').localeCompare(a.pinnedAt ?? '') || b.createdAt.localeCompare(a.createdAt));
}
export function isTerminalTask(status) { return ['done', 'failed', 'timeout'].includes(status); }
export function stampTaskFirstRun(state, id, now = new Date()) {
    const task = requireManagedTask(state, id);
    if (task.status !== 'running' || task.queued)
        fail('conflict', 'task is not admitted for execution');
    if (!task.firstRunAt) {
        task.firstRunAt = stamp(now);
        if ((task.timeoutSeconds ?? 0) > 0)
            task.deadlineAt = stamp(new Date(now.getTime() + task.timeoutSeconds * 1000));
    }
    return task;
}
/** First terminal writer wins. Call inside the shared transaction, then cancel runtime work. */
export function finishManagedTask(state, id, status, now = new Date()) {
    const task = requireManagedTask(state, id);
    if (isTerminalTask(task.status))
        return false;
    task.status = status;
    task.completedAt = stamp(now);
    task.updatedAt = stamp(now);
    task.queued = false;
    delete task.queuedAt;
    delete task.queueMode;
    return true;
}
export function pauseManagedTask(state, id, now = new Date()) {
    const task = requireManagedTask(state, id);
    if (isTerminalTask(task.status) || task.status === 'paused')
        fail('conflict', 'only an active task can be paused');
    task.status = 'paused';
    task.queued = false;
    delete task.queuedAt;
    task.updatedAt = stamp(now);
    return task;
}
function resumeMode(task, options) {
    return task.queueMode ?? (task.firstRunAt || options.hasGoals?.(task) ? 'resume' : 'bootstrap');
}
function checkAdmission(options) {
    if (options.enabled && (!Number.isSafeInteger(options.limit) || options.limit < 1))
        fail('invalid', 'concurrency limit must be a positive integer');
}
/** Admission reserves a slot; first-run clock is stamped only just before a real model call. */
export function admitManagedTask(state, id, options, action = 'start', now = new Date()) {
    checkAdmission(options);
    const task = requireManagedTask(state, id);
    const previous = task.status;
    if (action === 'resume' && previous !== 'paused')
        fail('conflict', 'only a paused task can resume');
    if (isTerminalTask(previous) && action !== 'rerun')
        fail('conflict', 'terminal task requires explicit rerun');
    if (previous === 'running' && !task.queued)
        return task;
    const ready = options.ready ?? (() => true);
    const active = state.tasks.filter(t => t.id !== id && t.status === 'running' && !t.queued).length;
    const backlog = state.tasks.some(t => t.id !== id && t.queued && !isTerminalTask(t.status) && t.status !== 'paused' && ready(t));
    const queued = options.enabled && (!ready(task) || active >= options.limit || backlog);
    const mode = action === 'rerun' ? 'resume' : resumeMode(task, options);
    if (previous === 'timeout') {
        delete task.firstRunAt;
        delete task.deadlineAt;
    }
    task.status = 'running';
    delete task.completedAt;
    task.updatedAt = stamp(now);
    if (queued) {
        if (!task.queued)
            task.queuedAt = stamp(now);
        task.queueMode = mode;
    }
    else {
        delete task.queuedAt;
        delete task.queueMode;
    }
    task.queued = queued;
    return task;
}
export function promoteQueuedTasks(state, options, now = new Date()) {
    checkAdmission(options);
    const ready = options.ready ?? (() => true);
    let slots = options.enabled ? options.limit - state.tasks.filter(t => t.status === 'running' && !t.queued).length : state.tasks.length;
    const waiting = state.tasks.filter(t => t.queued && t.status === 'running').sort((a, b) => (a.queuedAt ?? a.createdAt).localeCompare(b.queuedAt ?? b.createdAt));
    const result = [];
    for (const task of waiting) {
        if (slots <= 0)
            break;
        if (!ready(task))
            continue;
        result.push({ taskId: task.id, mode: resumeMode(task, options) });
        task.queued = false;
        delete task.queuedAt;
        delete task.queueMode;
        task.updatedAt = stamp(now);
        slots--;
    }
    return result;
}
/** Provider outages release a slot only after in-flight model calls have settled. */
export function reconcileTaskAdmission(state, options, hasActiveCalls, now = new Date()) {
    checkAdmission(options);
    const parked = [];
    const ready = options.ready ?? (() => true);
    if (options.enabled)
        for (const task of state.tasks) {
            if (task.status !== 'running' || task.queued || ready(task) || hasActiveCalls(task))
                continue;
            task.queued = true;
            task.queuedAt = stamp(now);
            task.queueMode = resumeMode(task, options);
            task.updatedAt = stamp(now);
            parked.push(task.id);
        }
    return { parked, started: promoteQueuedTasks(state, options, now) };
}
/** Includes paused tasks: ARTEX uses a wall-clock deadline, not accumulated active time. */
export function expiredTaskIds(state, now = new Date()) {
    return state.tasks.filter(t => !isTerminalTask(t.status) && t.deadlineAt && Date.parse(t.deadlineAt) <= now.getTime()).map(t => t.id);
}
export function directSourceTasks(state, id) {
    const task = requireManagedTask(state, id);
    return (task.sourceTaskIds ?? []).flatMap(sourceId => { const source = state.tasks.find(t => t.id === sourceId); return source ? [structuredClone(source)] : []; });
}
/** A copied read view, never an ownership change. No transitive sources, no live source intent. */
export function recordsWithDirectSources(state, id, records, kind) {
    const owners = [id, ...directSourceTasks(state, id).map(t => t.id)];
    return owners.flatMap(owner => records.filter(row => row.taskId === owner && (kind === undefined || row.kind === kind) &&
        (owner === id || row.kind !== 'intent' || ['done', 'blocked', 'exhausted', 'stopped'].includes(String(row.state ?? row.data?.state))))
        .map(row => ({ ...structuredClone(row), inherited: owner !== id, ...(owner !== id ? { sourceTaskId: owner } : {}) })));
}
export function requireOwnedRecord(taskId, records, id) {
    const row = records.find(r => r.id === id) ?? fail('not_found', `record not found: ${id}`);
    if (row.taskId !== taskId)
        fail('conflict', 'inherited records are read-only');
    return row;
}
export function createTaskAssetRule(state, taskId, input, now = new Date()) {
    requireManagedTask(state, taskId);
    const row = { ...normalizeTaskRule(input), id: randomUUID(), taskId, createdAt: stamp(now), updatedAt: stamp(now) };
    state.taskAssetRules.push(row);
    return row;
}
export function updateTaskAssetRule(state, taskId, id, input, now = new Date()) {
    requireManagedTask(state, taskId);
    const row = requireOwnedRecord(taskId, state.taskAssetRules, id);
    Object.assign(row, normalizeTaskRule(input), { updatedAt: stamp(now) });
    return row;
}
export function toggleTaskAssetRule(state, taskId, id, enabled, now = new Date()) {
    requireManagedTask(state, taskId);
    const row = requireOwnedRecord(taskId, state.taskAssetRules, id);
    if (typeof enabled !== 'boolean')
        fail('invalid', 'enabled must be boolean');
    row.enabled = enabled;
    row.updatedAt = stamp(now);
    return row;
}
export function deleteTaskAssetRule(state, taskId, id) {
    requireManagedTask(state, taskId);
    const index = state.taskAssetRules.findIndex(r => r.id === id && r.taskId === taskId);
    if (index < 0)
        return false;
    state.taskAssetRules.splice(index, 1);
    return true;
}
