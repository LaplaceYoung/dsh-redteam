import { dirname, join } from 'node:path';
import { SessionSeq } from '@deepseek-ai/dsh-session';
import { effectivePrompt, matchRule, parseVerdict, reviewInput } from './model.js';
import { InterceptionRepository, digest } from './repository.js';
export class InterceptionRuntime {
    ctx;
    store;
    options;
    repository;
    ready;
    lifetime = new AbortController();
    bindings = new Map();
    results = new Map();
    dispatched = new Set();
    operations = new Set();
    disposers = [];
    constructor(ctx, store, options = {}) {
        this.ctx = ctx;
        this.store = store;
        this.options = options;
        this.repository = new InterceptionRepository(options.path ?? join(dirname(store.storagePath), 'interception.json'));
        this.ready = this.repository.initialize(store.snapshot().interceptRules);
        this.disposers.push(ctx.on('tools/pre-execute', (exec, next) => this.track(this.preExecute(exec, next))));
        this.disposers.push(ctx.on('approval/request', async (request, next) => {
            const binding = [...this.bindings.values()].find(b => b.exec.agent === request.agent && b.exec.callId === request.callId && request.reason === this.reason(b.record));
            if (!binding)
                return next();
            const durable = this.repository.wait(binding.record.id, binding.signal).then(row => row.effectiveAction === 'allow' ? 'allowed-once' : 'rejected');
            // Native UI and the durable approval page are two views of the same exact request.
            const native = next().then(async (outcome) => {
                if (outcome === 'unavailable')
                    return durable;
                const result = await this.repository.decide(binding.record.id, outcome === 'allowed-once', { reason: `DSH approval: ${outcome}` });
                return result.record.effectiveAction === 'allow' ? 'allowed-once' : outcome === 'cancelled' ? 'cancelled' : 'rejected';
            });
            return Promise.race([durable, native]);
        }));
        this.disposers.push(ctx.on('tools/execute', async (exec, next) => { if (this.results.has(exec.token))
            this.dispatched.add(exec.token); return next(); }));
        this.disposers.push(ctx.on('tools/result', (exec, result) => {
            const id = this.results.get(exec.token);
            if (!id)
                return;
            this.results.delete(exec.token);
            const dispatched = this.dispatched.delete(exec.token);
            void this.track(this.recordResult(id, result, dispatched)).catch(error => this.options.onError ? this.options.onError(error) : this.ctx.logger?.error?.(String(error)));
        }));
        ctx.effect(() => () => this.dispose());
    }
    track(operation) { this.operations.add(operation); void operation.then(() => this.operations.delete(operation), () => this.operations.delete(operation)); return operation; }
    reason(row) { return `[ARTEX approval ${row.id}] ${row.reason}`; }
    task(exec) {
        if (!exec.agent)
            return;
        const bound = this.options.taskForAgent?.(exec.agent);
        const intent = this.store.snapshot().intents.find(i => i.execution?.childSessionId === exec.agent.session.id);
        const result = bound ?? (intent ? { taskId: intent.taskId, worker: true } : undefined);
        if (result && !this.store.snapshot().tasks.some(t => t.id === result.taskId))
            throw new Error('Intercept task binding refers to a missing task');
        return result;
    }
    async judge(exec, task) {
        const config = (await this.repository.snapshot()).judge;
        if (!config.enabled)
            return;
        const base = { source: 'model', configDigest: digest({ ...config, prompt: effectivePrompt(config.prompt) }), timeoutEnabled: true, timeoutSeconds: config.askTimeoutSeconds, timeoutAction: config.askTimeoutAction };
        let input;
        try {
            input = reviewInput(exec.name, exec.arguments, { worker: task?.worker, workingDirectory: exec.agent && this.ctx.get('workingDirectory')?.get(exec.agent.session), humanMessage: exec.agent ? (this.options.humanMessage ? this.options.humanMessage(exec.agent) : currentHumanMessage(exec.agent)) : undefined });
        }
        catch (error) {
            return { ...base, action: 'ask', modelFallback: true, reason: '[模型] 审查上下文不完整，需要人工确认：' + String(error) };
        }
        const controller = new AbortController();
        const signal = AbortSignal.any([exec.signal, this.lifetime.signal, controller.signal]);
        const timer = setTimeout(() => controller.abort(new Error('Judge timed out')), config.timeoutSeconds * 1000);
        let usage, judgeCallId, judgeStatus = 'failed', judgeError;
        try {
            if (!exec.agent)
                throw new Error('Judge requires a live Agent');
            const route = config.profileId ? await this.options.profiles?.resolveProfile(config.profileId) : await this.options.profiles?.resolveGlobal?.() ?? exec.agent.options;
            if (!route?.provider || !route.model)
                throw new Error('Configured judge profile is unavailable');
            const { provider, model } = route;
            const modelInfo = await this.ctx.llm.resolveModelInfo(provider, model);
            const off = modelInfo.reasoning?.efforts.find(e => ['none', 'disabled', 'off'].includes(e.id));
            judgeCallId = await this.repository.startJudge({ taskId: task?.taskId, sessionId: exec.agent.session.id, provider, model });
            const callId = judgeCallId;
            let text = '';
            const completion = this.track((async () => {
                for await (const chunk of this.ctx.llm.stream({ provider, model, ...(off ? { reasoningEffort: off.id } : {}), system: effectivePrompt(config.prompt), messages: [{ role: 'user', content: [{ type: 'text', text: JSON.stringify(input) }] }], maxTokens: 1024, temperature: 0, signal })) {
                    if (chunk.type === 'text-delta')
                        text += chunk.text;
                    if (chunk.type === 'usage') {
                        usage = chunk.usage;
                        await this.repository.updateJudge(callId, { usage });
                    }
                    if (chunk.type === 'finish' && ['error', 'aborted'].includes(chunk.reason.kind))
                        throw new Error(`Judge completion failed: ${JSON.stringify(chunk.reason)}`);
                }
                signal.throwIfAborted();
                return parseVerdict(text);
            })());
            const verdict = await abortable(completion, signal);
            judgeStatus = 'succeeded';
            return { ...base, ...verdict, reason: '[模型] ' + verdict.reason, modelInput: input, ...(config.profileId ? { profileId: config.profileId } : {}), usage };
        }
        catch (error) {
            judgeStatus = exec.signal.aborted || this.lifetime.signal.aborted ? 'cancelled' : 'failed';
            judgeError = String(error);
            exec.signal.throwIfAborted();
            this.lifetime.signal.throwIfAborted();
            return { ...base, action: config.failAction, modelFallback: true, reason: '[模型] 模型审批失败，按失败策略处理：' + String(error), modelInput: input, ...(config.profileId ? { profileId: config.profileId } : {}), usage };
        }
        finally {
            clearTimeout(timer);
            if (judgeCallId)
                await this.repository.updateJudge(judgeCallId, { usage, status: judgeStatus, error: judgeError, finishedAt: new Date().toISOString() });
        }
    }
    async preExecute(exec, next) {
        await this.ready;
        if (exec.signal.aborted || this.lifetime.signal.aborted)
            return { kind: 'cancel' };
        const state = await this.repository.snapshot();
        if (!state.enabledTools.includes(exec.name))
            return next();
        const task = this.task(exec);
        if (task && this.store.snapshot().archives.some(job => job.taskId === task.taskId && ['archive_queued', 'archiving'].includes(job.state)))
            return { kind: 'deny', reason: 'Task is being archived; new tool execution is stopped' };
        const rule = matchRule(state.rules, exec.name, JSON.stringify(exec.arguments), task?.taskId);
        const decision = rule ? { action: rule.action, reason: rule.message || (rule.action === 'allow' ? '' : `拦截规则 [${rule.name}] ${rule.action === 'deny' ? '禁止执行此工具' : '要求用户审批，请等待'}`), ruleId: rule.id, ruleName: rule.name, configDigest: digest(rule), source: 'rule', timeoutEnabled: rule.timeoutEnabled, timeoutSeconds: rule.timeoutSeconds > 0 ? rule.timeoutSeconds : 60, timeoutAction: rule.timeoutAction } : await this.judge(exec, task);
        if (!decision)
            return next();
        return this.applyDecision(exec, decision, task?.taskId, next);
    }
    async applyDecision(exec, decision, taskId, next) {
        const row = await this.repository.add({ taskId, sessionId: exec.agent?.session.id ?? '', callId: exec.callId, rootCallId: exec.rootCallId, toolName: exec.name, toolInput: exec.arguments,
            action: decision.action, ruleId: decision.ruleId, ruleName: decision.ruleName, status: decision.action === 'ask' ? 'pending' : decision.action === 'allow' ? 'allowed' : 'denied',
            ...(decision.action === 'ask' ? {} : { effectiveAction: decision.action, decidedAt: new Date().toISOString() }),
            reason: decision.reason, decisionSource: decision.source, inputDigest: digest(exec.arguments), configDigest: decision.configDigest,
            modelInput: decision.modelInput, modelInputDigest: decision.modelInput ? digest(decision.modelInput) : undefined, modelFallback: decision.modelFallback, profileId: decision.profileId, usage: decision.usage,
            execution: { status: 'pending' },
        });
        this.results.set(exec.token, row.id);
        if (decision.action === 'deny')
            return { kind: 'deny', reason: decision.reason };
        if (decision.action === 'allow')
            return next();
        const controller = new AbortController();
        const signal = AbortSignal.any([exec.signal, this.lifetime.signal, controller.signal]);
        const binding = { exec, record: row, signal };
        this.bindings.set(row.id, binding);
        const timer = decision.timeoutEnabled ? setTimeout(() => { void this.repository.decide(row.id, decision.timeoutAction === 'allow', { timeout: true, reason: '审批超时，按超时策略处理' }).catch(error => controller.abort(error)); }, decision.timeoutSeconds * 1000) : undefined;
        try {
            if (!exec.agent || !this.ctx.get('approval'))
                throw new Error('DSH approval service or Agent is unavailable');
            const outcome = await this.ctx.approval.request({ agent: exec.agent, toolName: exec.name, callId: exec.callId, reason: this.reason(row), signal });
            await this.repository.decide(row.id, outcome === 'allowed-once', { reason: `DSH approval: ${outcome}` });
            if (signal.aborted)
                return { kind: 'cancel' };
            const saved = await this.repository.detail(row.id);
            return outcome === 'allowed-once' && saved.effectiveAction === 'allow' ? next() : { kind: 'deny', reason: saved.decisionReason ?? decision.reason };
        }
        catch (error) {
            await this.repository.decide(row.id, false, { reason: String(error) });
            if (signal.aborted)
                return { kind: 'cancel' };
            throw error;
        }
        finally {
            if (timer)
                clearTimeout(timer);
            controller.abort();
            this.bindings.delete(row.id);
        }
    }
    async requestApproval(exec, taskId, action) {
        await this.ready;
        const task = this.task(exec);
        if (!this.store.snapshot().tasks.some(t => t.id === taskId))
            throw new Error('Task not found');
        if (task && task.taskId !== taskId)
            throw new Error('Approval task does not match caller task');
        this.dispatched.add(exec.token);
        return this.applyDecision(exec, { action: 'ask', reason: action, source: 'manual', configDigest: digest({ action }), timeoutEnabled: false, timeoutSeconds: 60, timeoutAction: 'deny' }, taskId, async () => ({ kind: 'allow' }));
    }
    async recordResult(id, result, dispatched) {
        const output = JSON.stringify(result.isError ? result.error : result.value);
        const bytes = Buffer.from(output);
        let bounded = bytes.subarray(0, 64 * 1024).toString('utf8');
        if (bytes.length > 64 * 1024 && bounded.endsWith('\ufffd'))
            bounded = bounded.slice(0, -1);
        await this.repository.complete(id, { status: !dispatched ? 'not_executed' : result.isError ? 'failed' : 'succeeded', output: bounded, truncated: bytes.length > 64 * 1024, completedAt: new Date().toISOString() });
    }
    async flush() { await Promise.all([...this.operations]); }
    async dispose() {
        if (this.lifetime.signal.aborted)
            return;
        this.lifetime.abort(new Error('Interception scope disposed'));
        await Promise.allSettled([...this.operations]);
        for (const [token, id] of this.results) {
            await this.repository.complete(id, { status: 'unknown', output: 'Scope disposed before tool result', completedAt: new Date().toISOString() });
            this.results.delete(token);
        }
        for (const dispose of this.disposers.splice(0).reverse())
            dispose();
    }
}
async function abortable(operation, signal) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason); };
        signal.addEventListener('abort', abort, { once: true });
        operation.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
    });
}
/** DSH stamps provenance independently of message text; never borrow previous turns. */
function currentHumanMessage(agent) {
    for (let seq = agent.session.seq - 1; seq >= 0; seq--) {
        const event = agent.session.eventAt(SessionSeq(seq));
        if (event?.type === 'turn/start' || event?.type === 'turn/end')
            return;
        if (event?.type === 'user/message' && event.data.source.kind === 'user')
            return event.data.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
    }
}
