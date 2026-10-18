import { EngineActivity, HostManagementError } from './stats.js';
import { ServiceLogs } from './logs.js';
const prefix = '/api/redteam/host';
const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
const body = async (req, max = 64 * 1024) => {
    const parts = [];
    let size = 0;
    for await (const chunk of req) {
        const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += part.length;
        if (size > max)
            throw new HostManagementError(413, 'request body exceeds limit');
        parts.push(part);
    }
    if (!parts.length)
        return {};
    try {
        return JSON.parse(Buffer.concat(parts).toString('utf8'));
    }
    catch {
        throw new HostManagementError(400, 'request body must be JSON');
    }
};
const queryInt = (value, fallback, max) => { if (value === null || value === '')
    return fallback; const result = Number(value); if (!Number.isSafeInteger(result) || result < 0 || result > max)
    throw new HostManagementError(400, 'invalid pagination value'); return result; };
function errorStatus(error) { return error instanceof HostManagementError ? error.status : error instanceof Error && /not found|invalid|required|must|limit|JSON/.test(error.message) ? 400 : 500; }
export function installHostManagement(ctx, store, options) {
    const logs = new ServiceLogs(options.path ?? `${store.storagePath}.host-logs.json`, options.retention);
    const activity = new EngineActivity();
    const disposers = [];
    const exporter = ctx.logger.exporter({ export(message) { void logs.append({ ts: new Date(message.ts).toISOString(), level: message.type, tag: message.name, text: message.args.map(value => value instanceof Error ? value.message : typeof value === 'string' ? value : JSON.stringify(value)).join(' ') }).catch(() => { }); } });
    disposers.push(() => { exporter(); });
    ctx.effect(() => {
        const remove = ctx.root.on('llm/stream', (request, next) => {
            const taskId = options.resolveTaskId?.(request);
            if (!taskId)
                return next();
            const done = activity.begin(taskId);
            return (async function* () { try {
                for await (const chunk of next())
                    yield chunk;
            }
            finally {
                done();
            } })();
        });
        disposers.push(remove);
        return () => remove();
    });
    const install = ctx.webServer.register({ kind: 'prefix', path: prefix, handler: async (req, res) => {
            try {
                const access = await options.authenticate(req);
                if (access !== true) {
                    json(res, access === 401 ? 401 : 403, { error: 'Owner access required' });
                    return;
                }
                const url = new URL(req.url ?? '/', 'http://dsh.local');
                const resource = url.pathname.slice(prefix.length).replace(/^\//, '');
                if (req.method === 'GET' && resource === 'health') {
                    json(res, 200, { ok: true, service: 'dsh-redteam', version: options.serviceVersion ?? '0.1.0' });
                    return;
                }
                if (req.method === 'GET' && resource === 'stats') {
                    json(res, 200, activity.stats(store.snapshot(), url.searchParams.get('task') ?? undefined, options.llmConfigured?.() ?? false, options.trafficEnabled?.() ?? false));
                    return;
                }
                if (req.method === 'GET' && resource === 'logs') {
                    json(res, 200, await logs.recent(queryInt(url.searchParams.get('since'), 0, Number.MAX_SAFE_INTEGER), queryInt(url.searchParams.get('limit'), 500, 500)));
                    return;
                }
                if (req.method === 'GET' && resource === 'logs/history') {
                    json(res, 200, await logs.history(queryInt(url.searchParams.get('before'), 0, Number.MAX_SAFE_INTEGER), queryInt(url.searchParams.get('limit'), 200, 500)));
                    return;
                }
                if (req.method === 'GET' && resource === 'logs/stream') {
                    streamLogs(req, res, logs, queryInt(url.searchParams.get('since'), 0, Number.MAX_SAFE_INTEGER));
                    return;
                }
                if (options.version && req.method === 'GET' && resource === 'update/check') {
                    json(res, 200, await options.version.check({ force: url.searchParams.has('force') }));
                    return;
                }
                if (options.version && req.method === 'POST' && resource === 'update/apply') {
                    json(res, 202, await options.version.apply(await body(req)));
                    return;
                }
                if (options.version && req.method === 'POST' && resource === 'update/rollback') {
                    json(res, 202, await options.version.rollback(await body(req)));
                    return;
                }
                if (options.version && req.method === 'GET' && resource === 'update/stream') {
                    streamVersion(req, res, options.version);
                    return;
                }
                json(res, 404, { error: 'Not found' });
            }
            catch (error) {
                json(res, errorStatus(error), { error: error instanceof Error ? error.message : String(error) });
            }
        } });
    disposers.push(install);
    return { logs, activity, ready: logs.ready, dispose: () => { for (const dispose of disposers.splice(0))
            dispose(); } };
}
function streamHeaders(res) { res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' }); }
function send(res, value) { res.write(`data: ${JSON.stringify(value)}\n\n`); }
function streamLogs(req, res, logs, since) {
    streamHeaders(res);
    let cursor = since;
    let closed = false;
    const listener = (row) => { if (!closed && row.seq > cursor) {
        cursor = row.seq;
        send(res, row);
    } };
    const unsubscribe = logs.subscribe(listener);
    void logs.recent(since, 1000).then(result => { if (!closed) {
        for (const row of result.items) {
            cursor = row.seq;
            send(res, row);
        }
    } });
    const ping = setInterval(() => { if (!closed)
        res.write(': ping\n\n'); }, 20_000);
    const close = () => { if (closed)
        return; closed = true; clearInterval(ping); unsubscribe(); res.end(); };
    req.on('close', close);
}
function streamVersion(req, res, manager) {
    streamHeaders(res);
    const status = manager.status?.();
    if (status !== undefined)
        send(res, status);
    const unsubscribe = manager.stream?.(event => send(res, event)) ?? (() => { });
    const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
    req.on('close', () => { clearInterval(ping); unsubscribe(); res.end(); });
}
