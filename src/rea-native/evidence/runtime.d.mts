import type { NativeAnalysisError, NativeResult, JsonObject, JsonValue } from '../types.js';
import type { EvidenceFileOperation, EvidenceBundleInspection } from './types.js';

export const inputSchemas: Record<EvidenceFileOperation, JsonObject>;
export function inspectEvidenceBundleFile(input: unknown): Promise<NativeResult<EvidenceBundleInspection>>;
export function compareEvidenceBundleFiles(input: unknown): Promise<NativeResult<JsonValue>>;
export function validateEvidenceBundleFile(input: unknown): Promise<NativeResult<{ imported: number; unknowns_added: number; total: number }>>;
export function exportEvidenceBundleFile(input: unknown): Promise<NativeResult<{ path: string; bytes: number; records: number }>>;
export function projectAnalysisError(error: NativeAnalysisError): JsonObject;
