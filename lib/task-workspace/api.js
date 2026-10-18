import { SessionId } from '@deepseek-ai/dsh-session';
import { listManagedTasks, requireManagedTask, TaskManagementError } from '../task-management/index.js';
import { TASK_WORKSPACE_PATH } from './contracts.js';
class ApiError extends Error {
    status;
    code;
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
    }
}
function invalid(message) { throw new ApiError(400, 'invalid', message); }
function object(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        invalid(`${label} must be an object`);
    return value;
}
function text(value, label, empty = false) {
    if (typeof value !== 'string' || (!empty && !value.trim()))
        invalid(`${label} must be a string${empty ? '' : ' with content'}`);
    return value;
}
function strings(value, label) {
    if (!Array.isArray(value))
        invalid(`${label} must be an array`);
    return value.map(entry => text(entry, label));
}
function fields(value, allowed) {
    for (const field of Object.keys(value))
        if (!allowed.includes(field))
            invalid(`unsupported field: ${field}`);
}
function optionalFields(input, stringFields, boolFields = [], numberFields = []) {
    for (const field of stringFields)
        if (input[field] !== undefined)
            text(input[field], field, true);
    for (const field of boolFields)
        if (input[field] !== undefined && typeof input[field] !== 'boolean')
            invalid(`${field} must be boolean`);
    for (const field of numberFields)
        if (input[field] !== undefined && (typeof input[field] !== 'number' || !Number.isSafeInteger(input[field])))
            invalid(`${field} must be an integer`);
}
function nullableId(value, label) { if (value !== null)
    text(value, label); }
/** Validate HTTP data before it reaches typed domain services. */
export function parseTaskWorkspaceAction(value) {
    const body = object(value, 'action');
    text(body.action, 'action');
    if (body.sessionId !== undefined)
        text(body.sessionId, 'sessionId');
    const base = ['action', 'sessionId'];
    const only = (...keys) => fields(body, [...base, ...keys]);
    const task = () => text(body.taskId, 'taskId');
    const id = () => text(body.id, 'id');
    const template = (value, partial) => {
        const input = object(value, 'template');
        fields(input, ['name', 'description', 'goal', 'categoryId', 'interceptRules']);
        optionalFields(input, ['name', 'description', 'goal']);
        if (!partial)
            for (const key of ['name', 'description', 'goal'])
                text(input[key], key);
        if (input.categoryId !== undefined)
            nullableId(input.categoryId, 'categoryId');
        rules(input.interceptRules);
    };
    switch (body.action) {
        case 'task.create': {
            only('input');
            const input = object(body.input, 'input');
            fields(input, ['title', 'description', 'goal', 'templateId', 'categoryId', 'sourceTaskIds', 'companyIds', 'parentRef', 'timeoutSeconds', 'planHeartbeatSeconds', 'coverageEnabled', 'seedFirstIntent', 'interceptRules', 'llmProfileIds']);
            optionalFields(input, ['title', 'description', 'goal', 'templateId', 'parentRef'], ['coverageEnabled', 'seedFirstIntent'], ['timeoutSeconds', 'planHeartbeatSeconds']);
            if (input.categoryId !== undefined)
                nullableId(input.categoryId, 'categoryId');
            for (const key of ['sourceTaskIds', 'companyIds', 'llmProfileIds'])
                if (input[key] !== undefined)
                    strings(input[key], key);
            rules(input.interceptRules);
            break;
        }
        case 'task.metadata':
            only('taskId', 'patch');
            task();
            {
                const patch = object(body.patch, 'patch');
                fields(patch, ['title', 'pinned']);
                optionalFields(patch, ['title'], ['pinned']);
            }
            break;
        case 'task.category':
            only('taskIds', 'categoryId');
            strings(body.taskIds, 'taskIds');
            nullableId(body.categoryId, 'categoryId');
            break;
        case 'task.start':
        case 'task.pause':
        case 'task.resume':
        case 'task.rerun':
            only('taskId');
            task();
            text(body.sessionId, 'sessionId');
            break;
        case 'task.delete':
            only('taskId', 'deleteAssets', 'deleteFindings');
            task();
            text(body.sessionId, 'sessionId');
            optionalFields(body, [], ['deleteAssets', 'deleteFindings']);
            break;
        case 'category.create':
            only('name');
            text(body.name, 'name');
            break;
        case 'category.rename':
            only('id', 'name');
            id();
            text(body.name, 'name');
            break;
        case 'category.delete':
        case 'template.delete':
        case 'profile.delete':
            only('id');
            id();
            break;
        case 'template.create':
            only('input');
            template(body.input, false);
            break;
        case 'template.update':
            only('id', 'patch');
            id();
            template(body.patch, true);
            break;
        case 'goal.create':
        case 'goal.update':
            only('taskId', ...(body.action === 'goal.update' ? ['id'] : []), 'text', 'vulnClass');
            task();
            text(body.text, 'text');
            if (body.action === 'goal.update')
                id();
            optionalFields(body, ['vulnClass']);
            break;
        case 'constraint.create':
        case 'constraint.update':
            only('taskId', ...(body.action === 'constraint.update' ? ['id'] : []), 'text', 'kind');
            task();
            text(body.text, 'text');
            if (body.action === 'constraint.update')
                id();
            if (body.kind !== 'allow' && body.kind !== 'deny')
                invalid('kind must be allow or deny');
            break;
        case 'goal.delete':
        case 'constraint.delete':
            only('taskId', 'id');
            task();
            id();
            break;
        case 'chain.set':
            only('taskId', 'profileIds', 'activeProfileId');
            task();
            strings(body.profileIds, 'profileIds');
            if (body.activeProfileId !== undefined)
                nullableId(body.activeProfileId, 'activeProfileId');
            break;
        case 'profile.upsert': {
            only('input');
            const input = object(body.input, 'input');
            fields(input, ['id', 'name', 'provider', 'model', 'maxTokens', 'reasoningEffort']);
            for (const key of ['name', 'provider', 'model'])
                text(input[key], key);
            optionalFields(input, ['id', 'reasoningEffort'], [], ['maxTokens']);
            break;
        }
        default: invalid('unknown workspace action');
    }
    // The discriminated union is checked completely at this external boundary.
    return body;
}
function rules(value) {
    if (value === undefined)
        return;
    if (!Array.isArray(value))
        invalid('interceptRules must be an array');
    for (const entry of value) {
        const row = object(entry, 'rule');
        fields(row, ['enabled', 'action', 'kind', 'pattern', 'note']);
        if (typeof row.enabled !== 'boolean')
            invalid('rule enabled must be boolean');
        for (const field of ['action', 'kind', 'pattern'])
            text(row[field], field);
        optionalFields(row, ['note']);
    }
}
function respond(response, status, body) {
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    response.end(JSON.stringify(body));
}
async function readBody(request) {
    if (!request.headers['content-type']?.toLowerCase().startsWith('application/json'))
        throw new ApiError(415, 'content_type', 'JSON request body required');
    let bytes = 0;
    const chunks = [];
    for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > 1024 * 1024)
            throw new ApiError(413, 'body_too_large', 'Request exceeds 1 MiB');
        chunks.push(buffer);
    }
    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }
    catch {
        invalid('Invalid JSON request body');
    }
}
export function installTaskWorkspaceApi(ctx, store, options) {
    const agentFor = (sessionId) => sessionId ? ctx.agents.get(SessionId(sessionId)) : undefined;
    async function workspace(sessionId) {
        await store.load();
        const profiles = await options.profiles.listAvailable();
        const catalog = await options.profiles.providerCatalog();
        const state = store.snapshot();
        const agent = agentFor(sessionId);
        const available = !!(agent?.options.provider && agent.options.model && options.lifecycleForAgent(agent));
        return { version: 1, tasks: listManagedTasks(state), categories: store.listTaskCategories(), templates: store.listTaskTemplates(), goals: state.goals, constraints: state.constraints.filter(row => row.text !== '[deleted]'), scopes: state.scopes, companies: state.companies,
            profiles: profiles.map(({ id, name, provider, model, maxTokens, reasoningEffort, createdAt, updatedAt, available, reason }) => ({ id, name, provider, model, maxTokens, reasoningEffort, createdAt, updatedAt, available, reason })),
            catalog: { providers: catalog.providers.map(({ id, name }) => ({ id, name })), models: await Promise.all(catalog.models.map(async ({ id, provider, name }) => {
                    const info = await ctx.llm.resolveModelInfo(provider, id);
                    return { id, provider, name, reasoningEfforts: (info.reasoning?.efforts ?? []).map(effort => ({ id: effort.id, name: effort.name })) };
                })) },
            agent: { sessionId: sessionId ?? null, available, ...(agent ? { provider: agent.options.provider, model: agent.options.model } : {}), ...(!available ? { error: !sessionId ? '请在当前 DSH Agent 会话中打开工作台' : !agent ? '当前 Agent 会话未运行' : '当前 Agent 尚未选择模型或未启用任务运行时' } : {}) },
            admission: await options.admission(),
        };
    }
    async function execute(action) {
        await store.load();
        if ('taskId' in action && action.action !== 'task.delete')
            requireManagedTask(store.snapshot(), action.taskId);
        if (action.action.startsWith('goal.') && 'id' in action && 'taskId' in action && !store.snapshot().goals.some(g => g.id === action.id && g.taskId === action.taskId))
            throw new ApiError(404, 'not_found', 'Goal not found in task');
        if (action.action.startsWith('constraint.') && 'id' in action && 'taskId' in action && !store.snapshot().constraints.some(g => g.id === action.id && g.taskId === action.taskId))
            throw new ApiError(404, 'not_found', 'Constraint not found in task');
        switch (action.action) {
            case 'task.create': return (await options.profiles.createManagedTask(action.input)).id;
            case 'task.metadata':
                await store.updateTaskMetadata(action.taskId, action.patch);
                break;
            case 'task.category':
                await store.setTasksCategory(action.taskIds, action.categoryId);
                break;
            case 'task.delete': {
                const agent = agentFor(action.sessionId);
                if (!agent)
                    throw new ApiError(409, 'agent_unavailable', 'Current Agent is not running');
                const lifecycle = options.lifecycleForAgent(agent);
                if (!lifecycle)
                    throw new ApiError(409, 'runtime_unavailable', 'Task runtime is not installed for current Agent');
                await lifecycle.deleteTask(action.taskId, agent, { deleteAssets: action.deleteAssets, deleteFindings: action.deleteFindings });
                return action.taskId;
            }
            case 'task.start':
            case 'task.pause':
            case 'task.resume':
            case 'task.rerun': {
                const agent = agentFor(action.sessionId);
                if (!agent)
                    throw new ApiError(409, 'agent_unavailable', 'Current Agent is not running');
                if (!agent.options.provider || !agent.options.model)
                    throw new ApiError(409, 'model_unselected', 'Current Agent must select provider and model');
                const lifecycle = options.lifecycleForAgent(agent);
                if (!lifecycle)
                    throw new ApiError(409, 'runtime_unavailable', 'Task runtime is not installed for current Agent');
                if (action.action === 'task.pause')
                    await lifecycle.pause(action.taskId, agent);
                else
                    await lifecycle.start(action.taskId, agent, action.action === 'task.resume' ? 'resume' : action.action === 'task.rerun' ? 'rerun' : 'start');
                break;
            }
            case 'category.create':
                await store.createTaskCategory(action.name);
                break;
            case 'category.rename':
                await store.renameTaskCategory(action.id, action.name);
                break;
            case 'category.delete':
                await store.deleteTaskCategory(action.id);
                break;
            case 'template.create':
                await store.createTaskTemplate(action.input);
                break;
            case 'template.update':
                await store.updateTaskTemplate(action.id, action.patch);
                break;
            case 'template.delete':
                await store.deleteTaskTemplate(action.id);
                break;
            case 'goal.create':
                await store.addGoal({ taskId: action.taskId, text: action.text, vulnClass: action.vulnClass, state: 'open' });
                break;
            case 'goal.update':
                await store.updateGoal(action.id, { text: action.text, vulnClass: action.vulnClass });
                break;
            case 'goal.delete':
                await store.deleteGoal(action.id);
                break;
            case 'constraint.create':
                await store.addConstraint({ taskId: action.taskId, kind: action.kind, text: action.text, origin: 'human' });
                break;
            case 'constraint.update':
                await store.updateConstraint(action.id, { kind: action.kind, text: action.text });
                break;
            case 'constraint.delete':
                await store.deleteConstraint(action.id);
                break;
            case 'chain.set':
                await options.profiles.setTaskChain(action.taskId, action.profileIds, action.activeProfileId ?? null);
                break;
            case 'profile.upsert':
                await options.profiles.upsert(action.input);
                break;
            case 'profile.delete':
                await options.profiles.delete(action.id);
                break;
        }
        if ('taskId' in action) {
            options.notify?.(action.taskId);
            return action.taskId;
        }
        return undefined;
    }
    const dispose = ctx.webServer.register({ kind: 'exact', path: TASK_WORKSPACE_PATH, handler: async (request, response) => {
            try {
                const authorization = await options.authenticate(request);
                if (authorization !== true) {
                    const status = authorization === 403 ? 403 : 401;
                    respond(response, status, { code: status === 403 ? 'forbidden' : 'unauthorized', error: status === 403 ? 'DSH owner access required' : 'DSH authentication required' });
                    return;
                }
                if (request.method === 'GET') {
                    const sessionId = new URL(request.url ?? TASK_WORKSPACE_PATH, 'http://localhost').searchParams.get('sessionId') ?? undefined;
                    if (sessionId !== undefined)
                        text(sessionId, 'sessionId');
                    respond(response, 200, await workspace(sessionId));
                }
                else if (request.method === 'POST') {
                    const action = parseTaskWorkspaceAction(await readBody(request));
                    const taskId = await execute(action);
                    const result = { workspace: await workspace(action.sessionId), ...(taskId ? { taskId } : {}) };
                    respond(response, 200, result);
                }
                else {
                    response.setHeader('allow', 'GET, POST');
                    respond(response, 405, { code: 'method_not_allowed', error: 'Use GET or POST' });
                }
            }
            catch (error) {
                if (error instanceof ApiError)
                    respond(response, error.status, { code: error.code, error: error.message });
                else if (error instanceof TaskManagementError)
                    respond(response, error.code === 'not_found' ? 404 : error.code === 'conflict' ? 409 : 400, { code: error.code, error: error.message });
                else {
                    ctx.logger?.warn?.(`Task workspace action failed: ${String(error)}`);
                    respond(response, 409, { code: 'operation_failed', error: error instanceof Error ? error.message : 'Task operation failed' });
                }
            }
        } });
    ctx.effect(() => dispose);
    return { dispose };
}
