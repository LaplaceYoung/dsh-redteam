import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { Context } from '@deepseek-ai/cordis';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import AgentPresets from '@deepseek-ai/dsh-agent-preset-registry';
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session';
import Agents from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import Projections from '@deepseek-ai/dsh-session-projection';
import * as Persistence from '@deepseek-ai/dsh-session-persistence-jsonl';
import SessionQuery from '@deepseek-ai/dsh-session-query-sqlite';

const buildDir = await mkdtemp(resolve('.tmp-conversation-host-'));
after(() => rm(buildDir, {recursive: true, force: true}));
const bundle = join(buildDir, 'bundle.mjs');
await build({ stdin: { contents: `export * from './src/conversation-workspace/host.ts'; export {installPlatform} from './src/platform/index.ts'; export {RedTeamStore} from './src/store.ts';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: bundle });
const host = await import(pathToFileURL(bundle).href);
const presetModule = join(buildDir, 'preset.mjs');
await writeFile(presetModule, `
import {defineTool} from '@deepseek-ai/dsh-tools';
import {RedTeamStore, installPlatform, registerConversationPreset, getConversationWorkspace} from ${JSON.stringify(pathToFileURL(bundle).href)};
export const name='conversation-host-fixture';
export const inject=['tools','llm','agents','systemPrompt'];
export async function apply(ctx, config) {
 const store=new RedTeamStore(config.storagePath); await store.load();
 ctx.tools.register(defineTool({name:'conversation_native_probe',description:'Actual preset scoped capability',parameters:{},output:{schema:{type:'json'},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},execute:()=>({revision:config.revision})}));
 const profiles={resolveProfile:()=>null,resolveBinding:()=>null,resolveGlobal:()=>({provider:'fixture',model:'native'})};
 const platform=await installPlatform(ctx,store,{schedulerIntervalMs:0});
 registerConversationPreset(ctx,store,{profiles,prepareRun:platform.prepareRun,resolveAgent:key=>platform.agents.list().some(row=>row.key===key),resolveAgentProfile:()=>null});
 await getConversationWorkspace(ctx,store,{onError:error=>ctx.root.emit('conversation-host/test-error',error)});
}
`);
class Adapter extends LlmAdapter {
  requests=[]; calls=new Map();
  async resolveModel(provider, model) {return {provider,id:model,name:model,context:{contextWindow:200000}};}
  async *stream(request) {
    this.requests.push(request);
    const count=this.calls.get(request.sessionId)??0;this.calls.set(request.sessionId,count+1);
    if(count%2===0) {yield {type:'tool-call-delta',index:0,id:randomUUID(),name:'conversation_native_probe',argumentsDelta:'{}'};yield {type:'finish',reason:{kind:'tool-calls'}};}
    else {yield {type:'text-delta',index:0,text:'native complete'};yield {type:'finish',reason:{kind:'stop'}};}
  }
}
async function fixture(t) {
  const dir=await mkdtemp(join(tmpdir(),'conversation-host-')),app=new Context(),fibers=[],handles=[],adapter=new Adapter(),errors=[];
  app.on('conversation-host/test-error',error=>{errors.push(error);});
  const store=new host.RedTeamStore(join(dir,'store.json'));await store.load();
  const unregister=[];
  t.after(async()=>{
    for(const handle of handles.reverse())try{await handle.dispose();}catch(error){errors.push(error);}
    try{await host.disposeConversationWorkspace(app,store);}catch(error){errors.push(error);}
    for(const remove of unregister.reverse())try{await remove();}catch(error){errors.push(error);}
    for(const fiber of fibers.reverse())try{await fiber.dispose();}catch(error){errors.push(error);}
    if(errors.length)throw new AggregateError(errors,'host fixture cleanup failed');
    await rm(dir,{recursive:true,force:true});
  });
  for(const [module,config] of [[SessionStore],[Agents],[LlmRuntime],[SystemPrompt,{}],[ToolRuntime,{mode:'native'}],[Projections],[Persistence,{root:join(dir,'native')}],[SessionQuery,{path:':memory:',openAt:'never'}],[AgentLoop,{}],[Loader,{baseUrl:pathToFileURL(buildDir+'/').href}],[AgentPresets,{default:'redteam'}]])fibers.push(await app.plugin(module,config));
  fibers.push(await app.plugin(ctx=>{ctx.inject(['llm'],inner=>{inner.llm.registerAdapter(['fixture'],adapter);});}));
  const register=async revision=>{const remove=await app.get('agentPresets').register({id:'redteam',plugins:[{id:'capabilities',name:pathToFileURL(presetModule).href,config:{storagePath:store.storagePath,revision}}]});unregister.push(remove);assert.equal((await app.get('agentPresets').resolve('redteam')).broken,undefined);return remove;};
  return{app,store,adapter,handles,register,errors};
}

test('UI-first workspace uses the real redteam preset and outlives unrelated Agent scopes', {timeout:30000}, async t=>{
  const f=await fixture(t);
  const workspace=await host.getConversationWorkspace(f.app,f.store,{onError:error=>f.errors.push(error)});
  assert.equal(f.app.get('agents').list().length,0,'UI initialization does not start a dummy Agent');
  await f.register('one');
  const first=await f.app.get('agents').create({sessionId:SessionId(randomUUID()),setup:ctx=>f.app.get('agentPresets').mount(ctx,'redteam').then(()=>{})});f.handles.push(first);
  assert.equal(await host.getConversationWorkspace(first.agent.ctx,new host.RedTeamStore(f.store.storagePath)),workspace);
  await first.dispose();
  const record=await workspace.conversations.create({agentKey:'mainagent'});
  const agent=f.app.get('agents').get(SessionId(record.sessionId));
  assert.equal(f.app.get('agentPresets').composedPreset(agent.ctx),'redteam');
  assert.equal(f.app.get('sessionProjections').stateOf(agent.session,'agentPreset'),'redteam');
  assert.equal(host.isConversationWorkspaceAgent(agent),true);
  assert.ok(f.app.get('tools').get('conversation_native_probe',agent));
  await workspace.conversations.send(record.id,'Execute the native capability');await workspace.conversations.wait(record.id);
  const events=(await workspace.conversations.messages(record.id,0,1000)).events;
  assert.ok(events.some(event=>event.type==='tool/result'&&JSON.stringify(event.data).includes('one')));
  assert.ok(f.adapter.requests[0].tools.some(tool=>tool.name==='conversation_native_probe'));
  assert.equal((await workspace.conversations.list()).length,1);
});

test('preset-first initialization avoids recursive activation and retains revision across hot replacement', {timeout:30000}, async t=>{
  const f=await fixture(t),remove=await f.register('old');
  const workspace=await host.getConversationWorkspace(f.app,f.store);
  const old=await workspace.conversations.create({agentKey:'mainagent'});
  await remove();await f.register('new');
  await workspace.conversations.send(old.id,'Use retained revision');await workspace.conversations.wait(old.id);
  const oldEvents=(await workspace.conversations.messages(old.id,0,1000)).events;
  assert.ok(oldEvents.some(event=>event.type==='tool/result'&&JSON.stringify(event.data).includes('old')));
  const fresh=await workspace.conversations.create({agentKey:'mainagent'});
  await workspace.conversations.send(fresh.id,'Use new revision');await workspace.conversations.wait(fresh.id);
  const freshEvents=(await workspace.conversations.messages(fresh.id,0,1000)).events;
  assert.ok(freshEvents.some(event=>event.type==='tool/result'&&JSON.stringify(event.data).includes('new')));
  assert.equal(await host.getConversationWorkspace(f.app,f.store),workspace);
});
