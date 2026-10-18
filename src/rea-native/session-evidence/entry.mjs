// Native adapter over REA 6.5.0's shared investigation record owner.
import { z } from 'rea-upstream/node_modules/zod/index.js';
import { isAbsolute } from 'node:path';
import { InvestigationRecords } from 'rea-upstream/dist/application/investigation/InvestigationRecords.js';
import { EvidenceLedger } from 'rea-upstream/dist/application/investigation/EvidenceLedger.js';
import { inspectEvidenceBundle } from 'rea-upstream/dist/application/investigation/InspectEvidenceBundle.js';
import { readImmutableEvidenceBundle, writeEvidenceBundle } from 'rea-upstream/dist/application/EvidenceBundleFiles.js';
import { ArtifactResourceScope } from 'rea-upstream/dist/artifacts/ArtifactResourceScope.js';
import { getEvidenceBundleInputSchema, importEvidenceBundleInputSchema, listUnknownsInputSchema, verifyUnknownResolutionInputSchema } from 'rea-upstream/dist/contracts/sessionToolSchemas.js';
import { recordUnknownInputSchema, updateUnknownInputSchema } from 'rea-upstream/dist/domain/residualUnknown.js';
import { bundleComparisonInputSchema, compareBundles } from 'rea-upstream/dist/domain/bundleComparison.js';
import { analysisInputErrorFromIssues } from 'rea-upstream/dist/domain/inputIssueProjection.js';
import { AnalysisCancelledError, AnalysisCapabilityUnavailableError } from 'rea-upstream/dist/domain/analysisErrorCore.js';
import { localPathStringSchema } from 'rea-upstream/dist/domain/localPath.js';
import { createEvidence } from 'rea-upstream/dist/domain/evidence.js';
import { jsonValueSchema } from 'rea-upstream/dist/domain/jsonValue.js';
import { BUNDLE_COMPARISON_PROVIDER } from 'rea-upstream/dist/application/InvestigationProviders.js';
import { runDerivedOperation } from 'rea-upstream/dist/server/runDerivedOperation.js';
import { recordSessionEvidenceSources } from 'rea-upstream/dist/server/sessionEvidence.js';
import { err, ok } from 'rea-upstream/dist/domain/result.js';
export { InvestigationRecords, EvidenceLedger };
export { projectAnalysisError } from 'rea-upstream/dist/domain/analysisErrorProjection.js';

// Verbatim schema from contracts/sessionToolContracts.js, isolated to avoid
// initializing every unrelated session tool's contracts in this state module.
const exportEvidenceBundleInputSchema = z.strictObject({
  path: localPathStringSchema.refine(isAbsolute, {
    message: 'path must be an absolute local filesystem path (for example /tmp/rea/evidence.json or C:\\rea\\evidence.json)',
  }).describe('Absolute local filesystem path for the exported evidence bundle; relative paths are rejected.'),
  overwrite: z.boolean().default(false),
});

const schemas = {
  get_evidence_bundle: getEvidenceBundleInputSchema,
  import_evidence_bundle: importEvidenceBundleInputSchema,
  export_evidence_bundle: exportEvidenceBundleInputSchema,
  compare_bundles: bundleComparisonInputSchema,
  record_unknown: recordUnknownInputSchema,
  update_unknown: updateUnknownInputSchema,
  list_unknowns: listUnknownsInputSchema,
  verify_unknown_resolution: verifyUnknownResolutionInputSchema,
};
export const inputSchemas = Object.fromEntries(Object.entries(schemas).map(([name, schema]) => [name, z.toJSONSchema(schema, { io: 'input' })]));

/** One DSH session owns one instance. Existing REA aggregates can inject their records. */
export function createSessionEvidence(options = {}) {
  const ownsRecords = options.records === undefined;
  const records = options.records ?? new InvestigationRecords();
  const resources = new ArtifactResourceScope();
  const active = new Set();
  let closing = false;
  let closePromise;

  function unavailable(operation) {
    return err(new AnalysisCapabilityUnavailableError('rea-session-evidence', operation, 'session_closed'));
  }

  function invoke(operation, input, callOptions = {}) {
    if (closing) return Promise.resolve(unavailable(operation));
    const schema = schemas[operation];
    if (!schema) throw new TypeError(`Unknown session Evidence operation: ${operation}`);
    const parsed = schema.safeParse(input);
    if (!parsed.success) return Promise.resolve(err(analysisInputErrorFromIssues(operation, parsed.error.issues, input)));
    const signal = callOptions.signal ?? new AbortController().signal;
    if (signal.aborted) return Promise.resolve(err(new AnalysisCancelledError(operation)));
    const running = execute(operation, parsed.data, signal);
    active.add(running);
    // Observe both branches without creating an unhandled rejected finally promise.
    void running.then(() => active.delete(running), () => active.delete(running));
    return running;
  }

  async function execute(operation, input, signal) {
    switch (operation) {
      case 'get_evidence_bundle':
        return inspectEvidenceBundle(records.evidenceBundleForSerialization(), input);
      case 'record_unknown':
        return records.recordUnknown(input, options.getTarget?.());
      case 'update_unknown':
        return records.updateUnknown(input, options.getTarget?.());
      case 'list_unknowns':
        return ok(records.listUnknownsPage(input));
      case 'verify_unknown_resolution':
        return records.verifyUnknownResolution(input.unknown_id);
      case 'import_evidence_bundle': {
        const loaded = await readImmutableEvidenceBundle(input.path, signal, resources);
        if (!loaded.ok) return loaded;
        if (signal.aborted) return err(new AnalysisCancelledError(operation));
        const imported = records.mergeEvidenceBundle(loaded.value);
        return imported.ok ? ok({ imported: imported.value.recordsAdded, unknowns_added: imported.value.unknownsAdded, total: records.evidenceBundleForSerialization().records.length }) : imported;
      }
      case 'export_evidence_bundle': {
        const bundle = records.evidenceBundleForSerialization();
        const written = await writeEvidenceBundle(bundle, input.path, input.overwrite, resources, signal);
        return written.ok ? ok({ path: written.value.path, bytes: written.value.bytes, records: bundle.records.length, unknowns: bundle.unknowns.length }) : written;
      }
      case 'compare_bundles': {
        const [left, right] = await Promise.all([
          readImmutableEvidenceBundle(input.left_bundle_path, signal, resources),
          readImmutableEvidenceBundle(input.right_bundle_path, signal, resources),
        ]);
        if (!left.ok) return left;
        if (!right.ok) return right;
        // This upstream helper uses an in-process signal and no transport. The
        // absent progress token means it never sends MCP notifications.
        const computed = await runDerivedOperation({ mcpReq: { signal } }, operation, () => compareBundles(left.value, right.value, input.record_pairs));
        if (!computed.ok) return computed;
        const comparison = computed.value;
        const sources = [...new Map([...left.value.records, ...right.value.records].map((record) => [record.evidence_id, record])).values()];
        const recordedSources = recordSessionEvidenceSources((evidence) => records.recordEvidence(evidence), sources);
        if (!recordedSources.ok) return recordedSources;
        const evidence = createEvidence(undefined, BUNDLE_COMPARISON_PROVIDER, {
          predicateType: 'rea.bundle-comparison', operation,
          parameters: { left_bundle_sha256: comparison.left_bundle_sha256, right_bundle_sha256: comparison.right_bundle_sha256, record_pairs: input.record_pairs },
          result: jsonValueSchema.parse(comparison), confidence: 'derived', authority: 'analyst-inference',
          limitations: comparison.limitations, evidenceLinks: sources.map(({ evidence_id }) => evidence_id),
        });
        const recorded = records.recordEvidence(evidence);
        return recorded.ok ? ok(evidence) : recorded;
      }
    }
  }

  return {
    records,
    invoke,
    recordEvidence(input) { return closing ? unavailable('record_evidence') : records.recordEvidence(input); },
    close() {
      if (closePromise) return closePromise;
      closing = true;
      closePromise = (async () => {
        await Promise.allSettled(active);
        await resources.close();
        if (ownsRecords) records.clear();
      })();
      // A retained cleanup failure is retryable through a later close call.
      void closePromise.catch(() => { closePromise = undefined; });
      return closePromise;
    },
  };
}
