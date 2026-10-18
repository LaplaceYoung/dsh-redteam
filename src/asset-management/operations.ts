import type { AssetManagementRuntime } from './assets.js';
import { arrayField, AssetManagementError, booleanField, idsField, numberField, textField } from './validation.js';

export interface ManagementServices {
  assets: AssetManagementRuntime;
  companies: {
    list():unknown;get(id:string):unknown;
    create(input:{name:string;logo?:string;scope?:unknown[]}):Promise<unknown>;
    scope(id:string,input:{scope:unknown[];reset?:boolean;reason?:string}):Promise<unknown>;
    delete(id:string,deleteAssets:boolean):Promise<unknown>;reattribute():Promise<unknown>;
  };
  tasks: {
    catalog():unknown;
    attach(taskId:string,input:{asset_ids?:string[];source_summary?:string;scope?:unknown[]}):Promise<unknown>;
    detach(taskId:string,assetId:string):Promise<unknown>;
    intentAssets(taskId:string):unknown;
    refs(taskId:string,assetId:string):unknown;
  };
  scopesentry: {
    status(signal?:AbortSignal):Promise<unknown>;
    projects(input:{page?:number;size?:number;search?:string},signal?:AbortSignal):Promise<unknown>;
    tasks(input:{page?:number;size?:number;search?:string},signal?:AbortSignal):Promise<unknown>;
    sync(input:{dimension:string;targets:string[];asset_types?:string[];create_company?:boolean;page_size?:number},signal?:AbortSignal):Promise<unknown>;
    configure(input:{url?:string;api_key?:string;enabled?:boolean},signal?:AbortSignal):Promise<unknown>;
  };
  ready:Promise<unknown>;
  dispose():Promise<void>;
}
export interface ManagementOptions { scopeSentryPath?:string; onTaskMutation?:(taskId:string)=>void|Promise<void> }
export type ManagementResource='assets'|'companies'|'task-assets'|'scopesentry';

export async function executeManagement(services:ManagementServices,resource:ManagementResource,action:string,input:Record<string,unknown>,signal:AbortSignal,options:ManagementOptions={}) {
  await services.ready;signal.throwIfAborted();
  const id=()=>textField(input,'id',true)!;
  switch(resource){
    case 'assets':switch(action){
      case 'list':return services.assets.list({type:textField(input,'type'),dsl:textField(input,'dsl'),task_id:textField(input,'task_id'),company_id:textField(input,'company_id'),limit:numberField(input,'limit'),offset:numberField(input,'offset')});
      case 'get':return services.assets.get(id());
      case 'counts':return services.assets.counts(textField(input,'task_id'));
      case 'upsert':{const taskId=textField(input,'task_id')??'global';const result=await services.assets.insert(arrayField(input,'assets',true)!,taskId);if(taskId!=='global'&&result.results.length)await options.onTaskMutation?.(taskId);return result;}
      case 'delete':return services.assets.delete(idsField(input,'ids',true)!);
    }break;
    case 'companies':switch(action){
      case 'list':return services.companies.list();
      case 'get':return services.companies.get(id());
      case 'create':return services.companies.create({name:textField(input,'name',true)!,logo:textField(input,'logo'),scope:arrayField(input,'scope')});
      case 'scope':return services.companies.scope(id(),{scope:arrayField(input,'scope',true)!,reset:booleanField(input,'reset'),reason:textField(input,'reason')});
      case 'delete':return services.companies.delete(id(),booleanField(input,'delete_assets')??false);
      case 'reattribute':return services.companies.reattribute();
    }break;
    case 'task-assets':{
      if(action==='catalog')return services.tasks.catalog();
      const taskId=textField(input,'task_id',true)!;
      if(action==='list')return services.assets.list({task_id:taskId,type:textField(input,'type'),dsl:textField(input,'dsl'),limit:numberField(input,'limit'),offset:numberField(input,'offset')});
      if(action==='refs'){const assetId=textField(input,'asset_id');return assetId?services.tasks.refs(taskId,assetId):services.tasks.intentAssets(taskId);}
      if(action==='attach'||action==='detach'){
        const result=action==='attach'?await services.tasks.attach(taskId,{asset_ids:idsField(input,'asset_ids'),source_summary:textField(input,'source_summary'),scope:arrayField(input,'scope')}):await services.tasks.detach(taskId,textField(input,'asset_id',true)!);
        await options.onTaskMutation?.(taskId);return result;
      }
    }break;
    case 'scopesentry':switch(action){
      case 'status':return services.scopesentry.status(signal);
      case 'projects':case 'tasks':return services.scopesentry[action]({page:numberField(input,'page'),size:numberField(input,'size'),search:textField(input,'search')},signal);
      case 'configure':return services.scopesentry.configure({url:textField(input,'url'),api_key:textField(input,'api_key'),enabled:booleanField(input,'enabled')},signal);
      case 'sync':return services.scopesentry.sync({dimension:textField(input,'dimension',true)!,targets:idsField(input,'targets',true)!,asset_types:idsField(input,'asset_types'),create_company:booleanField(input,'create_company'),page_size:numberField(input,'page_size')},signal);
    }break;
  }
  throw new AssetManagementError(`Unknown ${resource} action: ${action}`,404);
}
