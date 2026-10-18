import { type FindingRetest, type FindingsStore } from './types.js';
export interface RetestSessionProvider {
    /** Must return a real isolated session; start it only after binding via onSession. */
    run(input: {
        retest: FindingRetest;
        signal: AbortSignal;
        onSession: (sessionId: string) => Promise<void>;
    }): Promise<'done' | 'cancelled'>;
}
export declare class FindingRetests {
    readonly store: FindingsStore;
    readonly provider?: RetestSessionProvider | undefined;
    private readonly running;
    private readonly host;
    constructor(store: FindingsStore, provider?: RetestSessionProvider | undefined);
    private serialize;
    history(findingId: string): {
        id: string;
        findingId: string;
        sessionId?: string;
        status: "pending" | "running" | "done" | "failed" | "cancelled";
        notes: string;
        verdict?: "reproduced" | "fixed" | "inconclusive";
        summary?: string;
        evidence?: string;
        error?: string;
        createdAt: string;
        startedAt?: string;
        finishedAt?: string;
    }[];
    active(): {
        id: string;
        findingId: string;
        sessionId?: string;
        status: "pending" | "running" | "done" | "failed" | "cancelled";
        notes: string;
        verdict?: "reproduced" | "fixed" | "inconclusive";
        summary?: string;
        evidence?: string;
        error?: string;
        createdAt: string;
        startedAt?: string;
        finishedAt?: string;
    }[];
    start(findingId: string, notes?: string, provider?: RetestSessionProvider | undefined, signal?: AbortSignal): Promise<{
        completion: undefined;
        retest: FindingRetest;
        created: boolean;
    } | {
        completion: Promise<void>;
        retest: FindingRetest;
        created: boolean;
    }>;
    private execute;
    context(sessionId: string): {
        retest: FindingRetest;
        currentConstraints: import("../types.js").Constraint[];
    };
    recordResult(sessionId: string, verdict: 'reproduced' | 'fixed' | 'inconclusive', summary: string, evidence: string): Promise<{
        saved: boolean;
        verdict: "fixed" | "reproduced" | "inconclusive";
    }>;
    finish(findingId: string, id: string, status: 'done' | 'failed' | 'cancelled', error?: string): Promise<import("./types.js").FindingRecord>;
    cancel(id: string): void;
    cancelAll(): void;
    recover(): Promise<{
        recovered: number;
    }>;
}
