import { type FindingInput, type FindingPatch, type FindingRecord, type FindingsSnapshot, type FindingsStore, type TrafficBinding, type TrafficRef } from './types.js';
import type { ReportProvider } from './model.js';
export declare function requireFinding(state: FindingsSnapshot, id: string): FindingRecord;
export declare function assertFindingWritable(state: FindingsSnapshot, finding: Pick<FindingRecord, 'taskId'>): void;
/** Call inside host addFinding transaction, before insert/notification, to close deletion races. */
export declare function validateFindingInput(state: FindingsSnapshot, input: FindingInput): void;
export declare function validateFindingPatch(patch: FindingPatch): void;
/** Updates may target retained findings after source task/assets were removed. */
export declare function validateFindingUpdate(state: FindingsSnapshot, finding: FindingRecord, patch: FindingPatch): void;
export interface FindingsAccess {
    taskId?: string;
    findingId?: string;
    readonly?: boolean;
}
export declare class FindingsRuntime {
    readonly store: FindingsStore;
    readonly reportProvider?: ReportProvider | undefined;
    constructor(store: FindingsStore, reportProvider?: ReportProvider | undefined);
    get(id: string, access?: FindingsAccess): FindingRecord;
    private access;
    record(input: FindingInput, refs?: TrafficRef[], evidenceHintId?: string): Promise<FindingRecord>;
    update(id: string, patch: FindingPatch, access?: FindingsAccess): Promise<FindingRecord>;
    delete(id: string, access?: FindingsAccess): Promise<{
        deleted: string;
    }>;
    private prepare;
    bindTraffic(id: string, refs: TrafficRef[], access?: FindingsAccess): Promise<{
        findingId: string;
        version: number;
        reportVersion: number;
        bindings: TrafficBinding[];
    }>;
    traffic(id: string, access?: FindingsAccess): {
        findingId: string;
        version: number;
        reportVersion: number;
        bindings: TrafficBinding[];
    };
    private trafficView;
    editTraffic(id: string, expected: number, edit: {
        bindingId: string;
        role?: string;
        note?: string;
        remove?: boolean;
    } | {
        order: string[];
    }, access?: FindingsAccess): Promise<{
        findingId: string;
        version: number;
        reportVersion: number;
        bindings: TrafficBinding[];
    }>;
    body(id: string, bindingId: string, side: 'request' | 'response', offset?: number, limit?: number, access?: FindingsAccess): {
        offset: number;
        length: number;
        total: number;
        nextOffset: number;
        eof: boolean;
        base64: string;
        sha256: string;
        head: string;
    };
    updateReport(id: string, markdown: string, expected: number, access?: FindingsAccess): Promise<FindingRecord>;
    generateReport(id: string, signal?: AbortSignal, access?: FindingsAccess, provider?: ReportProvider | undefined): Promise<FindingRecord>;
    deepen(id: string, description: string, access?: FindingsAccess): Promise<{
        id: `${string}-${string}-${string}-${string}-${string}`;
        taskId: string;
        summary: string;
        state: "open";
        input: {
            sourceFindingId: string;
            sourceFindingNodeId: string;
            assetIds: string[];
            priority: number;
            origin: string;
        };
        createdAt: string;
        updatedAt: string;
    }>;
}
