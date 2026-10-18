import type { FindingRecord, FindingsSnapshot } from './types.js';
export interface FindingFilter {
    severity?: string;
    status?: string;
    vulnClass?: string;
    taskId?: string;
    query?: string;
    sort?: string;
    assetScope?: string;
}
export interface FindingPage<T> {
    items: T[];
    total: number;
    page: number;
    pageSize: number;
}
export interface FindingListItem extends Omit<FindingRecord, 'report' | 'trafficBindings' | 'retests'> {
    trafficCount: number;
    taskDescription: string;
}
export interface FindingCounts {
    critical: number;
    high: number;
    medium: number;
    low: number;
}
export interface FindingGroup extends FindingCounts {
    taskId: string | null;
    taskName: string;
    taskDescription: string;
    taskStatus: string;
    count: number;
    lastFoundAt: string;
}
export interface FindingStatsAggregate extends FindingCounts {
    total: number;
    pending: number;
    vulnClasses: string[];
}
export interface FindingStats extends FindingStatsAggregate {
    tasks: {
        id: string;
        name: string;
        description: string;
        count: number;
    }[];
}
export interface FindingAssetNode extends FindingCounts {
    key: string;
    parent?: string;
    kind: string;
    label: string;
    assetId?: string;
    companyId?: string;
    self: number;
    total: number;
    lastFoundAt: string;
}
export interface FindingAssetTree {
    nodes: FindingAssetNode[];
    findingTotal: number;
    truncated: boolean;
    droppedKinds: string[];
}
export declare const findingUnassignedTask = "__unassigned__";
export declare const findingUnassignedAsset = "__none__";
/** Shared by list, grouped list and filtered export; search treats %, _ and backslash literally. */
export declare function filterFindings(snapshot: FindingsSnapshot, filter?: FindingFilter): FindingRecord[];
export declare function listFindingsPage(snapshot: FindingsSnapshot, filter?: FindingFilter, page?: number, pageSize?: number): FindingPage<FindingListItem>;
export declare function listFindingGroups(snapshot: FindingsSnapshot, filter?: FindingFilter, page?: number, pageSize?: number): FindingPage<FindingGroup> & {
    findingTotal: number;
};
/** Cold-archive aggregates are supplied by the archive owner, never guessed from dataCounts. */
export declare function findingStats(snapshot: FindingsSnapshot, archived?: readonly FindingStatsAggregate[]): FindingStats;
/** ARTEX's catalog is DISTINCT vulnclass over real findings (db/findings.go), not a predefined taxonomy. */
export declare function listFindingVulnClasses(snapshot: FindingsSnapshot, archived?: readonly FindingStatsAggregate[]): string[];
export declare function buildFindingAssetTree(snapshot: FindingsSnapshot, filter?: FindingFilter, maxNodes?: number): FindingAssetTree;
/** Reverse reachability is task-local and returns all internal ancestor edges, irrespective of relation. */
export declare function findingLineage(snapshot: FindingsSnapshot, findingId: string): {
    nodes: FindingsSnapshot['nodes'];
    edges: FindingsSnapshot['edges'];
};
