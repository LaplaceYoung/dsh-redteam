import { SessionId } from '@deepseek-ai/dsh-session';
import { createScope, scopeOf, scopeParentOf } from '@deepseek-ai/dsh-scope';
import { resolve } from 'node:path';
import { createConversationWorkspace } from './index.js';
export const conversationHostDependencies = ['agents', 'agentPresets', 'tools', 'llm', 'sessionQuery', 'sessionPersistence', 'sessionProjections'];
const hosts = new WeakMap();
const managedAgents = new WeakMap();
const pathKey = (path) => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
/** These Agents already receive an explicit Platform run; do not auto-attach another one. */
export function isConversationWorkspaceAgent(agent) { return managedAgents.has(agent); }
export function conversationTaskForAgent(agent) {
    const binding = managedAgents.get(agent);
    return binding?.taskId ? { taskId: binding.taskId, agentKey: binding.agentKey } : undefined;
}
class ConversationHost {
    root;
    store;
    capabilities = new Map();
    scope;
    runs = new Map();
    workspace;
    options;
    closing;
    constructor(root, store) {
        this.root = root;
        this.store = store;
        // A host child owns the workspace. No Agent/plugin caller becomes its owner.
        this.scope = createScope(root, {});
        this.scope.ctx.effect(() => async () => { await this.closeWorkspace(); });
    }
    async revision(sessionId) {
        if (this.closing)
            throw new Error('Conversation host is disposed');
        const presets = this.root.get('agentPresets');
        if (!presets)
            throw new Error('Conversation workspace requires the DSH agentPresets host service');
        const live = sessionId ? this.root.get('agents').get(SessionId(sessionId)) : undefined;
        let scope;
        let release;
        let key;
        if (live && managedAgents.has(live)) {
            // Existing sessions retain their original revision across preset updates.
            scope = createScope(this.scope.ctx, {});
            try {
                if (presets.composeFrom(scope.ctx, live.ctx) !== 'redteam')
                    throw new Error('Conversation Agent is not composed with redteam');
                key = scopeParentOf(scopeOf(scope.ctx));
            }
            catch (error) {
                await scope.dispose();
                throw error;
            }
        }
        else {
            const lease = await presets.acquireScope('redteam');
            const disposeLease = async () => { await lease[Symbol.asyncDispose](); };
            release = disposeLease;
            key = lease.key;
            try {
                scope = createScope(this.scope.ctx, {}, { parent: key });
            }
            catch (error) {
                await disposeLease();
                throw error;
            }
        }
        const capabilities = this.capabilities.get(key);
        const dispose = async () => { try {
            await scope.dispose();
        }
        finally {
            await release?.();
        } };
        if (!capabilities) {
            await dispose();
            throw new Error('The redteam preset has not registered conversation capabilities for its active revision');
        }
        return { scope, key, capabilities, dispose };
    }
    async withRevision(fn) {
        const revision = await this.revision();
        try {
            return await fn(revision.capabilities);
        }
        finally {
            await revision.dispose();
        }
    }
    prepareRun = async (input) => {
        if (!input.sessionId)
            throw new Error('Conversation preparation requires its native session ID');
        const revision = await this.revision(input.sessionId);
        try {
            const registry = this.root.get('agentPresets').serviceFor({ ctx: revision.scope.ctx }, 'tools') ?? this.root.get('tools');
            const baseTools = registry.schemas(revision.key).map(schema => registry.get(schema.name, revision.key));
            const prepared = await revision.capabilities.prepareRun({ ...input, baseTools });
            const run = { revision, prepared, taskId: input.taskId, agentKey: input.agentKey };
            this.runs.set(input.sessionId, run);
            let disposed;
            return {
                ...prepared,
                attach: (ctx, agent, options) => {
                    managedAgents.set(agent, { taskId: run.taskId, agentKey: run.agentKey });
                    return prepared.attach(ctx, agent, options);
                },
                dispose: () => disposed ??= (async () => {
                    if (this.runs.get(input.sessionId) === run)
                        this.runs.delete(input.sessionId);
                    try {
                        await prepared.dispose();
                    }
                    finally {
                        await revision.dispose();
                    }
                })(),
            };
        }
        catch (error) {
            await revision.dispose();
            throw error;
        }
    };
    get(options) {
        if (this.closing)
            throw new Error('Conversation host is disposed');
        if (this.options) {
            for (const field of ['directory', 'workspaceRoot']) {
                const previous = this.options[field], current = options[field];
                if (current !== undefined && (previous === undefined || pathKey(current) !== pathKey(previous)))
                    throw new Error(`Conversation ${field} must match across contexts sharing the same store`);
            }
        }
        else
            this.options = options;
        // No preset lookup during initialization: a preset row may itself await this.
        return this.workspace ??= this.initializeWorkspace();
    }
    async initializeWorkspace() {
        let workspace;
        await this.scope.ctx.inject([...conversationHostDependencies], async (hostCtx) => {
            workspace = await createConversationWorkspace(hostCtx, this.store, {
                ...this.options,
                profiles: {
                    resolveProfile: id => this.withRevision(c => c.profiles.resolveProfile(id)),
                    resolveBinding: (id, role) => this.withRevision(c => c.profiles.resolveBinding(id, role)),
                    resolveGlobal: () => this.withRevision(c => c.profiles.resolveGlobal?.() ?? null),
                },
                resolveAgent: key => this.withRevision(c => c.resolveAgent(key)),
                resolveAgentProfile: key => this.withRevision(c => c.resolveAgentProfile?.(key) ?? null),
                prepareRun: this.prepareRun,
                setupAgent: async (ctx, agent) => {
                    const run = this.runs.get(agent.id);
                    if (!run)
                        throw new Error('Conversation setup has no prepared preset revision');
                    if (hostCtx.agentPresets.composeFrom(ctx, run.revision.scope.ctx) !== 'redteam')
                        throw new Error('Conversation redteam composition failed');
                    const logged = hostCtx.sessionProjections.stateOf(agent.session, 'agentPreset');
                    if (logged && logged !== 'redteam')
                        throw new Error(`Conversation session belongs to preset ${logged}`);
                    if (!logged) {
                        const boundary = hostCtx.sessionProjections.stateOf(agent.session, 'turnBoundary');
                        if (boundary && (boundary.openTurnStartSeq !== null || boundary.lastTurn > 0))
                            throw new Error('Cannot relabel an existing conversation transcript as redteam');
                        agent.session.append('agent-preset/selected', { agentPreset: 'redteam' });
                    }
                    managedAgents.set(agent, { taskId: run.taskId, agentKey: run.agentKey });
                    ctx.effect(() => () => { managedAgents.delete(agent); });
                },
                bindTask: async (taskId, agent) => {
                    const run = this.runs.get(agent.id);
                    if (!run?.revision.capabilities.bindTask)
                        throw new Error('Task conversation context binding is not installed');
                    await run.revision.capabilities.bindTask(taskId, agent);
                },
            });
        });
        if (!workspace)
            throw new Error('Conversation host dependencies did not activate');
        return workspace;
    }
    closeWorkspace() {
        return this.closing ??= (async () => { if (this.workspace)
            await (await this.workspace).dispose(); })();
    }
    async dispose() { try {
        await this.closeWorkspace();
    }
    finally {
        await this.scope.dispose();
    } }
}
function hostFor(ctx, store) {
    let byPath = hosts.get(ctx.root);
    if (!byPath) {
        byPath = new Map();
        hosts.set(ctx.root, byPath);
    }
    const key = pathKey(store.storagePath);
    let host = byPath.get(key);
    if (!host) {
        host = new ConversationHost(ctx.root, store);
        byPath.set(key, host);
    }
    return host;
}
/** Synchronous registration cannot await (and thereby deadlock) preset activation. */
export function registerConversationPreset(ctx, store, capabilities) {
    const key = scopeOf(ctx);
    if (!key)
        throw new Error('Conversation capabilities must be registered from a redteam preset scope');
    const host = hostFor(ctx, store);
    if (host.capabilities.has(key))
        throw new Error('Conversation capabilities are already registered for this preset revision');
    host.capabilities.set(key, capabilities);
    const remove = () => { if (host.capabilities.get(key) === capabilities)
        host.capabilities.delete(key); };
    ctx.effect(() => remove);
    return remove;
}
/** Safe from either UI or preset startup; only conversation execution acquires a preset. */
export function getConversationWorkspace(ctx, store, options = {}) {
    for (const name of conversationHostDependencies)
        if (!ctx.root.get(name))
            throw new Error(`Conversation workspace requires the DSH ${name} host service`);
    return hostFor(ctx, store).get(options);
}
/** Explicit plugin/host shutdown; normal Agent disposal never closes the workspace. */
export async function disposeConversationWorkspace(ctx, store) {
    const byPath = hosts.get(ctx.root), key = pathKey(store.storagePath), host = byPath?.get(key);
    if (!host)
        return;
    try {
        await host.dispose();
    }
    finally {
        if (byPath?.get(key) === host)
            byPath.delete(key);
    }
}
