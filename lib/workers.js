import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { SessionId } from '@deepseek-ai/dsh-session';
import { finalAssistantOutput, foldSubagentDescriptor } from '@deepseek-ai/dsh-subagent';
import { applicableConstraints, constraintPrompt } from './platform/constraints.js';
export class WorkerRuntime {
    ctx;
    store;
    concurrency;
    platform;
    agentTeams;
    children = new Map();
    lifetime = new AbortController();
    pendingStarts = new Set();
    pendingResults = new Set();
    resultErrors = [];
    eventQueues = new Map();
    platformRuns = new Map();
    timeoutTasks = new Set();
    executionSignals = new Map();
    modelFailures = new Map();
    retryCounts = new Map();
    retryJobs = new Map();
    /** Team allocates a child Session inside spawnTeammate, before that call returns. */
    pendingTeamStarts = new Map();
    removePlatformListener;
    constructor(ctx, store, concurrency, platform = {}, agentTeams) {
        this.ctx = ctx;
        this.store = store;
        this.concurrency = concurrency;
        this.platform = platform;
        // Cordis contexts throw on direct reads of services that were not injected.
        // Resolve the optional experimental service through Reflect.get so legacy
        // fixtures and profiles keep the native subagent path.
        const context = ctx;
        this.agentTeams = agentTeams ?? (typeof context.get === 'function'
            ? context.get('agentTeams', false)
            : context.agentTeams);
        if (!Number.isSafeInteger(concurrency) || concurrency < 1)
            throw new Error('plannerConcurrency must be a positive integer');
        if (ctx.root) {
            this.removePlatformListener = ctx.root.on('agent/created', async ({ agent, signal }) => {
                const pendingTeam = [...this.pendingTeamStarts.values()].find(entry => agent.session.header.parentSession === entry.parent.id);
                const parent = this.children.get(agent.id) ?? pendingTeam?.parent;
                if (!parent)
                    return;
                if (pendingTeam)
                    this.children.set(agent.id, parent);
                const intent = pendingTeam
                    ? this.store.snapshot().intents.find(row => row.id === pendingTeam.intentId)
                    : this.store.snapshot().intents.find(row => row.execution?.childSessionId === agent.id && row.execution.parentSessionId === parent.id);
                if (!intent)
                    throw new Error(`Worker platform binding disappeared: ${agent.id}`);
                // Agent Teams publishes the child before spawnTeammate resolves. Save
                // the real Session id at this boundary so a very fast child cannot
                // finish while the intent still points at its provisional id.
                if (pendingTeam && (intent.state === 'claimed' || intent.state === 'running')) {
                    await this.store.setWorkerExecution(intent.id, {
                        childSessionId: agent.id,
                        parentSessionId: parent.id,
                        provider: pendingTeam.provider,
                        teamName: pendingTeam.teamName,
                    });
                }
                const task = this.store.snapshot().tasks.find(row => row.id === intent.taskId);
                // Task-router handlers intentionally stop this waterfall when they own a
                // failure. Only an unhandled provider failure may retry the whole intent.
                agent.ctx.on('agent/request-error', async (payload, next) => {
                    const action = await next();
                    if (payload.agent === agent && action?.kind !== 'retry' && !payload.signal.aborted)
                        this.modelFailures.set(agent.id, payload.turn);
                    return action;
                });
                let currentConstraints = '', admittedConstraints;
                const constraints = () => currentConstraints = constraintPrompt(applicableConstraints(this.platform.constraints?.(task.id) ?? this.store.snapshot().constraints, task.id));
                // Providers supporting in-history system updates otherwise retain the old
                // injected boundary. A changed boundary starts a series and replaces it.
                agent.ctx.on('agent/pre-step', async (payload, next) => {
                    const decision = await next();
                    if (payload.agent !== agent || decision.kind !== 'enter' || admittedConstraints === currentConstraints)
                        return decision;
                    admittedConstraints = currentConstraints;
                    return { ...decision, startsRequestSeries: true };
                });
                if (!platform.prepareRun) {
                    agent.ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
                        const assembled = await next();
                        if (context.agent !== agent)
                            return assembled;
                        const text = constraints();
                        return { ...assembled, sections: [...assembled.sections.filter(section => section.name !== 'artex-worker-constraints'), ...(text ? [{ name: 'artex-worker-constraints', text, interpolate: false }] : [])] };
                    });
                    return;
                }
                const calls = new Map();
                const historySkills = [];
                for (const event of agent.session.snapshotEvents()) {
                    if (event.type === 'tool/call' && event.data.name === 'Skill') {
                        try {
                            const args = JSON.parse(event.data.arguments);
                            if (args && typeof args === 'object' && 'name' in args && typeof args.name === 'string')
                                calls.set(event.data.callId, args.name);
                        }
                        catch { /* Malformed historical calls never unlock capabilities. */ }
                    }
                    else if (event.type === 'tool/result' && !event.data.message.isError) {
                        const name = calls.get(event.data.message.toolCallId);
                        if (name)
                            historySkills.push(name);
                    }
                }
                const prepared = await platform.prepareRun({ agentKey: 'worker', taskId: task.id, sessionId: agent.id, parent, signal: signal ? AbortSignal.any([signal, this.lifetime.signal]) : this.lifetime.signal,
                    historySkills,
                    systemPromptSuffix: constraints,
                    baseTools: agent.ctx.tools.schemas(agent).map(schema => agent.ctx.tools.get(schema.name, agent)),
                    variables: { TaskID: task.id, TaskGoal: task.goal, TaskDesc: task.description ?? task.title, IntentID: intent.id, Intent: intent.summary, Task: task.goal, Instruction: intent.summary } });
                try {
                    const detach = prepared.attach(agent.ctx, agent);
                    this.platformRuns.set(agent.id, prepared);
                    if (this.timeoutTasks.has(task.id))
                        prepared.startTaskTimeoutWrapup(agent);
                    agent.ctx.effect(() => async () => { detach(); await prepared.dispose(); this.platformRuns.delete(agent.id); });
                }
                catch (error) {
                    await prepared.dispose();
                    throw error;
                }
            });
        }
    }
    start(taskId, parent, signal, provider = 'spawn') {
        const pending = this.startChild(taskId, parent, AbortSignal.any([signal, this.lifetime.signal]), provider);
        this.pendingStarts.add(pending);
        void pending.then(() => this.pendingStarts.delete(pending), () => this.pendingStarts.delete(pending));
        return pending;
    }
    async startChild(taskId, parent, signal, provider) {
        signal.throwIfAborted();
        const service = this.ctx.subagents;
        const teams = this.agentTeams;
        if (!service && !teams)
            throw new Error('DSH subagents or Agent Teams service is unavailable');
        if (!teams && (!service || !service.getProvider(provider)?.prepareContinuable))
            throw new Error(`DSH continuable provider is unavailable: ${provider}`);
        // Agent Teams allocates the real child Session id during spawnTeammate.
        // Reserve the ARTEX intent first to preserve the existing FIFO/concurrency
        // gate, then replace this provisional binding before event observation.
        const provisionalId = SessionId(randomUUID());
        const intent = await this.store.claimIntent(taskId, provisionalId, { execution: { childSessionId: provisionalId, parentSessionId: parent.id, provider }, concurrency: this.concurrency });
        if (!intent)
            return undefined;
        let childId = provisionalId;
        let teamName;
        this.children.set(childId, parent);
        this.executionSignals.set(childId, signal);
        try {
            const state = this.store.snapshot();
            const task = state.tasks.find((item) => item.id === taskId);
            const prompt = [
                `执行 ARTEX Worker 意图：${intent.summary}`,
                `任务 ID：${taskId}\n意图 ID：${intent.id}\n任务目标：${task.goal}`,
                `输入：${JSON.stringify(intent.input)}`,
                `目标：${JSON.stringify(state.goals.filter((item) => item.taskId === taskId))}`,
                `范围：${JSON.stringify(state.scopes.filter((item) => item.taskId === taskId))}`,
                '使用 redteam_* 工具读取任务证据、记录事实、资产和发现。最终回复说明结果、证据和未解决问题；宿主根据真实会话结束事件回写意图状态。'
            ].join('\n\n');
            if (teams) {
                teamName = this.workerTeamName(intent.id);
                this.pendingTeamStarts.set(intent.id, { taskId, intentId: intent.id, parent, provider, teamName });
                const spawned = await teams.spawnTeammate(parent, {
                    name: teamName,
                    description: `ARTEX Worker：${intent.summary}`.slice(0, 200),
                    prompt: [{ type: 'text', text: prompt }],
                    context: provider === 'fork' ? 'fork' : 'fresh',
                    provider,
                    signal,
                });
                childId = SessionId(spawned.member.id);
                await this.store.setWorkerExecution(intent.id, { childSessionId: childId, parentSessionId: parent.id, provider, teamName });
                this.children.delete(provisionalId);
                this.executionSignals.delete(provisionalId);
                this.children.set(childId, parent);
                this.executionSignals.set(childId, signal);
                this.pendingTeamStarts.delete(intent.id);
                // TeamService persists the initial inbox item before returning. The
                // Worker observes the child Session's turn/end events for settlement;
                // no synthetic result Promise is created here.
            }
            else {
                const accepted = await service.startActivation({ provider, label: intent.summary, childId, request: { parent, prompt: [{ type: 'text', text: prompt }], maxDepth: service.resolveMaxDepth() }, delivery: 'parent', signal });
                const receiptSaved = this.store.setWorkerMessage(intent.id, accepted.messageId);
                const result = accepted.result.then(() => { }, async (error) => {
                    await receiptSaved;
                    await this.store.transaction((state) => {
                        const current = state.intents.find((row) => row.id === intent.id);
                        // A later steering receipt or archived task no longer belongs to this activation.
                        if (!current || current.execution?.messageId !== accepted.messageId)
                            return;
                        const message = error instanceof Error ? error.message : String(error);
                        current.state = 'blocked';
                        current.output = { error: message };
                        current.updatedAt = new Date().toISOString();
                        state.traces.push({ id: randomUUID(), taskId, intentId: intent.id, worker: childId, kind: 'error', summary: `DSH activation result failed: ${message}`, createdAt: current.updatedAt });
                    });
                });
                this.pendingResults.add(result);
                void result.then(() => this.pendingResults.delete(result), (error) => { this.pendingResults.delete(result); this.resultErrors.push(error); });
                await receiptSaved;
            }
            return this.getIntent(intent.id);
        }
        catch (error) {
            this.pendingTeamStarts.delete(intent.id);
            // Also releases an accepted child if saving its receipt failed.
            const errors = [error];
            try {
                if (service)
                    await service.drainChildren(parent, [SessionId(childId)]);
                this.children.delete(childId);
                this.children.delete(provisionalId);
            }
            catch (cleanupError) {
                errors.push(cleanupError);
            }
            await this.store.updateIntent(intent.id, { state: 'blocked', output: { error: error instanceof Error ? error.message : String(error) } });
            await this.store.addTrace({ taskId, intentId: intent.id, worker: childId, kind: 'error', summary: `Worker 启动失败：${error instanceof Error ? error.message : String(error)}` });
            throw errors.length === 1 ? error : new AggregateError(errors, 'Worker startup and cleanup failed');
        }
    }
    workerTeamName(intentId) {
        // Team names are lower-kebab-case and never reused within a Lead. Intent
        // ids are UUIDs, therefore the prefix is both valid and collision-safe for
        // the lifetime of one task execution.
        return `artex-worker-${intentId.replace(/[^a-z0-9-]/gi, '').toLowerCase().slice(0, 40)}`;
    }
    async steer(intentId, message, parent, signal) {
        this.lifetime.signal.throwIfAborted();
        const intent = this.authorize(intentId, parent);
        const childId = SessionId(intent.execution.childSessionId);
        await this.cancelRetry(childId);
        this.retryCounts.delete(childId);
        this.executionSignals.set(childId, AbortSignal.any([signal, this.lifetime.signal]));
        this.children.set(childId, parent);
        const messageId = intent.execution?.teamName && this.agentTeams
            ? (await this.agentTeams.sendMessage(parent, { target: intent.execution.teamName, content: [{ type: 'text', text: message }], signal })).messageId
            : await this.ctx.subagents.sendMessage(parent, childId, [{ type: 'text', text: message }], { signal });
        await this.store.setWorkerMessage(intentId, messageId);
        await this.store.addTrace({ taskId: intent.taskId, intentId, worker: childId, kind: 'tool', summary: 'Worker 已接收 steering 消息', data: { message, messageId } });
        return { intentId, childSessionId: childId, messageId };
    }
    async stop(intentId, parent, state = 'paused') {
        const intent = this.authorize(intentId, parent);
        const childId = SessionId(intent.execution.childSessionId);
        await this.cancelRetry(childId);
        if (intent.execution?.teamName && this.agentTeams)
            this.agentTeams.interrupt(parent, intent.execution.teamName);
        await this.ctx.subagents.drainChildren(parent, [childId]);
        const stopped = await this.store.updateIntent(intentId, { state });
        await this.store.addTrace({ taskId: intent.taskId, intentId, worker: childId, kind: 'result', summary: `DSH Worker 已停止：${state}` });
        return stopped;
    }
    async beginTaskTimeout(taskId) {
        this.timeoutTasks.add(taskId);
        for (const intent of this.store.snapshot().intents.filter(row => row.taskId === taskId && row.execution))
            await this.cancelRetry(intent.execution.childSessionId);
        for (const intent of this.store.snapshot().intents.filter(row => row.taskId === taskId && ['running', 'claimed'].includes(row.state))) {
            const id = intent.execution?.childSessionId;
            if (!id || !this.children.has(id))
                continue;
            const agent = this.ctx.agents.get(SessionId(id));
            const prepared = this.platformRuns.get(id);
            if (agent && prepared)
                prepared.startTaskTimeoutWrapup(agent);
        }
    }
    async observe(session, event) {
        if (!this.children.has(session.id))
            return;
        const events = event.type === 'turn/end' ? session.snapshotEvents() : [];
        return this.serialEvents(session.id, () => this.applyEvent(session.id, events, event));
    }
    serialEvents(id, operation) {
        const previous = this.eventQueues.get(id) ?? Promise.resolve();
        // Each caller receives its own failure; a failed observation must not poison
        // the queue and suppress all future durable events for that child.
        const pending = previous.catch(() => { }).then(operation);
        this.eventQueues.set(id, pending);
        void pending.then(() => { if (this.eventQueues.get(id) === pending)
            this.eventQueues.delete(id); }, () => { if (this.eventQueues.get(id) === pending)
            this.eventQueues.delete(id); });
        return pending;
    }
    async applyEvent(sessionId, allEvents, event) {
        const data = { sessionId, seq: event.seq, event: event.type, payload: event.data };
        if (event.type === 'turn/start') {
            await this.store.recordWorkerEvent(sessionId, event.seq, { kind: 'start', summary: `DSH Worker 开始第 ${event.data.turn} 轮`, data }, { state: 'running' });
        }
        else if (event.type === 'tool/call' || event.type === 'tool/result') {
            await this.store.recordWorkerEvent(sessionId, event.seq, { kind: 'tool', summary: event.type === 'tool/call' ? event.data.name : '工具执行结果', data });
        }
        else if (event.type === 'assistant/message') {
            const detail = event.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
            if (detail)
                await this.store.recordWorkerEvent(sessionId, event.seq, { kind: 'result', summary: detail.split('\n', 1)[0], data: { sessionId, seq: event.seq, event: event.type, turn: event.data.turn, step: event.data.step, activityKind: 'text', detail } });
        }
        else if (event.type === 'turn/end') {
            const reason = event.data.reason.kind;
            const state = reason === 'completed' ? 'done' : reason === 'max-tokens' ? 'exhausted' : reason === 'aborted' || reason === 'interrupted' || reason === 'forked' ? 'paused' : 'blocked';
            const intent = this.store.snapshot().intents.find(row => row.execution?.childSessionId === sessionId);
            const modelFailure = reason === 'error' && this.modelFailures.get(sessionId) === event.data.turn;
            this.modelFailures.delete(sessionId);
            const rule = this.platform.intentRetry?.() ?? { attempts: 0, interval_ms: 0 };
            const attempt = (this.retryCounts.get(sessionId) ?? 0) + 1;
            const limit = rule.attempts === 0 ? 2 : Math.max(0, rule.attempts);
            const retry = modelFailure && intent && event.seq > (intent.execution.lastEventSeq ?? -1) && attempt <= limit && this.canRetry(intent);
            const events = allEvents.filter((item) => 'turn' in item.data && item.data.turn === event.data.turn);
            const output = { content: finalAssistantOutput(events) ?? [], reason: event.data.reason, turn: event.data.turn };
            const detail = output.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
            await this.store.recordWorkerEvent(sessionId, event.seq, { kind: state === 'blocked' ? 'error' : 'result', summary: retry ? `DSH Worker 模型失败，等待意图重试 ${attempt}/${limit}` : `DSH Worker 结束：${reason}`, data: { ...data, activityKind: 'result', detail, ...(retry ? { intentRetry: { attempt, limit, intervalMs: rule.interval_ms || 3000 } } : {}) } }, { state: retry ? 'running' : state, output });
            if (retry) {
                this.retryCounts.set(sessionId, attempt);
                this.scheduleRetry(intent, event.seq, rule.interval_ms || 3000, attempt);
            }
            else if (reason === 'completed')
                this.retryCounts.delete(sessionId);
        }
    }
    canRetry(intent) {
        const id = intent.execution.childSessionId, parent = this.children.get(id);
        const task = this.store.snapshot().tasks.find(row => row.id === intent.taskId);
        const executionSignal = this.executionSignals.get(id);
        return !this.lifetime.signal.aborted && !!executionSignal && !executionSignal.aborted && !this.timeoutTasks.has(intent.taskId)
            && task?.status === 'running' && !task.queued && (!task.deadlineAt || Date.parse(task.deadlineAt) > Date.now())
            && !!parent && this.ctx.agents.get(parent.id) === parent && intent.execution.parentSessionId === parent.id
            && ['running', 'claimed'].includes(intent.state);
    }
    scheduleRetry(intent, failedSeq, milliseconds, attempt) {
        const id = intent.execution.childSessionId, parent = this.children.get(id);
        const controller = new AbortController();
        const signal = AbortSignal.any([controller.signal, this.lifetime.signal, this.executionSignals.get(id)]);
        const job = { controller, promise: Promise.resolve() };
        const stillOwned = () => {
            const current = this.store.snapshot().intents.find(row => row.id === intent.id);
            return current?.execution?.childSessionId === id && current.execution.lastEventSeq === failedSeq && current.state === 'running' ? current : undefined;
        };
        job.promise = (async () => {
            let submitted = false;
            try {
                await delay(milliseconds, undefined, { signal });
                signal.throwIfAborted();
                const current = stillOwned();
                if (!current || !this.canRetry(current))
                    return;
                // Keep the same durable child, but give the retry a fresh role assembly
                // and budget. Its transcript prevents re-running completed tool history.
                await this.ctx.subagents.drainChildren(parent, [SessionId(id)]);
                signal.throwIfAborted();
                if (!stillOwned() || !this.canRetry(current))
                    return;
                const retryContent = [{ type: 'text', text: '上轮因模型服务故障中断。继续同一意图；先核对会话里已有结果和已完成的工具操作，不要重复已有副作用。' }];
                const messageId = current.execution?.teamName && this.agentTeams
                    ? (await this.agentTeams.sendMessage(parent, { target: current.execution.teamName, content: retryContent, signal })).messageId
                    : await this.ctx.subagents.sendMessage(parent, SessionId(id), retryContent, { signal });
                submitted = true;
                await this.store.setWorkerMessage(intent.id, messageId);
                await this.store.addTrace({ taskId: intent.taskId, intentId: intent.id, worker: id, kind: 'start', summary: `模型故障后重试原意图 ${attempt}`, data: { intentRetry: { attempt }, messageId } });
            }
            catch (error) {
                if (!signal.aborted)
                    await this.store.addTrace({ taskId: intent.taskId, intentId: intent.id, worker: id, kind: 'error', summary: `意图重试未启动：${error instanceof Error ? error.message : String(error)}` });
            }
            finally {
                if (!submitted)
                    await this.store.transaction(state => {
                        const current = state.intents.find(row => row.id === intent.id);
                        if (current?.execution?.childSessionId !== id || current.execution.lastEventSeq !== failedSeq || current.state !== 'running')
                            return;
                        const task = state.tasks.find(row => row.id === intent.taskId);
                        current.state = task?.status === 'paused' || signal.aborted && !this.timeoutTasks.has(intent.taskId) ? 'paused' : 'blocked';
                        current.updatedAt = new Date().toISOString();
                    });
                if (this.retryJobs.get(id) === job)
                    this.retryJobs.delete(id);
            }
        })();
        this.retryJobs.set(id, job);
        this.pendingResults.add(job.promise);
        void job.promise.then(() => this.pendingResults.delete(job.promise), error => { this.pendingResults.delete(job.promise); this.resultErrors.push(error); });
    }
    async cancelRetry(id) {
        const job = this.retryJobs.get(id);
        if (job) {
            job.controller.abort(new Error('Worker retry superseded by task control'));
            await job.promise;
        }
    }
    async recover(intent, parent, signal) {
        const cancellation = AbortSignal.any([signal, this.lifetime.signal]);
        cancellation.throwIfAborted();
        const current = this.authorize(intent.id, parent);
        if (current.execution.childSessionId !== intent.execution?.childSessionId)
            throw new Error(`worker binding changed during recovery: ${intent.id}`);
        const childId = SessionId(current.execution.childSessionId);
        if (this.ctx.agents.get(parent.id) !== parent)
            throw new Error('worker recovery requires the exact live parent');
        const catalog = await this.ctx.subagents.listChildren(parent.id, cancellation);
        if (!catalog.some(child => child.id === childId && child.mode === 'continuable'))
            throw new Error(`worker is not a durable continuable child of this parent: ${childId}`);
        const resident = this.ctx.agents.get(childId);
        if (resident && !this.ctx.agents.isOwnedBy(childId, parent))
            throw new Error(`worker is live under a different parent: ${childId}`);
        const previousParent = this.children.get(childId);
        this.children.set(childId, parent);
        try {
            await this.serialEvents(childId, async () => {
                const observation = await this.ctx.sessionQuery.observeSession(childId, { signal: cancellation, projectionMode: 'all' });
                try {
                    if (observation.header.parentSession !== parent.id)
                        throw new Error(`worker session lineage mismatch: ${childId}`);
                    const inbox = observation.projections?.values.inbox;
                    if (!inbox)
                        throw new Error('worker recovery requires the DSH inbox projection');
                    let events = observation.events;
                    if (observation.source === 'prepared') {
                        // Query's cold view includes synthetic interruptedTurnClosers. They
                        // are not durable facts and must never advance our event watermark.
                        const reader = await this.ctx.sessionPersistence.open(childId, 'read', { signal: cancellation });
                        try {
                            events = (await reader.read(0, undefined, { signal: cancellation })).events;
                        }
                        finally {
                            await reader.close();
                        }
                        if (events.some((event, index) => !isDeepStrictEqual(event, observation.events[index])))
                            throw new Error(`worker session changed during recovery: ${childId}`);
                    }
                    const ownEvents = events.slice(observation.inheritedEventCount);
                    const descriptor = foldSubagentDescriptor(ownEvents);
                    if (!descriptor || descriptor.mode !== 'continuable' || descriptor.provider !== current.execution.provider)
                        throw new Error(`worker descriptor mismatch: ${childId}`);
                    const watermark = this.getIntent(intent.id).execution.lastEventSeq ?? -1;
                    if (watermark >= events.length)
                        throw new Error(`worker event watermark exceeds its session log: ${childId}`);
                    for (const event of ownEvents) {
                        cancellation.throwIfAborted();
                        if (event.seq > watermark)
                            await this.applyEvent(childId, ownEvents, event);
                    }
                    const pendingMessageIds = [...inbox['next-turn'], ...inbox['next-step']].map(message => {
                        if (!message || typeof message !== 'object' || Array.isArray(message) || typeof message.id !== 'string')
                            throw new Error(`invalid DSH pending message: ${childId}`);
                        return message.id;
                    });
                    const live = this.ctx.agents.get(childId);
                    if (live && !this.ctx.agents.isOwnedBy(childId, parent))
                        throw new Error(`worker ownership changed during recovery: ${childId}`);
                    let openTurn = false;
                    let closedTurn = false;
                    for (const event of ownEvents) {
                        if (event.type === 'turn/start')
                            openTurn = true;
                        else if (event.type === 'turn/end') {
                            openTurn = false;
                            closedTurn = true;
                        }
                    }
                    const reason = live?.status === 'running' ? 'live-running'
                        : pendingMessageIds.length ? 'pending-inbox-needs-steer'
                            : openTurn ? 'interrupted-turn-needs-steer'
                                : closedTurn ? 'settled-log' : 'no-consumed-work-needs-steer';
                    const recovery = { reason, source: observation.source, observedThrough: events.length - 1, pendingMessageIds };
                    await this.store.transaction(state => {
                        cancellation.throwIfAborted();
                        const row = state.intents.find(item => item.id === intent.id);
                        if (!row || row.execution?.childSessionId !== childId)
                            throw new Error(`worker binding changed during recovery: ${intent.id}`);
                        const recoveredState = reason === 'live-running' ? 'running' : reason === 'settled-log' ? row.state : 'paused';
                        if (row.state === recoveredState && JSON.stringify(row.output?.recovery) === JSON.stringify(recovery))
                            return;
                        row.state = recoveredState;
                        row.output = { ...row.output, recovery };
                        row.updatedAt = new Date().toISOString();
                        state.traces.push({ id: randomUUID(), taskId: row.taskId, intentId: row.id, worker: childId, kind: 'result',
                            summary: reason.endsWith('needs-steer') ? 'DSH Worker 日志已恢复；原消息保留，需 steering 唤醒继续执行' : 'DSH Worker 已从原会话恢复状态',
                            data: recovery, createdAt: row.updatedAt });
                    });
                }
                finally {
                    observation[Symbol.dispose]();
                }
            });
        }
        catch (error) {
            if (previousParent)
                this.children.set(childId, previousParent);
            else
                this.children.delete(childId);
            throw error;
        }
    }
    async dispose() {
        this.lifetime.abort(new Error('Worker runtime disposed'));
        await Promise.allSettled([...this.pendingStarts]);
        const parents = new Set(this.children.values());
        const results = await Promise.allSettled([...parents].map((parent) => this.ctx.subagents.drainChildren(parent, [...this.children].filter(([, owner]) => owner === parent).map(([id]) => SessionId(id)))));
        await Promise.allSettled([...this.pendingResults]);
        await Promise.allSettled([...this.eventQueues.values()]);
        this.removePlatformListener?.();
        const platformResults = await Promise.allSettled([...this.platformRuns.values()].map(run => run.dispose()));
        this.platformRuns.clear();
        const errors = results.filter((result) => result.status === 'rejected');
        const platformErrors = platformResults.filter((result) => result.status === 'rejected');
        if (errors.length || platformErrors.length || this.resultErrors.length)
            throw new AggregateError([...errors.map((result) => result.reason), ...platformErrors.map(result => result.reason), ...this.resultErrors], 'Worker teardown failed');
        this.children.clear();
        this.executionSignals.clear();
        this.modelFailures.clear();
        this.retryCounts.clear();
        this.retryJobs.clear();
    }
    async quiesceTask(taskId, state = 'paused') {
        this.timeoutTasks.delete(taskId);
        for (const intent of this.store.snapshot().intents.filter((item) => item.taskId === taskId && item.execution)) {
            const parent = this.children.get(intent.execution.childSessionId);
            if (parent) {
                if (['running', 'claimed'].includes(intent.state))
                    await this.stop(intent.id, parent, state);
                else
                    await this.ctx.subagents.drainChildren(parent, [SessionId(intent.execution.childSessionId)]);
            }
        }
        const active = this.store.snapshot().intents.find((item) => item.taskId === taskId && ['running', 'claimed'].includes(item.state));
        if (active)
            throw new Error(`task has a worker owned by another runtime: ${active.id}`);
    }
    getIntent(intentId) {
        const intent = this.store.snapshot().intents.find((item) => item.id === intentId);
        if (!intent)
            throw new Error(`intent not found: ${intentId}`);
        return intent;
    }
    authorize(intentId, parent) {
        const intent = this.getIntent(intentId);
        if (!intent.execution)
            throw new Error(`intent has no DSH worker: ${intentId}`);
        if (intent.execution.parentSessionId !== parent.id)
            throw new Error(`worker belongs to a different parent session: ${intentId}`);
        return intent;
    }
}
