import type { FindingPatch } from './findings-reports/types.js';
import * as taskManagement from './task-management/index.js';
import { type GlobalAssetRule } from './task-asset-runtime.js';
import type { Approval, Asset, Company, Constraint, Evidence, Finding, Goal, GraphEdge, GraphNode, Intent, InterceptRule, NotificationChannel, RedTeamSnapshot, RedTeamTask, Report, ScopeEntry, TaskArchive, TaskStatus, TrafficRecord, WorkerTrace } from './types.js';
export declare class RedTeamStore {
    private readonly backend;
    private readonly filePath;
    constructor(configuredPath?: string);
    load(): Promise<void>;
    private loadFromDisk;
    snapshot(): RedTeamSnapshot;
    /** Shared atomic transaction for domain runtimes; publish only after durable write. */
    transaction<T>(mutator: (state: RedTeamSnapshot) => T): Promise<T>;
    get storagePath(): string;
    private commit;
    createTask(title: string, goal: string): Promise<RedTeamTask>;
    createManagedTask(input: taskManagement.NewTaskInput, availableProfileIds?: ReadonlySet<string>): Promise<RedTeamTask>;
    createTaskCategory(name: string): Promise<taskManagement.TaskCategory>;
    renameTaskCategory(id: string, name: string): Promise<taskManagement.TaskCategory>;
    deleteTaskCategory(id: string): Promise<boolean>;
    listTaskCategories(): (taskManagement.TaskCategory & {
        taskCount: number;
    })[];
    createTaskTemplate(input: taskManagement.TaskTemplateInput): Promise<taskManagement.TaskTemplate>;
    updateTaskTemplate(id: string, patch: taskManagement.TaskTemplatePatch): Promise<taskManagement.TaskTemplate>;
    deleteTaskTemplate(id: string): Promise<boolean>;
    listTaskTemplates(): taskManagement.TaskTemplate[];
    updateTaskMetadata(id: string, patch: {
        title?: string;
        pinned?: boolean;
    }): Promise<taskManagement.ManagedTask>;
    setTasksCategory(taskIds: string[], categoryId: string | null): Promise<string[]>;
    createTaskAssetRule(taskId: string, input: taskManagement.TaskRuleInput): Promise<taskManagement.TaskAssetRule>;
    updateTaskAssetRule(taskId: string, id: string, input: taskManagement.TaskRuleInput): Promise<taskManagement.TaskAssetRule>;
    toggleTaskAssetRule(taskId: string, id: string, enabled: boolean): Promise<taskManagement.TaskAssetRule>;
    deleteTaskAssetRule(taskId: string, id: string): Promise<boolean>;
    listGlobalAssetRules(): GlobalAssetRule[];
    createGlobalAssetRule(input: Omit<taskManagement.TaskRuleInput, 'action'>): Promise<GlobalAssetRule>;
    updateGlobalAssetRule(id: string, input: Omit<taskManagement.TaskRuleInput, 'action'>): Promise<GlobalAssetRule>;
    toggleGlobalAssetRule(id: string, enabled: boolean): Promise<GlobalAssetRule>;
    deleteGlobalAssetRule(id: string): Promise<boolean>;
    setTaskStatus(taskId: string, status: TaskStatus): Promise<RedTeamTask>;
    importSnapshot(input: Partial<RedTeamSnapshot>): Promise<RedTeamSnapshot>;
    addAsset(input: Omit<Asset, 'id' | 'createdAt'>): Promise<Asset>;
    addNode(input: GraphNode): Promise<GraphNode>;
    addEdge(input: Omit<GraphEdge, 'id'>): Promise<GraphEdge>;
    addIntent(input: Omit<Intent, 'id' | 'createdAt' | 'updatedAt' | 'state'> & {
        state?: Intent['state'];
    }): Promise<Intent>;
    updateIntent(intentId: string, patch: Partial<Pick<Intent, 'state' | 'worker' | 'output'>>): Promise<Intent>;
    claimIntent(taskId: string, worker: string, runtime?: {
        execution: import('./types.js').WorkerExecution;
        concurrency: number;
    }): Promise<Intent | undefined>;
    setWorkerMessage(intentId: string, messageId: string): Promise<void>;
    /**
     * Attach the provider-owned child identity after DSH Agent Teams allocates
     * its durable teammate Session. The intent is claimed first so the normal
     * ARTEX concurrency gate remains atomic; this method only changes the
     * provider binding before Worker events are admitted.
     */
    setWorkerExecution(intentId: string, execution: import('./types.js').WorkerExecution): Promise<void>;
    recordWorkerEvent(childSessionId: string, seq: number, trace: Pick<WorkerTrace, 'kind' | 'summary' | 'data'>, patch?: Partial<Pick<Intent, 'state' | 'output'>>): Promise<void>;
    addFinding(input: Omit<Finding, 'id' | 'createdAt'>): Promise<Finding>;
    updateFinding(id: string, patch: FindingPatch): Promise<Finding>;
    updateFindingAtomic(id: string, decide: (state: RedTeamSnapshot, finding: Finding) => FindingPatch): Promise<Finding>;
    addEvidence(input: Omit<Evidence, 'id' | 'createdAt'>): Promise<Evidence>;
    addTrace(input: Omit<WorkerTrace, 'id' | 'createdAt'>): Promise<WorkerTrace>;
    addApproval(input: Omit<Approval, 'id' | 'requestedAt'>): Promise<Approval>;
    addGoal(input: Omit<Goal, 'id' | 'createdAt' | 'updatedAt'>): Promise<Goal>;
    updateGoal(id: string, patch: Partial<Pick<Goal, 'text' | 'vulnClass' | 'state'>>): Promise<Goal>;
    deleteGoal(id: string): Promise<Goal>;
    addConstraint(input: Omit<Constraint, 'id' | 'createdAt' | 'updatedAt'>): Promise<Constraint>;
    updateConstraint(id: string, patch: Partial<Pick<Constraint, 'kind' | 'text'>>): Promise<Constraint>;
    deleteConstraint(id: string): Promise<Constraint>;
    addScope(input: Omit<ScopeEntry, 'id' | 'createdAt'>): Promise<ScopeEntry>;
    addCompany(input: Omit<Company, 'id' | 'createdAt' | 'updatedAt'>): Promise<Company>;
    updateCompany(id: string, patch: Partial<Pick<Company, 'name' | 'description'>>): Promise<Company>;
    deleteScope(id: string): Promise<ScopeEntry>;
    addTraffic(input: Omit<TrafficRecord, 'id' | 'createdAt'>, prepare?: () => Promise<void | (() => Promise<void>)>): Promise<TrafficRecord>;
    addInterceptRule(input: Omit<InterceptRule, 'id' | 'createdAt' | 'updatedAt'>): Promise<InterceptRule>;
    updateInterceptRule(id: string, patch: Partial<Pick<InterceptRule, 'enabled' | 'priority' | 'pattern' | 'action' | 'message'>>): Promise<InterceptRule>;
    deleteInterceptRule(id: string): Promise<InterceptRule>;
    addArchive(input: Omit<TaskArchive, 'id' | 'createdAt' | 'updatedAt'>): Promise<TaskArchive>;
    updateArchive(id: string, patch: Partial<Pick<TaskArchive, 'state' | 'progress' | 'error'>>): Promise<TaskArchive>;
    setReport(taskId: string, markdown: string): Promise<Report>;
    addNotificationChannel(input: Omit<NotificationChannel, 'id' | 'createdAt' | 'updatedAt'>): Promise<NotificationChannel>;
    updateNotificationChannel(id: string, patch: Partial<Pick<NotificationChannel, 'name' | 'mode' | 'enabled' | 'config' | 'filter' | 'ratePerMin'>>): Promise<NotificationChannel>;
    private addRecord;
    private updateRecord;
}
