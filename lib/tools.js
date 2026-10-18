import { defineTool } from '@deepseek-ai/dsh-tools';
import { randomUUID } from 'node:crypto';
import { intentAssetIds } from './task-asset-runtime.js';
import { maskNotificationConfig } from './notifications.js';
import { listManagedTasks, requireManagedTask, TaskManagementError } from './task-management/index.js';
import { findingStatuses } from './findings-reports/types.js';
import { lifecycleForAgent } from './task-management/runtime-scope.js';
export function registerRedTeamTools(ctx, store, workflow, rea, traffic, workers, notifications, archives, options = {}) {
    const register = (tool) => options.omitTools?.has(tool.name) ? () => { } : ctx.tools.register(tool);
    const jsonOutput = { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] };
    const disposers = [
        register(defineTool({
            name: 'redteam_restore_task_archive', description: 'Restore a task archive, rejecting conflicting task data or files, then consume the archive package.',
            parameters: { archive_id: { type: 'string', required: true } }, output: jsonOutput,
            execute: async (args) => { const job = store.snapshot().archives.find((row) => row.id === args.archive_id); const warnings = await archives.restore(args.archive_id); return { restored: job.taskId, warnings }; }
        })),
        register(defineTool({
            name: 'redteam_delete_task', description: 'Stop and drain a task before deleting its live records. Retain global assets and findings unless their deletion is explicitly selected; preserve assets still used by other tasks.',
            parameters: { task_id: { type: 'string', required: true }, delete_assets: { type: 'boolean' }, delete_findings: { type: 'boolean' } }, output: jsonOutput,
            execute: async (args, exec) => {
                exec.signal.throwIfAborted();
                const agent = requireAgent(exec);
                const lifecycle = lifecycleForAgent(agent);
                if (!lifecycle)
                    throw new Error('task lifecycle is unavailable in this Agent scope');
                return toJson(await lifecycle.deleteTask(args.task_id, agent, { deleteAssets: args.delete_assets, deleteFindings: args.delete_findings }));
            }
        })),
        register(defineTool({
            name: 'redteam_delete_task_archive', description: 'Delete the specified archived task package and archive record.',
            parameters: { archive_id: { type: 'string', required: true } }, output: jsonOutput,
            execute: async (args) => { await archives.delete(args.archive_id); return { deleted: args.archive_id }; }
        })),
        register(defineTool({
            name: 'redteam_recover_task_archives', description: 'Recover journaled archive operations after interruption and return current archive jobs.',
            parameters: {}, output: jsonOutput,
            execute: async () => { await archives.recover(); return toJson(store.snapshot().archives); }
        })),
        register(defineTool({
            name: 'redteam_update_finding',
            description: 'Update finding status and atomically enqueue the corresponding notification event.',
            parameters: { finding_id: { type: 'string', required: true }, status: { type: 'string', required: true, enum: [...findingStatuses, 'open', 'verified', 'accepted', 'closed'] } },
            output: jsonOutput,
            execute: async (args) => toJson(await store.updateFinding(args.finding_id, { status: args.status }))
        })),
        register(defineTool({
            name: 'redteam_dispatch_notifications',
            description: 'Dispatch due notifications through configured channels and return persisted delivery outcomes.',
            parameters: {}, output: jsonOutput,
            execute: async (_args, exec) => { await notifications.step(exec.signal); return toJson(store.snapshot().notificationDeliveries); }
        })),
        register(defineTool({
            name: 'redteam_retry_notification',
            description: 'Requeue a failed or skipped notification delivery for its enabled channel.',
            parameters: { delivery_id: { type: 'string', required: true } }, output: jsonOutput,
            execute: async (args) => toJson(await notifications.retry(args.delivery_id))
        })),
        register(defineTool({
            name: 'redteam_set_notification_channel_enabled',
            description: 'Enable or disable a notification channel; disabling skips its outstanding deliveries.',
            parameters: { channel_id: { type: 'string', required: true }, enabled: { type: 'boolean', required: true } }, output: jsonOutput,
            execute: async (args) => { const channel = await store.updateNotificationChannel(args.channel_id, { enabled: args.enabled }); if (!args.enabled)
                await notifications.skipChannel(args.channel_id); return toJson({ ...channel, config: maskNotificationConfig(channel.kind, channel.config) }); }
        })),
        register(defineTool({
            name: 'redteam_create_task',
            description: 'Create an ARTEX-compatible red-team task in the current DSH workspace.',
            parameters: { title: { type: 'string' }, goal: { type: 'string' }, description: { type: 'string' }, template_id: { type: 'string' }, category_id: { type: 'json', description: 'Category ID or null.' }, source_task_ids: { type: 'array', items: { type: 'string' } }, company_ids: { type: 'array', items: { type: 'string' } }, llm_profile_ids: { type: 'array', items: { type: 'string' }, description: 'Ordered IDs from redteam_list_model_profiles; validated atomically when creating the task.' }, parent_ref: { type: 'string' }, timeout_seconds: { type: 'number' }, plan_heartbeat_seconds: { type: 'number' }, coverage_enabled: { type: 'boolean' }, seed_first_intent: { type: 'boolean' }, asset_rules: { type: 'json', description: 'Array of asset allow/block rule snapshots.' } },
            output: jsonOutput,
            execute: async (args) => toJson(await workflow.createTask(args.title, args.goal, { description: args.description, templateId: args.template_id, categoryId: parseCategory(args.category_id), sourceTaskIds: args.source_task_ids, companyIds: args.company_ids, llmProfileIds: args.llm_profile_ids, parentRef: args.parent_ref, timeoutSeconds: args.timeout_seconds, planHeartbeatSeconds: args.plan_heartbeat_seconds, coverageEnabled: args.coverage_enabled, seedFirstIntent: args.seed_first_intent, interceptRules: args.asset_rules === undefined ? undefined : parseTaskRules(args.asset_rules) }))
        })),
        register(defineTool({
            name: 'redteam_list_tasks', description: 'List tasks with ARTEX pin ordering, category and creation metadata.', parameters: {}, output: jsonOutput,
            execute: async () => toJson(listManagedTasks(store.snapshot()))
        })),
        register(defineTool({
            name: 'redteam_update_task_metadata', description: 'Rename or pin/unpin a task; repeat pin preserves the first pin timestamp.',
            parameters: { task_id: { type: 'string', required: true }, title: { type: 'string' }, pinned: { type: 'boolean' } }, output: jsonOutput,
            execute: async (args) => toJson(await store.updateTaskMetadata(args.task_id, { title: args.title, pinned: args.pinned }))
        })),
        register(defineTool({
            name: 'redteam_task_categories', description: 'List, create, rename or delete task categories. Deletion clears active task/template category references.',
            parameters: { action: { type: 'string', required: true, enum: ['list', 'create', 'rename', 'delete'] }, category_id: { type: 'string' }, name: { type: 'string' } }, output: jsonOutput,
            execute: async (args) => {
                if (args.action === 'list')
                    return toJson(store.listTaskCategories());
                if (args.action === 'create')
                    return toJson(await store.createTaskCategory(requiredText(args.name, 'name')));
                if (args.action === 'rename')
                    return toJson(await store.renameTaskCategory(requiredText(args.category_id, 'category_id'), requiredText(args.name, 'name')));
                return { deleted: await store.deleteTaskCategory(requiredText(args.category_id, 'category_id')) };
            }
        })),
        register(defineTool({
            name: 'redteam_set_tasks_category', description: 'Move up to 100 tasks into a category or null; return actual moved and vanished task IDs.',
            parameters: { task_ids: { type: 'array', required: true, items: { type: 'string' } }, category_id: { type: 'json', required: true } }, output: jsonOutput,
            execute: async (args) => { const categoryId = parseCategory(args.category_id); if (categoryId === undefined)
                throw new TaskManagementError('invalid', 'category_id is required'); const moved = await store.setTasksCategory(args.task_ids, categoryId); return { moved, missing: args.task_ids.filter(id => !moved.includes(id)) }; }
        })),
        register(defineTool({
            name: 'redteam_task_templates', description: 'List/create/update/delete ARTEX task templates; rule snapshots are copied when creating tasks.',
            parameters: { action: { type: 'string', required: true, enum: ['list', 'create', 'update', 'delete'] }, template_id: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, goal: { type: 'string' }, category_id: { type: 'json' }, asset_rules: { type: 'json' } }, output: jsonOutput,
            execute: async (args) => {
                if (args.action === 'list')
                    return toJson(store.listTaskTemplates());
                if (args.action === 'delete')
                    return { deleted: await store.deleteTaskTemplate(requiredText(args.template_id, 'template_id')) };
                const patch = {};
                if (args.name !== undefined)
                    patch.name = args.name;
                if (args.description !== undefined)
                    patch.description = args.description;
                if (args.goal !== undefined)
                    patch.goal = args.goal;
                if (args.category_id !== undefined)
                    patch.categoryId = parseCategory(args.category_id);
                if (args.asset_rules !== undefined)
                    patch.interceptRules = parseTaskRules(args.asset_rules);
                if (args.action === 'update')
                    return toJson(await store.updateTaskTemplate(requiredText(args.template_id, 'template_id'), patch));
                return toJson(await store.createTaskTemplate({ ...patch, name: requiredText(args.name, 'name'), description: requiredText(args.description, 'description'), goal: requiredText(args.goal, 'goal') }));
            }
        })),
        register(defineTool({
            name: 'redteam_global_asset_rules', description: 'Manage ARTEX global asset block rules. Enabled rules reject asset insertion and intent asset bindings across all tasks. Builtin rules can be edited, disabled or deleted.',
            parameters: { action: { type: 'string', required: true, enum: ['list', 'create', 'update', 'toggle', 'delete'] }, rule_id: { type: 'string' }, rule: { type: 'json', description: 'Object with enabled, kind, pattern and optional note. Global rules always block.' }, enabled: { type: 'boolean' } }, output: jsonOutput,
            execute: async (args) => {
                if (args.action === 'list')
                    return toJson(store.listGlobalAssetRules());
                if (args.action === 'create')
                    return toJson(await store.createGlobalAssetRule(parseGlobalRule(args.rule)));
                const id = requiredText(args.rule_id, 'rule_id');
                if (args.action === 'delete')
                    return { deleted: await store.deleteGlobalAssetRule(id) };
                if (args.action === 'toggle') {
                    if (typeof args.enabled !== 'boolean')
                        throw new TaskManagementError('invalid', 'enabled is required');
                    return toJson(await store.toggleGlobalAssetRule(id, args.enabled));
                }
                return toJson(await store.updateGlobalAssetRule(id, parseGlobalRule(args.rule)));
            }
        })),
        register(defineTool({
            name: 'redteam_task_asset_rules', description: 'Manage task asset allow/block rules enforced at asset insertion and intent asset binding. Global and task blocks take precedence over task allow rules. Fuzzy rules use substring matching.',
            parameters: { action: { type: 'string', required: true, enum: ['list', 'create', 'update', 'toggle', 'delete'] }, task_id: { type: 'string', required: true }, rule_id: { type: 'string' }, rule: { type: 'json' }, enabled: { type: 'boolean' } }, output: jsonOutput,
            execute: async (args) => {
                if (args.action === 'list') {
                    const state = store.snapshot();
                    requireManagedTask(state, args.task_id);
                    return toJson(state.taskAssetRules.filter(rule => rule.taskId === args.task_id));
                }
                if (args.action === 'create')
                    return toJson(await store.createTaskAssetRule(args.task_id, parseTaskRules([args.rule ?? null])[0]));
                const id = requiredText(args.rule_id, 'rule_id');
                if (args.action === 'delete')
                    return { deleted: await store.deleteTaskAssetRule(args.task_id, id) };
                if (args.action === 'toggle') {
                    if (typeof args.enabled !== 'boolean')
                        throw new TaskManagementError('invalid', 'enabled is required');
                    return toJson(await store.toggleTaskAssetRule(args.task_id, id, args.enabled));
                }
                return toJson(await store.updateTaskAssetRule(args.task_id, id, parseTaskRules([args.rule ?? null])[0]));
            }
        })),
        register(defineTool({
            name: 'redteam_source_context', description: 'Read direct source tasks as inherited copies; source live intents and private planner/main-agent traces are excluded.',
            parameters: { task_id: { type: 'string', required: true } }, output: jsonOutput,
            execute: async (args) => toJson(workflow.sourceContext(args.task_id))
        })),
        register(defineTool({
            name: 'redteam_snapshot',
            description: 'Read the ARTEX task, asset graph, exploration graph, intents, findings, evidence and worker traces.',
            parameters: { task_id: { type: 'string', description: 'Optional task id.' } },
            output: jsonOutput,
            execute: async (args) => toJson(workflow.snapshot(args.task_id))
        })),
        register(defineTool({
            name: 'redteam_import_snapshot',
            description: 'Merge an ARTEX-compatible exported snapshot into the DSH redteam store while retaining stable ids.',
            parameters: { snapshot: { type: 'json', required: true } },
            output: jsonOutput,
            execute: async (args) => toJson(await store.importSnapshot(asRecord(args.snapshot)))
        })),
        register(defineTool({
            name: 'redteam_set_task_status',
            description: 'Set persisted task status. This does not start/cancel a DSH planner or perform timeout finalization.',
            parameters: { task_id: { type: 'string', required: true }, status: { type: 'string', required: true, enum: ['draft', 'running', 'paused', 'done', 'failed', 'timeout'] } },
            output: jsonOutput,
            execute: async (args) => toJson(await store.setTaskStatus(args.task_id, args.status))
        })),
        register(defineTool({
            name: 'redteam_add_asset',
            description: 'Add or annotate an ARTEX asset and keep its provenance in the asset graph.',
            parameters: { task_id: { type: 'string', required: true }, company_id: { type: 'string' }, kind: { type: 'string', required: true }, value: { type: 'string', required: true }, source: { type: 'string', required: true, enum: ['user', 'rea', 'worker', 'traffic'] }, metadata: { type: 'json' } },
            output: jsonOutput,
            execute: async (args) => toJson(await store.addAsset({ taskId: args.task_id, companyId: args.company_id, kind: args.kind, value: args.value, source: args.source, metadata: asRecord(args.metadata) }))
        })),
        register(defineTool({
            name: 'redteam_plan_intent',
            description: 'Create one Planner intent and place it on the ARTEX exploration graph frontier.',
            parameters: { task_id: { type: 'string', required: true }, summary: { type: 'string', required: true }, input: { type: 'json' }, asset_ids: { type: 'array', items: { type: 'string' }, description: 'Assets bound to this intent; current global and task asset policy is checked before persistence.' } },
            output: jsonOutput,
            execute: async (args) => {
                const input = asRecord(args.input);
                if (args.asset_ids !== undefined)
                    input.assetIds = [...new Set([...intentAssetIds(input), ...args.asset_ids])];
                return workflow.plan(args.task_id, args.summary, input).then(toJson);
            }
        })),
        register(defineTool({
            name: 'redteam_worker_claim',
            description: 'Claim the next open ARTEX intent for a DSH worker and write the worker start trace.',
            parameters: { task_id: { type: 'string', required: true }, worker: { type: 'string', required: true } },
            output: jsonOutput,
            execute: async (args) => toJson(await workflow.claim(args.task_id, args.worker) ?? null)
        })),
        register(defineTool({
            name: 'redteam_start_worker',
            description: 'Claim the next open intent and start a real DSH continuable child. Returns its durable session binding after prompt acceptance; session events record progress and the final outcome.',
            parameters: { task_id: { type: 'string', required: true }, provider: { type: 'string', enum: ['spawn', 'fork'] } },
            output: jsonOutput,
            execute: async (args, exec) => toJson(await workers.start(args.task_id, requireAgent(exec), exec.signal, args.provider) ?? null)
        })),
        register(defineTool({
            name: 'redteam_worker_finish',
            description: 'Commit a DSH worker result to the ARTEX intent and append the result trace.',
            parameters: { intent_id: { type: 'string', required: true }, output: { type: 'json' } },
            output: jsonOutput,
            execute: async (args) => {
                if (store.snapshot().intents.find((item) => item.id === args.intent_id)?.execution)
                    throw new Error('DSH worker completion is recorded from its turn/end event; return the result in the worker final reply');
                return toJson(await workflow.finish(args.intent_id, asRecord(args.output)));
            }
        })),
        register(defineTool({
            name: 'redteam_kill_worker',
            description: 'Stop and release the intent\'s real DSH child and its descendants, then persist the requested intent state.',
            parameters: { intent_id: { type: 'string', required: true }, state: { type: 'string', enum: ['paused', 'failed'] } },
            output: jsonOutput,
            execute: async (args, exec) => toJson(await workers.stop(args.intent_id, requireAgent(exec), args.state ?? 'paused'))
        })),
        register(defineTool({
            name: 'redteam_steer_worker',
            description: 'Deliver a message to the real DSH child inbox (steering a running child or resuming an idle child), and return the accepted message id.',
            parameters: { intent_id: { type: 'string', required: true }, message: { type: 'string', required: true } },
            output: jsonOutput,
            execute: async (args, exec) => toJson(await workers.steer(args.intent_id, args.message, requireAgent(exec), exec.signal))
        })),
        register(defineTool({
            name: 'redteam_record_fact',
            description: 'Record a graph fact produced by a Worker and optionally link it to an intent.',
            parameters: { task_id: { type: 'string', required: true }, summary: { type: 'string', required: true }, intent_id: { type: 'string' }, data: { type: 'json' } },
            output: jsonOutput,
            execute: async (args) => {
                const fact = { id: randomUUID(), taskId: args.task_id, kind: 'fact', label: args.summary, data: { ...asRecord(args.data), intentId: args.intent_id } };
                return toJson(await store.addNode(fact));
            }
        })),
        register(defineTool({
            name: 'redteam_add_hint',
            description: 'Record a Planner/Worker hint as a graph fact for later agents.',
            parameters: { task_id: { type: 'string', required: true }, summary: { type: 'string', required: true }, data: { type: 'json' } },
            output: jsonOutput,
            execute: async (args) => toJson(await store.addNode({ id: randomUUID(), taskId: args.task_id, kind: 'fact', label: args.summary, data: { ...asRecord(args.data), hint: true } }))
        })),
        register(defineTool({
            name: 'redteam_graph_overview',
            description: 'Return the compact ARTEX graph overview used by Planner prompts.',
            parameters: { task_id: { type: 'string', required: true } },
            output: jsonOutput,
            execute: async (args) => { const snapshot = workflow.snapshot(args.task_id); return toJson({ nodes: snapshot.nodes, edges: snapshot.edges, frontier: snapshot.intents.filter((item) => ['open', 'claimed', 'running'].includes(item.state)) }); }
        })),
        register(defineTool({
            name: 'redteam_list_worker_traces',
            description: 'List Worker traces for a task, optionally filtered by intent or search text.',
            parameters: { task_id: { type: 'string', required: true }, intent_id: { type: 'string' }, query: { type: 'string' } },
            output: jsonOutput,
            execute: async (args) => { const q = (args.query ?? '').toLowerCase(); return toJson(workflow.snapshot(args.task_id).traces.filter((item) => (!args.intent_id || item.intentId === args.intent_id) && (!q || JSON.stringify(item).toLowerCase().includes(q)))); }
        })),
        register(defineTool({
            name: 'redteam_add_edge',
            description: 'Connect two ARTEX graph nodes with a typed relation.',
            parameters: { task_id: { type: 'string', required: true }, from: { type: 'string', required: true }, to: { type: 'string', required: true }, relation: { type: 'string', required: true } },
            output: jsonOutput,
            execute: async (args) => toJson(await store.addEdge({ taskId: args.task_id, from: args.from, to: args.to, relation: args.relation }))
        })),
        register(defineTool({
            name: 'redteam_record_finding',
            description: 'Record an ARTEX finding with severity, asset links and evidence links.',
            parameters: { task_id: { type: 'string', required: true }, vuln_class: { type: 'string', required: true }, severity: { type: 'string', required: true, enum: ['info', 'low', 'medium', 'high', 'critical'] }, summary: { type: 'string', required: true }, evidence_ids: { type: 'array', items: { type: 'string' } }, asset_ids: { type: 'array', items: { type: 'string' } } },
            output: jsonOutput,
            execute: async (args) => toJson(await store.addFinding({ taskId: args.task_id, vulnClass: args.vuln_class, severity: args.severity, summary: args.summary, evidenceIds: args.evidence_ids ?? [], assetIds: args.asset_ids ?? [], status: 'open' }))
        })),
        register(defineTool({
            name: 'redteam_request_approval',
            description: 'Create an ARTEX approval gate for a tool or worker action.',
            parameters: { task_id: { type: 'string', required: true }, action: { type: 'string', required: true } },
            output: jsonOutput,
            execute: async (args) => toJson(await store.addApproval({ taskId: args.task_id, action: args.action, status: 'pending' }))
        })),
        register(defineTool({
            name: 'redteam_add_goal',
            description: 'Add an ARTEX task goal that the DSH planner can use as a frontier objective.',
            parameters: { task_id: { type: 'string', required: true }, text: { type: 'string', required: true }, vuln_class: { type: 'string' } },
            output: jsonOutput,
            execute: async (args) => toJson(await store.addGoal({ taskId: args.task_id, text: args.text, vulnClass: args.vuln_class, state: 'open' }))
        })),
        register(defineTool({
            name: 'redteam_update_goal',
            description: 'Edit or mark an ARTEX goal as met.',
            parameters: { goal_id: { type: 'string', required: true }, text: { type: 'string' }, vuln_class: { type: 'string' }, state: { type: 'string', enum: ['open', 'met', 'deleted'] } },
            output: jsonOutput,
            execute: async (args) => toJson(await store.updateGoal(args.goal_id, { text: args.text, vulnClass: args.vuln_class, state: args.state }))
        })),
        register(defineTool({
            name: 'redteam_prove_goal',
            description: 'Mark an ARTEX goal met after the required evidence has been recorded.',
            parameters: { goal_id: { type: 'string', required: true } },
            output: jsonOutput,
            execute: async (args) => toJson(await store.updateGoal(args.goal_id, { state: 'met' }))
        })),
        register(defineTool({
            name: 'redteam_list_assets',
            description: 'List task assets with optional kind/value filtering.',
            parameters: { task_id: { type: 'string', required: true }, kind: { type: 'string' }, query: { type: 'string' } },
            output: jsonOutput,
            execute: async (args) => { const q = (args.query ?? '').toLowerCase(); return toJson(workflow.snapshot(args.task_id).assets.filter((item) => (!args.kind || item.kind === args.kind) && (!q || JSON.stringify(item).toLowerCase().includes(q)))); }
        })),
        register(defineTool({
            name: 'redteam_list_findings',
            description: 'List task findings with optional severity/status filtering.',
            parameters: { task_id: { type: 'string', required: true }, severity: { type: 'string' }, status: { type: 'string' } },
            output: jsonOutput,
            execute: async (args) => toJson(workflow.snapshot(args.task_id).findings.filter((item) => (!args.severity || item.severity === args.severity) && (!args.status || item.status === args.status)))
        })),
        register(defineTool({
            name: 'redteam_add_constraint',
            description: 'Add an allow or deny operation constraint to an ARTEX task.',
            parameters: { task_id: { type: 'string', required: true }, kind: { type: 'string', required: true, enum: ['allow', 'deny'] }, text: { type: 'string', required: true }, origin: { type: 'string', enum: ['goals', 'human', 'system'] } },
            output: jsonOutput,
            execute: async (args) => toJson(await store.addConstraint({ taskId: args.task_id, kind: args.kind, text: args.text, origin: args.origin ?? 'human' }))
        })),
        register(defineTool({
            name: 'redteam_add_scope',
            description: 'Add a typed ARTEX task scope entry for a company, domain, IP, CIDR, ICP or keyword.',
            parameters: { task_id: { type: 'string', required: true }, kind: { type: 'string', required: true, enum: ['company', 'root_domain', 'subdomain', 'ip', 'cidr', 'icp', 'keyword'] }, value: { type: 'string', required: true }, source: { type: 'string', enum: ['auto', 'agent', 'human'] }, reason: { type: 'string' } },
            output: jsonOutput,
            execute: async (args) => toJson(await store.addScope({ taskId: args.task_id, kind: args.kind, value: args.value, source: args.source ?? 'agent', reason: args.reason }))
        })),
        register(defineTool({
            name: 'redteam_add_company',
            description: 'Create an ARTEX company scope container.',
            parameters: { name: { type: 'string', required: true }, description: { type: 'string' } },
            output: jsonOutput,
            execute: async (args) => toJson(await store.addCompany({ name: args.name, description: args.description }))
        })),
        register(defineTool({
            name: 'redteam_list_companies',
            description: 'List ARTEX company scope containers.',
            parameters: {},
            output: jsonOutput,
            execute: async () => toJson(store.snapshot().companies)
        })),
        register(defineTool({
            name: 'redteam_add_company_scope',
            description: 'Attach a domain, IP, CIDR, ICP or keyword scope to an ARTEX company.',
            parameters: { company_id: { type: 'string', required: true }, kind: { type: 'string', required: true, enum: ['root_domain', 'subdomain', 'ip', 'cidr', 'icp', 'keyword'] }, value: { type: 'string', required: true }, reason: { type: 'string' } },
            output: jsonOutput,
            execute: async (args) => toJson(await store.addScope({ taskId: 'global', companyId: args.company_id, kind: args.kind, value: args.value, source: 'agent', reason: args.reason }))
        })),
        register(defineTool({
            name: 'redteam_traffic_record',
            description: 'Persist a captured traffic index row so workers and findings can reference request/response evidence.',
            parameters: { task_id: { type: 'string' }, host: { type: 'string', required: true }, method: { type: 'string', required: true }, url: { type: 'string', required: true }, status: { type: 'number' }, request: { type: 'json' }, response: { type: 'json' } },
            output: jsonOutput,
            execute: async (args) => toJson(await store.addTraffic({ taskId: args.task_id, host: args.host, method: args.method, url: args.url, status: args.status, request: args.request, response: args.response }))
        })),
        register(defineTool({
            name: 'redteam_traffic_search',
            description: 'Search the lightweight ARTEX traffic index by host, URL substring or body text.',
            parameters: { task_id: { type: 'string' }, query: { type: 'string' }, host: { type: 'string' } },
            output: jsonOutput,
            execute: async (args) => {
                const q = (args.query ?? '').toLowerCase();
                return toJson(store.snapshot().traffic.filter((item) => (!args.task_id || item.taskId === args.task_id) && (!args.host || item.host === args.host) && (!q || JSON.stringify(item).toLowerCase().includes(q))).slice(0, 50));
            }
        })),
        register(defineTool({
            name: 'redteam_traffic_start',
            description: 'Start the local mitmproxy capture bridge and persist captured flows into the ARTEX traffic index.',
            parameters: { task_id: { type: 'string', required: true }, port: { type: 'number' }, worker_session_id: { type: 'string' } },
            output: jsonOutput,
            execute: async (args) => toJson(await traffic.start(args.task_id, args.port ?? 8080, { workerSessionId: args.worker_session_id }))
        })),
        register(defineTool({
            name: 'redteam_traffic_stop',
            description: 'Stop the local mitmproxy capture bridge while retaining captured traffic records.',
            parameters: {},
            output: jsonOutput,
            execute: async () => toJson(await traffic.stop())
        })),
        register(defineTool({
            name: 'redteam_traffic_status',
            description: 'Return the local mitmproxy capture bridge status.',
            parameters: {},
            output: jsonOutput,
            execute: async () => toJson(traffic.status())
        })),
        register(defineTool({
            name: 'redteam_add_intercept_rule',
            description: 'Add an ARTEX intercept rule used by the DSH approval boundary.',
            parameters: { task_id: { type: 'string' }, name: { type: 'string', required: true }, match_target: { type: 'string', required: true }, match_type: { type: 'string', required: true }, pattern: { type: 'string', required: true }, action: { type: 'string', required: true }, priority: { type: 'number' }, enabled: { type: 'boolean' }, message: { type: 'string' } },
            output: jsonOutput,
            execute: async (args) => toJson(await store.addInterceptRule({ taskId: args.task_id, name: args.name, enabled: args.enabled ?? true, priority: args.priority ?? 0, matchTarget: args.match_target, matchType: args.match_type, pattern: args.pattern, action: args.action, message: args.message }))
        })),
        register(defineTool({
            name: 'redteam_set_report',
            description: 'Persist the Markdown report for a task and increment its evidence version.',
            parameters: { task_id: { type: 'string', required: true }, markdown: { type: 'string', required: true } },
            output: jsonOutput,
            execute: async (args) => toJson(await store.setReport(args.task_id, args.markdown))
        })),
        register(defineTool({
            name: 'redteam_archive_task',
            description: 'Archive a paused or finished task to a verified tar.zst package, then remove the archived task records and files from live storage.',
            parameters: { task_id: { type: 'string', required: true } },
            output: jsonOutput,
            execute: async (args) => toJson(await archives.archive(args.task_id))
        })),
        register(defineTool({
            name: 'redteam_add_notification_channel',
            description: 'Register an ARTEX notification channel configuration for findings and task events.',
            parameters: { name: { type: 'string', required: true }, kind: { type: 'string', required: true }, mode: { type: 'string', enum: ['realtime', 'digest'] }, enabled: { type: 'boolean' }, config: { type: 'json' }, filter: { type: 'json' } },
            output: jsonOutput,
            execute: async (args) => { const channel = await store.addNotificationChannel({ name: args.name, kind: args.kind, mode: args.mode ?? 'realtime', enabled: args.enabled ?? true, config: asRecord(args.config), filter: args.filter === undefined ? undefined : asRecord(args.filter) }); return toJson({ ...channel, config: maskNotificationConfig(channel.kind, channel.config) }); }
        })),
        register(defineTool({
            name: 'redteam_rea_analyze',
            description: 'Run the installed REA analyzer, persist its full JSON evidence, and anchor the evidence in the exploration graph.',
            parameters: { task_id: { type: 'string', required: true }, target: { type: 'string', required: true }, provider: { type: 'string' } },
            output: jsonOutput,
            execute: async (args) => rea.analyze(args.task_id, args.target, args.provider).then(toJson)
        })),
        register(defineTool({
            name: 'redteam_rea_manifest',
            description: 'Read the installed REA provider and command manifest for dynamic capability discovery.',
            parameters: {},
            output: jsonOutput,
            execute: async () => toJson(await rea.manifest())
        })),
        register(defineTool({
            name: 'redteam_rea_command',
            description: 'Dispatch any installed REA command and persist its raw result as evidence. Use the manifest to discover command names and schemas.',
            parameters: { task_id: { type: 'string', required: true }, subcommand: { type: 'string', required: true }, args: { type: 'array', items: { type: 'string' } }, target: { type: 'string' } },
            output: jsonOutput,
            execute: async (args) => {
                if (!/^[a-z0-9][a-z0-9-]*$/.test(args.subcommand))
                    throw new Error('invalid REA subcommand');
                return toJson(await rea.run(args.task_id, [args.subcommand, ...(args.target ? [args.target] : []), ...(args.args ?? [])], args.target));
            }
        }))
    ];
    return () => disposers.forEach((dispose) => dispose());
}
function asRecord(value) {
    if (value === undefined)
        return {};
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        throw new Error('input must be a JSON object');
    return value;
}
function requiredText(value, name) {
    if (typeof value !== 'string' || !value.trim())
        throw new TaskManagementError('invalid', `${name} is required`);
    return value;
}
function parseCategory(value) {
    if (value === undefined || value === null || typeof value === 'string')
        return value;
    throw new TaskManagementError('invalid', 'category_id must be a string or null');
}
function parseTaskRules(value) {
    if (!Array.isArray(value))
        throw new TaskManagementError('invalid', 'asset_rules must be an array');
    return value.map(item => {
        if (!item || typeof item !== 'object' || Array.isArray(item))
            throw new TaskManagementError('invalid', 'rule must be an object');
        const { enabled, action, kind, pattern, note } = item;
        if (typeof enabled !== 'boolean' || (action !== 'allow' && action !== 'block') || typeof pattern !== 'string' || (note !== undefined && typeof note !== 'string'))
            throw new TaskManagementError('invalid', 'rule requires enabled, action, kind and pattern');
        if (kind !== 'exact_domain' && kind !== 'exact_ip' && kind !== 'exact_url' && kind !== 'fuzzy_domain' && kind !== 'fuzzy_ip' && kind !== 'fuzzy_url' && kind !== 'cidr')
            throw new TaskManagementError('invalid', 'invalid asset rule kind');
        return { enabled, action, kind, pattern, note: note ?? '' };
    });
}
function parseGlobalRule(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new TaskManagementError('invalid', 'rule must be an object');
    const row = value;
    if (row.action !== undefined && row.action !== 'block')
        throw new TaskManagementError('invalid', 'global asset rules always block');
    const { action: _action, ...rule } = parseTaskRules([{ ...row, action: 'block' }])[0];
    return rule;
}
function requireAgent(exec) {
    if (!exec.agent)
        throw new Error('this operation requires a live DSH agent');
    return exec.agent;
}
function toJson(value) {
    return JSON.parse(JSON.stringify(value));
}
