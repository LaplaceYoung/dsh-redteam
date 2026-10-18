import { dirname, join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-host-webserver';
import { ObservabilityRepository } from './repository.js';
import { validateFilter } from './index.js';

export interface ObservabilityHttpOptions {
  path?: string;
  authenticate(request: IncomingMessage): boolean | 401 | 403 | Promise<boolean | 401 | 403>;
}
const respond = (res: ServerResponse, status: number, data: unknown) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); };
export function installObservabilityHttp(ctx: Context, store: { storagePath: string }, options: ObservabilityHttpOptions) {
  const repository = new ObservabilityRepository(options.path ?? join(dirname(store.storagePath), 'observability.json'));
  const prefix = '/api/redteam/observability';
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: prefix, handler: async (req, res) => {
    try {
      const admission = await options.authenticate(req);
      if (admission !== true) { respond(res, admission === 401 ? 401 : 403, { error: 'Owner access required' }); return; }
      const url = new URL(req.url ?? '/', 'http://dsh.local'), [resource, id] = url.pathname.slice(prefix.length).split('/').filter(Boolean).map(decodeURIComponent);
      const filterInput: Record<string, unknown> = {};
      for (const [key, value] of url.searchParams) if (key !== 'group') filterInput[key] = key === 'limit' || key === 'offset' ? Number(value) : value;
      const filter = validateFilter(filterInput);
      if (req.method === 'GET') {
        if (resource === 'settings') { respond(res, 200, { enabled: (await repository.snapshot()).recording }); return; }
        if (resource === 'records') { if (id) { try { respond(res, 200, await repository.detail(id)); } catch (error) { if (error instanceof Error && error.message === 'LLM record not found') respond(res, 404, { error: error.message }); else throw error; } } else respond(res, 200, await repository.records(filter)); return; }
        if (resource === 'tasks') { respond(res, 200, await repository.tasks()); return; }
        if (resource === 'commands') { respond(res, 200, await repository.commands(filter)); return; }
        if (resource === 'tool-stats') { respond(res, 200, await repository.toolStats(filter)); return; }
        if (resource === 'usage') { const group = url.searchParams.get('group') ?? 'model'; if (group !== 'model' && group !== 'profile' && group !== 'day') throw new Error('Invalid usage group'); respond(res, 200, await repository.usage(filter, group)); return; }
      }
      if (req.method === 'PUT' || req.method === 'DELETE') {
        if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) { respond(res, 403, { error: 'Cross-origin mutation rejected' }); return; }
        if (resource === 'records' && req.method === 'DELETE') { if (!filter.taskId) throw new Error('taskId is required'); respond(res, 200, { deleted: await repository.deleteRecords(filter.taskId) }); return; }
        if (resource === 'settings' && req.method === 'PUT') {
          if (!req.headers['content-type']?.startsWith('application/json')) throw new Error('Content-Type must be application/json');
          const chunks: Buffer[] = []; let size = 0;
          for await (const chunk of req) { const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += part.length; if (size > 1024) throw new Error('Settings body exceeds 1 KiB'); chunks.push(part); }
          const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!body || typeof body !== 'object' || !('enabled' in body) || typeof body.enabled !== 'boolean') throw new Error('enabled must be boolean');
          respond(res, 200, await repository.setRecording(body.enabled)); return;
        }
      }
      respond(res, 404, { error: 'Not found' });
    } catch (error) { respond(res, error instanceof SyntaxError || error instanceof Error && /must|required|Invalid|Unknown filter|exceeds/.test(error.message) ? 400 : 500, { error: error instanceof Error ? error.message : String(error) }); }
  } }));
  return { repository, ready: repository.snapshot().then(() => {}) };
}
