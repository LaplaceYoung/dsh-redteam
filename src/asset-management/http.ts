import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-host-webserver';
import type { RedTeamStore } from '../store.js';
import { createAssetManagementServices } from './services.js';
import { executeManagement, type ManagementOptions, type ManagementResource } from './operations.js';
import { AssetManagementError, object } from './validation.js';

export interface AssetManagementHttpOptions extends ManagementOptions {
  authenticate(request:IncomingMessage):boolean|401|403|Promise<boolean|401|403>;
}
function respond(response:ServerResponse,status:number,value:unknown){response.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});response.end(JSON.stringify(value));}
async function readBody(request:IncomingMessage,limit:number,optional=false){
  let size=0;const chunks:Buffer[]=[];
  for await(const chunk of request.iterator({destroyOnReturn:false})){const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=bytes.length;if(size>limit){request.resume();throw new AssetManagementError('Request body is too large',413);}chunks.push(bytes);}
  if(size===0&&optional)return {};
  if(!request.headers['content-type']?.toLowerCase().startsWith('application/json'))throw new AssetManagementError('Content-Type must be application/json',415);
  let value:unknown;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new AssetManagementError('Invalid JSON');}return object(value);
}
function queryInput(url:URL):Record<string,unknown>{
  const input:Record<string,unknown>={};for(const [key,value] of url.searchParams)input[key]=['limit','offset','page','size','page_size'].includes(key)?Number(value):value;return input;
}
function errorStatus(error:unknown):number{
  if(error&&typeof error==='object'){
    if('status'in error&&typeof error.status==='number'&&[400,401,403,404,409,413,415,422,502,503,504].includes(error.status))return error.status;
    if('statusCode'in error&&typeof error.statusCode==='number'&&[400,404,409,502,503,504].includes(error.statusCode))return error.statusCode;
    if('code'in error&&typeof error.code==='string')return ({invalid:400,not_found:404,forbidden:403,conflict:409,unavailable:503} as Record<string,number>)[error.code]??500;
  }return 500;
}
export function installAssetManagementHttp(ctx:Context,store:RedTeamStore,options:AssetManagementHttpOptions){
  if(typeof options.authenticate!=='function')throw new Error('Asset management HTTP requires owner authentication');
  const services=createAssetManagementServices(store,options),lifetime=new AbortController(),prefix='/api/redteam/asset-management';
  const unregister=ctx.webServer.register({kind:'prefix',path:prefix,handler:async(request,response)=>{
    const disconnected=new AbortController(),abort=()=>disconnected.abort(new Error('Asset management request disconnected'));
    const closed=()=>{if(!response.writableEnded)abort();};
    request.once('aborted',abort);response.once('close',closed);
    try{
      const admission=await options.authenticate(request);
      if(admission!==true){respond(response,admission===401?401:403,{error:admission===401?'Authentication required':'Owner access required'});return;}
      const url=new URL(request.url??'/','http://dsh.local');
      if(url.pathname!==prefix&&!url.pathname.startsWith(prefix+'/'))throw new AssetManagementError('Unknown asset management route',404);
      const path=url.pathname.slice(prefix.length).split('/').filter(Boolean).map(decodeURIComponent),[resource,id,action,assetId]=path;
      const method=request.method??'GET',mutating=['POST','PUT','DELETE'].includes(method);
      if(mutating&&request.headers.origin&&new URL(request.headers.origin).host!==request.headers.host)throw new AssetManagementError('Cross-origin mutation rejected',403);
      const input=mutating?await readBody(request,resource==='tasks'?512*1024:2*1024*1024,method==='DELETE'||resource==='scopesentry'&&id==='datasource'||resource==='companies'&&id==='reattribute'):queryInput(url);
      let target:ManagementResource|undefined,operation:string|undefined,status=200;
      if(resource==='assets'){
        target='assets';
        if(method==='GET'&&path.length===1)operation='list';
        else if(method==='GET'&&path.length===2){operation=id==='counts'?'counts':'get';if(operation==='get')input.id=id;}
        else if(method==='POST'&&path.length===1)operation='upsert';
        else if(method==='DELETE'&&path.length===1)operation='delete';
      }else if(resource==='companies'){
        target='companies';
        if(method==='GET'&&path.length===1)operation='list';
        else if(method==='GET'&&path.length===2){operation='get';input.id=id;}
        else if(method==='POST'&&path.length===1){operation='create';status=201;}
        else if(method==='POST'&&id==='reattribute'&&path.length===2)operation='reattribute';
        else if(method==='POST'&&action==='scope'&&path.length===3){operation='scope';input.id=id;}
        else if(method==='DELETE'&&path.length===2){operation='delete';input.id=id;}
      }else if(resource==='tasks'&&!id&&method==='GET'&&path.length===1){
        target='task-assets';operation='catalog';
      }else if(resource==='tasks'&&id){
        target='task-assets';input.task_id=id;
        if(method==='GET'&&action==='assets'&&path.length===3)operation='list';
        else if(method==='GET'&&action==='intent-assets'&&path.length===3)operation='refs';
        else if(method==='GET'&&action==='assets'&&assetId&&path[4]==='refs'&&path.length===5){operation='refs';input.asset_id=assetId;}
        else if(method==='POST'&&action==='assets'&&path.length===3)operation='attach';
        else if(method==='DELETE'&&action==='assets'&&assetId&&path.length===4){operation='detach';input.asset_id=assetId;}
      }else if(resource==='scopesentry'&&path.length===2){
        target='scopesentry';
        if(method==='GET'&&['status','projects','tasks'].includes(id))operation=id;
        else if(method==='POST'&&id==='datasource')operation='configure';
        else if(method==='POST'&&id==='sync')operation='sync';
      }
      if(!target||!operation)throw new AssetManagementError('Unknown asset management route',404);
      const result=await executeManagement(services,target,operation,input,AbortSignal.any([disconnected.signal,lifetime.signal]),options);
      respond(response,status,result);
    }catch(error){if(!response.destroyed&&!response.headersSent)respond(response,errorStatus(error),{error:error instanceof Error?error.message:String(error)});}
    finally{request.removeListener('aborted',abort);response.removeListener('close',closed);}
  }});
  return {...services,dispose:async()=>{lifetime.abort(new Error('Asset management HTTP disposed'));unregister();await services.dispose();}};
}
