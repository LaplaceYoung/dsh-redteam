import { randomUUID } from 'node:crypto';
import { findingStatuses, FindingsError } from './types.js';
import { assertRole, normalizeTrafficRefs, prepareTrafficBinding, readEvidenceBody } from './evidence.js';
export function requireFinding(state, id) {
    const row = state.findings.find(f => f.id === id);
    if (!row)
        throw new FindingsError('not_found', `finding not found: ${id}`);
    return row;
}
export function assertFindingWritable(state, finding) {
    const archive = state.archives.find(row => row.taskId === finding.taskId && !['failed', 'archive_failed'].includes(row.state));
    if (archive)
        throw new FindingsError('conflict', `finding task archive is ${archive.state}`);
}
/** Call inside host addFinding transaction, before insert/notification, to close deletion races. */
export function validateFindingInput(state, input) {
    if (!state.tasks.some(t => t.id === input.taskId))
        throw new FindingsError('not_found', `task not found: ${input.taskId}`);
    assertFindingWritable(state, input);
    validateFindingPatch(input);
    if (!input.summary.trim())
        throw new FindingsError('invalid', 'summary is required');
    if (input.intentId && !state.intents.some(i => i.id === input.intentId && i.taskId === input.taskId))
        throw new FindingsError('invalid', 'intent must belong to the finding task');
    // ARTEX assets are global; RecordFindingTx anchors existing asset IDs without copying them.
    for (const id of input.assetIds)
        if (!state.assets.some(a => a.id === id))
            throw new FindingsError('invalid', `asset not found: ${id}`);
    for (const id of input.evidenceIds)
        if (!state.evidence.some(e => e.id === id && e.taskId === input.taskId))
            throw new FindingsError('invalid', `evidence does not belong to task: ${id}`);
}
export function validateFindingPatch(patch) {
    if (patch.status !== undefined && ![...findingStatuses, 'open', 'verified', 'accepted', 'closed'].includes(patch.status))
        throw new FindingsError('invalid', 'invalid finding status');
    if (patch.severity !== undefined && !['critical', 'high', 'medium', 'low', 'info'].includes(patch.severity))
        throw new FindingsError('invalid', 'invalid severity');
    for (const key of ['name', 'summary', 'vulnClass'])
        if (patch[key] !== undefined && typeof patch[key] !== 'string')
            throw new FindingsError('invalid', `${key} must be text`);
    for (const key of ['assetIds', 'evidenceIds'])
        if (patch[key] !== undefined && (!Array.isArray(patch[key]) || patch[key].some(id => typeof id !== 'string')))
            throw new FindingsError('invalid', `${key} must be string[]`);
}
/** Updates may target retained findings after source task/assets were removed. */
export function validateFindingUpdate(state, finding, patch) {
    assertFindingWritable(state, finding);
    validateFindingPatch(patch);
    if (patch.assetIds)
        for (const id of patch.assetIds)
            if (!state.assets.some(a => a.id === id))
                throw new FindingsError('invalid', `asset not found: ${id}`);
    if (patch.evidenceIds)
        for (const id of patch.evidenceIds)
            if (!state.evidence.some(e => e.id === id && e.taskId === finding.taskId))
                throw new FindingsError('invalid', `evidence does not belong to task: ${id}`);
}
function version(finding, expected) {
    if (!Number.isSafeInteger(expected) || expected < 0)
        throw new FindingsError('invalid', 'evidence version must be a nonnegative integer');
    if ((finding.evidenceVersion ?? 0) !== expected)
        throw new FindingsError('conflict', 'traffic evidence changed; reload before updating');
}
export class FindingsRuntime {
    store;
    reportProvider;
    constructor(store, reportProvider) {
        this.store = store;
        this.reportProvider = reportProvider;
    }
    get(id, access = {}) {
        const state = this.store.snapshot(), row = requireFinding(state, id);
        this.access(state, row, access, false);
        return row;
    }
    access(state, row, access, write) {
        if (access.findingId && row.id !== access.findingId)
            throw new FindingsError('forbidden', 'finding is outside the current retest');
        if (write && access.readonly)
            throw new FindingsError('forbidden', 'current session has read-only finding access');
        if (!access.taskId || row.taskId === access.taskId)
            return;
        const task = state.tasks.find(t => t.id === access.taskId);
        if (!write && task?.sourceTaskIds?.includes(row.taskId))
            return;
        throw new FindingsError('forbidden', write ? 'inherited or foreign findings are read-only' : 'finding is outside current task');
    }
    async record(input, refs = [], evidenceHintId) {
        const state = this.store.snapshot();
        validateFindingInput(state, input);
        if (evidenceHintId) {
            const hint = state.nodes.find(n => n.id === evidenceHintId && n.taskId === input.taskId && n.kind === 'fact' && (n.data.hint === true || n.data.kind === 'strategic_hint'));
            if (!hint)
                throw new FindingsError('invalid', 'evidence hint must belong to this task; inherited hints are read-only');
            const stored = hint.data.traffic_refs;
            if (stored !== undefined) {
                if (!Array.isArray(stored))
                    throw new FindingsError('invalid', 'hint traffic_refs must be an array');
                refs = [...refs, ...stored.map((value) => {
                        if (!value || typeof value !== 'object')
                            throw new FindingsError('invalid', 'invalid hint traffic reference');
                        const ref = value, id = ref.traffic_id ?? ref.trafficId;
                        if (typeof id !== 'string' || (ref.note !== undefined && typeof ref.note !== 'string'))
                            throw new FindingsError('invalid', 'invalid hint traffic reference');
                        if (ref.role !== undefined) {
                            if (typeof ref.role !== 'string')
                                throw new FindingsError('invalid', 'invalid hint traffic role');
                            assertRole(ref.role);
                        }
                        return { trafficId: id, role: ref.role, note: ref.note };
                    })];
            }
        }
        const bindings = await this.prepare(input.taskId, refs);
        return this.store.addFinding({ ...input, trafficBindings: bindings.map((b, i) => ({ ...b, position: i })), evidenceVersion: bindings.length ? 1 : 0, reportEvidenceVersion: 0 });
    }
    async update(id, patch, access = {}) {
        const state = this.store.snapshot(), row = requireFinding(state, id);
        this.access(state, row, access, true);
        assertFindingWritable(state, row);
        validateFindingPatch(patch);
        return this.store.updateFinding(id, patch);
    }
    async delete(id, access = {}) {
        return this.store.transaction(state => {
            const row = requireFinding(state, id);
            this.access(state, row, access, true);
            assertFindingWritable(state, row);
            state.findings = state.findings.filter(f => f.id !== id);
            const nodeId = row.nodeId ?? row.id;
            state.nodes = state.nodes.filter(n => n.id !== nodeId && n.id !== row.id);
            state.edges = state.edges.filter(e => e.from !== nodeId && e.to !== nodeId && e.from !== row.id && e.to !== row.id);
            return { deleted: id };
        });
    }
    async prepare(taskId, refs) {
        const state = this.store.snapshot();
        return Promise.all(normalizeTrafficRefs(refs).map(ref => {
            const row = state.traffic.find(t => t.id === ref.trafficId);
            if (!row)
                throw new FindingsError('not_found', `traffic not found: ${ref.trafficId}`);
            if (row.taskId && row.taskId !== taskId)
                throw new FindingsError('forbidden', 'traffic belongs to another task');
            return prepareTrafficBinding(row, ref, this.store.storagePath);
        }));
    }
    async bindTraffic(id, refs, access = {}) {
        if (!refs.length)
            throw new FindingsError('invalid', 'at least one traffic reference is required');
        const row = this.get(id, access);
        const prepared = await this.prepare(row.taskId, refs);
        return this.store.transaction(state => {
            const finding = requireFinding(state, id);
            this.access(state, finding, access, true);
            assertFindingWritable(state, finding);
            const bindings = finding.trafficBindings ??= [], seen = new Set(bindings.map(b => b.snapshot.id));
            let changed = false;
            for (const binding of prepared)
                if (!seen.has(binding.snapshot.id)) {
                    bindings.push({ ...binding, position: bindings.length });
                    seen.add(binding.snapshot.id);
                    changed = true;
                }
            if (changed)
                finding.evidenceVersion = (finding.evidenceVersion ?? 0) + 1;
            return this.trafficView(finding);
        });
    }
    traffic(id, access = {}) { return this.trafficView(this.get(id, access)); }
    trafficView(row) { return { findingId: row.id, version: row.evidenceVersion ?? 0, reportVersion: row.reportEvidenceVersion ?? 0, bindings: row.trafficBindings ?? [] }; }
    async editTraffic(id, expected, edit, access = {}) {
        return this.store.transaction(state => {
            const row = requireFinding(state, id);
            this.access(state, row, access, true);
            assertFindingWritable(state, row);
            version(row, expected);
            const bindings = row.trafficBindings ??= [];
            if ('order' in edit) {
                if (edit.order.length !== bindings.length || new Set(edit.order).size !== bindings.length || edit.order.some(id => !bindings.some(b => b.id === id)))
                    throw new FindingsError('conflict', 'order must contain every binding exactly once');
                row.trafficBindings = edit.order.map((id, position) => ({ ...bindings.find(b => b.id === id), position }));
            }
            else {
                const index = bindings.findIndex(b => b.id === edit.bindingId);
                if (index < 0)
                    throw new FindingsError('not_found', 'traffic binding not found');
                if (edit.remove)
                    bindings.splice(index, 1);
                else {
                    if (edit.role !== undefined) {
                        assertRole(edit.role);
                        bindings[index].role = edit.role;
                    }
                    if (edit.note !== undefined) {
                        if (typeof edit.note !== 'string')
                            throw new FindingsError('invalid', 'note must be text');
                        bindings[index].note = edit.note;
                    }
                }
            }
            row.evidenceVersion = expected + 1;
            return this.trafficView(row);
        });
    }
    body(id, bindingId, side, offset, limit, access = {}) {
        const binding = this.get(id, access).trafficBindings?.find(b => b.id === bindingId);
        if (!binding)
            throw new FindingsError('not_found', 'traffic binding not found');
        return readEvidenceBody(binding, side, offset, limit);
    }
    async updateReport(id, markdown, expected, access = {}) {
        if (!markdown.trim())
            throw new FindingsError('invalid', 'report must not be empty');
        return this.store.transaction(state => { const row = requireFinding(state, id); this.access(state, row, access, true); assertFindingWritable(state, row); version(row, expected); row.report = markdown; row.reportEvidenceVersion = expected; return row; });
    }
    async generateReport(id, signal, access = {}, provider = this.reportProvider) {
        if (!provider)
            throw new FindingsError('unavailable', 'report generation requires a configured DSH LLM provider');
        const row = this.get(id, access), state = this.store.snapshot();
        this.access(state, row, access, true);
        signal?.throwIfAborted();
        const markdown = await provider.generate({ finding: row, evidence: state.evidence.filter(e => row.evidenceIds.includes(e.id)), traces: state.traces.filter(t => t.taskId === row.taskId && (!row.intentId || t.intentId === row.intentId)), constraints: state.constraints.filter(c => c.taskId === row.taskId) }, signal);
        signal?.throwIfAborted();
        return this.updateReport(id, markdown, row.evidenceVersion ?? 0, access);
    }
    async deepen(id, description, access = {}) {
        if (!description.trim() || Array.from(description).length > 4000)
            throw new FindingsError('invalid', 'description must contain 1..4000 characters');
        return this.store.transaction(state => {
            const row = requireFinding(state, id);
            this.access(state, row, access, true);
            assertFindingWritable(state, row);
            const nodeId = row.nodeId ?? row.id;
            if (!state.tasks.some(t => t.id === row.taskId) || !state.nodes.some(n => n.id === nodeId && n.kind === 'finding'))
                throw new FindingsError('unavailable', 'finding origin is no longer available');
            const at = new Date().toISOString(), intent = { id: randomUUID(), taskId: row.taskId, summary: description.trim(), state: 'open', input: { sourceFindingId: id, sourceFindingNodeId: nodeId, assetIds: row.assetIds, priority: 10, origin: 'human' }, createdAt: at, updatedAt: at };
            state.intents.push(intent);
            state.edges.push({ id: randomUUID(), taskId: row.taskId, from: nodeId, to: intent.id, relation: 'derived_from' });
            state.traces.push({ id: randomUUID(), taskId: row.taskId, intentId: intent.id, worker: 'human', kind: 'tool', summary: `深入验证漏洞 ${id}`, createdAt: at });
            return intent;
        });
    }
}
