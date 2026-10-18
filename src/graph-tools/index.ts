import { defineTool, type ParameterSchemaSpec, type ToolRunContext } from '@deepseek-ai/dsh-tools';
import type { JsonValue } from '@deepseek-ai/dsh-util-values';
import type { RedTeamStore } from '../store.js';
import { requireManagedTask, TaskManagementError } from '../task-management/index.js';
import { GraphRuntime, type FactInput, type HintInput, type GraphRuntimeOptions, type TrafficRef } from './graph.js';
import { GraphAssetRuntime } from './assets.js';
import { GraphTraceRuntime } from './traces.js';

export { GraphRuntime } from './graph.js';
export { GraphAssetRuntime } from './assets.js';
export { GraphTraceRuntime } from './traces.js';
export { GraphCompactor } from './compaction.js';
export type { DigestInput, DigestProvider, GraphCompactorOptions, GraphCompactionTaskFields, CompactionRound } from './compaction.js';
export { createDshDigestProvider } from './digest-model.js';
export type { DigestRoute, DigestRouteResolver } from './digest-model.js';
export interface GraphToolBinding { taskId: string; ownerIntentId?: string; worker?: string }
export interface GraphToolsOptions extends GraphRuntimeOptions {
  /** Supply an explicit Planner binding; native worker bindings are resolved from persisted executions. */
  resolveBinding?: (exec: ToolRunContext) => GraphToolBinding | undefined;
  /** Fact/asset writes after persistence; hints use notifyHint once per batch. */
  onMutation?: (taskId: string, toolName: string) => void | Promise<void>;
}
export interface GraphToolsContext { tools: { register(tool: unknown): () => void } }

const text = { type: 'string' } as const;
const integer = { type: 'integer' } as const;
const idSchema = { oneOf: [{ type: 'string' }, { type: 'integer' }] } as const;
const idsSchema = { type: 'array', items: idSchema } as const;
const factFields = { summary: text, detail: text, evidence: text, confidence: text, intent_id: idSchema, asset_ids: idsSchema, data: { type: 'object', additionalProperties: true } } as const;
const refsSchema = { type: 'array', items: { type: 'object', additionalProperties: false, properties: { traffic_id: { ...text, required: true }, role: text, note: text } } } as const;
const hintFields = { text, summary: text, asset_ids: idsSchema, traffic_refs: refsSchema, data: { type: 'object', additionalProperties: true } } as const;
const stringsSchema = { type: 'array', items: text } as const;
const assetFields = {
  type: { ...text, required: true, enum: ['root_domain', 'subdomain', 'ip', 'app', 'service', 'endpoint'] },
  domain: text, icp: text, record_type: text, record_value: stringsSchema, ip: text, bound_domains: stringsSchema,
  open_ports: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { port: { ...integer, required: true }, service: text } } },
  app_name: text, bundle_id: text, category: text, description: text, app_icp: text, company_id: idSchema,
  url: text, technologies: stringsSchema, status_code: integer, content_length: integer, page_title: text, favicon_mmh3: text,
  auth: { type: 'array', items: { type: 'object', additionalProperties: true } },
  service_name: text, service_ip: text, port: integer, proto: text, method: text,
  params: { type: 'array', items: { type: 'object', additionalProperties: true } },
} as const;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TaskManagementError('invalid', 'arguments must be an object');
  return value as Record<string, unknown>;
}
function string(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new TaskManagementError('invalid', 'expected a string');
  return value;
}
function id(value: unknown): string | undefined {
  if (value === undefined || value === 0 || value === '0') return undefined;
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  throw new TaskManagementError('invalid', 'expected a nonempty ID string or positive integer');
}
function number(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new TaskManagementError('invalid', 'expected an integer');
  return value;
}
function list(value: unknown): unknown[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new TaskManagementError('invalid', 'expected an array');
  return value;
}
function ids(value: unknown): string[] | undefined { return list(value)?.flatMap(value => { const parsed = id(value); return parsed ? [parsed] : []; }); }
function fact(value: unknown): FactInput {
  const row = object(value);
  return { summary: string(row.summary), detail: string(row.detail), evidence: string(row.evidence), confidence: string(row.confidence), intent_id: id(row.intent_id), asset_ids: ids(row.asset_ids), data: row.data === undefined ? undefined : object(row.data) };
}
function hint(value: unknown): HintInput {
  const row = object(value);
  const trafficRefs = list(row.traffic_refs)?.map(value => {
    const ref = object(value); const trafficId = string(ref.traffic_id);
    if (trafficId === undefined) throw new TaskManagementError('invalid', 'traffic_id is required');
    return { traffic_id: trafficId, role: string(ref.role), note: string(ref.note) } satisfies TrafficRef;
  });
  return { text: string(row.text), summary: string(row.summary), asset_ids: ids(row.asset_ids), traffic_refs: trafficRefs, data: row.data === undefined ? undefined : object(row.data) };
}
function json(value: unknown): JsonValue { return JSON.parse(JSON.stringify(value)) as JsonValue; }

export const replacedGraphToolNames = ['redteam_record_fact', 'redteam_add_hint', 'redteam_graph_overview', 'redteam_list_worker_traces', 'redteam_list_assets', 'redteam_list_findings'] as const;

/** Install once, after removing the six superseded definitions listed above.
 * Returns a disposer like the existing registerRedTeamTools installation. */
export function installGraphTools(ctx: GraphToolsContext, store: RedTeamStore, options: GraphToolsOptions = {}): () => void {
  const graph = new GraphRuntime(store, options), assets = new GraphAssetRuntime(store), traces = new GraphTraceRuntime(store);
  const disposers: Array<() => void> = [];
  type Handler = (taskId: string, args: Record<string, unknown>, binding: GraphToolBinding | undefined) => unknown | Promise<unknown>;
  function register(names: string[], description: string, parameters: ParameterSchemaSpec, run: Handler, write = false) {
    for (const name of names) {
      const orchestration = ['redteam_get_task_graph', 'redteam_list_task_findings', 'redteam_add_task_hint', 'redteam_get_task_worker_trace', 'redteam_list_task_worker_traces', 'redteam_search_task_worker_traces', 'redteam_get_task_node_detail'].includes(name);
      disposers.push(ctx.tools.register(defineTool({
        name, description, parameters: { task_id: { ...text, ...(orchestration ? { required: true as const } : {}), description: 'Task ID; may be omitted only in a bound worker/Planner session.' }, ...parameters },
        output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
        isConcurrencySafe: () => !write,
        execute: async (raw, exec) => {
          await store.load();
          exec?.signal?.throwIfAborted();
          const args = object(raw), state = store.snapshot();
          const worker = exec?.agent ? state.intents.find(intent => intent.execution?.childSessionId === exec.agent?.id) : undefined;
          const explicit = exec ? options.resolveBinding?.(exec) : undefined;
          if (worker && explicit && worker.taskId !== explicit.taskId) throw new TaskManagementError('conflict', 'session binding conflicts with persisted worker task');
          const binding = worker ? { taskId: worker.taskId, ownerIntentId: worker.id, worker: worker.worker } : explicit;
          const globalAssetTool = name === 'redteam_insert_assets' || name === 'redteam_list_assets';
          const taskId = id(args.task_id) ?? binding?.taskId ?? (globalAssetTool ? 'global' : undefined);
          if (!taskId) throw new TaskManagementError('invalid', 'task_id is required outside a bound task session');
          if (binding && taskId !== binding.taskId) throw new TaskManagementError('conflict', 'tool call targets a different task than the bound session');
          if (taskId !== 'global' || !globalAssetTool) requireManagedTask(state, taskId);
          const result = await run(taskId, args, binding);
          if (write && name !== 'redteam_add_hint' && name !== 'redteam_add_task_hint') {
            const receipt = object(result);
            const changed = Boolean(receipt.id) || Array.isArray(receipt.ids) && receipt.ids.some(Boolean) || Array.isArray(receipt.results) && receipt.results.length > 0;
            if (changed && taskId !== 'global') await options.onMutation?.(taskId, name);
          }
          return json(result);
        },
      })));
    }
  }
  try {
    register(['redteam_graph_overview', 'redteam_get_task_graph'], 'ARTEX exploration overview: local frontier and lineage, facts, findings, hints, coverage, and bounded read-only direct-source summaries.', {}, taskId => graph.overview(taskId));
    register(['redteam_list_facts'], 'Newest facts first. limit defaults to 20/max 100; before is the previous next_before cursor; q matches summary case-insensitively. Returns facts,total,has_more,next_before.', { limit: integer, before: idSchema, q: text }, (taskId, args) => graph.listFacts(taskId, { limit: number(args.limit), before: id(args.before), q: string(args.q) }));
    register(['redteam_list_findings', 'redteam_list_task_findings'], 'Compact confirmed findings, including direct-source provenance and producing local/terminal source intent.', { severity: text, status: text }, (taskId, args) => graph.listFindings(taskId, { severity: string(args.severity), status: string(args.status) }));
    register(['redteam_node_detail', 'redteam_get_task_node_detail'], 'Full exploration node payload; assets use list_assets/asset_neighbors. Direct-source live intents are private.', { id: { ...idSchema, required: true } }, (taskId, args) => graph.nodeDetail(taskId, id(args.id) ?? ''));
    register(['redteam_expand_digest'], 'Expand persisted cold digest members with direct-source read-only provenance. Fetch full member evidence with node_detail.', { id: { ...idSchema, required: true } }, (taskId, args) => graph.expandDigest(taskId, id(args.id) ?? ''));
    register(['redteam_record_fact'], 'Record one conclusion or facts[] with per-item errors. Batch items inherit top-level intent_id. Source intents are read-only; preserve concise evidence and observed/inferred confidence.', { ...factFields, facts: { type: 'array', items: { type: 'object', additionalProperties: false, properties: factFields } } }, (taskId, args, binding) => graph.recordFact(taskId, { ...fact(args), facts: list(args.facts)?.map(fact) }, binding?.worker), true);
    register(['redteam_add_hint', 'redteam_add_task_hint'], 'Persist strategic text or hints[]; returns ordered IDs and per-item errors. Traffic refs require the enabled setting. Wake Planner once per successful batch when connected.', { ...hintFields, hints: { type: 'array', items: { type: 'object', additionalProperties: false, properties: hintFields } } }, (taskId, args) => graph.addHint(taskId, { ...hint(args), hints: list(args.hints)?.map(hint) }), true);
    register(['redteam_insert_assets'], 'Normalize root_domain/subdomain/ip/app/service/endpoint assets and merge identities. service uses url or domain/service_ip+port; endpoint uses url+method. record_value lists DNS values; technologies/auth/params merge without duplicate entries. Returns per-item results/errors, applies current asset policy and does not scan.', { assets: { type: 'array', required: true, items: { type: 'object', additionalProperties: true, properties: assetFields } } }, (taskId, args, binding) => assets.insertAssets(taskId, list(args.assets) ?? [], { ownerIntentId: binding?.ownerIntentId }), true);
    register(['redteam_list_assets'], 'Query assets in task/direct-source scope. Supply id/ids or nonempty DSL. AND precedes OR; parentheses supported. Separate type filter; limit defaults 10 and offset 0.', { id: idSchema, ids: idsSchema, dsl: text, type: text, limit: integer, offset: integer }, (taskId, args) => assets.listAssets(taskId, { id: id(args.id), ids: ids(args.ids), dsl: string(args.dsl), type: string(args.type), limit: number(args.limit), offset: number(args.offset) }));
    register(['redteam_list_untested_assets'], 'Page scoped or anchored assets without a fact anchor in this task or direct sources; page starts 1, page_size defaults 10.', { type: text, page: integer, page_size: integer }, (taskId, args) => assets.listUntestedAssets(taskId, { type: string(args.type), page: number(args.page), page_size: number(args.page_size) }));
    register(['redteam_asset_neighbors'], 'Inspect structural asset relationships inside current/direct-source scope; excludes unrelated-task assets.', { id: { ...idSchema, required: true }, limit: integer, offset: integer }, (taskId, args) => assets.assetNeighbors(taskId, { id: id(args.id) ?? '', limit: number(args.limit), offset: number(args.offset) }));
    register(['redteam_get_worker_trace', 'redteam_get_task_worker_trace'], 'Summaries of one work; q searches summary/detail. step_ids requests full detail, deduplicated and capped at 5. Excludes thinking/usage and live source work.', { intent_id: { ...idSchema, required: true }, q: text, step_ids: idsSchema, limit: integer }, (taskId, args) => traces.getWorkerTrace(taskId, { intent_id: id(args.intent_id) ?? '', q: string(args.q), step_ids: list(args.step_ids), limit: number(args.limit) }));
    register(['redteam_get_worker_output'], 'Final work result or last text before stopping, with direct-source provenance.', { intent_id: { ...idSchema, required: true } }, (taskId, args) => traces.getWorkerOutput(taskId, { intent_id: id(args.intent_id) ?? '' }));
    register(['redteam_search_all_worker_traces', 'redteam_search_task_worker_traces'], 'Search all worker summaries/details, excluding caller intent and private planner rows. Returns <=100-character summaries plus IDs for drill-down.', { q: { ...text, required: true }, limit: integer }, (taskId, args, binding) => traces.searchAllWorkerTraces(taskId, { q: string(args.q) ?? '', limit: number(args.limit) }, binding?.ownerIntentId));
    register(['redteam_list_worker_traces', 'redteam_list_task_worker_traces'], 'Index executed works (running/done/exhausted/blocked/stopped); source works must be terminal. q filters summaries; default limit 50.', { q: text, limit: integer }, (taskId, args) => traces.listWorkerTraces(taskId, { q: string(args.q), limit: number(args.limit) }));
  } catch (error) { for (const dispose of disposers.reverse()) dispose(); throw error; }
  return () => { for (const dispose of disposers.reverse()) dispose(); };
}
