import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { JsonValue } from '@deepseek-ai/dsh-util-values';
import type { RedTeamStore } from '../store.js';
import type { TrafficRuntime } from '../traffic.js';
import { TrafficQuery, type TrafficFilter, type TrafficSearch } from './query.js';
export { TrafficQuery } from './query.js';
export type { TrafficFilter, TrafficSearch, TrafficMessage } from './query.js';

const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue;
const output = { schema: { type: 'json' as const }, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value) }] };
const binding = { task_id: { type: 'string' as const }, worker_session_id: { type: 'string' as const } };

/** Original ARTEX lookup names plus DSH page/detail/statistics surfaces. */
export function installTrafficTools(ctx: Pick<Context, 'tools' | 'effect'>, store: RedTeamStore, runtime?: TrafficRuntime): TrafficQuery {
  const traffic = new TrafficQuery(store);
  const registerAgentLookup = (tool: Parameters<Context['tools']['register']>[0]) => ctx.effect(() => {
    if (!runtime) return ctx.tools.register(tool);
    let unregister: (() => void) | undefined;
    const refresh = () => {
      if (runtime.configuration().captureEnabled) unregister ??= ctx.tools.register(tool);
      else { unregister?.(); unregister = undefined; }
    };
    refresh();
    const unsubscribe = runtime.onConfigurationChange(refresh);
    return () => { unsubscribe(); unregister?.(); };
  });
  registerAgentLookup(defineTool({
    name: 'traffic_search', description: 'Query captured traffic for a required host, host:port, or URL. Returns only id/method/url/status/resp_len, default 3 rows, maximum 10 per page. body_contains searches request/response headers and text (minimum 3 characters). Read traffic_get before using an exchange as evidence.',
    parameters: { ...binding, host: { type: 'string', required: true }, contains: { type: 'string' }, body_contains: { type: 'string' }, limit: { type: 'number' }, page: { type: 'number' } }, output,
    execute: async (args: TrafficSearch) => json(await traffic.search(args)),
  }));
  registerAgentLookup(defineTool({
    name: 'traffic_get', description: 'Read a captured exchange as raw HTTP request/response text. Large body previews include their blob hash; use traffic_blob for further bytes.',
    parameters: { id: { type: 'string', required: true } }, output,
    execute: async (args: { id: string }) => traffic.get(args.id),
  }));
  registerAgentLookup(defineTool({
    name: 'traffic_blob', description: 'Read a captured large body by its referenced SHA-256 hash. Byte offsets, maximum 8192 bytes per call; base64 preserves binary bytes and UTF-8 split boundaries.',
    parameters: { hash: { type: 'string', required: true }, offset: { type: 'number' }, length: { type: 'number' } }, output,
    execute: async (args: { hash: string; offset?: number; length?: number }) => json(await traffic.blob(args.hash, args.offset, args.length)),
  }));
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'redteam_traffic_page', description: 'Page captured exchange metadata without bodies; combine host substring, HTTP method, path template, status/code class, response size and content filters. Includes filtered total and global count.',
    parameters: { ...binding, host: { type: 'string' }, method: { type: 'string' }, q: { type: 'string' }, body: { type: 'string' }, path: { type: 'string' }, status: { type: 'string' }, resp_min: { type: 'number' }, resp_max: { type: 'number' }, sort: { type: 'string', enum: ['ts','status','resp_len'] }, order: { type: 'string', enum: ['asc','desc'] }, page: { type: 'number' }, size: { type: 'number' } }, output,
    execute: async (args: TrafficFilter) => json(await traffic.page(args)),
  })));
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'redteam_traffic_detail', description: 'Read structured captured request/response headers, previews, byte lengths, task/worker binding and blob references. headerFields preserves repeated headers; bodyBase64 preserves inline bytes.',
    parameters: { id: { type: 'string', required: true } }, output,
    execute: async (args: { id: string }) => json(traffic.detail(args.id)),
  })));
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'redteam_traffic_body', description: 'Read exact request or response body bytes by exchange ID, side and byte offset, at most 8192 bytes. Works for inline and blob bodies.',
    parameters: { id: { type: 'string', required: true }, side: { type: 'string', required: true, enum: ['request','response'] }, offset: { type: 'number' }, length: { type: 'number' } }, output,
    execute: async (args: { id: string; side: 'request' | 'response'; offset?: number; length?: number }) => json(await traffic.body(args.id, args.side, args.offset, args.length)),
  })));
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'redteam_traffic_stats', description: 'Count captured exchanges, HTTP methods/statuses, request/response bytes and hosts ordered by recent activity; optionally filter task and worker.',
    parameters: binding, output,
    execute: async (args: { task_id?: string; worker_session_id?: string }) => json(traffic.stats(args)),
  })));
  ctx.effect(() => ctx.tools.register(defineTool({
    name:'redteam_traffic_delete_host',description:'Delete disposable captured traffic globally across tasks for the host substring (original SQLite LIKE %/_ semantics). Reclaim only blobs not referenced by any remaining host. Immutable finding evidence is preserved.',
    parameters:{host:{type:'string',required:true}},output,execute:async(args:{host:string})=>json(await traffic.deleteHost(args.host)),
  })));
  ctx.effect(() => ctx.tools.register(defineTool({
    name:'redteam_traffic_delete_hosts',description:'Delete disposable captured traffic globally for a list of exact host names. Does not match longer suffix hosts; preserves independent finding evidence and shared blobs still referenced elsewhere.',
    parameters:{hosts:{type:'array',items:{type:'string'},required:true}},output,execute:async(args:{hosts:string[]})=>json(await traffic.deleteHostsExact(args.hosts)),
  })));
  ctx.effect(() => ctx.tools.register(defineTool({
    name:'redteam_traffic_delete_all',description:'Clear all disposable captured traffic across all tasks and collect unreferenced traffic SHA-256 blobs. Finding evidence and incoming capture files are preserved. reclaimed is removed serialized traffic bytes; blobReclaimed is removed body bytes.',
    parameters:{},output,execute:async()=>json(await traffic.deleteAll()),
  })));
  return traffic;
}
