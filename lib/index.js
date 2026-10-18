import { SessionId } from '@deepseek-ai/dsh-session';
import { readFileSync } from 'node:fs';
import { ArtexWorkflow } from './artex.js';
import { ReaRuntime } from './rea.js';
import { RedTeamStore } from './store.js';
import { registerRedTeamTools } from './tools.js';
import { TrafficRuntime } from './traffic.js';
import { WorkerRuntime } from './workers.js';
import { NotificationDispatcher } from './notifications.js';
import { ArchiveRuntime } from './archives.js';
import { dirname, join } from 'node:path';
import { installNativeRea } from './rea-native-integration.js';
import { installPlanner } from './planner/integration.js';
import { SessionArchiveRuntime } from './session-archive.js';
import { TrafficArchiveRuntime } from './traffic-archive.js';
import { installTrafficTools } from './traffic-tools/index.js';
import { NotificationSettingsRuntime, registerNotificationManagementTools } from './notification-settings.js';
import { installTaskLifecycle } from './task-management/integration.js';
import { installTaskProfiles, TaskProfileRegistry } from './task-management/runtime-profiles.js';
import { installTaskAdmissionSettings, TaskAdmissionRegistry } from './task-management/runtime-settings.js';
import { lifecycleForAgent } from './task-management/runtime-scope.js';
import { installTaskWorkspaceApi } from './task-workspace/api.js';
import { installTrafficEnvironment } from './traffic-tools/environment.js';
import { installGraphTools, replacedGraphToolNames } from './graph-tools/index.js';
import { installPlatform } from './platform/index.js';
import { installInterception } from './interception/index.js';
import { installTrafficControls } from './traffic-tools/controls.js';
import { withInterceptionArchive } from './interception/archive.js';
import { installInterceptionHttp } from './interception/http.js';
import { installDshFindings } from './findings-reports/dsh.js';
import { installSystemRuntime } from './system-runtime/index.js';
import { createDeepSeekCredentialResolver } from './system-runtime/host-profile-adapter.js';
import { installSystemRuntimeHttp } from './system-runtime/http.js';
import { installObservability, installObservabilityHttp, withObservationStream } from './observability/index.js';
import { resolveModelCallAttribution } from './system-runtime/model-attribution.js';
import { installAssetManagementTools, installAssetManagementHttp } from './asset-management/index.js';
import { conversationHostDependencies, getConversationWorkspace, installConversationWorkspaceHttp, installConversationWorkspaceTools, registerConversationPreset } from './conversation-workspace/index.js';
import { withConversationArchive } from './conversation-workspace/archive.js';
import { conversationTaskForAgent, isConversationWorkspaceAgent } from './conversation-workspace/host.js';
import { installHostManagement } from './host-management/index.js';
import { installPlatformHttp } from './platform/http.js';
export const name = 'dsh-redteam';
const trafficRuntimes = new Map();
const planners = new Map();
export async function apply(ctx, config = {}) {
    const store = new RedTeamStore(config.storagePath);
    await store.load();
    const workflow = new ArtexWorkflow(store);
    const rea = new ReaRuntime(store, { command: config.reaCommand });
    const trafficKey = process.platform === 'win32' ? store.storagePath.toLowerCase() : store.storagePath;
    let sharedTraffic = trafficRuntimes.get(trafficKey);
    if (sharedTraffic && sharedTraffic.command !== config.trafficCommand)
        throw new Error('trafficCommand must match across contexts sharing the same store');
    if (!sharedTraffic) {
        sharedTraffic = { runtime: new TrafficRuntime(store, config.trafficCommand), command: config.trafficCommand, users: 0 };
        trafficRuntimes.set(trafficKey, sharedTraffic);
    }
    const shared = sharedTraffic;
    const traffic = shared.runtime;
    await traffic.load();
    ctx.effect(() => {
        shared.users++;
        return async () => {
            if (--shared.users === 0) {
                try {
                    await traffic.stop();
                }
                finally {
                    trafficRuntimes.delete(trafficKey);
                }
            }
        };
    });
    const notificationSettings = new NotificationSettingsRuntime({ read: () => store.snapshot(), transaction: (mutate) => store.transaction(mutate) }, config.notifications);
    const notifications = new NotificationDispatcher({ read: () => store.snapshot(), transaction: (mutate) => store.transaction(mutate) }, () => store.snapshot().notificationChannels, {
        ...config.notifications,
        settings: () => notificationSettings.read(),
        isTaskAvailable: (taskId) => !store.snapshot().archives.some((job) => job.taskId === taskId && ['archive_queued', 'archiving'].includes(job.state))
    });
    if (config.surface !== 'agent')
        ctx.effect(() => {
            const abort = new AbortController();
            let pending;
            const timer = setInterval(() => {
                const state = store.snapshot();
                if (pending || !state.notificationEvents.some((row) => !row.fannedOut) && !state.notificationDeliveries.some((row) => ['pending', 'sending'].includes(row.state)))
                    return;
                pending = notifications.step(abort.signal).catch((error) => {
                    if (!abort.signal.aborted)
                        ctx.logger?.error?.(`Notification dispatch failed: ${String(error)}`);
                }).finally(() => { pending = undefined; });
            }, 3000);
            timer.unref();
            return async () => { clearInterval(timer); abort.abort(); await pending; };
        });
    if (config.surface !== 'ui')
        await ctx.inject(['tools', 'subagents', 'llm', 'agents', 'sessionQuery', 'sessionPersistence', 'approval'], async (agentCtx) => {
            installNativeRea(agentCtx, store);
            installTrafficTools(agentCtx, store, traffic);
            installTrafficControls(agentCtx, traffic);
            installTrafficEnvironment(agentCtx, store, traffic);
            agentCtx.effect(() => registerNotificationManagementTools(agentCtx, notificationSettings));
            const profiles = installTaskProfiles(agentCtx, store);
            const system = await installSystemRuntime(agentCtx, store, {
                profiles: profiles.registry,
                resolveDeepSeekCredentials: createDeepSeekCredentialResolver(agentCtx, profiles.registry),
            });
            const platform = await installPlatform(agentCtx, store, {
                wrapPrepareRun: prepare => system.wrapPrepareRun(prepare),
                defaultRoute: async () => await profiles.registry.resolveGlobal() ?? undefined,
                profileExists: async (id) => (await profiles.registry.list()).profiles.some(profile => profile.id === String(id)),
                resolveProfile: async (id) => {
                    const route = await profiles.registry.resolveProfile(String(id));
                    if (!route)
                        throw new Error(`Agent model profile is unavailable: ${id}`);
                    return route;
                },
                resourceContext: input => ({
                    env: input.taskId ? traffic.workerEnvironment(input.taskId, input.sessionId) : {},
                    recordingProxy: () => {
                        if (!input.taskId)
                            return;
                        const status = traffic.status();
                        const environment = traffic.workerEnvironment(input.taskId, input.sessionId);
                        if (!status.proxyUrl || !status.caCertPath || environment.HTTP_PROXY !== status.proxyUrl)
                            return;
                        return { url: status.proxyUrl, ca: readFileSync(status.caCertPath, 'utf8') };
                    },
                }),
            });
            const prepareRun = system.wrapPrepareRun(platform.prepareRun);
            // Agent Teams is a host service. Depending on the preset's isolation
            // realm it may be visible from the agent scope or only from root.
            const agentTeams = (agentCtx.get('agentTeams', false) ?? agentCtx.root?.get?.('agentTeams', false));
            const workers = new WorkerRuntime(agentCtx, store, config.plannerConcurrency ?? 3, {
                prepareRun, constraints: taskId => system.constraints(taskId, 'worker'),
                intentRetry: () => system.models.retryPolicy().intent,
            }, agentTeams);
            const agentWorkflow = new ArtexWorkflow(store, input => profiles.registry.createManagedTask(input));
            let lifecycle;
            let conversationWorkspace;
            let removeConversationPreset;
            if (conversationHostDependencies.every(name => agentCtx.get(name))) {
                removeConversationPreset = registerConversationPreset(agentCtx, store, {
                    profiles: profiles.resolver,
                    prepareRun,
                    resolveAgent: key => platform.agents.list().some(row => row.key === key),
                    resolveAgentProfile: key => platform.resolveAgentProfile(key),
                    bindTask: (taskId, agent) => lifecycle.attachConversation(taskId, agent),
                });
                conversationWorkspace = await getConversationWorkspace(agentCtx, store, {
                    directory: join(dirname(store.storagePath), 'conversation-workspace'),
                    workspaceRoot: config.dataDir ?? join(dirname(store.storagePath), 'redteam'),
                    parentForSession: async (sessionId) => {
                        const intent = store.snapshot().intents.find(row => row.execution?.childSessionId === sessionId);
                        return intent ? { kind: 'task', id: intent.taskId, intentId: intent.id } : undefined;
                    },
                });
                installConversationWorkspaceTools(agentCtx, conversationWorkspace);
            }
            const planner = installPlanner(agentCtx, store, workers, {
                concurrency: config.plannerConcurrency ?? 3, prepareRun,
                constraints: taskId => system.constraints(taskId, 'planner'),
                modelStream: call => withObservationStream({ taskId: call.taskId, role: call.purpose ?? call.role ?? 'planner', agentId: call.parent.id, sessionId: call.parent.id }, () => lifecycle.modelStream(call)),
            });
            lifecycle = installTaskLifecycle(agentCtx, store, planner, {
                profiles: {
                    resolveProfile: id => profiles.resolver.resolveProfile(id),
                    resolveGlobal: () => profiles.resolver.resolveGlobal(),
                    resolveBinding: async (taskId, role) => await platform.resolveAgentProfile(role) ?? await profiles.resolver.resolveBinding(taskId, role),
                    resolveGlobalSelection: () => profiles.registry.resolveGlobalSelection(),
                    resolveBindingSelection: async (taskId, role) => await platform.resolveAgentProfileSelection(role) ?? await profiles.registry.resolveBindingSelection(taskId, role),
                },
                modelHealth: system.models,
                poolSettings: () => system.settings.snapshot(),
                concurrency: config.taskConcurrency ?? 5,
                enabled: config.taskConcurrencyEnabled ?? false,
                prepareTaskDelete: conversationWorkspace?.prepareTaskDelete,
                onError: (error, taskId) => agentCtx.logger?.error?.(`Task lifecycle ${taskId ?? ''}: ${String(error)}`),
            });
            const attributionForAgent = (agent) => {
                const binding = lifecycle.taskForAgent(agent.id);
                if (binding) {
                    const intent = store.snapshot().intents.find(row => row.execution?.childSessionId === agent.id);
                    return { taskId: binding.binding.taskId, role: binding.role, agentId: agent.id, sessionId: agent.id, ...(intent ? { intentId: intent.id } : {}) };
                }
                if (lifecycleForAgent(agent) === lifecycle)
                    return { role: 'mainagent', agentId: agent.id, sessionId: agent.id };
            };
            const observability = installObservability(agentCtx, store, {
                resolveAgent: attributionForAgent,
                resolveCall: request => {
                    const agent = request.sessionId ? agentCtx.agents.get(SessionId(request.sessionId)) : undefined;
                    const identity = agent ? attributionForAgent(agent) : undefined;
                    const selected = resolveModelCallAttribution(request);
                    return identity || selected ? { ...identity, ...selected } : undefined;
                },
                onError: error => agentCtx.logger?.error?.(`Observability failed: ${String(error)}`),
            });
            await observability.ready;
            const assetManagement = installAssetManagementTools(agentCtx, store, {
                authorize: exec => !!exec.agent && lifecycleForAgent(exec.agent) === lifecycle && lifecycle.taskForAgent(exec.agent.id)?.role !== 'worker',
                onTaskMutation: taskId => planner.notify(taskId, { kind: 'change', detail: 'asset-management' }),
            });
            await assetManagement.ready;
            agentCtx.effect(() => () => assetManagement.dispose());
            agentCtx.effect(() => { planners.set(lifecycle, planner); return () => { planners.delete(lifecycle); }; });
            platform.bindMainAgents(agent => {
                if (isConversationWorkspaceAgent(agent))
                    return undefined;
                const binding = lifecycle.taskForAgent(agent.id);
                const conversation = conversationTaskForAgent(agent);
                return binding ? { taskId: binding.binding.taskId, role: binding.role } : conversation ? { taskId: conversation.taskId, role: 'mainagent' } : undefined;
            });
            const interception = installInterception(agentCtx, store, {
                profiles: profiles.resolver,
                taskForAgent: agent => {
                    const binding = lifecycle.taskForAgent(agent.id);
                    return binding ? { taskId: binding.binding.taskId, worker: binding.role === 'worker' } : undefined;
                },
                onError: error => agentCtx.logger?.error?.(`Tool interception failed: ${String(error)}`),
            });
            await interception.ready;
            let sessions = withInterceptionArchive(new SessionArchiveRuntime(agentCtx.sessionPersistence, agentCtx.subagents), interception.repository);
            if (conversationWorkspace)
                sessions = withConversationArchive(sessions, { conversations: conversationWorkspace.conversations, sideQuestions: conversationWorkspace.sideQuestions, prepareTaskDelete: conversationWorkspace.prepareTaskDelete });
            const archives = new ArchiveRuntime(store, { dataDir: config.dataDir ?? join(dirname(store.storagePath), 'redteam'), sessions, trafficBodies: new TrafficArchiveRuntime(join(dirname(store.storagePath), 'redteam', 'traffic', '_blobs', 'sha256')), lifecycle: { quiesce: async (taskId) => {
                        if (planner.runtime.inspect(taskId))
                            await planner.runtime.pause(taskId);
                        if (traffic.status().taskId === taskId)
                            await traffic.stop();
                        await workers.quiesceTask(taskId);
                        await interception.flush();
                        await observability.flush();
                    } } });
            // DSH children are composed in sibling agent scopes. Observe from the host
            // scope, then let WorkerRuntime filter its own exact child-session bindings.
            agentCtx.effect(() => agentCtx.root.on('session/event', async (session, event) => {
                await workers.observe(session, event);
                planner.notifyWorkerEvent(session, event);
            }));
            agentCtx.effect(() => async () => { removeConversationPreset?.(); await conversationWorkspace?.dispose(); await lifecycle.dispose(); await planner.dispose(); await workers.dispose(); });
            await installTaskAdmissionSettings(agentCtx, store, lifecycle, lifecycle.admission());
            agentCtx.effect(() => registerRedTeamTools(agentCtx, store, agentWorkflow, rea, traffic, workers, notifications, archives, { omitTools: new Set([...replacedGraphToolNames, 'redteam_add_intercept_rule', 'redteam_request_approval', 'redteam_record_finding', 'redteam_update_finding']) }));
            const findings = installDshFindings(agentCtx, store, {
                models: lifecycle.models,
                start: lifecycle.start.bind(lifecycle),
                taskForAgent: lifecycle.taskForAgent.bind(lifecycle),
                resolveBinding: agent => lifecycleForAgent(agent)?.taskForAgent(agent.id)?.binding,
            }, profiles.resolver, { trafficBindingEnabled: () => traffic.configuration().trafficBindingEnabled });
            await findings.ready;
            agentCtx.effect(() => () => findings.dispose());
            agentCtx.effect(() => installGraphTools(agentCtx, store, {
                trafficBindingEnabled: () => traffic.configuration().trafficBindingEnabled,
                resolveBinding: (exec) => {
                    const binding = exec.agent && lifecycle.taskForAgent(exec.agent.id);
                    return binding ? { taskId: binding.binding.taskId } : undefined;
                },
                notifyHint: (taskId, texts) => planner.notify(taskId, { kind: 'hint', hints: texts }),
                onMutation: (taskId, toolName) => planner.notify(taskId, { kind: 'change', detail: toolName }),
            }));
        });
    if (config.surface !== 'agent')
        await ctx.inject(['webServer', 'connection', 'agents', 'llm'], async (uiCtx) => {
            const authenticate = (request) => {
                const admission = uiCtx.connection.admit(request);
                return 'rejection' in admission ? admission.rejection : admission.peer.principal.kind === 'owner' ? true : 403;
            };
            const uiProfiles = new TaskProfileRegistry(store, uiCtx.llm);
            const system = installSystemRuntimeHttp(uiCtx, store, {
                profiles: uiProfiles, authenticate,
                resolveDeepSeekCredentials: createDeepSeekCredentialResolver(uiCtx, uiProfiles),
            });
            await system.ready;
            const platformHttp = installPlatformHttp(uiCtx, store, {
                root: join(dirname(store.storagePath), 'platform'),
                authenticate,
                schedulerIntervalMs: 0,
            });
            await platformHttp.ready;
            uiCtx.effect(() => () => platformHttp.dispose());
            const hostManagement = installHostManagement(uiCtx, store, {
                authenticate,
                serviceVersion: name,
                trafficEnabled: () => traffic.configuration().trafficBindingEnabled,
                llmConfigured: () => uiCtx.llm.listProviders().length > 0,
            });
            await hostManagement.ready;
            uiCtx.effect(() => () => hostManagement.dispose());
            if (conversationHostDependencies.every(name => uiCtx.get(name))) {
                try {
                    const workspace = await getConversationWorkspace(uiCtx, store, {
                        directory: join(dirname(store.storagePath), 'conversation-workspace'),
                        workspaceRoot: config.dataDir ?? join(dirname(store.storagePath), 'redteam'),
                    });
                    installConversationWorkspaceHttp(uiCtx, workspace, { authenticate });
                }
                catch (error) {
                    uiCtx.logger?.warn?.(`Conversation workspace UI is unavailable until the redteam preset is active: ${String(error)}`);
                }
            }
            await installInterceptionHttp(uiCtx, store, { authenticate }).ready;
            await installObservabilityHttp(uiCtx, store, { authenticate }).ready;
            const assetManagement = installAssetManagementHttp(uiCtx, store, {
                authenticate,
                onTaskMutation: taskId => {
                    for (const [runtime, planner] of planners)
                        if (runtime.store.storagePath === store.storagePath)
                            planner.notify(taskId, { kind: 'change', detail: 'asset-management' });
                },
            });
            await assetManagement.ready;
            uiCtx.effect(() => () => assetManagement.dispose());
            const admission = new TaskAdmissionRegistry(store, { enabled: config.taskConcurrencyEnabled ?? false, limit: config.taskConcurrency ?? 5 });
            installTaskWorkspaceApi(uiCtx, store, {
                profiles: uiProfiles,
                authenticate,
                lifecycleForAgent,
                admission: () => admission.get(),
                notify: taskId => {
                    for (const [runtime, planner] of planners)
                        if (runtime.store.storagePath === store.storagePath)
                            planner.notify(taskId, { kind: 'change', detail: 'task-workspace' });
                },
            });
            uiCtx.effect(() => uiCtx.webServer.register({
                kind: 'exact',
                path: '/api/redteam/snapshot',
                handler: (request, response) => {
                    const access = authenticate(request);
                    if (access !== true) {
                        response.writeHead(access === false ? 403 : access, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                        response.end(JSON.stringify({ error: 'Owner authentication required' }));
                        return;
                    }
                    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    response.end(JSON.stringify(workflow.snapshot()));
                },
            }));
        });
    ctx.logger?.info?.(`dsh-redteam loaded (planner concurrency ${config.plannerConcurrency ?? 3})`);
}
export { ArtexWorkflow } from './artex.js';
export { ReaRuntime } from './rea.js';
export { RedTeamStore } from './store.js';
export { TrafficRuntime } from './traffic.js';
