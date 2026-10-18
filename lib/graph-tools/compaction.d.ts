import type { RedTeamStore } from '../store.js';
import type { RedTeamSnapshot } from '../types.js';
export interface DigestInput {
    taskId: string;
    members: Array<{
        id: string;
        kind: string;
        state: string;
        summary: string;
        confidence?: string;
    }>;
    edges: Array<{
        from: string;
        to: string;
        relation: string;
    }>;
    anchors: Array<{
        id: string;
        state: string;
        summary: string;
    }>;
}
export interface DigestProvider {
    generate(input: DigestInput, signal: AbortSignal): Promise<string>;
}
/** Stored on the task so archive/restore naturally retains the round counter. */
export interface GraphCompactionTaskFields {
    graphCompaction?: {
        round: number;
        majorPending?: boolean;
    };
}
export interface GraphCompactorOptions {
    provider: DigestProvider;
    onError?: (taskId: string, error: unknown) => void;
    now?: () => number;
    /** Host admission/ownership check, repeated inside every durable mutation. */
    isTaskActive?: (state: RedTeamSnapshot, taskId: string) => boolean;
}
export interface CompactionRound {
    round: number;
    eligibleUncovered: number;
    activeDigests: number;
    majorPending: boolean;
    started: boolean;
}
/** ARTEX's per-planner-round cold-graph maintenance and one background compactor per task. */
export declare class GraphCompactor {
    private readonly store;
    private readonly options;
    private disposed;
    private readonly prefix;
    private readonly now;
    constructor(store: RedTeamStore, options: GraphCompactorOptions);
    private assertActive;
    /** Await maintenance before capturing the Planner context. Model generation stays in the background. */
    onPlannerRound(taskId: string, taskSignal?: AbortSignal): Promise<CompactionRound>;
    waitForIdle(taskId: string): Promise<void>;
    /** Pause/park/archive must abort immediately, then wait until queued commits have drained. */
    cancelTask(taskId: string): Promise<void>;
    dispose(): Promise<void>;
    private compact;
    private fold;
}
