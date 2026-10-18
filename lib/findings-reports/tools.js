import { defineTool } from '@deepseek-ai/dsh-tools';
import { FindingsRuntime } from './runtime.js';
import { findingStatuses, FindingsError } from './types.js';
import { filterFindings, listFindingsPage, listFindingGroups, findingStats, buildFindingAssetTree, findingLineage, listFindingVulnClasses } from './query.js';
import { exportFindings, renderTaskReport } from './export.js';
import { FindingRetests } from './retests.js';
const output = { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] };
const json = (value) => JSON.parse(JSON.stringify(value));
export const replacedFindingToolNames = new Set(['redteam_record_finding', 'redteam_update_finding']);
function required(value, name) { if (!value?.trim())
    throw new FindingsError('invalid', `${name} is required`); return value; }
function object(value) {
    if (value === undefined)
        return {};
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        throw new FindingsError('invalid', 'expected JSON object');
    return value;
}
function filter(value) {
    const result = {};
    for (const [key, item] of Object.entries(object(value))) {
        if (!['severity', 'status', 'vulnClass', 'taskId', 'query', 'sort', 'assetScope'].includes(key) || typeof item !== 'string')
            throw new FindingsError('invalid', `invalid filter ${key}`);
        Object.assign(result, { [key]: item });
    }
    return result;
}
function trafficRefs(value) {
    if (value === undefined)
        return [];
    if (!Array.isArray(value))
        throw new FindingsError('invalid', 'traffic_refs must be array');
    return value.map(item => {
        const row = object(item), id = row.traffic_id ?? row.trafficId;
        if (typeof id !== 'string')
            throw new FindingsError('invalid', 'traffic_id is required');
        if (row.traffic_id !== undefined && row.trafficId !== undefined && row.traffic_id !== row.trafficId)
            throw new FindingsError('invalid', 'conflicting traffic identifiers');
        if (row.role !== undefined && row.role !== 'baseline' && row.role !== 'proof' && row.role !== 'verification' && row.role !== 'supporting')
            throw new FindingsError('invalid', 'invalid traffic role');
        if (row.note !== undefined && typeof row.note !== 'string')
            throw new FindingsError('invalid', 'traffic note must be text');
        return { trafficId: id, role: row.role, note: row.note };
    });
}
export function installFindingsReportTools(ctx, store, options = {}) {
    const definitions = new Map();
    const register = (tool) => { definitions.set(tool.name, tool); return ctx.tools.register(tool); };
    const runtime = new FindingsRuntime(store, options.reportProvider);
    const retests = options.retestProvider || options.retestProviderFor ? new FindingRetests(store, options.retestProvider) : undefined;
    const reportProvider = (exec) => options.reportProviderFor?.(exec) ?? options.reportProvider;
    const access = (exec) => { exec.signal.throwIfAborted(); return options.resolveAccess?.(exec) ?? {}; };
    const visibleState = (exec) => {
        const state = store.snapshot(), caller = access(exec);
        if (caller.taskId) {
            const task = state.tasks.find(t => t.id === caller.taskId);
            if (!task)
                throw new FindingsError('forbidden', 'caller task not found');
            const ids = new Set([task.id, ...(task.sourceTaskIds ?? [])]);
            state.findings = state.findings.filter(f => ids.has(f.taskId));
        }
        if (caller.findingId)
            state.findings = state.findings.filter(f => f.id === caller.findingId);
        return state;
    };
    const disposers = [
        register(defineTool({ name: 'redteam_finding_query', description: 'Query findings, task groups, statistics, asset tree, dynamic vulnerability classes, details or lineage. Inherited findings are read-only.',
            parameters: { action: { type: 'string', required: true, enum: ['list', 'groups', 'stats', 'asset_tree', 'classes', 'get', 'lineage'] }, finding_id: { type: 'string' }, filter: { type: 'json' }, page: { type: 'number' }, page_size: { type: 'number' } }, output,
            execute: async (args, exec) => {
                const state = visibleState(exec), f = filter(args.filter);
                switch (args.action) {
                    case 'list': return json(listFindingsPage(state, f, args.page, args.page_size));
                    case 'groups': return json(listFindingGroups(state, f, args.page, args.page_size));
                    case 'stats': return json(findingStats(state));
                    case 'asset_tree': return json(buildFindingAssetTree(state, f));
                    case 'classes': return json(listFindingVulnClasses(state));
                    case 'get': return json(runtime.get(required(args.finding_id, 'finding_id'), access(exec)));
                    case 'lineage':
                        runtime.get(required(args.finding_id, 'finding_id'), access(exec));
                        return json(findingLineage(state, args.finding_id));
                    default: throw new FindingsError('invalid', 'unknown query action');
                }
            }
        })),
        register(defineTool({ name: 'redteam_finding_record', description: 'Record a finding and immutable snapshots of verified traffic IDs in the existing finding/notification transaction; optional command/log evidence does not require traffic.', parameters: { task_id: { type: 'string', required: true }, vuln_class: { type: 'string', required: true }, severity: { type: 'string', required: true, enum: ['critical', 'high', 'medium', 'low', 'info'] }, summary: { type: 'string', required: true }, name: { type: 'string' }, intent_id: { type: 'string' }, worker: { type: 'string' }, evidence: { type: 'json' }, asset_ids: { type: 'array', items: { type: 'string' } }, evidence_ids: { type: 'array', items: { type: 'string' } }, traffic_refs: { type: 'json', description: 'Array of {traffic_id,role?,note?}; requires automatic traffic binding setting.' }, evidence_hint_id: { type: 'string' } }, output,
            execute: async (args, exec) => {
                const caller = access(exec);
                if (caller.readonly || caller.taskId && caller.taskId !== args.task_id)
                    throw new FindingsError('forbidden', 'cannot record in this task');
                const refs = trafficRefs(args.traffic_refs);
                if ((refs.length || args.evidence_hint_id) && !options.trafficBindingEnabled?.())
                    throw new FindingsError('forbidden', 'Agent automatic traffic binding is disabled');
                const finding = await runtime.record({ taskId: args.task_id, vulnClass: args.vuln_class, severity: args.severity, summary: args.summary, name: args.name, intentId: args.intent_id, worker: args.worker, evidence: args.evidence, assetIds: args.asset_ids ?? [], evidenceIds: args.evidence_ids ?? [], status: 'pending' }, refs, args.evidence_hint_id);
                if ((options.reportProvider || options.reportProviderFor) && options.automaticReports !== false) {
                    try {
                        return json(await runtime.generateReport(finding.id, exec.signal, caller, reportProvider(exec)));
                    }
                    catch (error) {
                        return json({ ...finding, reportGeneration: { status: 'failed', error: error instanceof Error ? error.message : String(error) } });
                    }
                }
                return json(finding);
            }
        })),
        register(defineTool({ name: 'redteam_finding_edit', description: 'Edit finding triage, name, type, severity or summary, preserving atomic status notifications; or explicitly delete a finding.', parameters: { finding_id: { type: 'string', required: true }, action: { type: 'string', required: true, enum: ['update', 'delete'] }, status: { type: 'string', enum: [...findingStatuses, 'open', 'verified', 'accepted', 'closed'] }, name: { type: 'string' }, vuln_class: { type: 'string' }, severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] }, summary: { type: 'string' } }, output,
            execute: async (args, exec) => {
                if (args.action === 'delete')
                    return json(await runtime.delete(args.finding_id, access(exec)));
                if (args.action !== 'update')
                    throw new FindingsError('invalid', 'unknown edit action');
                return json(await runtime.update(args.finding_id, { status: args.status, name: args.name, vulnClass: args.vuln_class, severity: args.severity, summary: args.summary }, access(exec)));
            }
        })),
        register(defineTool({ name: 'redteam_finding_traffic', description: 'Read, bind, edit, delete, reorder or read body chunks from immutable finding traffic evidence. Mutations require current evidence version except append-only binding.', parameters: { finding_id: { type: 'string', required: true }, action: { type: 'string', required: true, enum: ['get', 'bind', 'edit', 'delete', 'order', 'body'] }, traffic_refs: { type: 'json' }, version: { type: 'number' }, binding_id: { type: 'string' }, role: { type: 'string' }, note: { type: 'string' }, order: { type: 'array', items: { type: 'string' } }, side: { type: 'string', enum: ['request', 'response'] }, offset: { type: 'number' }, limit: { type: 'number' } }, output,
            execute: async (args, exec) => {
                const caller = access(exec);
                if (args.action === 'get')
                    return json(runtime.traffic(args.finding_id, caller));
                if (args.action === 'bind') {
                    if (!options.trafficBindingEnabled?.())
                        throw new FindingsError('forbidden', 'Agent automatic traffic binding is disabled');
                    return json(await runtime.bindTraffic(args.finding_id, trafficRefs(args.traffic_refs), caller));
                }
                if (args.action === 'body') {
                    if (!args.side)
                        throw new FindingsError('invalid', 'side is required');
                    return json(runtime.body(args.finding_id, required(args.binding_id, 'binding_id'), args.side, args.offset, args.limit, caller));
                }
                if (args.version === undefined)
                    throw new FindingsError('invalid', 'version is required');
                if (args.action === 'order') {
                    if (!args.order)
                        throw new FindingsError('invalid', 'order is required');
                    return json(await runtime.editTraffic(args.finding_id, args.version, { order: args.order }, caller));
                }
                if (args.action !== 'edit' && args.action !== 'delete')
                    throw new FindingsError('invalid', 'unknown traffic action');
                return json(await runtime.editTraffic(args.finding_id, args.version, { bindingId: required(args.binding_id, 'binding_id'), role: args.role, note: args.note, remove: args.action === 'delete' }, caller));
            }
        })),
        register(defineTool({ name: 'redteam_finding_report', description: 'Read, update or generate a real detailed report. Update checks the evidence version; generation requires configured DSH LLM and commits only complete successful output.', parameters: { finding_id: { type: 'string', required: true }, action: { type: 'string', required: true, enum: ['get', 'update', 'generate'] }, markdown: { type: 'string' }, evidence_version: { type: 'number' } }, output,
            execute: async (args, exec) => {
                const caller = access(exec);
                if (args.action === 'get') {
                    const f = runtime.get(args.finding_id, caller);
                    return json({ markdown: f.report ?? '', evidenceVersion: f.evidenceVersion ?? 0, reportEvidenceVersion: f.reportEvidenceVersion ?? 0, stale: !!f.report && (f.evidenceVersion ?? 0) !== (f.reportEvidenceVersion ?? 0) });
                }
                if (args.action === 'generate')
                    return json(await runtime.generateReport(args.finding_id, exec.signal, caller, reportProvider(exec)));
                if (args.action !== 'update' || args.evidence_version === undefined)
                    throw new FindingsError('invalid', 'update requires evidence_version');
                return json(await runtime.updateReport(args.finding_id, required(args.markdown, 'markdown'), args.evidence_version, caller));
            }
        })),
        register(defineTool({ name: 'redteam_finding_export', description: 'Export exact selected IDs, current filter or all accessible findings as Markdown, ZIP with verified HTTP evidence, CSV or JSON. Returns actual artifact bytes encoded as base64 and sha256.', parameters: { scope: { type: 'string', required: true, enum: ['selected', 'filtered', 'all'] }, format: { type: 'string', required: true, enum: ['md-single', 'md-zip', 'csv', 'json'] }, ids: { type: 'array', items: { type: 'string' } }, filter: { type: 'json' } }, output,
            execute: async (args, exec) => {
                const state = visibleState(exec);
                let rows;
                if (args.scope === 'selected') {
                    if (!args.ids?.length)
                        throw new FindingsError('invalid', 'selected export requires ids');
                    const ids = new Set(args.ids);
                    if ([...ids].some(id => !state.findings.some(f => f.id === id)))
                        throw new FindingsError('not_found', 'selected finding is missing or inaccessible');
                    rows = state.findings.filter(f => ids.has(f.id));
                }
                else if (args.scope === 'filtered')
                    rows = filterFindings(state, filter(args.filter));
                else if (args.scope === 'all')
                    rows = state.findings;
                else
                    throw new FindingsError('invalid', 'unknown export scope');
                const artifact = exportFindings(rows.map(row => ({ ...row, taskDescription: state.tasks.find(t => t.id === row.taskId)?.description })), args.format);
                return { filename: artifact.filename, contentType: artifact.contentType, sha256: artifact.sha256, base64: artifact.data.toString('base64') };
            }
        })),
        register(defineTool({ name: 'redteam_finding_deepen', description: 'Create a priority-10 human follow-up intent, preserve finding lineage, and resume/queue through host task admission.', parameters: { finding_id: { type: 'string', required: true }, description: { type: 'string', required: true } }, output,
            execute: async (args, exec) => { if (!options.admitTask)
                throw new FindingsError('unavailable', 'host task admission is not configured'); const intent = await runtime.deepen(args.finding_id, args.description, access(exec)); const admission = await options.admitTask(intent.taskId, exec); return json({ intent, admission }); }
        })),
        register(defineTool({ name: 'redteam_task_report', description: 'Render and persist the ARTEX task Markdown report from actual finding evidence and asset counts.', parameters: { task_id: { type: 'string', required: true } }, output,
            execute: async (args, exec) => {
                const caller = access(exec);
                if (caller.readonly || caller.taskId && caller.taskId !== args.task_id)
                    throw new FindingsError('forbidden', 'cannot write this task report');
                const state = store.snapshot(), task = state.tasks.find(t => t.id === args.task_id);
                if (!task)
                    throw new FindingsError('not_found', 'task not found');
                const assetCounts = {};
                for (const asset of state.assets.filter(a => a.taskId === task.id))
                    assetCounts[asset.kind] = (assetCounts[asset.kind] ?? 0) + 1;
                return json(await store.setReport(task.id, renderTaskReport({ title: task.title, goal: task.goal, generatedAt: new Date(), assetCounts, findings: state.findings.filter(f => f.taskId === task.id) })));
            }
        }))
    ];
    if (retests) {
        const session = (exec) => { access(exec); if (!exec.agent)
            throw new FindingsError('forbidden', 'live retester Agent required'); return exec.agent.session.id; };
        disposers.push(register(defineTool({ name: 'redteam_finding_retests', description: 'Start, list or cancel a dedicated finding retest; start waits for the real isolated session to finish and returns persisted outcome.', parameters: { action: { type: 'string', required: true, enum: ['start', 'history', 'active', 'cancel'] }, finding_id: { type: 'string' }, retest_id: { type: 'string' }, notes: { type: 'string' } }, output, execute: async (args, exec) => {
                const caller = access(exec);
                if (args.action === 'active')
                    return json(retests.active().filter(r => { try {
                        runtime.get(r.findingId, caller);
                        return true;
                    }
                    catch (error) {
                        if (error instanceof FindingsError && error.code === 'forbidden')
                            return false;
                        throw error;
                    } }));
                const id = required(args.finding_id, 'finding_id');
                runtime.get(id, caller);
                if (args.action !== 'history' && (caller.readonly || caller.taskId && runtime.get(id).taskId !== caller.taskId))
                    throw new FindingsError('forbidden', 'inherited retest is read-only');
                if (args.action === 'history')
                    return json(retests.history(id));
                if (args.action === 'cancel') {
                    const retestId = required(args.retest_id, 'retest_id');
                    if (!retests.history(id).some(r => r.id === retestId))
                        throw new FindingsError('not_found', 'retest not found');
                    retests.cancel(retestId);
                    return { cancelRequested: true };
                }
                if (args.action !== 'start')
                    throw new FindingsError('invalid', 'unknown retest action');
                const started = await retests.start(id, args.notes, options.retestProviderFor?.(exec) ?? options.retestProvider, exec.signal);
                await started.completion;
                return json({ created: started.created, retest: retests.history(id).find(r => r.id === started.retest.id) });
            } })), register(defineTool({ name: 'redteam_get_finding_retest_context', description: 'Read only the finding retest bound by host to this real Agent session.', parameters: {}, output, execute: async (_args, exec) => json(retests.context(session(exec))) })), register(defineTool({ name: 'redteam_record_finding_retest_result', description: 'Stage the sole evidence-backed verdict for this host-bound retest session. Only successful session completion can mark original finding fixed.', parameters: { verdict: { type: 'string', required: true, enum: ['reproduced', 'fixed', 'inconclusive'] }, summary: { type: 'string', required: true }, evidence: { type: 'string', required: true } }, output, execute: async (args, exec) => json(await retests.recordResult(session(exec), args.verdict, args.summary, args.evidence)) })));
    }
    const record = definitions.get('redteam_finding_record');
    const edit = definitions.get('redteam_finding_edit');
    disposers.push(register({ ...record, name: 'redteam_record_finding' }), register(defineTool({
        name: 'redteam_update_finding', description: 'Update finding status through the same session-scoped triage and atomic notification path as redteam_finding_edit.',
        parameters: { finding_id: { type: 'string', required: true }, status: { type: 'string', required: true, enum: [...findingStatuses, 'open', 'verified', 'accepted', 'closed'] } }, output,
        execute: async (args, exec) => json(await edit.execute({ ...args, action: 'update' }, exec))
    })));
    return { runtime, retests, dispose: () => { retests?.cancelAll(); for (const dispose of disposers)
            dispose(); } };
}
