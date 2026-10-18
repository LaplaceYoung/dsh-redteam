import { type ToolRunContext } from '@deepseek-ai/dsh-tools';
import type { RedTeamStore } from '../store.js';
import { type GraphRuntimeOptions } from './graph.js';
export { GraphRuntime } from './graph.js';
export { GraphAssetRuntime } from './assets.js';
export { GraphTraceRuntime } from './traces.js';
export { GraphCompactor } from './compaction.js';
export type { DigestInput, DigestProvider, GraphCompactorOptions, GraphCompactionTaskFields, CompactionRound } from './compaction.js';
export { createDshDigestProvider } from './digest-model.js';
export type { DigestRoute, DigestRouteResolver } from './digest-model.js';
export interface GraphToolBinding {
    taskId: string;
    ownerIntentId?: string;
    worker?: string;
}
export interface GraphToolsOptions extends GraphRuntimeOptions {
    /** Supply an explicit Planner binding; native worker bindings are resolved from persisted executions. */
    resolveBinding?: (exec: ToolRunContext) => GraphToolBinding | undefined;
    /** Fact/asset writes after persistence; hints use notifyHint once per batch. */
    onMutation?: (taskId: string, toolName: string) => void | Promise<void>;
}
export interface GraphToolsContext {
    tools: {
        register(tool: unknown): () => void;
    };
}
export declare const replacedGraphToolNames: readonly ["redteam_record_fact", "redteam_add_hint", "redteam_graph_overview", "redteam_list_worker_traces", "redteam_list_assets", "redteam_list_findings"];
/** Install once, after removing the six superseded definitions listed above.
 * Returns a disposer like the existing registerRedTeamTools installation. */
export declare function installGraphTools(ctx: GraphToolsContext, store: RedTeamStore, options?: GraphToolsOptions): () => void;
