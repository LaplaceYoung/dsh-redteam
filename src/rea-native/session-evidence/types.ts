import type { JsonObject, NativeEvidence, NativeResult, NativeInspectOptions } from '../types.js';
import type { EvidenceBundle, EvidenceBundleInspection } from '../evidence/types.js';

export type UnknownStatus = 'open' | 'investigating' | 'blocked' | 'contradicted' | 'resolved';
export type UnknownSeverity = 'low' | 'medium' | 'high' | 'critical';
export type UnknownResolution = null | { disposition: 'verified' | 'withdrawn' | 'out-of-scope'; rationale: string; evidence_ids: string[] };
export interface UnknownDetails {
  severity: UnknownSeverity;
  supporting_evidence_ids: string[];
  contradicting_evidence_ids: string[];
  required_authority: NativeEvidence['authority'] | null;
  required_confidence: NativeEvidence['confidence'];
  required_environment: null | { id: string | null; platform: string | null; architecture: string | null; isolation: 'none' | 'process' | 'container' | 'virtual-machine' | null };
  recommended_probes: Array<{ operation: string; rationale: string }>;
  relationships: Array<{ type: 'depends-on' | 'related-to' | 'contradicts'; unknown_id: string }>;
}
export interface RecordUnknownInput extends Omit<UnknownDetails, 'supporting_evidence_ids' | 'contradicting_evidence_ids'> {
  question: string;
  domain: string;
  supporting_evidence_ids?: string[];
  contradicting_evidence_ids?: string[];
  comparison_conclusion_scope?: { comparison_evidence_id: string; dimensions: string[] };
}
/** Low-level record owners expect schema defaults to have already been applied. */
export type ParsedRecordUnknownInput = RecordUnknownInput & Pick<UnknownDetails, 'supporting_evidence_ids' | 'contradicting_evidence_ids'>;
export interface UpdateUnknownInput extends UnknownDetails {
  unknown_id: string;
  expected_revision: number;
  status: UnknownStatus;
  resolution: UnknownResolution;
}
export interface UnknownRevision extends UnknownDetails {
  unknown_id: string;
  revision: number;
  previous_revision_digest: string | null;
  revision_digest: string;
  scope_digest: string | null;
  question: string;
  domain: string;
  status: UnknownStatus;
  resolution: UnknownResolution;
  mutation_evidence_ids: string[];
  comparison_conclusion_scope?: RecordUnknownInput['comparison_conclusion_scope'];
}
export interface UnknownQuery { status?: UnknownStatus; severity?: UnknownSeverity; domain?: string; offset?: number; limit?: number }
export interface UnknownPage { items: UnknownRevision[]; total: number; offset: number; next_offset: number | null }
export interface UnknownVerification { valid: boolean; truthVerified: boolean; unknown: UnknownRevision }
export interface EvidenceMerge { recordsAdded: number; unknownsAdded: number; changed: boolean; metadataChanged: boolean }
export interface EvidenceSubjectTarget { path: string; sha256: string; format: string; architecture?: string }

/** Same structural owner accepted by the upstream BinarySessionRecords constructor. */
export interface InvestigationRecordOwner {
  recordEvidence(input: unknown): NativeResult<'added' | 'duplicate'>;
  hasEvidence(evidenceId: string): boolean;
  evidenceById(evidenceId: string): NativeEvidence | undefined;
  evidenceForAnalysis(evidenceId: string): NativeEvidence | undefined;
  exportEvidenceBundle(): EvidenceBundle;
  evidenceBundleForSerialization(): EvidenceBundle;
  mergeEvidenceBundle(input: unknown): NativeResult<EvidenceMerge>;
  recordUnknown(input: ParsedRecordUnknownInput, target?: EvidenceSubjectTarget): NativeResult<UnknownRevision>;
  recordEvidenceWithUnknown(evidence: unknown, input: ParsedRecordUnknownInput): NativeResult<UnknownRevision | null>;
  updateUnknown(input: UpdateUnknownInput, target?: EvidenceSubjectTarget): NativeResult<UnknownRevision>;
  listUnknowns(filters?: UnknownQuery): UnknownRevision[];
  listUnknownsPage(query?: UnknownQuery): UnknownPage;
  verifyUnknownResolution(unknownId: string): NativeResult<UnknownVerification>;
  clear(): void;
}

export type SessionEvidenceOperation = 'get_evidence_bundle' | 'import_evidence_bundle' | 'export_evidence_bundle' | 'compare_bundles' | 'record_unknown' | 'update_unknown' | 'list_unknowns' | 'verify_unknown_resolution';
export type SessionEvidenceValue = EvidenceBundleInspection | NativeEvidence | UnknownRevision | UnknownPage | UnknownVerification | { imported: number; unknowns_added: number; total: number } | { path: string; bytes: number; records: number; unknowns: number };
export interface SessionEvidenceOptions { records?: InvestigationRecordOwner; getTarget?: () => EvidenceSubjectTarget | undefined }
export interface SessionEvidenceRuntime {
  readonly records: InvestigationRecordOwner;
  invoke(operation: SessionEvidenceOperation, input: unknown, options?: NativeInspectOptions): Promise<NativeResult<SessionEvidenceValue>>;
  recordEvidence(input: unknown): NativeResult<'added' | 'duplicate'>;
  close(): Promise<void>;
}
export type SessionEvidenceInputSchemas = Record<SessionEvidenceOperation, JsonObject>;
