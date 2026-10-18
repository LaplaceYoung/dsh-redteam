import type { RedTeamStore } from '../store.js';
export interface TrafficDeletionResult {
    deleted: number;
    reclaimed: number;
    blobReclaimed: number;
}
/** Global disposable traffic deletion. Finding evidence uses its own immutable
 * snapshots and body store, neither of which is touched here. */
export declare class TrafficDeletion {
    private readonly store;
    private readonly blobRoot;
    constructor(store: RedTeamStore);
    deleteHost(raw: string): Promise<TrafficDeletionResult>;
    deleteHostsExact(hosts: string[]): Promise<TrafficDeletionResult>;
    deleteAll(): Promise<TrafficDeletionResult>;
    private remove;
    private collect;
}
