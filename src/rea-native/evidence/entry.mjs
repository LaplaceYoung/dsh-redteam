// Adapter for REA 6.5.0's offline file commands. Bundled by generate.mjs.
import { z } from 'rea-upstream/node_modules/zod/index.js';
import { readEvidenceBundle } from 'rea-upstream/dist/application/EvidenceBundleFiles.js';
import { inspectEvidenceBundle } from 'rea-upstream/dist/application/investigation/InspectEvidenceBundle.js';
import { compareEvidenceBundlesCommand, importEvidenceBundleCommand, exportEvidenceBundleCommand } from 'rea-upstream/dist/application/EvidenceBundleCommands.js';
import { getEvidenceBundleInputSchema, importEvidenceBundleInputSchema } from 'rea-upstream/dist/contracts/sessionToolSchemas.js';
import { analysisInputErrorFromIssues } from 'rea-upstream/dist/domain/inputIssueProjection.js';
export { projectAnalysisError } from 'rea-upstream/dist/domain/analysisErrorProjection.js';

const schemas = {
  inspect_evidence_bundle: getEvidenceBundleInputSchema.safeExtend({ path: importEvidenceBundleInputSchema.shape.path }),
  compare_evidence_bundle_files: z.strictObject({ left: z.string(), right: z.string() }),
  validate_evidence_bundle_file: z.strictObject({ path: z.string() }),
  export_evidence_bundle_file: z.strictObject({ source: z.string(), output: z.string(), overwrite: z.boolean().default(false) }),
};

export const inputSchemas = Object.fromEntries(Object.entries(schemas).map(([name, schema]) => [name, z.toJSONSchema(schema, { io: 'input' })]));

function validate(name, input, operation) {
  const parsed = schemas[name].safeParse(input);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: analysisInputErrorFromIssues(operation, parsed.error.issues, input) };
}

export async function inspectEvidenceBundleFile(input) {
  const parsed = validate('inspect_evidence_bundle', input, 'inspect-evidence-bundle');
  if (!parsed.ok) return parsed;
  const loaded = await readEvidenceBundle(parsed.value.path);
  return loaded.ok ? inspectEvidenceBundle(loaded.value, parsed.value) : loaded;
}

export async function compareEvidenceBundleFiles(input) {
  const parsed = validate('compare_evidence_bundle_files', input, 'compare');
  if (!parsed.ok) return parsed;
  return compareEvidenceBundlesCommand({ leftPath: parsed.value.left, rightPath: parsed.value.right });
}

export async function validateEvidenceBundleFile(input) {
  const parsed = validate('validate_evidence_bundle_file', input, 'evidence-import');
  if (!parsed.ok) return parsed;
  return importEvidenceBundleCommand(parsed.value.path);
}

export async function exportEvidenceBundleFile(input) {
  const parsed = validate('export_evidence_bundle_file', input, 'evidence-export');
  if (!parsed.ok) return parsed;
  return exportEvidenceBundleCommand(parsed.value.source, parsed.value.output, parsed.value.overwrite);
}
