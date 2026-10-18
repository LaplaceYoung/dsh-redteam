import type { JsonObject, JsonValue, NativeEvidence, NativeResult } from '../types.js';

export interface EvidenceBundle {
  artifacts: JsonObject[];
  providers: NativeEvidence['provider'][];
  environments: JsonObject[];
  scenarios: JsonObject[];
  captures: JsonObject[];
  unknowns: JsonObject[];
  records: NativeEvidence[];
}

export interface EvidenceRecordFilters {
  evidence_id?: string;
  operation?: string;
  target_sha256?: string;
  analysis_profile_digest?: string;
  procedure_address?: string;
}

export interface InspectEvidenceBundleInput {
  path: string;
  detail?: 'complete' | 'summary';
  filters?: EvidenceRecordFilters;
}

export interface EvidenceBundleSummary {
  kind: 'evidence-bundle-summary';
  filters: Record<string, string>;
  total_retained_records: number;
  matching_records: number;
  unknown_revisions: number;
  records: Array<{
    evidence_id: string;
    subject: NativeEvidence['subject'];
    provider: NativeEvidence['provider'];
    operation: string;
    confidence: NativeEvidence['confidence'];
    authority: NativeEvidence['authority'];
    analysis_profile_digest: string | null;
    retention: 'complete-record';
    limitation_count: number;
    native_dossier: JsonObject;
  }>;
}

export interface CompareEvidenceBundleFilesInput { left: string; right: string }
export interface ExportEvidenceBundleFileInput { source: string; output: string; overwrite?: boolean }
export interface ValidateEvidenceBundleFileInput { path: string }
export type EvidenceBundleInspection = EvidenceBundle | EvidenceBundleSummary;
export type EvidenceFileOperation = 'inspect_evidence_bundle' | 'compare_evidence_bundle_files' | 'validate_evidence_bundle_file' | 'export_evidence_bundle_file';
export type EvidenceFileResult = NativeResult<EvidenceBundleInspection | JsonValue>;
