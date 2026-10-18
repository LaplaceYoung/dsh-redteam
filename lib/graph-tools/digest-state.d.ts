import type { GraphNode, RedTeamSnapshot } from '../types.js';
export declare function graphKind(node: GraphNode): string;
export declare function graphState(node: GraphNode): string;
/** Bookkeeping cannot itself advance the content version. */
export declare function nodeFingerprint(node: GraphNode): string;
/** Old imported digests have no fingerprints; retain their existing read contract. */
export declare function digestIsCurrent(state: RedTeamSnapshot, digest: GraphNode): boolean;
export declare function supersedeDigests(state: RedTeamSnapshot, ids: ReadonlySet<string>): void;
