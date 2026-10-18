import type { GraphNode, RedTeamSnapshot } from './types.js';
export declare const nodeKinds: GraphNode['kind'][];
export declare const kindLabels: Record<GraphNode['kind'], string>;
export declare function matchesQuery(values: unknown[], query: string): boolean;
export declare function filterTask<T extends {
    taskId?: string;
}>(rows: T[], taskId: string): T[];
/** Columns preserve the domain kind; every matching node remains reachable by scrolling. */
export declare function layoutGraph(nodes: GraphNode[]): {
    columns: ("intent" | "evidence" | "asset" | "fact" | "finding")[];
    positions: Map<string, {
        x: number;
        y: number;
    }>;
    width: number;
    height: number;
};
export declare function graphRelations(snapshot: RedTeamSnapshot, node: GraphNode): {
    edge: import("./types.js").GraphEdge;
    direction: "out" | "in";
    node: GraphNode | undefined;
    targetId: string;
}[];
export declare function graphRecord(snapshot: RedTeamSnapshot, node: GraphNode): unknown;
