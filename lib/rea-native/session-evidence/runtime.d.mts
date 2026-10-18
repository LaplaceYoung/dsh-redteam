import type { NativeAnalysisError, NativeEvidence, NativeResult, JsonObject } from '../types.js';
import type { EvidenceBundle } from '../evidence/types.js';
import type { InvestigationRecordOwner, SessionEvidenceOptions, SessionEvidenceRuntime, SessionEvidenceInputSchemas, ParsedRecordUnknownInput, UpdateUnknownInput, UnknownRevision, UnknownQuery, UnknownPage, UnknownVerification, EvidenceMerge } from './types.js';

export const InvestigationRecords: { new(): InvestigationRecordOwner };
export class EvidenceLedger {
  record(input: unknown): NativeResult<'added' | 'duplicate'>;
  import(input: unknown): NativeResult<EvidenceMerge>;
  export(): EvidenceBundle;
  forSerialization(): EvidenceBundle;
  has(evidenceId: string): boolean;
  get(evidenceId: string): NativeEvidence | undefined;
  forAnalysis(evidenceId: string): NativeEvidence | undefined;
  recordUnknown(input: ParsedRecordUnknownInput, mutationEvidence: NativeEvidence): NativeResult<UnknownRevision>;
  recordWithUnknown(evidence: NativeEvidence, input: ParsedRecordUnknownInput, mutation: NativeEvidence): NativeResult<UnknownRevision | null>;
  updateUnknown(input: UpdateUnknownInput, mutationEvidence: NativeEvidence): NativeResult<UnknownRevision>;
  listUnknowns(query?: UnknownQuery): UnknownRevision[];
  listUnknownsPage(query?: UnknownQuery): UnknownPage;
  verifyUnknownResolution(unknownId: string): NativeResult<UnknownVerification>;
  clear(): void;
}
export const inputSchemas: SessionEvidenceInputSchemas;
export function createSessionEvidence(options?: SessionEvidenceOptions): SessionEvidenceRuntime;
export function projectAnalysisError(error: NativeAnalysisError): JsonObject;
