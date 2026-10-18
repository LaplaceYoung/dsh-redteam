import type { TrafficRecord } from '../types.js';
/** Python writes private incoming files. Promotion and row publication share the
 * same mutation lock as deletion, so GC never races a not-yet-indexed body. */
export declare function incomingTrafficRecord(input: Omit<TrafficRecord, 'id' | 'createdAt'>, incomingRoot: string, blobRoot: string): {
    record: Omit<TrafficRecord, "id" | "createdAt">;
    prepare: () => Promise<() => Promise<void>>;
};
