import { dirname, join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-host-webserver';
import type { RedTeamStore } from '../store.js';
import { InterceptionRepository } from './repository.js';
import { effectivePrompt, validateJudge, validateRule, type JudgeConfig, type RuleInput } from './model.js';

function respond(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify(value));
}
async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) throw new Error('Content-Type must be application/json');
  const parts: Buffer[] = []; let size = 0;
  for await (const chunk of request) { const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += bytes.length; if (size > 1024 * 1024) throw new Error('Request body exceeds 1 MiB'); parts.push(bytes); }
  const value: unknown = JSON.parse(Buffer.concat(parts).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected JSON object');
  return value as Record<string, unknown>;
}

export interface InterceptionHttpOptions {
  path?: string;
  /** Must call the actual DSH connection admission service and require the owner principal. */
  authenticate(request: IncomingMessage): boolean | 401 | 403 | Promise<boolean | 401 | 403>;
}
/** Custom webServer routes do not inherit /api auth; composition must supply real admission. */
export function installInterceptionHttp(ctx: Context, store: RedTeamStore, options: InterceptionHttpOptions): { repository: InterceptionRepository; ready: Promise<void> } {
  const repository = new InterceptionRepository(options.path ?? join(dirname(store.storagePath), 'interception.json')), ready = repository.initialize(store.snapshot().interceptRules);
  const prefix = '/api/redteam/interception';
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: prefix, handler: async (request, response) => {
    try {
      const admission = await options.authenticate(request);
      if (admission !== true) { respond(response, admission === 401 ? 401 : 403, { error: admission === 401 ? 'Authentication required' : 'Owner access required' }); return; }
      await ready;
      const url = new URL(request.url ?? '/', 'http://dsh.local');
      const segments = url.pathname.slice(prefix.length).split('/').filter(Boolean).map(decodeURIComponent);
      const [resource, id, action] = segments;
      if (request.method === 'GET') {
        const state = await repository.snapshot();
        if (resource === 'judge-usage') { respond(response, 200, await repository.judgeUsage(Number(url.searchParams.get('days') ?? 30))); return; }
        if (resource === 'settings') { respond(response, 200, { enabledTools: state.enabledTools, judge: { ...state.judge, prompt: effectivePrompt(state.judge.prompt) } }); return; }
        if (resource === 'rules') { respond(response, 200, state.rules.sort((a, b) => b.priority - a.priority || a.order - b.order)); return; }
        if (resource === 'pending' || resource === 'history') {
          const taskId = url.searchParams.get('task_id'); const offset = Number(url.searchParams.get('offset') ?? 0), limit = Number(url.searchParams.get('limit') ?? 100);
          const status = url.searchParams.get('status'), source = url.searchParams.get('decision_source');
          if (status && !['pending', 'allowed', 'denied', 'timeout'].includes(status) || source && !['rule', 'model', 'manual', 'unknown'].includes(source)) throw new Error('Invalid approval filter');
          if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('Invalid pagination');
          const rows = state.records.filter(row => (!taskId || row.taskId === taskId) && (!status || row.status === status) && (!source || row.decisionSource === source || source === 'unknown' && row.decisionSource === 'manual') && (resource !== 'pending' || row.status === 'pending')).reverse();
          respond(response, 200, { total: rows.length, items: rows.slice(offset, offset + limit) }); return;
        }
        if (resource === 'records' && id) {
          const row = await repository.detail(id);
          if (action === 'execution') {
            if (row.taskId && !store.snapshot().tasks.some(t => t.id === row.taskId)) { respond(response, 410, { error: 'Task is archived or deleted; restore its archive to navigate execution' }); return; }
            if (!row.sessionId || !row.callId) { respond(response, 409, { error: 'Execution correlation unavailable' }); return; }
            respond(response, 200, { sessionId: row.sessionId, callId: row.callId, rootCallId: row.rootCallId, toolName: row.toolName, toolInput: row.toolInput, execution: row.execution }); return;
          }
          respond(response, 200, row); return;
        }
      }
      if (request.method === 'POST' || request.method === 'PUT' || request.method === 'DELETE') {
        // JSON writes reject browser cross-origin requests before changing decisions.
        if (request.headers.origin && new URL(request.headers.origin).host !== request.headers.host) { respond(response, 403, { error: 'Cross-origin approval mutation rejected' }); return; }
        const input = await body(request);
        if (resource === 'records' && id && action === 'decide' && request.method === 'POST') {
          if (typeof input.allowed !== 'boolean' || input.taskId !== undefined && typeof input.taskId !== 'string') throw new Error('allowed must be boolean; taskId must be a string');
          const result = await repository.decide(id, input.allowed, { expectedTaskId: input.taskId as string | undefined });
          respond(response, result.resolved ? 200 : 409, result.record); return;
        }
        if (resource === 'rules') {
          if (request.method === 'DELETE' && id) { await repository.deleteRule(id); respond(response, 200, { deleted: id }); return; }
          if (action === 'toggle' && id && typeof input.enabled === 'boolean') { respond(response, 200, await repository.toggleRule(id, input.enabled)); return; }
          const rule = input as unknown as RuleInput; validateRule(rule);
          if (rule.taskId !== undefined && !store.snapshot().tasks.some(t => t.id === rule.taskId)) throw new Error('Rule task not found');
          respond(response, 200, await repository.upsertRule(rule, id)); return;
        }
        if (resource === 'settings') {
          if (input.judge !== undefined) validateJudge(input.judge as JudgeConfig);
          await repository.configure({ enabledTools: input.enabledTools as string[] | undefined, judge: input.judge as JudgeConfig | undefined });
          const state = await repository.snapshot(); respond(response, 200, { enabledTools: state.enabledTools, judge: state.judge }); return;
        }
      }
      respond(response, 404, { error: 'Unknown interception route' });
    } catch (error) { respond(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
  } }));
  return { repository, ready };
}
