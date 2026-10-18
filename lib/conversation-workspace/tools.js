import { defineTool } from '@deepseek-ai/dsh-tools';
const json = (value) => JSON.parse(JSON.stringify(value));
const output = { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] };
function required(value, name) { if (!value)
    throw new Error(`${name} is required`); return value; }
export function installConversationWorkspaceTools(ctx, runtime) {
    const disposers = [
        ctx.tools.register(defineTool({
            name: 'redteam_conversation', description: 'Create and manage real native DSH conversations and task main-session segments; send returns accepted, messages exposes native event history. Deletion removes the business entry while native audit history remains.',
            parameters: { action: { type: 'string', required: true, enum: ['create', 'list', 'get', 'update', 'send', 'stop', 'messages', 'segments', 'delete'] }, id: { type: 'string' }, agent_key: { type: 'string' }, task_id: { type: 'string' }, title: { type: 'string' }, profile_id: { type: 'string' }, clear_profile: { type: 'boolean' }, pinned: { type: 'boolean' }, message: { type: 'string' }, query: { type: 'string' }, cursor: { type: 'number' }, limit: { type: 'number' } }, output,
            execute: async (args, exec) => {
                const service = runtime.conversations;
                if (args.action === 'list')
                    return json(await service.list({ query: args.query, taskId: args.task_id }));
                if (args.action === 'segments')
                    return json(await service.segments(required(args.task_id, 'task_id')));
                if (args.action === 'create')
                    return json(await service.create({ agentKey: required(args.agent_key, 'agent_key'), taskId: args.task_id, title: args.title, profileId: args.profile_id }, exec.agent));
                const id = required(args.id, 'id');
                switch (args.action) {
                    case 'get': return json(await service.get(id));
                    case 'update': return json(await service.update(id, { ...(args.title !== undefined ? { title: args.title } : {}), ...(args.pinned !== undefined ? { pinned: args.pinned } : {}), ...(args.clear_profile ? { profileId: null } : args.profile_id !== undefined ? { profileId: args.profile_id } : {}) }));
                    case 'send': return json(await service.send(id, required(args.message, 'message'), { parent: exec.agent }));
                    case 'stop':
                        await service.cancel(id);
                        return { stopped: true };
                    case 'messages': return json(await service.messages(id, args.cursor, args.limit));
                    case 'delete':
                        await service.delete(id);
                        return { deleted: id };
                    default: throw new Error('Unknown conversation action');
                }
            },
        })),
        ctx.tools.register(defineTool({
            name: 'redteam_side_question', description: 'Ask an independent tool-free question against a frozen main/worker context. Does not steer or cancel the main Agent. Reuse client_request_id only for the same question.',
            parameters: { action: { type: 'string', required: true, enum: ['ask', 'list', 'get', 'cancel', 'clear'] }, parent_kind: { type: 'string', enum: ['conversation', 'task'] }, parent_id: { type: 'string' }, exploration_id: { type: 'string' }, intent_id: { type: 'string' }, question: { type: 'string' }, client_request_id: { type: 'string' }, request_id: { type: 'string' }, before: { type: 'number' }, limit: { type: 'number' } }, output,
            execute: async (args) => {
                if (args.action === 'get')
                    return json(await runtime.sideQuestions.get(required(args.request_id, 'request_id')) ?? null);
                if (args.action === 'cancel')
                    return json(await runtime.sideQuestions.cancel(required(args.request_id, 'request_id')));
                const id = required(args.parent_id, 'parent_id');
                if (!args.parent_kind)
                    throw new Error('parent_kind is required');
                const parent = args.parent_kind === 'conversation' ? { kind: 'conversation', id } : { kind: 'task', id, explorationId: args.exploration_id, intentId: args.intent_id };
                switch (args.action) {
                    case 'ask': return json(await runtime.sideQuestions.ask(parent, { question: required(args.question, 'question'), clientRequestId: required(args.client_request_id, 'client_request_id') }));
                    case 'list': return json(await runtime.sideQuestions.list(parent, { before: args.before, limit: args.limit }));
                    case 'clear':
                        await runtime.sideQuestions.clear(parent);
                        return { cleared: true };
                    default: throw new Error('Unknown side-question action');
                }
            },
        })),
        ctx.tools.register(defineTool({
            name: 'redteam_workspace_file', description: 'List, read, write, mkdir or delete paths inside the shared ARTEX workspace. Read is bounded at 2 MiB; binary/large files return metadata. File uploads and streaming downloads use the authenticated workspace HTTP API.',
            parameters: { action: { type: 'string', required: true, enum: ['list', 'read', 'write', 'mkdir', 'delete'] }, path: { type: 'string', required: true }, content: { type: 'string' } }, output,
            execute: async (args) => {
                switch (args.action) {
                    case 'list': return json(await runtime.files.list(args.path));
                    case 'read': return json(await runtime.files.read(args.path));
                    case 'write':
                        if (args.content === undefined)
                            throw new Error('content is required');
                        return json(await runtime.files.write(args.path, args.content));
                    case 'mkdir': return json(await runtime.files.mkdir(args.path));
                    case 'delete': return json(await runtime.files.delete(args.path));
                    default: throw new Error('Unknown workspace action');
                }
            },
        })),
        ctx.tools.register(defineTool({
            name: 'redteam_search_chat_mentions', description: 'Search persisted findings, companies and typed assets for message mention tokens. Returns at most 20 results with a query-bound cursor; labels do not grant authority.',
            parameters: { query: { type: 'string' }, scope: { type: 'string', enum: ['all', 'finding', 'asset', 'company', 'endpoint', 'ip', 'app', 'root_domain', 'subdomain', 'service'] }, cursor: { type: 'string' }, task_id: { type: 'string' } }, output,
            execute: async (args) => json(runtime.mentions.search({ query: args.query, scope: args.scope, cursor: args.cursor, taskId: args.task_id })),
        })),
    ];
    const dispose = () => { for (const unregister of disposers.splice(0).reverse())
        unregister(); };
    ctx.effect(() => dispose);
    return dispose;
}
