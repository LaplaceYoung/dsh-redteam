import { type TaskLLMChainState } from './llm-chain.js';
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
    id: string;
    title: string;
    goal: string;
    status: ManagedTaskStatus;
    createdAt: string;
    updatedAt: string;
}
export interface TaskCategory {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
}
export type TaskRuleKind = 'exact_domain' | 'exact_ip' | 'exact_url' | 'fuzzy_domain' | 'fuzzy_ip' | 'fuzzy_url' | 'cidr';
export interface TaskRuleInput {
    enabled: boolean;
    action: 'block' | 'allow';
    kind: TaskRuleKind;
    pattern: string;
    note: string;
}
export interface TaskAssetRule extends TaskRuleInput {
    id: string;
    taskId: string;
    createdAt: string;
    updatedAt: string;
}
export interface TaskTemplate {
    id: string;
    name: string;
    description: string;
    goal: string;
    categoryId: string | null;
    interceptRules: TaskRuleInput[];
    createdAt: string;
    updatedAt: string;
}
export interface TaskManagementCollections {
    taskCategories: TaskCategory[];
    taskTemplates: TaskTemplate[];
    taskAssetRules: TaskAssetRule[];
}
export interface TaskManagementState extends TaskManagementCollections {
    tasks: ManagedTask[];
}
export interface NewTaskInput {
    title?: string;
    description?: string;
    goal?: string;
    templateId?: string;
    categoryId?: string | null;
    sourceTaskIds?: string[];
    companyIds?: string[];
    parentRef?: string;
    timeoutSeconds?: number;
    planHeartbeatSeconds?: number;
    coverageEnabled?: boolean;
    seedFirstIntent?: boolean;
    interceptRules?: TaskRuleInput[];
    llmProfileIds?: string[];
}
export declare class TaskManagementError extends Error {
    readonly code: 'invalid' | 'not_found' | 'conflict';
    constructor(code: 'invalid' | 'not_found' | 'conflict', message: string);
}
export declare function requireManagedTask(state: Pick<TaskManagementState, 'tasks'>, id: string): ManagedTask;
export declare function emptyTaskManagement(): TaskManagementCollections;
/** Call only at the persisted-data boundary; never reset existing collections. */
export declare function initializeTaskManagement(state: {
    tasks: ManagedTask[];
} & Partial<TaskManagementCollections>): asserts state is TaskManagementState;
export declare function createTaskCategory(state: TaskManagementState, name: string, now?: Date): TaskCategory;
export declare function renameTaskCategory(state: TaskManagementState, id: string, name: string, now?: Date): TaskCategory;
export declare function listTaskCategories(state: TaskManagementState): Array<TaskCategory & {
    taskCount: number;
}>;
export declare function deleteTaskCategory(state: TaskManagementState, id: string): boolean;
/** ARTEX batch move skips vanished task ids, returns the ids actually moved. */
export declare function setTasksCategory(state: TaskManagementState, taskIds: string[], categoryId: string | null): string[];
export declare function setTaskCategory(state: TaskManagementState, taskId: string, categoryId: string | null): ManagedTask;
export declare function normalizeTaskRule(input: TaskRuleInput): TaskRuleInput;
export type TaskTemplateInput = Pick<TaskTemplate, 'name' | 'description' | 'goal'> & Partial<Pick<TaskTemplate, 'categoryId' | 'interceptRules'>>;
export type TaskTemplatePatch = Partial<TaskTemplateInput>;
export declare function createTaskTemplate(state: TaskManagementState, input: TaskTemplateInput, now?: Date): TaskTemplate;
export declare function patchTaskTemplate(state: TaskManagementState, id: string, patch: TaskTemplatePatch, now?: Date): TaskTemplate;
export declare function listTaskTemplates(state: TaskManagementState): TaskTemplate[];
export declare function deleteTaskTemplate(state: TaskManagementState, id: string): boolean;
/** Caller adds origin graph/goals and company asset links in the same store transaction. */
export declare function createManagedTask(state: TaskManagementState, input: NewTaskInput, now?: Date, companyIds?: readonly string[], availableProfileIds?: ReadonlySet<string>): ManagedTask;
export declare function patchTaskMetadata(state: TaskManagementState, id: string, patch: {
    title?: string;
    pinned?: boolean;
}, now?: Date): ManagedTask;
export declare function listManagedTasks(state: Pick<TaskManagementState, 'tasks'>): ManagedTask[];
export declare function isTerminalTask(status: string): boolean;
export declare function stampTaskFirstRun(state: Pick<TaskManagementState, 'tasks'>, id: string, now?: Date): ManagedTask;
/** First terminal writer wins. Call inside the shared transaction, then cancel runtime work. */
export declare function finishManagedTask(state: Pick<TaskManagementState, 'tasks'>, id: string, status: 'done' | 'failed' | 'timeout', now?: Date): boolean;
export declare function pauseManagedTask(state: Pick<TaskManagementState, 'tasks'>, id: string, now?: Date): ManagedTask;
export interface AdmissionOptions {
    enabled: boolean;
    limit: number;
    ready?: (task: ManagedTask) => boolean;
    /** Host knows whether first-plan goals already exist even before the first model-call stamp. */
    hasGoals?: (task: ManagedTask) => boolean;
}
/** Admission reserves a slot; first-run clock is stamped only just before a real model call. */
export declare function admitManagedTask(state: Pick<TaskManagementState, 'tasks'>, id: string, options: AdmissionOptions, action?: 'start' | 'resume' | 'rerun', now?: Date): ManagedTask;
export declare function promoteQueuedTasks(state: Pick<TaskManagementState, 'tasks'>, options: AdmissionOptions, now?: Date): Array<{
    taskId: string;
    mode: QueueMode;
}>;
/** Provider outages release a slot only after in-flight model calls have settled. */
export declare function reconcileTaskAdmission(state: Pick<TaskManagementState, 'tasks'>, options: AdmissionOptions, hasActiveCalls: (task: ManagedTask) => boolean, now?: Date): {
    parked: string[];
    started: Array<{
        taskId: string;
        mode: QueueMode;
    }>;
};
/** Includes paused tasks: ARTEX uses a wall-clock deadline, not accumulated active time. */
export declare function expiredTaskIds(state: Pick<TaskManagementState, 'tasks'>, now?: Date): string[];
export declare function directSourceTasks(state: Pick<TaskManagementState, 'tasks'>, id: string): ManagedTask[];
export interface ContextRecord {
    id: string;
    taskId: string;
    kind?: string;
    state?: string;
    data?: Record<string, unknown>;
}
export type InheritedRecord<T> = T & {
    inherited: boolean;
    sourceTaskId?: string;
};
/** A copied read view, never an ownership change. No transitive sources, no live source intent. */
export declare function recordsWithDirectSources<T extends ContextRecord>(state: Pick<TaskManagementState, 'tasks'>, id: string, records: readonly T[], kind?: string): Array<InheritedRecord<T>>;
export declare function requireOwnedRecord<T extends ContextRecord>(taskId: string, records: readonly T[], id: string): T;
export declare function createTaskAssetRule(state: TaskManagementState, taskId: string, input: TaskRuleInput, now?: Date): TaskAssetRule;
export declare function updateTaskAssetRule(state: TaskManagementState, taskId: string, id: string, input: TaskRuleInput, now?: Date): TaskAssetRule;
export declare function toggleTaskAssetRule(state: TaskManagementState, taskId: string, id: string, enabled: boolean, now?: Date): TaskAssetRule;
export declare function deleteTaskAssetRule(state: TaskManagementState, taskId: string, id: string): boolean;
