import type { Finding, RedTeamSnapshot, Report } from '../types.js';
export declare const findingStatuses: readonly ["pending", "in_progress", "confirmed", "resolved", "fixed", "false_positive", "ignored", "duplicate", "risk_accepted"];
export type FindingStatus = typeof findingStatuses[number] | 'open' | 'verified' | 'accepted' | 'closed';
export type TrafficRole = 'baseline' | 'proof' | 'verification' | 'supporting';
export interface EvidenceBody {
    head: string;
    bodyBase64: string;
    sha256: string;
    length: number;
}
export interface TrafficSnapshot {
    id: string;
    sourceTrafficId: string;
    url: string;
    method: string;
    status?: number;
    capturedAt: string;
    request: EvidenceBody;
    response: EvidenceBody;
    createdAt: string;
}
export interface TrafficBinding {
    id: string;
    role: TrafficRole;
    note: string;
    position: number;
    snapshot: TrafficSnapshot;
    createdAt: string;
}
export interface TrafficRef {
    trafficId: string;
    role?: TrafficRole;
    note?: string;
}
export interface FindingFields {
    name?: string;
    nodeId?: string;
    intentId?: string;
    worker?: string;
    evidence?: unknown;
    report?: string;
    evidenceVersion?: number;
    reportEvidenceVersion?: number;
    trafficBindings?: TrafficBinding[];
    retests?: FindingRetest[];
}
export interface FindingRecord extends Omit<Finding, 'status'>, FindingFields {
    status: FindingStatus;
}
export interface FindingsSnapshot extends Omit<RedTeamSnapshot, 'findings'> {
    findings: FindingRecord[];
}
export type FindingInput = Omit<FindingRecord, 'id' | 'createdAt'>;
export type FindingPatch = Partial<Pick<FindingRecord, 'status' | 'summary' | 'severity' | 'assetIds' | 'evidenceIds' | 'name' | 'vulnClass'>>;
/** Host implementations must preserve add/update notification transactions. */
export interface FindingsStore {
    readonly storagePath: string;
    snapshot(): FindingsSnapshot;
    transaction<T>(mutator: (state: FindingsSnapshot) => T): Promise<T>;
    addFinding(input: FindingInput): Promise<FindingRecord>;
    updateFinding(id: string, patch: FindingPatch): Promise<FindingRecord>;
    updateFindingAtomic?(id: string, decide: (state: FindingsSnapshot, finding: FindingRecord) => FindingPatch): Promise<FindingRecord>;
    setReport(taskId: string, markdown: string): Promise<Report>;
}
export interface FindingRetest {
    id: string;
    findingId: string;
    sessionId?: string;
    status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
    notes: string;
    snapshot: {
        finding: Omit<FindingRecord, 'retests'>;
        assets: RedTeamSnapshot['assets'];
        constraints: RedTeamSnapshot['constraints'];
    };
    verdict?: 'reproduced' | 'fixed' | 'inconclusive';
    summary?: string;
    evidence?: string;
    error?: string;
    createdAt: string;
    startedAt?: string;
    finishedAt?: string;
}
export declare class FindingsError extends Error {
    readonly code: 'invalid' | 'not_found' | 'conflict' | 'forbidden' | 'unavailable' | 'integrity';
    constructor(code: 'invalid' | 'not_found' | 'conflict' | 'forbidden' | 'unavailable' | 'integrity', message: string);
}
