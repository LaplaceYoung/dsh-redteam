import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { requireManagedTask } from '../task-management/index.js';
import { ColdGraph, blockSignature } from './coldgraph.js';
import { digestIsCurrent, graphKind, graphState, nodeFingerprint, supersedeDigests } from './digest-state.js';
const runs = new Map();
const R = 6, K = 2, N = 20, M = 8, COOLDOWN = 60_000, TIMEOUT = 300_000;
function taskState(state, id) { return requireManagedTask(state, id); }
function nodesOf(state, id) { return state.nodes.filter(node => node.taskId === id); }
function graphOf(state, id) {
    return new ColdGraph(nodesOf(state, id).map(node => ({ id: node.id, kind: graphKind(node), state: graphState(node) === 'claimed' ? 'running' : graphState(node) })), state.edges.filter(edge => edge.taskId === id));
}
function versionsOf(state, id) { return new Map(nodesOf(state, id).map(node => [node.id, typeof node.data.content_version === 'number' ? node.data.content_version : 0])); }
function activeDigests(state, id) { return nodesOf(state, id).filter(node => graphKind(node) === 'digest' && graphState(node) === 'active'); }
function coveredMembers(state, id) {
    const active = new Set(activeDigests(state, id).map(node => node.id));
    return new Set(state.edges.filter(edge => edge.taskId === id && edge.relation === 'covers' && active.has(edge.from)).map(edge => edge.to));
}
function eligible(state, id) {
    const graph = graphOf(state, id), round = taskState(state, id).graphCompaction?.round ?? 0;
    const stamps = new Map(nodesOf(state, id).map(node => [node.id, typeof node.data.cold_since_round === 'number' ? node.data.cold_since_round : undefined]));
    return graph.eligibleCold(graph.structuralCold(), stamps, round, R);
}
function refreshVersions(state, id) {
    for (const node of nodesOf(state, id)) {
        if (graphKind(node) === 'digest')
            continue;
        const hash = nodeFingerprint(node);
        if (node.data.content_hash !== hash) {
            node.data.content_version = (typeof node.data.content_version === 'number' ? node.data.content_version : 0) + (node.data.content_hash === undefined ? 0 : 1);
            node.data.content_hash = hash;
        }
    }
    const invalid = activeDigests(state, id).filter(node => !digestIsCurrent(state, node));
    for (const node of invalid)
        node.data.invalidated_by = 'content_change';
    supersedeDigests(state, new Set(invalid.map(node => node.id)));
}
function inputFor(state, taskId, block) {
    const byId = new Map(nodesOf(state, taskId).map(node => [node.id, node]));
    const members = new Set(block.members);
    return { taskId,
        members: block.members.map(id => { const node = byId.get(id); return { id, kind: graphKind(node), state: graphState(node), summary: node.label, ...(typeof node.data.confidence === 'string' ? { confidence: node.data.confidence } : {}) }; }),
        edges: state.edges.filter(edge => edge.taskId === taskId && edge.relation !== 'covers' && members.has(edge.from) && members.has(edge.to)).map(({ from, to, relation }) => ({ from, to, relation })),
        anchors: block.anchors.map(id => { const node = byId.get(id); return { id, state: graphState(node), summary: node.label }; }),
    };
}
function generation(node) { return typeof node.data.generation === 'number' ? node.data.generation : 1; }
function digestMembers(state, node) {
    const cached = node.data.member_ids;
    const ids = cached && typeof cached === 'object' && !Array.isArray(cached)
        ? Object.values(cached).flatMap(value => Array.isArray(value) ? value.filter((id) => typeof id === 'string') : []) : [];
    return [...ids, ...state.edges.filter(edge => edge.from === node.id && edge.relation === 'covers').map(edge => edge.to)];
}
/** ARTEX's per-planner-round cold-graph maintenance and one background compactor per task. */
export class GraphCompactor {
    store;
    options;
    disposed = false;
    prefix;
    now;
    constructor(store, options) {
        this.store = store;
        this.options = options;
        const path = resolve(store.storagePath);
        this.prefix = (process.platform === 'win32' ? path.toLowerCase() : path) + '\0';
        this.now = options.now ?? Date.now;
    }
    assertActive(state, taskId) {
        taskState(state, taskId);
        if (this.options.isTaskActive && !this.options.isTaskActive(state, taskId))
            throw new Error('graph compaction task is no longer active');
    }
    /** Await maintenance before capturing the Planner context. Model generation stays in the background. */
    async onPlannerRound(taskId, taskSignal) {
        if (this.disposed)
            throw new Error('graph compactor is disposed');
        taskSignal?.throwIfAborted();
        const result = await this.store.transaction(state => {
            taskSignal?.throwIfAborted();
            this.assertActive(state, taskId);
            const task = taskState(state, taskId);
            const round = (task.graphCompaction?.round ?? 0) + 1;
            // Retirement must not erase a pending major trigger during its cooldown.
            const majorPending = task.graphCompaction?.majorPending === true || activeDigests(state, taskId).length >= M;
            task.graphCompaction = { round, ...(majorPending ? { majorPending: true } : {}) };
            refreshVersions(state, taskId);
            const graph = graphOf(state, taskId), nodes = nodesOf(state, taskId), byId = new Map(nodes.map(node => [node.id, node]));
            const stamps = new Map(nodes.map(node => [node.id, typeof node.data.cold_since_round === 'number' ? node.data.cold_since_round : undefined]));
            for (const op of graph.computeStampOps(graph.structuralCold(), stamps, round)) {
                if (op.set)
                    byId.get(op.id).data.cold_since_round = op.round;
                else
                    delete byId.get(op.id).data.cold_since_round;
            }
            const covered = coveredMembers(state, taskId);
            return { round, eligibleUncovered: [...eligible(state, taskId)].filter(id => !covered.has(id)).length, activeDigests: activeDigests(state, taskId).length, majorPending, started: false };
        });
        if (this.disposed || taskSignal?.aborted || result.eligibleUncovered < N && result.activeDigests < M && !result.majorPending)
            return result;
        const key = this.prefix + taskId, previous = runs.get(key);
        if (previous?.running || previous?.finishedAt !== undefined && this.now() - previous.finishedAt < COOLDOWN)
            return result;
        const controller = new AbortController();
        const abortTask = () => { run.cancelled = true; controller.abort(taskSignal?.reason); };
        taskSignal?.addEventListener('abort', abortTask, { once: true });
        const run = { owner: this, controller, promise: Promise.resolve(), running: true };
        runs.set(key, run);
        const timer = setTimeout(() => controller.abort(new Error('graph compaction timed out after 5 minutes')), TIMEOUT);
        timer.unref();
        run.promise = this.compact(taskId, result.majorPending || result.activeDigests >= M, controller.signal).catch(async (error) => {
            // Archive/dispose cancellation must not recreate records for a removed task.
            const reportable = (state) => !run.cancelled && !this.disposed && state.tasks.some(task => task.id === taskId) && (!this.options.isTaskActive || this.options.isTaskActive(state, taskId));
            if (reportable(this.store.snapshot())) {
                await this.store.transaction(state => {
                    if (!reportable(state))
                        throw new Error('compactor error recording cancelled because task stopped');
                    state.traces.push({ id: randomUUID(), taskId, worker: 'compactor', kind: 'error', summary: '冷图摘要生成失败', data: { error: error instanceof Error ? error.message : String(error) }, createdAt: new Date().toISOString() });
                });
                this.options.onError?.(taskId, error);
            }
            throw error;
        }).finally(() => { clearTimeout(timer); taskSignal?.removeEventListener('abort', abortTask); run.running = false; run.finishedAt = this.now(); });
        // The explicit wait API still receives the rejection; detached work cannot cause an unhandled rejection.
        void run.promise.catch(() => { });
        return { ...result, started: true };
    }
    async waitForIdle(taskId) { await runs.get(this.prefix + taskId)?.promise; }
    /** Pause/park/archive must abort immediately, then wait until queued commits have drained. */
    async cancelTask(taskId) {
        const run = runs.get(this.prefix + taskId);
        if (!run?.running)
            return;
        run.cancelled = true;
        run.controller.abort(new Error('graph compaction task stopped'));
        await Promise.allSettled([run.promise]);
    }
    async dispose() {
        this.disposed = true;
        const owned = [...runs.entries()].filter(([, run]) => run.owner === this);
        for (const [, run] of owned)
            if (run.running) {
                run.cancelled = true;
                run.controller.abort(new Error('graph compactor disposed'));
            }
        await Promise.allSettled(owned.map(([, run]) => run.promise));
        for (const [key, run] of owned)
            if (runs.get(key) === run)
                runs.delete(key);
    }
    async compact(taskId, major, signal) {
        signal.throwIfAborted();
        const snapshot = this.store.snapshot();
        this.assertActive(snapshot, taskId);
        const graph = graphOf(snapshot, taskId), cold = eligible(snapshot, taskId), covered = coveredMembers(snapshot, taskId);
        const blocks = graph.groupBlocks(major ? cold : new Set([...cold].filter(id => !covered.has(id))), K);
        const versions = versionsOf(snapshot, taskId), active = activeDigests(snapshot, taskId);
        const ancestors = nodesOf(snapshot, taskId).filter(node => graphKind(node) === 'digest' && (node.data.invalidated_by === 'content_change' || major && graphState(node) === 'active'));
        const signatures = new Set(blocks.map(block => blockSignature(block, versions)));
        if (major)
            await this.store.transaction(state => {
                signal.throwIfAborted();
                this.assertActive(state, taskId);
                const task = taskState(state, taskId);
                if (task.graphCompaction)
                    delete task.graphCompaction.majorPending;
                supersedeDigests(state, new Set(active.filter(node => !signatures.has(String(node.data.signature))).map(node => node.id)));
            });
        const failures = [];
        for (const block of blocks) {
            signal.throwIfAborted();
            if (major && active.some(node => node.data.signature === blockSignature(block, versions) && digestIsCurrent(snapshot, node)))
                continue;
            const overlap = ancestors.filter(node => digestMembers(snapshot, node).some(id => block.members.includes(id)));
            const nextGeneration = Math.max(0, ...overlap.map(generation)) + 1;
            try {
                await this.fold(taskId, snapshot, block, nextGeneration, signal);
            }
            catch (error) {
                signal.throwIfAborted();
                failures.push(error);
            }
        }
        if (!major && activeDigests(this.store.snapshot(), taskId).length >= M) {
            try {
                await this.compact(taskId, true, signal);
            }
            catch (error) {
                signal.throwIfAborted();
                failures.push(error);
            }
        }
        if (failures.length === 1)
            throw failures[0];
        if (failures.length)
            throw new AggregateError(failures, `digest blocks failed: ${failures.map(error => error instanceof Error ? error.message : String(error)).join('; ')}`);
    }
    async fold(taskId, snapshot, block, nextGeneration, signal) {
        // Abort remains effective even when an injected provider does not cooperate.
        let rejectAbort;
        const aborted = new Promise((_, reject) => { rejectAbort = reject; });
        const onAbort = () => rejectAbort(signal.reason);
        signal.addEventListener('abort', onAbort, { once: true });
        let body;
        try {
            signal.throwIfAborted();
            body = (await Promise.race([this.options.provider.generate(inputFor(snapshot, taskId, block), signal), aborted])).trim();
        }
        finally {
            signal.removeEventListener('abort', onAbort);
        }
        if (!body)
            throw new Error('digest LLM returned empty body');
        signal.throwIfAborted();
        await this.store.transaction(state => {
            signal.throwIfAborted();
            this.assertActive(state, taskId);
            refreshVersions(state, taskId);
            const finalBlock = graphOf(state, taskId).filterAtCommit(block, K);
            if (!finalBlock)
                return;
            const originals = new Map(nodesOf(snapshot, taskId).map(node => [node.id, node]));
            const current = new Map(nodesOf(state, taskId).map(node => [node.id, node]));
            // An answer made from edited evidence is stale, even if the remaining nodes are still cold.
            if ([...block.members, ...block.anchors].some(id => !current.has(id) || nodeFingerprint(current.get(id)) !== nodeFingerprint(originals.get(id))))
                return;
            const covered = coveredMembers(state, taskId);
            if (finalBlock.members.some(id => covered.has(id)))
                return;
            const fingerprints = Object.fromEntries([...finalBlock.members, ...finalBlock.anchors].map(id => [id, nodeFingerprint(current.get(id))]));
            const id = randomUUID();
            state.nodes.push({ id, taskId, kind: 'fact', label: body, data: { kind: 'digest', state: 'active', origin: 'compactor', priority: 0, body,
                    member_ids: { facts: finalBlock.members.filter(id => graphKind(current.get(id)) === 'fact'), intents: finalBlock.members.filter(id => graphKind(current.get(id)) === 'intent') },
                    anchor_ids: finalBlock.anchors, generation: nextGeneration, signature: blockSignature(finalBlock, versionsOf(state, taskId)), source_fingerprints: fingerprints } });
            state.edges.push(...finalBlock.members.map(to => ({ id: randomUUID(), taskId, from: id, to, relation: 'covers' })));
        });
    }
}
