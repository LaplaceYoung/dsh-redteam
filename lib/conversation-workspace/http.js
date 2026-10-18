import { createWorkspaceFilesHandler } from './files-http.js';
import { WorkspaceFileError } from './files.js';
const prefix = '/api/redteam/conversation-workspace';
function send(response, status, value) { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify(value)); }
function text(input, key, optional = false) {
    const value = input[key];
    if (optional && value === undefined)
        return;
    if (typeof value !== 'string')
        throw new WorkspaceFileError(`${key} 必须是字符串`);
    return value;
}
function numberParam(url, name) {
    const value = url.searchParams.get(name);
    if (value === null)
        return;
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
        throw new WorkspaceFileError(`${name} 必须是非负整数`);
    return Number(value);
}
async function body(request, limit) {
    if (!request.headers['content-type']?.toLowerCase().startsWith('application/json'))
        throw new WorkspaceFileError('Content-Type 必须是 application/json', 415);
    const chunks = [];
    let size = 0;
    for await (const chunk of request.iterator({ destroyOnReturn: false })) {
        const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += data.length;
        if (size > limit)
            throw new WorkspaceFileError('请求内容过大', 413);
        chunks.push(data);
    }
    try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value))
            throw new Error();
        return value;
    }
    catch {
        throw new WorkspaceFileError('请求必须是 JSON 对象');
    }
}
function parent(url, input = {}) {
    const kind = input.parent_kind ?? url.searchParams.get('parent_kind'), id = input.parent_id ?? url.searchParams.get('parent_id');
    if (!['task', 'conversation'].includes(String(kind)) || typeof id !== 'string' || !id)
        throw new WorkspaceFileError('旁路 parent_kind/parent_id 无效');
    if (kind === 'conversation')
        return { kind, id };
    const explorationId = input.exploration_id ?? url.searchParams.get('exploration_id') ?? undefined, intentId = input.intent_id ?? url.searchParams.get('intent_id') ?? undefined;
    if (explorationId !== undefined && typeof explorationId !== 'string' || intentId !== undefined && typeof intentId !== 'string')
        throw new WorkspaceFileError('旁路子会话 ID 无效');
    return { kind: 'task', id, explorationId, intentId };
}
function attachments(value) {
    if (value === undefined)
        return [];
    if (!Array.isArray(value) || value.length > 100)
        throw new WorkspaceFileError('attachments 必须是最多100个附件的数组');
    return value.map(item => {
        if (!item || typeof item !== 'object' || typeof item.path !== 'string' || typeof item.name !== 'string')
            throw new WorkspaceFileError('附件 name/path 无效');
        return { name: item.name, path: item.path };
    });
}
export function createConversationWorkspaceHandler(runtime, options) {
    const authenticate = async (request) => {
        const admission = await options.authenticate(request);
        if (admission !== true)
            throw new WorkspaceFileError(admission === 401 ? 'Authentication required' : 'Owner access required', admission === 401 ? 401 : 403);
        if (!['GET', 'HEAD'].includes(request.method ?? '') && request.headers.origin) {
            let origin;
            try {
                origin = new URL(request.headers.origin);
            }
            catch {
                throw new WorkspaceFileError('Origin 无效', 403);
            }
            if (origin.host !== request.headers.host)
                throw new WorkspaceFileError('拒绝跨站写入请求', 403);
        }
    };
    const files = createWorkspaceFilesHandler(runtime.files, { authenticate, acquireTaskOperation: runtime.acquireTaskOperation });
    return async (request, response) => {
        const url = new URL(request.url ?? '/', 'http://dsh.local');
        if (url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`))
            return false;
        if (await files(request, response))
            return true;
        try {
            await authenticate(request);
            const [resource, id, action, extra] = url.pathname.slice(prefix.length).split('/').filter(Boolean).map(decodeURIComponent);
            if (extra) {
                send(response, 404, { error: '路由不存在' });
                return true;
            }
            let value;
            if (resource === 'mentions' && request.method === 'GET')
                value = runtime.mentions.search({ query: url.searchParams.get('query') ?? undefined, scope: (url.searchParams.get('scope') ?? 'all'), cursor: url.searchParams.get('cursor') ?? undefined, taskId: url.searchParams.get('task_id') ?? undefined });
            else if (resource === 'conversations') {
                if (request.method === 'GET' && (!action || action === 'messages')) {
                    value = !id ? await runtime.conversations.list({ query: url.searchParams.get('query') ?? undefined, taskId: url.searchParams.get('task_id') ?? undefined })
                        : action === 'messages' ? await runtime.conversations.messages(id, numberParam(url, 'cursor'), numberParam(url, 'limit')) : await runtime.conversations.get(id);
                }
                else if (request.method === 'POST' && !id) {
                    const input = await body(request, 64 << 10);
                    value = await runtime.conversations.create({ agentKey: text(input, 'agent_key'), title: text(input, 'title', true), taskId: text(input, 'task_id', true), profileId: input.profile_id === null ? null : text(input, 'profile_id', true) });
                }
                else if (request.method === 'PATCH' && id && !action) {
                    const input = await body(request, 64 << 10);
                    if (input.pinned !== undefined && typeof input.pinned !== 'boolean')
                        throw new WorkspaceFileError('pinned 必须是布尔值');
                    value = await runtime.conversations.update(id, { ...(input.title !== undefined ? { title: text(input, 'title') } : {}), ...(input.pinned !== undefined ? { pinned: input.pinned } : {}), ...(input.profile_id !== undefined ? { profileId: input.profile_id === null ? null : text(input, 'profile_id') } : {}) });
                }
                else if (request.method === 'POST' && id && action === 'send') {
                    const input = await body(request, 64 << 10);
                    value = await runtime.conversations.send(id, text(input, 'message', true) ?? '', { attachments: attachments(input.attachments) });
                }
                else if (request.method === 'POST' && id && action === 'stop') {
                    await runtime.conversations.cancel(id);
                    value = { stopped: true };
                }
                else if (request.method === 'DELETE' && id && !action) {
                    await runtime.conversations.delete(id);
                    value = { deleted: id };
                }
                else if (request.method === 'POST' && id === 'batch-delete' && !action) {
                    const input = await body(request, 64 << 10);
                    if (!Array.isArray(input.ids) || !input.ids.every(item => typeof item === 'string'))
                        throw new WorkspaceFileError('ids 必须是字符串数组');
                    value = await runtime.conversations.deleteMany(input.ids);
                }
            }
            else if (resource === 'tasks' && id && action === 'segments' && request.method === 'GET')
                value = await runtime.conversations.segments(id);
            else if (resource === 'tasks' && id && request.method === 'POST' && (action === 'segments' || action === 'main-session')) {
                const initial = await runtime.conversations.ensureMainSession(id);
                value = action === 'main-session' ? initial : await runtime.conversations.create({ taskId: id, agentKey: 'mainagent' });
            }
            else if (resource === 'side-questions' && !id) {
                if (request.method === 'GET')
                    value = await runtime.sideQuestions.list(parent(url), { before: numberParam(url, 'before'), limit: numberParam(url, 'limit') });
                else if (request.method === 'POST') {
                    const input = await body(request, 32 << 10);
                    value = await runtime.sideQuestions.ask(parent(url, input), { question: text(input, 'question'), clientRequestId: text(input, 'client_request_id') });
                }
                else if (request.method === 'DELETE') {
                    await runtime.sideQuestions.clear(parent(url));
                    value = { cleared: true };
                }
            }
            else if (resource === 'side-requests' && id) {
                if (request.method === 'POST' && action === 'cancel')
                    value = await runtime.sideQuestions.cancel(id);
                else if (request.method === 'GET' && action === 'events') {
                    let last = -1, unsubscribe = () => { };
                    const push = (exchange) => {
                        if (exchange.id !== id || exchange.sequence <= last || response.destroyed || response.writableEnded)
                            return;
                        last = exchange.sequence;
                        response.write(`id: ${exchange.sequence}\nevent: exchange\ndata: ${JSON.stringify(exchange)}\n\n`);
                        if (exchange.status !== 'running') {
                            unsubscribe();
                            response.end();
                        }
                    };
                    const existing = await runtime.sideQuestions.get(id);
                    if (!existing)
                        throw new WorkspaceFileError('旁路问题不存在', 404);
                    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
                    unsubscribe = runtime.sideQuestions.subscribe(push);
                    response.once('close', () => unsubscribe());
                    push((await runtime.sideQuestions.get(id)));
                    return true;
                }
                else if (request.method === 'GET' && !action) {
                    value = await runtime.sideQuestions.get(id);
                    if (!value)
                        throw new WorkspaceFileError('旁路问题不存在', 404);
                }
            }
            if (value === undefined)
                send(response, 404, { error: '路由不存在' });
            else
                send(response, 200, value);
        }
        catch (error) {
            if (response.headersSent)
                response.destroy(error instanceof Error ? error : undefined);
            else {
                const status = error instanceof Error && 'status' in error && typeof error.status === 'number' ? error.status : 500;
                send(response, status, { error: error instanceof Error ? error.message : String(error) });
            }
        }
        return true;
    };
}
export function installConversationWorkspaceHttp(ctx, runtime, options) {
    const handler = createConversationWorkspaceHandler(runtime, options);
    const dispose = ctx.webServer.register({ kind: 'prefix', path: prefix, handler: async (request, response) => { await handler(request, response); } });
    ctx.effect(() => dispose);
    return dispose;
}
