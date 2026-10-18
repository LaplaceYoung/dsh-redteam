import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { emptyTaskLLMChain, replaceTaskLLMProfiles, type TaskLLMChainState } from './llm-chain.js';
export * from './llm-chain.js';

export type ManagedTaskStatus = 'draft' | 'running' | 'paused' | 'done' | 'failed' | 'timeout';
export type QueueMode = 'bootstrap' | 'resume';
/** Optional on old snapshots; initializeTaskManagement supplies their migration defaults. */
export interface TaskManagementFields {
  description?: string;
  categoryId?: string | null;
  pinnedAt?: string;
  sourceTaskIds?: string[];
  companyIds?: string[];
  parentRef?: string;
  timeoutSeconds?: number;
  planHeartbeatSeconds?: number;
  coverageEnabled?: boolean;
  seedFirstIntent?: boolean;
  firstRunAt?: string;
  deadlineAt?: string;
  completedAt?: string;
  queued?: boolean;
  queuedAt?: string;
  queueMode?: QueueMode;
  llmChain?: TaskLLMChainState;
}
export interface ManagedTask extends TaskManagementFields {
  id: string; title: string; goal: string; status: ManagedTaskStatus; createdAt: string; updatedAt: string;
}
export interface TaskCategory { id: string; name: string; createdAt: string; updatedAt: string }
export type TaskRuleKind = 'exact_domain' | 'exact_ip' | 'exact_url' | 'fuzzy_domain' | 'fuzzy_ip' | 'fuzzy_url' | 'cidr';
export interface TaskRuleInput { enabled: boolean; action: 'block' | 'allow'; kind: TaskRuleKind; pattern: string; note: string }
export interface TaskAssetRule extends TaskRuleInput { id: string; taskId: string; createdAt: string; updatedAt: string }
export interface TaskTemplate {
  id: string; name: string; description: string; goal: string; categoryId: string | null;
  interceptRules: TaskRuleInput[]; createdAt: string; updatedAt: string;
}
export interface TaskManagementCollections { taskCategories: TaskCategory[]; taskTemplates: TaskTemplate[]; taskAssetRules: TaskAssetRule[] }
export interface TaskManagementState extends TaskManagementCollections { tasks: ManagedTask[] }
export interface NewTaskInput {
  title?: string; description?: string; goal?: string; templateId?: string; categoryId?: string | null;
  sourceTaskIds?: string[]; companyIds?: string[]; parentRef?: string; timeoutSeconds?: number;
  planHeartbeatSeconds?: number; coverageEnabled?: boolean; seedFirstIntent?: boolean; interceptRules?: TaskRuleInput[];
  llmProfileIds?: string[];
}
export class TaskManagementError extends Error {
  constructor(public readonly code: 'invalid' | 'not_found' | 'conflict', message: string) { super(message); this.name = 'TaskManagementError'; }
}
const fail = (code: TaskManagementError['code'], message: string): never => { throw new TaskManagementError(code, message); };
const stamp = (now: Date) => now.toISOString();
function text(value: string, field: string, max: number, collapse = false): string {
  if (typeof value !== 'string') return fail('invalid', `${field} must be a string`);
  const result = collapse ? value.trim().split(/\s+/u).join(' ') : value.trim();
  if (!result || [...result].length > max) return fail('invalid', `${field} must contain 1-${max} characters`);
  return result;
}
function integer(value: number, field: string): number {
  if (!Number.isSafeInteger(value)) return fail('invalid', `${field} must be an integer`);
  return value;
}
function ids(values: string[], limit: number, field: string): string[] {
  if (!Array.isArray(values) || values.length > limit || values.some(v => typeof v !== 'string' || !v.trim())) return fail('invalid', `${field} must contain at most ${limit} valid ids`);
  const normalized = values.map(v => v.trim());
  if (new Set(normalized).size !== normalized.length) return fail('invalid', `${field} contains duplicate ids`);
  return normalized;
}
export function requireManagedTask(state: Pick<TaskManagementState, 'tasks'>, id: string): ManagedTask {
  return state.tasks.find(t => t.id === id) ?? fail('not_found', `task not found: ${id}`);
}
function requireCategory(state: TaskManagementState, id: string | null): void {
  if (id !== null && !state.taskCategories.some(c => c.id === id)) fail('not_found', `task category not found: ${id}`);
}
export function emptyTaskManagement(): TaskManagementCollections { return { taskCategories: [], taskTemplates: [], taskAssetRules: [] }; }
/** Call only at the persisted-data boundary; never reset existing collections. */
export function initializeTaskManagement(state: { tasks: ManagedTask[] } & Partial<TaskManagementCollections>): asserts state is TaskManagementState {
  state.taskCategories ??= []; state.taskTemplates ??= []; state.taskAssetRules ??= [];
  for (const task of state.tasks) {
    task.description ??= task.title; task.sourceTaskIds ??= []; task.companyIds ??= [];
    task.timeoutSeconds ??= 0; task.planHeartbeatSeconds ??= 600; task.coverageEnabled ??= true;
    task.seedFirstIntent ??= false; task.queued ??= false;
    task.llmChain ??= emptyTaskLLMChain();
  }
}
function categoryName(state: TaskManagementState, value: string, except?: string): string {
  const name = text(value, 'category name', 80, true);
  if (state.taskCategories.some(c => c.id !== except && c.name.toLowerCase() === name.toLowerCase())) fail('conflict', 'task category name already exists');
  return name;
}
export function createTaskCategory(state: TaskManagementState, name: string, now = new Date()): TaskCategory {
  const row = { id: randomUUID(), name: categoryName(state, name), createdAt: stamp(now), updatedAt: stamp(now) };
  state.taskCategories.push(row); return row;
}
export function renameTaskCategory(state: TaskManagementState, id: string, name: string, now = new Date()): TaskCategory {
  const row = state.taskCategories.find(c => c.id === id) ?? fail('not_found', `task category not found: ${id}`);
  row.name = categoryName(state, name, id); row.updatedAt = stamp(now); return row;
}
export function listTaskCategories(state: TaskManagementState): Array<TaskCategory & { taskCount: number }> {
  return state.taskCategories.map(c => ({ ...c, taskCount: state.tasks.filter(t => t.categoryId === c.id).length })).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
export function deleteTaskCategory(state: TaskManagementState, id: string): boolean {
  const i = state.taskCategories.findIndex(c => c.id === id); if (i < 0) return false;
  state.taskCategories.splice(i, 1);
  for (const row of [...state.tasks, ...state.taskTemplates]) if (row.categoryId === id) row.categoryId = null;
  return true;
}
/** ARTEX batch move skips vanished task ids, returns the ids actually moved. */
export function setTasksCategory(state: TaskManagementState, taskIds: string[], categoryId: string | null): string[] {
  if (!taskIds.length) fail('invalid', 'task ids are required');
  const selected = ids([...new Set(taskIds)], 100, 'task ids'); requireCategory(state, categoryId);
  const moved: string[] = [];
  for (const task of state.tasks) if (selected.includes(task.id)) { task.categoryId = categoryId; moved.push(task.id); }
  return moved;
}
export function setTaskCategory(state: TaskManagementState, taskId: string, categoryId: string | null): ManagedTask {
  const task = requireManagedTask(state, taskId); requireCategory(state, categoryId); task.categoryId = categoryId; return task;
}
export function normalizeTaskRule(input: TaskRuleInput): TaskRuleInput {
  const pattern = text(input.pattern, 'rule pattern', Number.MAX_SAFE_INTEGER);
  const action = input.action || 'block';
  if (action !== 'block' && action !== 'allow') fail('invalid', 'rule action must be block or allow');
  if (typeof input.enabled !== 'boolean') fail('invalid', 'rule enabled must be boolean');
  const kinds: TaskRuleKind[] = ['exact_domain', 'exact_ip', 'exact_url', 'fuzzy_domain', 'fuzzy_ip', 'fuzzy_url', 'cidr'];
  if (!kinds.includes(input.kind)) fail('invalid', 'invalid rule kind');
  if (input.kind === 'exact_ip' && !isIP(pattern)) fail('invalid', 'invalid exact_ip');
  if (input.kind === 'cidr') {
    const [address, prefix, extra] = pattern.split('/'); const family = isIP(address);
    if (extra !== undefined || !family || prefix === undefined || !/^\d+$/.test(prefix) || Number(prefix) > (family === 4 ? 32 : 128)) fail('invalid', 'invalid cidr');
  }
  return { enabled: input.enabled, action, kind: input.kind, pattern, note: input.note ?? '' };
}
export type TaskTemplateInput = Pick<TaskTemplate, 'name' | 'description' | 'goal'> & Partial<Pick<TaskTemplate, 'categoryId' | 'interceptRules'>>;
export type TaskTemplatePatch = Partial<TaskTemplateInput>;
function templateInput(state: TaskManagementState, input: TaskTemplateInput, except?: string) {
  const name = text(input.name, 'template name', 120, true);
  if (state.taskTemplates.some(t => t.id !== except && t.name.toLowerCase() === name.toLowerCase())) fail('conflict', 'task template name already exists');
  const categoryId = input.categoryId ?? null; requireCategory(state, categoryId);
  return { name, description: text(input.description, 'description', 16000), goal: text(input.goal, 'goal', 16000), categoryId, interceptRules: (input.interceptRules ?? []).map(normalizeTaskRule) };
}
export function createTaskTemplate(state: TaskManagementState, input: TaskTemplateInput, now = new Date()): TaskTemplate {
  const row = { ...templateInput(state, input), id: randomUUID(), createdAt: stamp(now), updatedAt: stamp(now) };
  state.taskTemplates.push(row); return row;
}
export function patchTaskTemplate(state: TaskManagementState, id: string, patch: TaskTemplatePatch, now = new Date()): TaskTemplate {
  const row = state.taskTemplates.find(t => t.id === id) ?? fail('not_found', `task template not found: ${id}`);
  if (!['name', 'description', 'goal', 'categoryId', 'interceptRules'].some(key => Object.hasOwn(patch, key))) fail('invalid', 'no template fields supplied');
  const next = templateInput(state, { ...row, ...patch }, id); Object.assign(row, next, { updatedAt: stamp(now) }); return row;
}
export function listTaskTemplates(state: TaskManagementState): TaskTemplate[] {
  return structuredClone(state.taskTemplates).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
}
export function deleteTaskTemplate(state: TaskManagementState, id: string): boolean {
  const i = state.taskTemplates.findIndex(t => t.id === id); if (i < 0) return false; state.taskTemplates.splice(i, 1); return true;
}
/** Caller adds origin graph/goals and company asset links in the same store transaction. */
export function createManagedTask(state: TaskManagementState, input: NewTaskInput, now = new Date(), companyIds: readonly string[] = [], availableProfileIds: ReadonlySet<string> = new Set()): ManagedTask {
  const template = input.templateId === undefined ? undefined : state.taskTemplates.find(t => t.id === input.templateId) ?? fail('not_found', 'task template not found');
  const categoryId = input.categoryId === undefined ? template?.categoryId ?? null : input.categoryId;
  requireCategory(state, categoryId);
  const sources = ids(input.sourceTaskIds ?? [], 8, 'source task ids'); for (const id of sources) requireManagedTask(state, id);
  const companies = ids([...new Set(input.companyIds ?? [])], 32, 'company ids');
  for (const id of companies) if (!companyIds.includes(id)) fail('not_found', `company not found: ${id}`);
  if (input.parentRef !== undefined) requireManagedTask(state, input.parentRef);
  const rules = (input.interceptRules ?? template?.interceptRules ?? []).map(normalizeTaskRule);
  const llmChain = input.llmProfileIds?.length ? { ...replaceTaskLLMProfiles(emptyTaskLLMChain(), input.llmProfileIds, availableProfileIds), revision: 0 } : emptyTaskLLMChain();
  const description = input.description ?? template?.description ?? input.title ?? '';
  const normalizedDescription = description.trim() ? description : '未命名任务';
  const row: ManagedTask = {
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
export function patchTaskMetadata(state: TaskManagementState, id: string, patch: { title?: string; pinned?: boolean }, now = new Date()): ManagedTask {
  const task = requireManagedTask(state, id);
  if (patch.title === undefined && patch.pinned === undefined) fail('invalid', 'title or pinned is required');
  const title = patch.title === undefined ? undefined : text(patch.title, 'task title', 200);
  if (patch.pinned !== undefined && typeof patch.pinned !== 'boolean') fail('invalid', 'pinned must be boolean');
  if (title !== undefined) task.title = title;
  if (patch.pinned === true) task.pinnedAt ??= stamp(now);
  if (patch.pinned === false) delete task.pinnedAt;
  task.updatedAt = stamp(now); return task;
}
export function listManagedTasks(state: Pick<TaskManagementState, 'tasks'>): ManagedTask[] {
  return structuredClone(state.tasks).reverse().sort((a, b) => Number(!!b.pinnedAt) - Number(!!a.pinnedAt) || (b.pinnedAt ?? '').localeCompare(a.pinnedAt ?? '') || b.createdAt.localeCompare(a.createdAt));
}
export function isTerminalTask(status: string): boolean { return ['done', 'failed', 'timeout'].includes(status); }
export function stampTaskFirstRun(state: Pick<TaskManagementState, 'tasks'>, id: string, now = new Date()): ManagedTask {
  const task = requireManagedTask(state, id);
  if (task.status !== 'running' || task.queued) fail('conflict', 'task is not admitted for execution');
  if (!task.firstRunAt) {
    task.firstRunAt = stamp(now);
    if ((task.timeoutSeconds ?? 0) > 0) task.deadlineAt = stamp(new Date(now.getTime() + task.timeoutSeconds! * 1000));
  }
  return task;
}
/** First terminal writer wins. Call inside the shared transaction, then cancel runtime work. */
export function finishManagedTask(state: Pick<TaskManagementState, 'tasks'>, id: string, status: 'done' | 'failed' | 'timeout', now = new Date()): boolean {
  const task = requireManagedTask(state, id); if (isTerminalTask(task.status)) return false;
  task.status = status; task.completedAt = stamp(now); task.updatedAt = stamp(now); task.queued = false;
  delete task.queuedAt; delete task.queueMode; return true;
}
export function pauseManagedTask(state: Pick<TaskManagementState, 'tasks'>, id: string, now = new Date()): ManagedTask {
  const task = requireManagedTask(state, id);
  if (isTerminalTask(task.status) || task.status === 'paused') fail('conflict', 'only an active task can be paused');
  task.status = 'paused'; task.queued = false; delete task.queuedAt; task.updatedAt = stamp(now); return task;
}
export interface AdmissionOptions {
  enabled: boolean; limit: number; ready?: (task: ManagedTask) => boolean;
  /** Host knows whether first-plan goals already exist even before the first model-call stamp. */
  hasGoals?: (task: ManagedTask) => boolean;
}
function resumeMode(task: ManagedTask, options: AdmissionOptions): QueueMode {
  return task.queueMode ?? (task.firstRunAt || options.hasGoals?.(task) ? 'resume' : 'bootstrap');
}
function checkAdmission(options: AdmissionOptions): void {
  if (options.enabled && (!Number.isSafeInteger(options.limit) || options.limit < 1)) fail('invalid', 'concurrency limit must be a positive integer');
}
/** Admission reserves a slot; first-run clock is stamped only just before a real model call. */
export function admitManagedTask(state: Pick<TaskManagementState, 'tasks'>, id: string, options: AdmissionOptions, action: 'start' | 'resume' | 'rerun' = 'start', now = new Date()): ManagedTask {
  checkAdmission(options); const task = requireManagedTask(state, id); const previous = task.status;
  if (action === 'resume' && previous !== 'paused') fail('conflict', 'only a paused task can resume');
  if (isTerminalTask(previous) && action !== 'rerun') fail('conflict', 'terminal task requires explicit rerun');
  if (previous === 'running' && !task.queued) return task;
  const ready = options.ready ?? (() => true);
  const active = state.tasks.filter(t => t.id !== id && t.status === 'running' && !t.queued).length;
  const backlog = state.tasks.some(t => t.id !== id && t.queued && !isTerminalTask(t.status) && t.status !== 'paused' && ready(t));
  const queued = options.enabled && (!ready(task) || active >= options.limit || backlog);
  const mode = action === 'rerun' ? 'resume' : resumeMode(task, options);
  if (previous === 'timeout') { delete task.firstRunAt; delete task.deadlineAt; }
  task.status = 'running'; delete task.completedAt; task.updatedAt = stamp(now);
  if (queued) { if (!task.queued) task.queuedAt = stamp(now); task.queueMode = mode; }
  else { delete task.queuedAt; delete task.queueMode; }
  task.queued = queued; return task;
}
export function promoteQueuedTasks(state: Pick<TaskManagementState, 'tasks'>, options: AdmissionOptions, now = new Date()): Array<{ taskId: string; mode: QueueMode }> {
  checkAdmission(options); const ready = options.ready ?? (() => true);
  let slots = options.enabled ? options.limit - state.tasks.filter(t => t.status === 'running' && !t.queued).length : state.tasks.length;
  const waiting = state.tasks.filter(t => t.queued && t.status === 'running').sort((a, b) => (a.queuedAt ?? a.createdAt).localeCompare(b.queuedAt ?? b.createdAt));
  const result: Array<{ taskId: string; mode: QueueMode }> = [];
  for (const task of waiting) {
    if (slots <= 0) break; if (!ready(task)) continue;
    result.push({ taskId: task.id, mode: resumeMode(task, options) });
    task.queued = false; delete task.queuedAt; delete task.queueMode; task.updatedAt = stamp(now); slots--;
  }
  return result;
}
/** Provider outages release a slot only after in-flight model calls have settled. */
export function reconcileTaskAdmission(state: Pick<TaskManagementState, 'tasks'>, options: AdmissionOptions, hasActiveCalls: (task: ManagedTask) => boolean, now = new Date()): { parked: string[]; started: Array<{ taskId: string; mode: QueueMode }> } {
  checkAdmission(options); const parked: string[] = []; const ready = options.ready ?? (() => true);
  if (options.enabled) for (const task of state.tasks) {
    if (task.status !== 'running' || task.queued || ready(task) || hasActiveCalls(task)) continue;
    task.queued = true; task.queuedAt = stamp(now); task.queueMode = resumeMode(task, options); task.updatedAt = stamp(now);
    parked.push(task.id);
  }
  return { parked, started: promoteQueuedTasks(state, options, now) };
}
/** Includes paused tasks: ARTEX uses a wall-clock deadline, not accumulated active time. */
export function expiredTaskIds(state: Pick<TaskManagementState, 'tasks'>, now = new Date()): string[] {
  return state.tasks.filter(t => !isTerminalTask(t.status) && t.deadlineAt && Date.parse(t.deadlineAt) <= now.getTime()).map(t => t.id);
}
export function directSourceTasks(state: Pick<TaskManagementState, 'tasks'>, id: string): ManagedTask[] {
  const task = requireManagedTask(state, id);
  return (task.sourceTaskIds ?? []).flatMap(sourceId => { const source = state.tasks.find(t => t.id === sourceId); return source ? [structuredClone(source)] : []; });
}
export interface ContextRecord { id: string; taskId: string; kind?: string; state?: string; data?: Record<string, unknown> }
export type InheritedRecord<T> = T & { inherited: boolean; sourceTaskId?: string };
/** A copied read view, never an ownership change. No transitive sources, no live source intent. */
export function recordsWithDirectSources<T extends ContextRecord>(state: Pick<TaskManagementState, 'tasks'>, id: string, records: readonly T[], kind?: string): Array<InheritedRecord<T>> {
  const owners = [id, ...directSourceTasks(state, id).map(t => t.id)];
  return owners.flatMap(owner => records.filter(row => row.taskId === owner && (kind === undefined || row.kind === kind) &&
    (owner === id || row.kind !== 'intent' || ['done', 'blocked', 'exhausted', 'stopped'].includes(String(row.state ?? row.data?.state))))
    .map(row => ({ ...structuredClone(row), inherited: owner !== id, ...(owner !== id ? { sourceTaskId: owner } : {}) })));
}
export function requireOwnedRecord<T extends ContextRecord>(taskId: string, records: readonly T[], id: string): T {
  const row = records.find(r => r.id === id) ?? fail('not_found', `record not found: ${id}`);
  if (row.taskId !== taskId) fail('conflict', 'inherited records are read-only'); return row;
}
export function createTaskAssetRule(state: TaskManagementState, taskId: string, input: TaskRuleInput, now = new Date()): TaskAssetRule {
  requireManagedTask(state, taskId);
  const row = { ...normalizeTaskRule(input), id: randomUUID(), taskId, createdAt: stamp(now), updatedAt: stamp(now) };
  state.taskAssetRules.push(row); return row;
}
export function updateTaskAssetRule(state: TaskManagementState, taskId: string, id: string, input: TaskRuleInput, now = new Date()): TaskAssetRule {
  requireManagedTask(state, taskId); const row = requireOwnedRecord(taskId, state.taskAssetRules, id);
  Object.assign(row, normalizeTaskRule(input), { updatedAt: stamp(now) }); return row;
}
export function toggleTaskAssetRule(state: TaskManagementState, taskId: string, id: string, enabled: boolean, now = new Date()): TaskAssetRule {
  requireManagedTask(state, taskId); const row = requireOwnedRecord(taskId, state.taskAssetRules, id);
  if (typeof enabled !== 'boolean') fail('invalid', 'enabled must be boolean');
  row.enabled = enabled; row.updatedAt = stamp(now); return row;
}
export function deleteTaskAssetRule(state: TaskManagementState, taskId: string, id: string): boolean {
  requireManagedTask(state, taskId); const index = state.taskAssetRules.findIndex(r => r.id === id && r.taskId === taskId);
  if (index < 0) return false; state.taskAssetRules.splice(index, 1); return true;
}
