import type { TrafficRecord } from '../types.js';
import { type EvidenceBody, type TrafficBinding, type TrafficRef, type TrafficRole } from './types.js';
export declare function assertRole(role: string): asserts role is TrafficRole;
export declare function sha256(bytes: Uint8Array): string;
export declare function verifyBody(body: EvidenceBody): Buffer;
export declare function normalizeTrafficRefs(refs: TrafficRef[]): Required<TrafficRef>[];
export declare function prepareTrafficBinding(row: TrafficRecord, ref: Required<TrafficRef>, storagePath: string): Promise<TrafficBinding>;
export declare function readEvidenceBody(binding: TrafficBinding, side: 'request' | 'response', offset?: number, limit?: number): {
    offset: number;
    length: number;
    total: number;
    nextOffset: number;
    eof: boolean;
    base64: string;
    sha256: string;
    head: string;
};
