import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { requireFinding, assertFindingWritable } from './runtime.js';
import { FindingsError } from './types.js';
// Match RedTeamStore's identity: sibling scopes construct separate store objects.
const hostsByPath = new Map();
export class FindingRetests {
    store;
    provider;
    running = new Map();
    host;
    constructor(store, provider) {
        this.store = store;
        this.provider = provider;
        const path = resolve(store.storagePath), key = process.platform === 'win32' ? path.toLowerCase() : path;
        this.host = hostsByPath.get(key)?.deref() ?? { running: new Map(), serial: Promise.resolve() };
        hostsByPath.set(key, new WeakRef(this.host));
    }
    serialize(operation) {
        const result = this.host.serial.then(operation);
        this.host.serial = result.then(() => { }, () => { });
        return result;
    }
    history(findingId) { return (requireFinding(this.store.snapshot(), findingId).retests ?? []).map(({ snapshot: _snapshot, ...row }) => row); }
    active() { return this.store.snapshot().findings.flatMap(f => (f.retests ?? []).filter(r => r.status === 'pending' || r.status === 'running').map(({ snapshot: _snapshot, ...row }) => row)); }
    async start(findingId, notes = '', provider = this.provider, signal) {
        signal?.throwIfAborted();
        if (!provider)
            throw new FindingsError('unavailable', 'retest session provider is unavailable');
        if (typeof notes !== 'string' || Array.from(notes).length > 4000)
            throw new FindingsError('invalid', 'notes must contain at most 4000 characters');
        if (!this.store.updateFindingAtomic)
            throw new FindingsError('unavailable', 'host must implement updateFindingAtomic for retest completion and notification');
        const controller = new AbortController();
        const created = await this.serialize(async () => {
            signal?.throwIfAborted();
            const result = await this.store.transaction(state => {
                const finding = requireFinding(state, findingId);
                assertFindingWritable(state, finding);
                const active = finding.retests?.find(r => r.status === 'pending' || r.status === 'running');
                if (active)
                    return { retest: active, created: false };
                const { retests: _history, ...snapshot } = finding;
                const retest = { id: randomUUID(), findingId, status: 'pending', notes: notes.trim(), createdAt: new Date().toISOString(), snapshot: { finding: structuredClone(snapshot), assets: state.assets.filter(a => finding.assetIds.includes(a.id)), constraints: state.constraints.filter(c => c.taskId === finding.taskId) } };
                (finding.retests ??= []).push(retest);
                return { retest, created: true };
            });
            // Recovery cannot inspect the durable pending row until its live owner is registered.
            if (result.created) {
                this.running.set(result.retest.id, controller);
                this.host.running.set(result.retest.id, controller);
            }
            return result;
        });
        if (!created.created)
            return { ...created, completion: undefined };
        const cancel = () => controller.abort(signal?.reason);
        signal?.addEventListener('abort', cancel, { once: true });
        if (signal?.aborted)
            cancel();
        const completion = this.execute(created.retest, controller, provider).finally(() => { this.running.delete(created.retest.id); this.host.running.delete(created.retest.id); signal?.removeEventListener('abort', cancel); });
        return { ...created, completion };
    }
    async execute(retest, controller, provider) {
        try {
            const status = await provider.run({ retest, signal: controller.signal, onSession: async (sessionId) => {
                    if (!sessionId.trim())
                        throw new FindingsError('invalid', 'retest session ID is required');
                    await this.store.transaction(state => {
                        const record = requireFinding(state, retest.findingId).retests.find(r => r.id === retest.id);
                        if (record.status !== 'pending')
                            throw new FindingsError('conflict', 'retest already started');
                        if (state.findings.some(f => f.retests?.some(r => r.sessionId === sessionId)))
                            throw new FindingsError('conflict', 'retest session is already bound');
                        record.sessionId = sessionId;
                        record.status = 'running';
                        record.startedAt = new Date().toISOString();
                    });
                } });
            await this.finish(retest.findingId, retest.id, controller.signal.aborted ? 'cancelled' : status);
        }
        catch (error) {
            await this.finish(retest.findingId, retest.id, controller.signal.aborted ? 'cancelled' : 'failed', error instanceof Error ? error.message : String(error));
        }
    }
    context(sessionId) {
        const state = this.store.snapshot();
        for (const finding of state.findings) {
            const retest = finding.retests?.find(r => r.sessionId === sessionId);
            if (retest)
                return { retest, currentConstraints: state.constraints.filter(c => c.taskId === finding.taskId) };
        }
        throw new FindingsError('forbidden', 'current session is not bound to a retest');
    }
    async recordResult(sessionId, verdict, summary, evidence) {
        if (!['reproduced', 'fixed', 'inconclusive'].includes(verdict) || !summary.trim() || !evidence.trim() || Buffer.byteLength(summary) > 16000 || Buffer.byteLength(evidence) > 128000)
            throw new FindingsError('invalid', 'valid verdict, summary (<=16KB), evidence (<=128KB) are required');
        return this.store.transaction(state => {
            const retest = state.findings.flatMap(f => f.retests ?? []).find(r => r.sessionId === sessionId);
            if (!retest || retest.status !== 'running')
                throw new FindingsError('forbidden', 'current session has no running retest');
            summary = summary.trim();
            evidence = evidence.trim();
            if (retest.verdict && (retest.verdict !== verdict || retest.summary !== summary || retest.evidence !== evidence))
                throw new FindingsError('conflict', 'retest verdict already recorded');
            Object.assign(retest, { verdict, summary, evidence });
            return { saved: true, verdict };
        });
    }
    async finish(findingId, id, status, error) {
        if (!this.store.updateFindingAtomic)
            throw new FindingsError('unavailable', 'host atomic finding updater is unavailable');
        return this.store.updateFindingAtomic(findingId, (_state, finding) => {
            const retest = finding.retests?.find(r => r.id === id);
            if (!retest)
                throw new FindingsError('not_found', 'retest not found');
            if (!['pending', 'running'].includes(retest.status))
                return {};
            retest.status = status === 'done' && !retest.verdict ? 'failed' : status;
            retest.error = status === 'done' && !retest.verdict ? 'Agent did not record a retest result' : error;
            retest.finishedAt = new Date().toISOString();
            return retest.status === 'done' && retest.verdict === 'fixed' ? { status: 'fixed' } : {};
        });
    }
    cancel(id) { const controller = this.host.running.get(id); if (!controller)
        throw new FindingsError('not_found', 'retest is not active in this host'); controller.abort(new Error('retest cancelled')); }
    cancelAll() { for (const controller of this.running.values())
        controller.abort(new Error('retest host disposed')); }
    async recover() {
        return this.serialize(() => this.store.transaction(state => {
            let recovered = 0;
            for (const finding of state.findings)
                for (const retest of finding.retests ?? []) {
                    if ((retest.status === 'pending' || retest.status === 'running') && !this.host.running.has(retest.id)) {
                        retest.status = 'cancelled';
                        retest.error = 'Host restarted; retest interrupted';
                        retest.finishedAt = new Date().toISOString();
                        recovered++;
                    }
                }
            return { recovered };
        }));
    }
}
