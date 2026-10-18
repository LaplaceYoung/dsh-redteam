import type { RedTeamStore } from '../store.js';
import type { RedTeamSnapshot } from '../types.js';
import { assetTaskIds, associateTaskAsset } from '../shared-assets.js';
import { assetRow, compileAssetDSL, GraphAssetRuntime } from '../graph-tools/assets.js';
import { AssetManagementError } from './validation.js';

export interface AssetFilter { type?: string; dsl?: string; task_id?: string; company_id?: string; limit?: number; offset?: number }

/** Mirrors assets DELETE CASCADE for live anchors; finding evidence retains historical IDs. */
export function deleteAssetsInState(state: RedTeamSnapshot, ids: ReadonlySet<string>): number {
  const removed = new Set(state.assets.filter(asset => ids.has(asset.id)).map(asset => asset.id));
  state.assets = state.assets.filter(asset => !removed.has(asset.id));
  state.nodes = state.nodes.filter(node => node.kind !== 'asset' || !removed.has(node.id));
  state.edges = state.edges.filter(edge => edge.relation !== 'anchors' || !removed.has(edge.from) && !removed.has(edge.to));
  const clear = (data: Record<string, unknown>) => {
    for (const field of ['asset_ids', 'assetIds']) if (Array.isArray(data[field])) data[field] = data[field].filter(id => typeof id !== 'string' || !removed.has(id));
  };
  for (const node of state.nodes) if (node.kind !== 'asset') clear(node.data);
  for (const intent of state.intents) clear(intent.input);
  return removed.size;
}

function pagination(filter: AssetFilter): {limit:number;offset:number} {
  for(const key of ['limit','offset'] as const) if(filter[key]!==undefined&&!Number.isSafeInteger(filter[key]))throw new AssetManagementError(`${key} must be an integer`);
  return {limit:filter.limit===undefined||filter.limit<=0?50:Math.min(filter.limit,200),offset:Math.max(filter.offset??0,0)};
}
export class AssetManagementRuntime {
  readonly graph: GraphAssetRuntime;
  constructor(readonly store: RedTeamStore) { this.graph = new GraphAssetRuntime(store); }
  list(filter: AssetFilter = {}) {
    const {limit,offset}=pagination(filter), state=this.store.snapshot();
    for(const key of ['type','dsl','task_id','company_id'] as const) if(filter[key]!==undefined&&typeof filter[key]!=='string')throw new AssetManagementError(`${key} must be a string`);
    let predicate:ReturnType<typeof compileAssetDSL>|undefined;
    try{predicate=filter.dsl?compileAssetDSL(filter.dsl):undefined;}catch(error){throw new AssetManagementError(error instanceof Error?error.message:String(error));}
    const type=filter.type || (!predicate&&!filter.company_id&&!filter.task_id?'root_domain':undefined);
    const assets=state.assets.filter(asset=>{
      if(type&&asset.kind!==type)return false;
      const row=assetRow(asset,filter.task_id);
      if(predicate)return (!filter.task_id||assetTaskIds(asset).includes(filter.task_id))&&predicate(row);
      if(filter.company_id)return asset.companyId===filter.company_id;
      return !filter.task_id||assetTaskIds(asset).includes(filter.task_id);
    });
    const positions=new Map(state.assets.map((asset,index)=>[asset.id,index]));
    assets.sort((a,b)=>assetRow(b).last_seen.localeCompare(assetRow(a).last_seen)||positions.get(b.id)!-positions.get(a.id)!);
    const rows=assets.slice(offset,offset+limit).map(asset=>assetRow(asset,filter.task_id));
    return {count:rows.length,total:assets.length,assets:rows};
  }
  get(id:string) {
    const asset=this.store.snapshot().assets.find(row=>row.id===id);
    if(!asset)throw new AssetManagementError(`asset not found: ${id}`,404);
    return assetRow(asset);
  }
  counts(taskId?:string) {
    if(taskId!==undefined&&typeof taskId!=='string')throw new AssetManagementError('task_id must be a string');
    const result:Record<string,number>={};
    for(const asset of this.store.snapshot().assets)if(!taskId||assetTaskIds(asset).includes(taskId))result[asset.kind]=(result[asset.kind]??0)+1;
    return result;
  }
  async insert(assets:unknown[],taskId='global',source='api',summary='通过资产 API 登记') {
    if(typeof taskId!=='string'||!taskId.trim())throw new AssetManagementError('task_id must be a nonempty string');
    const result=await this.graph.insertAssets(taskId,assets);
    if(taskId!=='global'&&result.results.length)await this.store.transaction(state=>{
      const ids=new Set(result.results.map(row=>row.id));
      for(const asset of state.assets)if(ids.has(asset.id))associateTaskAsset(asset,taskId,{source,summary});
    });
    return result;
  }
  async delete(ids:string[]) {
    if(!Array.isArray(ids)||!ids.length||ids.some(id=>typeof id!=='string'||!id.trim()))throw new AssetManagementError('ids must be a nonempty array of asset IDs');
    return this.store.transaction(state=>({deleted:deleteAssetsInState(state,new Set(ids))}));
  }
}
