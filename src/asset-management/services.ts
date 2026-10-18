import type { RedTeamStore } from '../store.js';
import { AssetManagementRuntime } from './assets.js';
import { CompanyManagementRuntime } from './companies.js';
import { TaskAssetRuntime } from './task-assets.js';
import { ScopeSentryRuntime } from './scopesentry.js';
import type { ManagementOptions, ManagementServices } from './operations.js';
import { AssetManagementError } from './validation.js';

export function createAssetManagementServices(store:RedTeamStore,options:ManagementOptions={}):ManagementServices {
  const assets=new AssetManagementRuntime(store),companies=new CompanyManagementRuntime(store),tasks=new TaskAssetRuntime(store);
  const scopesentry=new ScopeSentryRuntime(options.scopeSentryPath??store.storagePath+'.scopesentry.json',{
    insertAssets:input=>assets.graph.insertAssets('global',input),
    upsertCompany:input=>companies.upsertFromSync(input),
    recomputeAttribution:()=>companies.reattribute(),
  });
  return {assets,companies,tasks:{
    catalog:()=>({tasks:store.snapshot().tasks.map(({id,title,status})=>({id,title,status}))}),
    attach:(taskId,input)=>{
      if(input.scope!==undefined){
        if(input.asset_ids?.length)throw new AssetManagementError('scope and asset_ids cannot be submitted together');
        return tasks.registerScopes(taskId,input.scope);
      }
      return tasks.attach(taskId,input.asset_ids??[],input.source_summary??'');
    },
    detach:(taskId,assetId)=>tasks.detach(taskId,assetId),
    intentAssets:taskId=>tasks.intentAssets(taskId),
    refs:(taskId,assetId)=>tasks.refs(taskId,assetId),
  },scopesentry:{
    configure:(input,signal)=>scopesentry.configure(input,signal),
    status:signal=>scopesentry.status(signal),
    projects:(input,signal)=>scopesentry.projects(input,signal),
    tasks:(input,signal)=>scopesentry.tasks(input,signal),
    sync:(input,signal)=>{
      const dimension=input.dimension;
      if(dimension!=='project'&&dimension!=='task')throw new AssetManagementError('dimension must be project or task');
      return scopesentry.sync({...input,dimension},signal);
    },
  },ready:Promise.all([store.load(),scopesentry.ready()]),dispose:()=>scopesentry.dispose()};
}
