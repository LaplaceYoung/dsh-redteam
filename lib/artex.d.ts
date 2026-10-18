import type { RedTeamStore } from './store.js';
import type { Intent, RedTeamTask } from './types.js';
import { type NewTaskInput } from './task-management/index.js';
export declare class ArtexWorkflow {
    private readonly store;
    private readonly createManagedTask;
    constructor(store: RedTeamStore, createManagedTask?: (input: NewTaskInput) => Promise<RedTeamTask>);
    createTask(title?: string, goal?: string, options?: NewTaskInput): Promise<RedTeamTask>;
    plan(taskId: string, summary: string, input?: Record<string, unknown>): Promise<Intent>;
    claim(taskId: string, worker: string): Promise<Intent | undefined>;
    finish(intentId: string, output: Record<string, unknown>): Promise<Intent>;
    stop(intentId: string, state?: 'paused' | 'failed'): Promise<Intent>;
    steer(intentId: string, message: string): Promise<Intent>;
    snapshot(taskId?: string): import("./types.js").RedTeamSnapshot;
    sourceContext(taskId: string): {
        sources: import("./task-management/index.js").ManagedTask[];
        nodes: import("./task-management/index.js").InheritedRecord<import("./types.js").GraphNode>[];
        edges: import("./task-management/index.js").InheritedRecord<import("./types.js").GraphEdge>[];
        intents: import("./task-management/index.js").InheritedRecord<{
            kind: string;
            id: string;
            taskId: string;
            summary: string;
            state: import("./types.js").IntentState;
            worker?: string;
            execution?: import("./types.js").WorkerExecution;
            input: Record<string, unknown>;
            output?: Record<string, unknown>;
            createdAt: string;
            updatedAt: string;
        }>[];
        traces: import("./task-management/index.js").InheritedRecord<import("./types.js").WorkerTrace>[];
        assets: import("./task-management/index.js").InheritedRecord<import("./types.js").Asset>[];
        findings: import("./task-management/index.js").InheritedRecord<import("./types.js").Finding>[];
        evidence: import("./task-management/index.js").InheritedRecord<import("./types.js").Evidence>[];
    };
}
