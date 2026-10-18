import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {build} from 'esbuild';
const built=await build({stdin:{contents:"export {installAssetManagementHttp} from './src/asset-management/http.ts'; export {RedTeamStore} from './src/store.ts';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'esm',packages:'external'});
const code=built.outputFiles[0].text.replace(/from\s+(["'])([^"']+)\1/g,(_m,_q,s)=>`from ${JSON.stringify(import.meta.resolve(s))}`);
const {installAssetManagementHttp,RedTeamStore}=await import(`data:text/javascript;base64,${Buffer.from(code+'\n//# sourceURL=asset-management-http-test.bundle.mjs').toString('base64')}`);
async function fixture(t){
  const dir=await mkdtemp(join(tmpdir(),'asset-http-')),store=new RedTeamStore(join(dir,'state.json'));await store.load();let handler;
  const notified=[];
  const installed=installAssetManagementHttp({webServer:{register:route=>{handler=route.handler;return()=>{};}}},store,{authenticate:req=>req.headers['x-owner']==='yes'?true:req.headers['x-owner']?403:401,onTaskMutation:id=>{notified.push(id);}});
  await installed.ready;
  const server=createServer((req,res)=>void handler(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`,base=origin+'/api/redteam/asset-management';
  t.after(async()=>{await installed.dispose();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
  const request=async(path,method='GET',body,headers={})=>{const response=await fetch(base+path,{method,headers:{'x-owner':'yes',...(body===undefined?{}:{'content-type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
  return {store,installed,base,origin,request,notified};
}

test('owner HTTP rejects unauthenticated, non-owner, cross-origin and malformed writes before mutation',async t=>{
  const f=await fixture(t);
  const missing=await fetch(f.base+'/assets');assert.equal(missing.status,401);
  assert.equal((await f.request('/assets','GET',undefined,{'x-owner':'guest'})).status,403);
  assert.equal((await f.request('/assets','POST',{assets:[{type:'root_domain',domain:'blocked.example'}]},{origin:'http://untrusted.invalid'})).status,403);
  const malformed=await fetch(f.base+'/assets',{method:'POST',headers:{'x-owner':'yes','content-type':'application/json'},body:'{"assets":[]} trailing'});assert.equal(malformed.status,400);
  assert.equal((await f.request('/assets','DELETE',{})).status,400);
  assert.equal((await f.request('/tasks/missing/assets','POST',{asset_ids:['x'],source_summary:'x'.repeat(512*1024)})).status,413);
  assert.equal(f.store.snapshot().assets.length,0);
  assert.equal((await f.request('/assets/unknown')).status,404);
});

test('owner HTTP performs global upsert, company attribution, task membership and explicit delete',async t=>{
  const f=await fixture(t),task=await f.store.createTask('HTTP task','Local fixture');
  assert.deepEqual((await f.request('/tasks')).body.tasks.map(row=>({id:row.id,title:row.title})),[{id:task.id,title:'HTTP task'}]);
  const created=await f.request('/assets','POST',{assets:[{type:'root_domain',domain:'managed.example',icp:'old'}]});assert.equal(created.status,200,JSON.stringify(created.body));
  const id=created.body.results[0].id;
  const updated=await f.request('/assets','POST',{assets:[{type:'root_domain',domain:'managed.example',icp:'new'}]});assert.equal(updated.body.results[0].id,id);
  const company=await f.request('/companies','POST',{name:'HTTP Company',scope:['managed.example']});assert.equal(company.status,201,JSON.stringify(company.body));
  const listing=await f.request(`/assets?company_id=${encodeURIComponent(company.body.id)}`);assert.equal(listing.body.assets[0].id,id);
  assert.equal((await f.request('/companies/reattribute','POST')).status,200,'reattribution accepts an empty POST body like the original server');
  const attach=await f.request(`/tasks/${task.id}/assets`,'POST',{asset_ids:[id],source_summary:'Operator attached'});assert.equal(attach.status,200,JSON.stringify(attach.body));
  assert.equal((await f.request(`/tasks/${task.id}/assets`)).body.assets[0].task_source_summary,'Operator attached');
  assert.deepEqual(f.notified,[task.id]);
  assert.equal((await f.request(`/tasks/${task.id}/assets/${id}`,'DELETE')).status,200);
  assert.equal((await f.request(`/tasks/${task.id}/assets`)).body.total,0);
  assert.equal((await f.request('/assets/'+id)).status,200,'detach must keep global asset');
  assert.equal((await f.request('/companies/'+company.body.id,'DELETE',{delete_assets:false})).status,200);
  assert.equal((await f.request('/assets/'+id)).status,200);
  assert.deepEqual((await f.request('/assets','DELETE',{ids:[id]})).body,{deleted:1});
});
