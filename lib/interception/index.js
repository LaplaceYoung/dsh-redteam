import { defineTool } from '@deepseek-ai/dsh-tools';
import { InterceptionRuntime } from './runtime.js';
export { InterceptionRuntime } from './runtime.js';
export { InterceptionRepository } from './repository.js';
export * from './model.js';
export { installInterceptionHttp } from './http.js';
export { InterceptionArchive, withInterceptionArchive } from './archive.js';
const json = (value) => JSON.parse(JSON.stringify(value));
const output = { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] };
const ruleProperties = {
    task_id: { type: 'string' }, name: { type: 'string', required: true },
    match_target: { type: 'string', enum: ['tool_name', 'tool_input'], required: true },
    match_type: { type: 'string', enum: ['string', 'regex'], required: true },
    pattern: { type: 'string', required: true }, action: { type: 'string', enum: ['allow', 'deny', 'ask'], required: true },
    priority: { type: 'integer' }, enabled: { type: 'boolean' }, message: { type: 'string' }, timeout_enabled: { type: 'boolean' }, timeout_seconds: { type: 'integer' }, timeout_action: { type: 'string', enum: ['allow', 'deny'] },
};
const rule = (a) => ({ taskId: a.task_id, name: a.name, matchTarget: a.match_target, matchType: a.match_type, pattern: a.pattern, action: a.action, priority: a.priority ?? 0, enabled: a.enabled ?? true, message: a.message ?? '', timeoutEnabled: a.timeout_enabled ?? false, timeoutSeconds: a.timeout_seconds ?? 60, timeoutAction: a.timeout_action ?? 'deny' });
/** Install once in each Agent scope after tools/llm/approval services are available. */
export function installInterception(ctx, store, options = {}) {
    const runtime = new InterceptionRuntime(ctx, store, options), repo = runtime.repository;
    const task = (id) => { if (id !== undefined && !store.snapshot().tasks.some(t => t.id === id))
        throw new Error(`Task not found: ${id}`); };
    const tools = [
        defineTool({ name: 'redteam_add_intercept_rule', description: 'Create an ARTEX tool rule: priority ordered, substring or RE2 match, allow/deny/ask and optional approval timeout.', parameters: ruleProperties, output, execute: async (args) => { await runtime.ready; task(args.task_id); return json(await repo.upsertRule(rule(args))); } }),
        defineTool({ name: 'redteam_update_intercept_rule', description: 'Replace all editable fields of an ARTEX tool interception rule.', parameters: { id: { type: 'string', required: true }, ...ruleProperties }, output, execute: async (args) => { await runtime.ready; task(args.task_id); return json(await repo.upsertRule(rule(args), args.id)); } }),
        defineTool({ name: 'redteam_list_intercept_rules', description: 'List tool interception rules and effective enabled tool names.', parameters: {}, output, execute: async () => { await runtime.ready; const state = await repo.snapshot(); return json({ rules: state.rules.sort((a, b) => b.priority - a.priority || a.order - b.order), enabledTools: state.enabledTools }); } }),
        defineTool({ name: 'redteam_toggle_intercept_rule', description: 'Enable or disable a tool interception rule.', parameters: { id: { type: 'string', required: true }, enabled: { type: 'boolean', required: true } }, output, execute: async (a) => { await runtime.ready; return json(await repo.toggleRule(a.id, a.enabled)); } }),
        defineTool({ name: 'redteam_delete_intercept_rule', description: 'Delete a tool interception rule; historical decisions remain.', parameters: { id: { type: 'string', required: true } }, output, execute: async (a) => { await runtime.ready; await repo.deleteRule(a.id); return { deleted: a.id }; } }),
        defineTool({ name: 'redteam_configure_interception', description: 'Configure exact tool names entering interception and the unmatched-call LLM judge. Empty enabled_tools disables interception.', parameters: {
                enabled_tools: { type: 'array', items: { type: 'string' } },
                judge: { type: 'object', additionalProperties: false, properties: { enabled: { type: 'boolean', required: true }, profileId: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true }, prompt: { type: 'string', required: true }, timeoutSeconds: { type: 'integer', required: true }, failAction: { type: 'string', enum: ['allow', 'ask', 'deny'], required: true }, askTimeoutSeconds: { type: 'integer', required: true }, askTimeoutAction: { type: 'string', enum: ['allow', 'deny'], required: true } } },
            }, output, execute: async (a) => { await runtime.ready; await repo.configure({ enabledTools: a.enabled_tools, judge: a.judge }); const state = await repo.snapshot(); return json({ enabledTools: state.enabledTools, judge: state.judge }); } }),
        defineTool({ name: 'redteam_list_approvals', description: 'Read pending or historical interception decisions, optionally restricted to one task.', parameters: { task_id: { type: 'string' }, pending_only: { type: 'boolean' } }, output, execute: async (a) => { await runtime.ready; task(a.task_id); return json((await repo.snapshot()).records.filter(r => (!a.task_id || r.taskId === a.task_id) && (!a.pending_only || r.status === 'pending')).reverse()); } }),
        defineTool({ name: 'redteam_get_approval', description: 'Read exact tool arguments, decision audit and paired execution result for an approval.', parameters: { id: { type: 'string', required: true } }, output, execute: async (a) => { await runtime.ready; return json(await repo.detail(a.id)); } }),
        defineTool({ name: 'redteam_request_approval', description: 'Wait for a real DSH one-shot human approval of this request. The returned grant does not authorize an unrelated future tool call.', parameters: { task_id: { type: 'string', required: true }, action: { type: 'string', required: true } }, output, execute: async (a, exec) => { const outcome = await runtime.requestApproval(exec, a.task_id, a.action); if (outcome.kind !== 'allow')
                throw new Error(outcome.kind === 'deny' ? outcome.reason : 'Approval cancelled'); return { approved: true }; } }),
    ];
    ctx.effect(() => { const disposers = tools.map(tool => ctx.tools.register(tool)); return () => { for (const dispose of disposers.reverse())
        dispose(); }; });
    return runtime;
}
