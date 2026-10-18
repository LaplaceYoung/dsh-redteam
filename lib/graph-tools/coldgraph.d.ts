/** Pure ARTEX coldgraph.go view. Node order replaces ARTEX's increasing numeric IDs. */
export interface ColdNode {
    id: string;
    kind: string;
    state?: string;
    contentVersion?: number;
}
export interface ColdEdge {
    from: string;
    to: string;
    relation: string;
}
export interface ColdBlock {
    members: string[];
    anchors: string[];
}
export interface StampOp {
    id: string;
    set: boolean;
    round?: number;
}
export type ColdStamps = ReadonlyMap<string, number | null | undefined>;
export declare function isLiveIntent(node: ColdNode): boolean;
export declare function foldableKind(kind: string): boolean;
export declare class ColdGraph {
    readonly nodes: Map<string, ColdNode>;
    readonly children: Map<string, string[]>;
    readonly parents: Map<string, string[]>;
    constructor(nodes: readonly ColdNode[], edges: readonly ColdEdge[]);
    hotSet(): Set<string>;
    structuralCold(hot?: ReadonlySet<string>): Set<string>;
    computeStampOps(structCold: ReadonlySet<string>, stamps: ColdStamps, round: number): StampOp[];
    eligibleCold(structCold: ReadonlySet<string>, stamps: ColdStamps, round: number, R?: number): Set<string>;
    groupBlocks(eligible: ReadonlySet<string>, K?: number): ColdBlock[];
    /** Call on a fresh snapshot after compression, inside the committing transaction. */
    filterAtCommit(block: ColdBlock, K?: number): ColdBlock | null;
}
/** Blocks must be in graph input order, as returned by groupBlocks. */
export declare function blockSignature(block: ColdBlock, versions: ReadonlyMap<string, number>): string;
