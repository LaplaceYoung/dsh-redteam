import { inspectEvidenceBundleFile, compareEvidenceBundleFiles, validateEvidenceBundleFile, exportEvidenceBundleFile } from './runtime.mjs';
import type { EvidenceFileOperation, EvidenceFileResult } from './types.js';
export type * from './types.js';
export { inspectEvidenceBundleFile, compareEvidenceBundleFiles, validateEvidenceBundleFile, exportEvidenceBundleFile };
export { projectAnalysisError as projectEvidenceFileError } from './runtime.mjs';
export declare const evidenceFileInputSchemas: Record<EvidenceFileOperation, import("../types.js").JsonObject>;
/** Offline commands deliberately use separate names from live session import/export. */
export declare const evidenceFileCommands: {
    readonly inspect_evidence_bundle: {
        readonly cli: "inspect-evidence-bundle";
        readonly invoke: typeof inspectEvidenceBundleFile;
    };
    readonly compare_evidence_bundle_files: {
        readonly cli: "compare";
        readonly aliases: readonly ["compare-bundles"];
        readonly invoke: typeof compareEvidenceBundleFiles;
    };
    readonly validate_evidence_bundle_file: {
        readonly cli: "evidence-import";
        readonly invoke: typeof validateEvidenceBundleFile;
    };
    readonly export_evidence_bundle_file: {
        readonly cli: "evidence-export";
        readonly invoke: typeof exportEvidenceBundleFile;
    };
};
export declare function invokeEvidenceFileCommand(operation: EvidenceFileOperation, input: unknown): Promise<EvidenceFileResult>;
