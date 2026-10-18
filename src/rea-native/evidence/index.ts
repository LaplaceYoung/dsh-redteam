import {
  inspectEvidenceBundleFile,
  compareEvidenceBundleFiles,
  validateEvidenceBundleFile,
  exportEvidenceBundleFile,
  inputSchemas,
} from './runtime.mjs';
import type { EvidenceFileOperation, EvidenceFileResult } from './types.js';

export type * from './types.js';
export { inspectEvidenceBundleFile, compareEvidenceBundleFiles, validateEvidenceBundleFile, exportEvidenceBundleFile };
export { projectAnalysisError as projectEvidenceFileError } from './runtime.mjs';
export const evidenceFileInputSchemas = inputSchemas;

/** Offline commands deliberately use separate names from live session import/export. */
export const evidenceFileCommands = {
  inspect_evidence_bundle: { cli: 'inspect-evidence-bundle', invoke: inspectEvidenceBundleFile },
  compare_evidence_bundle_files: { cli: 'compare', aliases: ['compare-bundles'], invoke: compareEvidenceBundleFiles },
  validate_evidence_bundle_file: { cli: 'evidence-import', invoke: validateEvidenceBundleFile },
  export_evidence_bundle_file: { cli: 'evidence-export', invoke: exportEvidenceBundleFile },
} as const;

export function invokeEvidenceFileCommand(operation: EvidenceFileOperation, input: unknown): Promise<EvidenceFileResult> {
  return evidenceFileCommands[operation].invoke(input);
}
