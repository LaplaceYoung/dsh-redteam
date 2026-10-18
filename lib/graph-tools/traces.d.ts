import type { RedTeamStore } from '../store.js';
export interface WorkerTraceArgs {
    intent_id: string;
    q?: string;
    step_ids?: unknown[];
    limit?: number;
}
export interface WorkerTraceSearchArgs {
    q: string;
    limit?: number;
}
export interface WorkerTraceIndexArgs {
    q?: string;
    limit?: number;
}
interface Provenance {
    source_task_id?: string;
    inherited?: true;
}
interface Step extends Provenance {
    step_id: string;
    kind: string;
    tool: string;
    is_error: boolean;
    summary?: string;
    detail?: string;
}
export declare function sqlSubstringMatcher(q: string): (value: string) => boolean;
/** Read-only ARTEX trace queries over the durable store, with direct-source isolation. */
export declare class GraphTraceRuntime {
    private readonly store;
    constructor(store: RedTeamStore);
    private view;
    private requireIntent;
    private steps;
    private step;
    getWorkerTrace(taskId: string, args: WorkerTraceArgs): {
        source_task_id?: string;
        inherited?: true;
        omitted_step_ids?: string[] | undefined;
        notice?: string | undefined;
        intent_id: string;
        steps: Step[];
        returned_step_ids: string[];
    } | {
        source_task_id?: string;
        inherited?: true;
        intent_id: string;
        steps: Step[];
    };
    getWorkerOutput(taskId: string, args: {
        intent_id: string;
    }): "（该 work 尚无任何输出）" | {
        source_task_id?: string;
        inherited?: true;
        intent_id: string;
        final_text: string;
    } | {
        source_task_id?: string;
        inherited?: true;
        intent_id: string;
        final_text: string;
        summary: string;
        is_error: boolean;
    };
    searchAllWorkerTraces(taskId: string, args: WorkerTraceSearchArgs, ownerIntentId?: string): {
        query: string;
        hits: {
            step_id: string;
            kind: string;
            tool: string;
            is_error: boolean;
            summary?: string;
            detail?: string;
            source_task_id?: string;
            inherited?: true;
            intent_id: string;
            worker: string;
        }[];
    };
    listWorkerTraces(taskId: string, args?: WorkerTraceIndexArgs): {
        works: {
            source_task_id?: string;
            inherited?: true;
            intent_id: string;
            summary: string;
            state: import("../types.js").IntentState;
        }[];
    };
}
export {};
