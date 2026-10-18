export class HostManagementError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
export class EngineActivity {
    now;
    calls = new Map();
    touched = new Map();
    constructor(now = Date.now) {
        this.now = now;
    }
    touch(taskId) { this.touched.set(taskId, this.now()); }
    begin(taskId) {
        this.calls.set(taskId, (this.calls.get(taskId) ?? 0) + 1);
        this.touch(taskId);
        let done = false;
        return () => { if (done)
            return; done = true; const count = this.calls.get(taskId) - 1; if (count)
            this.calls.set(taskId, count);
        else
            this.calls.delete(taskId); this.touch(taskId); };
    }
    stats(state, taskId, configured, trafficEnabled) {
        const counts = {};
        for (const asset of state.assets)
            counts[asset.kind] = (counts[asset.kind] ?? 0) + 1;
        const result = { engine_mode: 'idle', llm_configured: configured, traffic: state.traffic.length, traffic_enabled: trafficEnabled, assets: state.assets.length, asset_counts: counts, tasks: state.tasks.length };
        if (!taskId)
            return result;
        const task = state.tasks.find(row => row.id === taskId);
        if (!task)
            throw new HostManagementError(404, 'task not found');
        const intents = state.intents.filter(row => row.taskId === taskId), goals = state.goals.filter(row => row.taskId === taskId && row.state !== 'deleted');
        const activeCalls = this.calls.get(taskId) ?? 0, inFlight = intents.filter(row => row.state === 'running').length;
        const persistedActivity = Math.max(Date.parse(task.updatedAt), ...intents.map(row => Date.parse(row.updatedAt)), ...state.traces.filter(row => row.taskId === taskId).map(row => Date.parse(row.createdAt)));
        const last = Math.max(this.touched.get(taskId) ?? 0, persistedActivity), paused = task.status === 'paused', running = task.status === 'running' && configured;
        const stalled = running && activeCalls === 0 && inFlight > 0 && this.now() - last > 120000;
        const mode = paused ? 'paused' : stalled ? 'stalled' : running && activeCalls > 0 ? 'exploring' : 'idle';
        const byState = {};
        for (const intent of intents)
            byState[intent.state] = (byState[intent.state] ?? 0) + 1;
        result.engine_mode = mode;
        result.exploration = { intents: intents.length, intent_states: byState, findings: state.findings.filter(row => row.taskId === taskId).length, evidence: state.evidence.filter(row => row.taskId === taskId).length };
        result.active_task = { id: task.id, description: task.description ?? task.title, goal: task.goal, running, paused, engine_mode: mode, in_flight: inFlight, llm_in_flight: activeCalls, last_activity: Math.floor(last / 1000), stalled, goals_total: goals.length, goals_met: goals.filter(row => row.state === 'met').length };
        return result;
    }
}
