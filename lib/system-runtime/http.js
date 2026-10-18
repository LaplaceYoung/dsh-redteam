import { SystemRuntime } from './index.js';
export const SYSTEM_RUNTIME_PATH = '/api/redteam/system';
class HttpError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
function object(value) { if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new HttpError(400, 'Body must be an object'); return value; }
function fields(value, keys) { for (const key of Object.keys(value))
    if (!keys.includes(key))
        throw new HttpError(400, `Unsupported field: ${key}`); }
function optionalString(value, key) { if (value === undefined)
    return undefined; if (typeof value !== 'string')
    throw new HttpError(400, `${key} must be a string`); return value; }
async function body(request) {
    if (!request.headers['content-type']?.toLowerCase().startsWith('application/json'))
        throw new HttpError(415, 'Content-Type must be application/json');
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size > 64 * 1024)
            throw new HttpError(413, 'Body exceeds 64 KiB');
        chunks.push(bytes);
    }
    if (!size)
        return {};
    return object(JSON.parse(Buffer.concat(chunks).toString('utf8')));
}
function respond(response, status, value) {
    if (response.destroyed || response.writableEnded)
        return;
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    response.end(JSON.stringify(value));
}
/** UI-only hosts use the same durable/shared services without registering agent tools. */
export function installSystemRuntimeHttp(ctx, store, options) {
    const runtime = new SystemRuntime(ctx, store, options);
    const ready = runtime.initialize();
    const remove = ctx.webServer.register({ kind: 'prefix', path: SYSTEM_RUNTIME_PATH, handler: async (request, response) => {
            const controller = new AbortController();
            const disconnected = () => { if (!response.writableEnded)
                controller.abort(new Error('HTTP client disconnected')); };
            response.once('close', disconnected);
            try {
                const admission = await options.authenticate(request);
                if (admission !== true) {
                    respond(response, admission === 403 ? 403 : 401, { error: admission === 403 ? 'DSH owner access required' : 'DSH authentication required' });
                    return;
                }
                await ready;
                const url = new URL(request.url ?? '/', 'http://dsh.local');
                const segments = url.pathname.slice(SYSTEM_RUNTIME_PATH.length).split('/').filter(Boolean).map(decodeURIComponent);
                const [resource, id] = segments;
                if (segments.length > 2 || !url.pathname.startsWith(`${SYSTEM_RUNTIME_PATH}/`))
                    throw new HttpError(404, 'Not found');
                if (request.method === 'GET') {
                    if (resource === 'settings' && !id) {
                        respond(response, 200, runtime.settings.snapshot());
                        return;
                    }
                    if (resource === 'model-pool' && !id) {
                        respond(response, 200, { ...await runtime.models.status(), enabled: runtime.settings.snapshot().llm_pool_enabled, bind_fallback: runtime.settings.snapshot().llm_pool_bind_fallback });
                        return;
                    }
                    if (resource === 'model-retry' && !id) {
                        respond(response, 200, runtime.models.retryPolicy());
                        return;
                    }
                    if (resource === 'model-policy' && id) {
                        if (!(await options.profiles.list()).profiles.some(profile => profile.id === id))
                            throw new HttpError(404, 'Profile not found');
                        respond(response, 200, runtime.models.profilePolicy(id));
                        return;
                    }
                }
                else if (request.method === 'PUT' || request.method === 'POST') {
                    if (request.headers.origin) {
                        let sameOrigin = false;
                        try {
                            sameOrigin = new URL(request.headers.origin).host === request.headers.host;
                        }
                        catch { /* Reject malformed origins. */ }
                        if (!sameOrigin)
                            throw new HttpError(403, 'Cross-origin mutation rejected');
                    }
                    const input = await body(request);
                    if (resource === 'settings' && !id && request.method === 'PUT') {
                        respond(response, 200, await runtime.settings.update(input));
                        return;
                    }
                    if (resource === 'model-policy' && id && request.method === 'PUT') {
                        respond(response, 200, await runtime.models.setProfilePolicy(id, input));
                        return;
                    }
                    if (resource === 'model-retry' && !id && request.method === 'PUT') {
                        respond(response, 200, await runtime.models.setRetryPolicy(input));
                        return;
                    }
                    if (resource === 'model-health' && id === 'reset' && request.method === 'POST') {
                        fields(input, ['profile_id']);
                        const profile = optionalString(input.profile_id, 'profile_id');
                        if (profile !== undefined && !profile.trim())
                            throw new HttpError(400, 'profile_id must not be blank');
                        await runtime.models.reset(profile);
                        respond(response, 200, await runtime.models.status());
                        return;
                    }
                    if (resource === 'model-test' && id && request.method === 'POST') {
                        fields(input, []);
                        respond(response, 200, await runtime.models.probe(id, controller.signal));
                        return;
                    }
                    if (resource === 'web-search' && id === 'test' && request.method === 'POST') {
                        const keys = ['web_search_backend', 'web_search_proxy', 'brave_search_api_key', 'tavily_search_api_key'];
                        fields(input, keys);
                        for (const key of keys)
                            optionalString(input[key], key);
                        respond(response, 200, await runtime.testSearch(input, controller.signal));
                        return;
                    }
                }
                else {
                    response.setHeader('allow', 'GET, PUT, POST');
                    throw new HttpError(405, 'Method not allowed');
                }
                throw new HttpError(404, 'Not found');
            }
            catch (error) {
                const message = error instanceof Error ? error.message : 'System runtime operation failed';
                const status = error instanceof HttpError ? error.status : error instanceof SyntaxError || error instanceof TypeError || /must be|unsupported|requires|Invalid URL/i.test(message) ? 400 : /profile not found/i.test(message) ? 404 : 500;
                respond(response, status, { error: message });
            }
            finally {
                response.removeListener('close', disconnected);
            }
        } });
    const dispose = async () => { remove(); await runtime.dispose(); };
    ctx.effect(() => dispose);
    return { runtime, ready, dispose };
}
