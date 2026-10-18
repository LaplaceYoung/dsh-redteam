// Real packaged Desktop CLI verification in an isolated DSH_HOME.
// Usage: node scripts/verify-dsh-host.mjs [--serve-seconds 180]
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = process.env.DSH_VERIFY_CLI ?? join(process.env.LOCALAPPDATA ?? '', 'Programs', 'DeepSeek Harness', 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd');
if (!existsSync(cli)) throw new Error(`Installed DSH CLI not found: ${cli}`);
const args = process.argv.slice(2);
const serveSeconds = args[0] === '--serve-seconds' ? Number(args[1]) : 0;
if (!Number.isFinite(serveSeconds) || serveSeconds < 0 || serveSeconds > 1800) throw new Error('serve-seconds must be between 0 and 1800');
const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
const artifacts = join(project, 'docs', 'host-verification', runId);
const home = join(artifacts, 'home');
const env = { ...process.env, DSH_HOME: home, DSH_AGENTS_HOME: join(home, 'agents') };
await mkdir(artifacts, { recursive: true });
const report = { runId, cli, home, node: process.version, startedAt: new Date().toISOString(), steps: [], success: false };
let host;
let hostLog = '';
let hostEnded = false;
const quote = (value) => {
  if (/["\r\n%]/.test(value)) throw new Error('Unsupported Windows command argument');
  return `"${value}"`;
};
function launch(file, values, options = {}) {
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(file)) {
    return spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `"${[file, ...values].map(quote).join(' ')}"`], { cwd: project, env, windowsHide: true, windowsVerbatimArguments: true, ...options });
  }
  return spawn(file, values, { cwd: project, env, windowsHide: true, ...options });
}
async function run(label, file, values) {
  const child = launch(file, values);
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const code = await new Promise((accept, reject) => { child.on('error', reject); child.on('close', accept); });
  await writeFile(join(artifacts, `${label}.log`), output);
  report.steps.push({ label, code });
  if (code !== 0) throw new Error(`${label} failed (${code}); see ${join(artifacts, `${label}.log`)}`);
  return output;
}
async function stopHost() {
  if (!host || hostEnded) return;
  if (process.platform === 'win32') await new Promise((accept, reject) => {
    const stop = spawn('taskkill.exe', ['/PID', String(host.pid), '/T', '/F'], { windowsHide: true });
    stop.once('error', reject); stop.once('close', accept);
  });
  else host.kill('SIGTERM');
  await Promise.race([new Promise((accept) => host.once('close', accept)), delay(5000)]);
}
try {
  report.version = (await run('version', cli, ['--version'])).trim();
  await run('base-config', cli, ['--profile', 'redteam-verification', '--from-default-profile', 'web', '--dump-config']);
  const manifest = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'));
  const sidebarVersion = JSON.parse(await readFile(join(project, 'node_modules', 'dsh-better-sidebar', 'package.json'), 'utf8')).version;
  const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  await run('build', process.execPath, [npmCli, 'run', 'build']);
  const packed = JSON.parse(await run('package', process.execPath, [npmCli, 'pack', '--pack-destination', artifacts, '--json']));
  const tarball = join(artifacts, packed[0].filename);
  report.packageSHA256 = createHash('sha256').update(await readFile(tarball)).digest('hex');
  report.packageVersion = manifest.version;
  await run('install', cli, ['plugin', '--profile', 'redteam-verification', 'add', tarball, `dsh-better-sidebar@${sidebarVersion}`]);

  const probePath = join(artifacts, 'probe.mjs');
  await writeFile(probePath, `
export const name = 'redteam-host-verification';
export const inject = ['webServer', 'agentPresets', 'agents', 'tools', 'connection'];
export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({kind:'exact',path:'/api/redteam-host-verification',handler:async(req,res)=>{
    const admission=ctx.connection.admit(req);
    if ('rejection' in admission || admission.peer.principal.kind !== 'owner') {
      res.writeHead('rejection' in admission ? admission.rejection : 403);res.end();return;
    }
    let handle;
    try {
      const presets=await ctx.agentPresets.list();
      const selected=presets.find(p=>p.id==='redteam');
      if(!selected || selected.broken) {
        const record=ctx.agentPresets.definitions.get('redteam');
        throw new Error('redteam preset unavailable: '+JSON.stringify({selected,baseUrl:record?.context.baseUrl}));
      }
      handle=await ctx.agents.create({sessionId:'host-verification-'+Date.now(),meta:{cwd:${JSON.stringify(project)},agentPreset:'redteam'},setup:async(agentCtx)=>{await ctx.agentPresets.mount(agentCtx,'redteam');}});
      const toolNames=ctx.tools.schemas(handle.agent).map(t=>t.name);
      // Record the ordinary Agent scope's service visibility for diagnostics.
      // The redteam runtime is installed inside the delegation isolate, so
      // these services are intentionally not required on the outer Agent
      // context; the tool catalog below verifies the public Team/workflow
      // surfaces exposed to the live session.
      const agentTeamsService=handle.agent.ctx.get?.('agentTeams', false) ?? ctx.get?.('agentTeams', false);
      const workflowEngineService=handle.agent.ctx.get?.('workflowEngine', false) ?? ctx.get?.('workflowEngine', false);
      // Keep the real Agent alive while the authenticated workspace GET resolves
      // its sessionId through the installed Agent registry.
      const workspaceUrl=new URL('/api/redteam/task-workspace','http://'+req.headers.host);
      workspaceUrl.searchParams.set('sessionId',handle.agent.id);
      const workspaceResponse=await fetch(workspaceUrl,{headers:{Cookie:req.headers.cookie??'',Origin:workspaceUrl.origin},signal:AbortSignal.timeout(15000)});
      const workspace=await workspaceResponse.json();
      const response={presets,agentPreset:ctx.agentPresets.composedPreset(handle.agent.ctx),agentContextAgentTeamsAvailable:Boolean(agentTeamsService),agentContextWorkflowEngineAvailable:Boolean(workflowEngineService),redteamTools:toolNames.filter(n=>n.startsWith('redteam_')),allToolNames:toolNames,
        sessionId:handle.agent.id,agentOptions:{provider:handle.agent.options.provider??null,model:handle.agent.options.model??null},workspaceStatus:workspaceResponse.status,workspace};
      res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(response));
    } catch(error) {res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:String(error),stack:error.stack}));}
    finally {await handle?.dispose();}
  }}));
}
`);
  const overlay = join(artifacts, 'verify.patch.yml');
  await writeFile(overlay, JSON.stringify([{ insert: [{ id: 'redteam-host-verification', name: pathToFileURL(probePath).href }] }], null, 2));
  await run('composed-config', cli, ['--profile', 'redteam-verification', '--patch', overlay, '--dump-config']);
  host = launch(cli, ['--profile', 'redteam-verification', '--patch', overlay, '--no-open', '--port', '0']);
  host.on('close', () => { hostEnded = true; });
  host.stdout.on('data', (chunk) => { hostLog += chunk; });
  host.stderr.on('data', (chunk) => { hostLog += chunk; });
  let url;
  let browserUrl;
  for (let attempt = 0; attempt < 240; attempt++) {
    if (hostEnded) throw new Error('DSH host exited before becoming ready; see host.log');
    const matches = [...hostLog.matchAll(/http:\/\/(?:127\.0\.0\.1|localhost):\d+/g)];
    if (matches.length) {
      const candidate = matches.at(-1)[0];
      try { const status=(await fetch(`${candidate}/api/redteam/snapshot`, { signal: AbortSignal.timeout(1000) })).status; if (status===200 || status===401) { url = candidate; break; } } catch {}
    }
    await delay(250);
  }
  if (!url) throw new Error('DSH host did not become ready; see host.log');
  report.url = url;
  report.unauthenticated = {};
  for (const path of ['/api/redteam/snapshot', '/api/redteam/task-workspace', '/api/redteam/interception/settings', '/api/redteam/system/settings', '/api/redteam/asset-management/assets', '/api/redteam/observability/settings', '/api/redteam/conversations', '/api/redteam/platform/contract', '/api/redteam/host/health', '/api/redteam-host-verification']) {
    const response = await fetch(`${url}${path}`, { signal: AbortSignal.timeout(10000) });
    report.unauthenticated[path] = response.status;
    if (response.status !== 401) throw new Error(`Unauthenticated plugin route must return 401: ${path} returned ${response.status}`);
  }
  browserUrl = [...hostLog.matchAll(/http:\/\/(?:127\.0\.0\.1|localhost):\d+[^\s\x1b]*/g)].at(-1)?.[0] ?? url;
  await writeFile(join(artifacts, 'browser-url.txt'), browserUrl);
  const admission = await fetch(browserUrl, { redirect: 'manual' });
  const cookie = admission.headers.getSetCookie().map((value) => value.split(';', 1)[0]).join('; ');
  const headers = { Cookie: cookie, Origin: url };
  const pageResponse = await fetch(url, { headers });
  report.pageStatus = pageResponse.status;
  const html = await pageResponse.text();
  await writeFile(join(artifacts, 'host-page.html'), html);
  if (pageResponse.status !== 200) throw new Error(`Host HTML failed: HTTP ${pageResponse.status}`);
  const snapshotResponse = await fetch(`${url}/api/redteam/snapshot`, { headers });
  report.snapshotStatus = snapshotResponse.status;
  const snapshot = await snapshotResponse.json();
  if (!snapshotResponse.ok || !Array.isArray(snapshot.tasks)) throw new Error(`Plugin snapshot route failed: ${JSON.stringify(snapshot)}`);
  await writeFile(join(artifacts, 'snapshot.json'), JSON.stringify(snapshot, null, 2));
  const probeResponse = await fetch(`${url}/api/redteam-host-verification`, { headers });
  report.probeStatus = probeResponse.status;
  const probe = await probeResponse.json();
  await writeFile(join(artifacts, 'preset-probe.json'), JSON.stringify(probe, null, 2));
  if (!probeResponse.ok || probe.agentPreset !== 'redteam') throw new Error(`Real preset activation failed: ${JSON.stringify(probe)}`);
  const requiredRedteamTools = [
    'create_task', 'start_worker', 'start_planner', 'planner_status', 'rea_native_manifest', 'rea_native', 'rea_native_prompt',
    'get_task_concurrency', 'list_model_profiles', 'graph_overview', 'insert_assets', 'finding_query', 'finding_retests',
    'platform_agents', 'platform_prompts', 'platform_tools', 'platform_mcp', 'platform_skills', 'platform_triggers',
    'list_intercept_rules', 'get_approval', 'traffic_stats',
  ].map(name => `redteam_${name}`);
  // Agent Team package names the cancellation tool `interrupt_agent` (the
  // legacy subagent-control package has a different `interrupt_agent` export
  // as well); there is no public `interrupt` tool in the installed host.
  const requiredDshTools = ['spawn_teammate', 'send_message', 'list_agents', 'wait_agent', 'interrupt_agent'];
  const missingTools = [...requiredRedteamTools, ...requiredDshTools, 'subagent', 'subagent_fork', 'workflow'].filter(name => !probe.allToolNames.includes(name));
  report.requiredTools = [...requiredRedteamTools, ...requiredDshTools, 'subagent', 'subagent_fork', 'workflow'];
  if (missingTools.length) throw new Error(`Real preset is missing required tools: ${missingTools.join(', ')}`);
  const workspace = probe.workspace;
  if (probe.workspaceStatus !== 200 || workspace.version !== 1 || !Array.isArray(workspace.tasks) || !Array.isArray(workspace.profiles) || !Array.isArray(workspace.catalog?.providers) || workspace.agent?.sessionId !== probe.sessionId) {
    throw new Error(`Authenticated task workspace GET failed: ${JSON.stringify({ status: probe.workspaceStatus, workspace })}`);
  }
  if ((workspace.agent.provider ?? null) !== probe.agentOptions.provider || (workspace.agent.model ?? null) !== probe.agentOptions.model || workspace.agent.error === '当前 Agent 会话未运行') {
    throw new Error(`Task workspace did not resolve the live probe Agent: ${JSON.stringify(workspace.agent)}`);
  }
  report.workspaceStatus = probe.workspaceStatus;
  await writeFile(join(artifacts, 'task-workspace.json'), JSON.stringify(workspace, null, 2));
  report.presets = probe.presets;
  report.redteamTools = probe.redteamTools;
  report.agentContextAgentTeamsAvailable = probe.agentContextAgentTeamsAvailable;
  report.agentContextWorkflowEngineAvailable = probe.agentContextWorkflowEngineAvailable;
  report.success = true;
  console.log(JSON.stringify({ url, browserUrlFile: join(artifacts, 'browser-url.txt'), artifacts, preset: probe.agentPreset, toolCount: probe.redteamTools.length, serveSeconds }));
  if (serveSeconds) await delay(serveSeconds * 1000);
} catch (error) {
  report.error = String(error);
  process.exitCode = 1;
  console.error(report.error);
} finally {
  await stopHost();
  await writeFile(join(artifacts, 'host.log'), hostLog);
  report.finishedAt = new Date().toISOString();
  report.hostStopped = !host || hostEnded;
  // Only this invocation's generated profile/home is removed; diagnostic artifacts stay reviewable.
  const relativeHome = resolve(home).startsWith(`${resolve(artifacts)}${process.platform === 'win32' ? '\\' : '/'}`);
  if (!relativeHome) throw new Error('Refusing cleanup outside verification artifacts');
  await rm(home, { recursive: true, force: true });
  report.profileRemoved = !existsSync(home);
  await writeFile(join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`Verification report: ${join(artifacts, 'report.json')}`);
}
