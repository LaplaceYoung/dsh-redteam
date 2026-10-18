import type { TaskManagementFields, TaskManagementCollections } from './task-management/index.js';
import type { FindingFields, FindingStatus } from './findings-reports/types.js';
export type TaskStatus = 'draft' | 'running' | 'paused' | 'done' | 'failed' | 'timeout';
export type IntentState = 'open' | 'claimed' | 'running' | 'done' | 'failed' | 'paused' | 'stopped' | 'exhausted' | 'blocked';
export interface RedTeamTask extends TaskManagementFields {
    templateId?: string;
    id: string;
    title: string;
    goal: string;
    status: TaskStatus;
    createdAt: string;
    updatedAt: string;
}
export interface Asset {
    companyId?: string;
    id: string;
    taskId: string;
    kind: string;
    value: string;
    source: 'user' | 'rea' | 'worker' | 'traffic';
    metadata: Record<string, unknown>;
    createdAt: string;
}
export interface GraphNode {
    id: string;
    taskId: string;
    kind: 'asset' | 'intent' | 'fact' | 'finding' | 'evidence';
    label: string;
    data: Record<string, unknown>;
}
export interface GraphEdge {
    id: string;
    taskId: string;
    from: string;
    to: string;
    relation: string;
}
export interface Intent {
    id: string;
    taskId: string;
    summary: string;
    state: IntentState;
    worker?: string;
    execution?: WorkerExecution;
    input: Record<string, unknown>;
    output?: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
}
export interface WorkerExecution {
    childSessionId: string;
    parentSessionId: string;
    provider: 'spawn' | 'fork';
    /** DSH Agent Teams durable name when this Worker was created as a teammate. */
    teamName?: string;
    messageId?: string;
    lastEventSeq?: number;
}
export interface Finding extends FindingFields {
    id: string;
    taskId: string;
    vulnClass: string;
    severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
    summary: string;
    evidenceIds: string[];
    assetIds: string[];
    status: FindingStatus;
    createdAt: string;
}
export interface Evidence {
    id: string;
    taskId: string;
    provider: 'rea' | 'artex' | 'traffic' | 'worker';
    command?: string;
    target?: string;
    summary: string;
    raw: unknown;
    createdAt: string;
}
export interface WorkerTrace {
    id: string;
    taskId: string;
    intentId?: string;
    worker: string;
    kind: 'start' | 'tool' | 'result' | 'error';
    summary: string;
    data?: Record<string, unknown>;
    createdAt: string;
}
export interface Approval {
    id: string;
    taskId: string;
    action: string;
    status: 'pending' | 'approved' | 'rejected';
    requestedAt: string;
    decidedAt?: string;
}
export interface Goal {
    id: string;
    taskId: string;
    text: string;
    vulnClass?: string;
    state: 'open' | 'met' | 'deleted';
    createdAt: string;
    updatedAt: string;
}
export interface Constraint {
    id: string;
    taskId: string;
    kind: 'allow' | 'deny';
    text: string;
    origin: 'goals' | 'human' | 'system';
    createdAt: string;
    updatedAt: string;
}
export interface ScopeEntry {
    id: string;
    taskId: string;
    kind: 'company' | 'root_domain' | 'subdomain' | 'ip' | 'cidr' | 'icp' | 'keyword';
    companyId?: string;
    value: string;
    source: 'auto' | 'agent' | 'human';
    reason?: string;
    createdAt: string;
}
export interface Company {
    id: string;
    name: string;
    description?: string;
    createdAt: string;
    updatedAt: string;
}
export interface TrafficRecord {
    id: string;
    taskId?: string;
    workerSessionId?: string;
    capturedAt?: string;
    error?: string;
    host: string;
    method: string;
    url: string;
    status?: number;
    request?: unknown;
    response?: unknown;
    createdAt: string;
}
export interface InterceptRule {
    id: string;
    taskId?: string;
    name: string;
    enabled: boolean;
    priority: number;
    matchTarget: string;
    matchType: string;
    pattern: string;
    action: string;
    message?: string;
    createdAt: string;
    updatedAt: string;
}
export type TaskArchive = import('./archives.js').ArchiveRecord;
export interface Report {
    id: string;
    taskId: string;
    markdown: string;
    version: number;
    updatedAt: string;
}
export interface NotificationChannel {
    id: string;
    name: string;
    kind: string;
    mode: 'realtime' | 'digest';
    enabled: boolean;
    ratePerMin?: number;
    config: Record<string, unknown>;
    filter?: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
}
export interface RedTeamSnapshot extends TaskManagementCollections {
    assetInterceptRules: import('./task-asset-runtime.js').GlobalAssetRule[];
    notificationSettings: Partial<import('./notification-settings.js').NotificationSettings>;
    version: number;
    tasks: RedTeamTask[];
    assets: Asset[];
    nodes: GraphNode[];
    edges: GraphEdge[];
    intents: Intent[];
    findings: Finding[];
    evidence: Evidence[];
    traces: WorkerTrace[];
    approvals: Approval[];
    goals: Goal[];
    constraints: Constraint[];
    scopes: ScopeEntry[];
    traffic: TrafficRecord[];
    interceptRules: InterceptRule[];
    archives: TaskArchive[];
    reports: Report[];
    notificationChannels: NotificationChannel[];
    notificationEvents: import('./notifications.js').NotificationEvent[];
    notificationDeliveries: import('./notifications.js').NotificationDelivery[];
    companies: Company[];
}
export interface ReaRunResult {
    evidenceId: string;
    provider: 'rea';
    command: string;
    target: string;
    summary: string;
    raw: unknown;
}
