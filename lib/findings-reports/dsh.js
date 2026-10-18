import { SessionId } from '@deepseek-ai/dsh-session';
import { taskModelChunkCommitsOutput } from '../task-management/runtime-model.js';
import { FindingsError } from './types.js';
import { createDshReportProvider } from './model.js';
import { createDshRetestProvider } from './dsh-retest.js';
import { installFindingsReportTools } from './tools.js';
/** Each factory captures the exact caller, never a process-global last Agent. */
export function installDshFindings(ctx, store, lifecycle, profiles, options = {}) {
    const lifetime = new AbortController();
    const children = new Map();
    const attempts = new Map();
    const pending = new Set();
    function track(operation) {
        pending.add(operation);
        void operation.then(() => pending.delete(operation), () => pending.delete(operation));
        return operation;
    }
    function parentRoute(parent) {
        const { provider, model, maxTokens, reasoningEffort } = parent.options;
        if (!provider?.trim() || !model?.trim())
            throw new FindingsError('unavailable', 'caller must select a real provider and model');
        return { provider, model, maxTokens, reasoningEffort };
    }
    function caller(exec) {
        exec.signal.throwIfAborted();
        lifetime.signal.throwIfAborted();
        if (!exec.agent || ctx.agents.get(exec.agent.id) !== exec.agent)
            throw new FindingsError('forbidden', 'findings tools require the exact live DSH Agent');
        return exec.agent;
    }
    function accessForAgent(agent) {
        const state = store.snapshot();
        const finding = state.findings.find(f => f.retests?.some(r => r.sessionId === agent.id));
        if (finding)
            return { findingId: finding.id, ...(state.tasks.some(t => t.id === finding.taskId) ? { taskId: finding.taskId } : {}), readonly: true };
        const managed = lifecycle.resolveBinding?.(agent) ?? lifecycle.taskForAgent(agent.id)?.binding;
        if (managed)
            return { taskId: managed.taskId };
        const ownedTasks = new Set(state.intents.filter(i => i.execution?.parentSessionId === agent.id).map(i => i.taskId));
        if (ownedTasks.size === 1)
            return { taskId: [...ownedTasks][0] };
        if (ownedTasks.size > 1)
            throw new FindingsError('forbidden', 'Agent owns multiple tasks without an active lifecycle binding');
        // Other DSH agent scopes share durable Worker bindings but not lifecycle's local maps.
        const intent = state.intents.find(i => i.execution?.childSessionId === agent.id);
        if (intent) {
            if (intent.execution.parentSessionId !== agent.session.header.parentSession)
                throw new FindingsError('forbidden', 'Worker session lineage mismatch');
            return { taskId: intent.taskId };
        }
        if (agent.session.header.origin === 'subagent' || agent.session.header.parentSession) {
            const parentId = agent.session.header.parentSession, parent = parentId ? ctx.agents.get(parentId) : undefined;
            if (!parent || !ctx.agents.isOwnedBy(agent.id, parent))
                throw new FindingsError('forbidden', 'unbound child cannot access the findings workspace');
            return accessForAgent(parent);
        }
        return {};
    }
    async function route(role, taskId, parent) {
        if (store.snapshot().tasks.some(t => t.id === taskId)) {
            const selection = await lifecycle.models.selectRoute(taskId, parentRoute(parent), role);
            if (!selection.available)
                throw new FindingsError('unavailable', selection.reason);
            return selection.route;
        }
        // Retained findings remain usable after the originating task was deleted.
        const selected = await profiles.resolveBinding(taskId, role) ?? await profiles.resolveGlobal?.() ?? parentRoute(parent);
        if (!ctx.llm.listProviders().some(p => p.id === selected.provider))
            throw new FindingsError('unavailable', `provider is not registered: ${selected.provider}`);
        return selected;
    }
    const installation = installFindingsReportTools(ctx, store, {
        automaticReports: options.automaticReports,
        trafficBindingEnabled: options.trafficBindingEnabled,
        resolveAccess: exec => accessForAgent(caller(exec)),
        reportProviderFor: exec => {
            const parent = caller(exec), signal = AbortSignal.any([exec.signal, lifetime.signal]);
            return { generate: (input, requestedSignal) => {
                    const taskId = input.finding.taskId;
                    const llm = store.snapshot().tasks.some(t => t.id === taskId) ? { stream: (request) => lifecycle.models.stream(taskId, 'reporter', request, parentRoute(parent)) } : ctx.llm;
                    const provider = createDshReportProvider(llm, () => route('reporter', taskId, parent));
                    return track(provider.generate(input, requestedSignal ? AbortSignal.any([signal, requestedSignal]) : signal));
                } };
        },
        retestProviderFor: exec => {
            const parent = caller(exec);
            return { run: input => track((async () => {
                    const taskId = input.retest.snapshot.finding.taskId;
                    let childId;
                    try {
                        return await createDshRetestProvider(ctx, parent, { route: await route('retester', taskId, parent) }).run({ ...input, signal: AbortSignal.any([input.signal, exec.signal, lifetime.signal]), onSession: async (id) => { await input.onSession(id); childId = id; children.set(id, { taskId, parent }); } });
                    }
                    finally {
                        if (childId) {
                            children.delete(childId);
                            attempts.delete(childId);
                        }
                    }
                })()) };
        },
        admitTask: async (taskId, exec) => {
            const agent = caller(exec), binding = lifecycle.resolveBinding?.(agent) ?? lifecycle.taskForAgent(agent.id)?.binding;
            const execution = store.snapshot().intents.find(i => i.execution?.childSessionId === agent.id)?.execution;
            const owner = execution ? ctx.agents.get(SessionId(execution.parentSessionId)) : undefined;
            const parent = binding?.parent ?? owner ?? agent;
            const task = store.snapshot().tasks.find(t => t.id === taskId);
            if (!task)
                throw new FindingsError('not_found', 'task not found');
            return lifecycle.start(taskId, parent, ['done', 'failed', 'timeout'].includes(task.status) ? 'rerun' : task.status === 'paused' ? 'resume' : 'start');
        }
    });
    // The retester may inspect only its captured finding and save a session-owned verdict.
    // In particular it cannot escape via older unrestricted redteam_* tools.
    const unhooks = [ctx.root.on('tools/pre-execute', async (exec, next) => {
            if (!exec.agent || !store.snapshot().findings.some(f => f.retests?.some(r => r.sessionId === exec.agent.id)))
                return next();
            if (!exec.name.startsWith('redteam_'))
                return next();
            const allowed = new Set(['redteam_finding_query', 'redteam_finding_traffic', 'redteam_finding_report', 'redteam_finding_export', 'redteam_get_finding_retest_context', 'redteam_record_finding_retest_result']);
            if (!allowed.has(exec.name))
                return { kind: 'deny', reason: 'Retester may read its finding and record only its own verdict' };
            return next();
        }), ctx.root.on('agent/request', async (payload, next) => {
            const child = children.get(payload.agent.id);
            if (!child || !store.snapshot().tasks.some(t => t.id === child.taskId))
                return next();
            const config = await next(), selection = await lifecycle.models.selectRoute(child.taskId, parentRoute(child.parent), 'retester');
            if (!selection.available)
                throw new FindingsError('unavailable', selection.reason);
            attempts.set(payload.agent.id, { selection, committed: false });
            const { maxTokens: _max, reasoningEffort: _effort, ...retained } = config;
            return { ...retained, ...selection.route };
        }), ctx.root.on('agent/assistant-stream', ({ agent, frame }) => {
            const attempt = attempts.get(agent.id);
            if (attempt && frame.type === 'chunk' && taskModelChunkCommitsOutput(frame.chunk))
                attempt.committed = true;
        }), ctx.root.on('agent/request-error', async (payload, next) => {
            const attempt = attempts.get(payload.agent.id);
            if (!attempt || !children.has(payload.agent.id))
                return next();
            payload.signal.throwIfAborted();
            const result = await lifecycle.models.recordFailure(attempt.selection, payload.failure, attempt.committed);
            if (result.replay)
                return { kind: 'retry' };
            if (result.handled)
                return undefined;
            return next();
        })];
    const ready = installation.retests.recover();
    return { ...installation, ready, resolveAccess: accessForAgent, dispose: async () => {
            lifetime.abort(new Error('findings host disposed'));
            installation.dispose();
            try {
                await Promise.allSettled([ready, ...pending]);
            }
            finally {
                for (const unhook of unhooks)
                    unhook();
            }
        } };
}
