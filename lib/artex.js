import { directSourceTasks, recordsWithDirectSources } from './task-management/index.js';
export class ArtexWorkflow {
    store;
    createManagedTask;
    constructor(store, createManagedTask = input => store.createManagedTask(input)) {
        this.store = store;
        this.createManagedTask = createManagedTask;
    }
    async createTask(title, goal, options = {}) {
        const task = await this.createManagedTask({ ...options, ...(title === undefined ? {} : { title }), ...(goal === undefined ? {} : { goal }) });
        await this.store.addTrace({ taskId: task.id, worker: 'mainagent', kind: 'start', summary: `任务创建：${task.title || task.description}` });
        return task;
    }
    async plan(taskId, summary, input = {}) {
        const intent = await this.store.addIntent({ taskId, summary, input });
        await this.store.addTrace({ taskId, intentId: intent.id, worker: 'planner', kind: 'result', summary: `Planner 生成意图：${summary}`, data: input });
        return intent;
    }
    async claim(taskId, worker) {
        return this.store.claimIntent(taskId, worker);
    }
    async finish(intentId, output) {
        const current = this.store.snapshot().intents.find((item) => item.id === intentId);
        if (!current)
            throw new Error(`intent not found: ${intentId}`);
        const result = await this.store.updateIntent(intentId, { state: 'done', output });
        await this.store.addTrace({ taskId: current.taskId, intentId, worker: current.worker ?? 'worker', kind: 'result', summary: `Worker 完成：${current.summary}`, data: output });
        return result;
    }
    async stop(intentId, state = 'paused') {
        const current = this.store.snapshot().intents.find((item) => item.id === intentId);
        if (!current)
            throw new Error(`intent not found: ${intentId}`);
        const result = await this.store.updateIntent(intentId, { state });
        await this.store.addTrace({ taskId: current.taskId, intentId, worker: current.worker ?? 'worker', kind: 'result', summary: `Worker ${state === 'paused' ? '暂停' : '停止'}：${current.summary}` });
        return result;
    }
    async steer(intentId, message) {
        const current = this.store.snapshot().intents.find((item) => item.id === intentId);
        if (!current)
            throw new Error(`intent not found: ${intentId}`);
        await this.store.addTrace({ taskId: current.taskId, intentId, worker: current.worker ?? 'worker', kind: 'tool', summary: `Worker steering: ${message}`, data: { message } });
        return current;
    }
    snapshot(taskId) {
        const state = this.store.snapshot();
        state.notificationChannels = state.notificationChannels.map((channel) => ({ ...channel, config: maskNotificationConfig(channel.kind, channel.config) }));
        if (!taskId)
            return state;
        return {
            ...state,
            tasks: state.tasks.filter((item) => item.id === taskId),
            assets: state.assets.filter((item) => item.taskId === taskId),
            nodes: state.nodes.filter((item) => item.taskId === taskId),
            edges: state.edges.filter((item) => item.taskId === taskId),
            intents: state.intents.filter((item) => item.taskId === taskId),
            findings: state.findings.filter((item) => item.taskId === taskId),
            evidence: state.evidence.filter((item) => item.taskId === taskId),
            traces: state.traces.filter((item) => item.taskId === taskId),
            approvals: state.approvals.filter((item) => item.taskId === taskId),
            goals: state.goals.filter((item) => item.taskId === taskId),
            constraints: state.constraints.filter((item) => item.taskId === taskId),
            scopes: state.scopes.filter((item) => item.taskId === taskId),
            traffic: state.traffic.filter((item) => item.taskId === taskId),
            interceptRules: state.interceptRules.filter((item) => item.taskId === taskId),
            archives: state.archives.filter((item) => item.taskId === taskId),
            reports: state.reports.filter((item) => item.taskId === taskId),
            notificationChannels: state.notificationChannels,
            notificationEvents: state.notificationEvents.filter((item) => item.snapshot.taskId === taskId),
            notificationDeliveries: state.notificationDeliveries.filter((item) => state.notificationEvents.some((event) => event.id === item.eventId && event.snapshot.taskId === taskId)),
            companies: state.companies,
            taskAssetRules: state.taskAssetRules.filter(item => item.taskId === taskId)
        };
    }
    sourceContext(taskId) {
        const state = this.store.snapshot();
        const sources = directSourceTasks(state, taskId);
        const nodes = recordsWithDirectSources(state, taskId, state.nodes);
        const intents = recordsWithDirectSources(state, taskId, state.intents.map(intent => ({ ...intent, kind: 'intent' })));
        const visible = new Set(nodes.map(node => node.id));
        const edges = recordsWithDirectSources(state, taskId, state.edges).filter(edge => visible.has(edge.from) && visible.has(edge.to));
        const terminalSourceIntents = new Set(intents.filter(intent => intent.inherited).map(intent => intent.id));
        const traces = recordsWithDirectSources(state, taskId, state.traces).filter(trace => !trace.inherited || (trace.intentId && terminalSourceIntents.has(trace.intentId)));
        return { sources, nodes, edges, intents, traces, assets: recordsWithDirectSources(state, taskId, state.assets), findings: recordsWithDirectSources(state, taskId, state.findings), evidence: recordsWithDirectSources(state, taskId, state.evidence) };
    }
}
import { maskNotificationConfig } from './notifications.js';
