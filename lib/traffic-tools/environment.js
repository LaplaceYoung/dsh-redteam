import ShellExecutor from '@deepseek-ai/dsh-shell';
import * as bashTool from '@deepseek-ai/dsh-tool-bash';
import * as pwshTool from '@deepseek-ai/dsh-tool-pwsh';
/** Install the official shell tool against a private delegating executor.
 * shellEnv owns only DSH_* facts; DSH_SESSION_ID is generated from exec.agent.
 * Ordinary proxy/CA variables belong to ShellExecSpec.env, not that registry.
 */
export function installTrafficEnvironment(ctx, store, traffic) {
    ctx.inject(['shell', 'shellEnv'], shellOwner => mountTrafficShell(shellOwner, store, traffic));
}
async function mountTrafficShell(ctx, store, traffic) {
    await traffic.load();
    const upstream = ctx.shell;
    const shellCtx = ctx.isolate('shell');
    class TrafficShell extends ShellExecutor {
        get sandboxMode() { return upstream.sandboxMode; }
        resolve(request) { return upstream.resolve(request); }
        execute(spec) {
            const sessionId = spec.dshEnv?.DSH_SESSION_ID;
            const intent = sessionId ? store.snapshot().intents.find(row => row.execution?.childSessionId === sessionId) : undefined;
            if (!intent)
                return upstream.execute(spec);
            const environment = traffic.workerEnvironment(intent.taskId, sessionId);
            return upstream.execute(Object.keys(environment).length ? { ...spec, env: { ...spec.env, ...environment } } : spec);
        }
    }
    await shellCtx.plugin(TrafficShell);
    await shellCtx.plugin(process.platform === 'win32' ? pwshTool : bashTool);
}
