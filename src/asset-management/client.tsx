import React from 'react';
import { Button, Checkbox, Input, SegmentedTabs } from '@deepseek-ai/dsh-client-ui-primitives';
import type { TabComponentProps } from 'dsh-better-sidebar/client/service';
import { taskWorkspaceStyles } from '../task-workspace/styles.js';
import { request, type AssetView, type CompanyView } from './client-api.js';
import { CompanyPanel } from './company-panel.js';
import { TaskAssetPanel } from './task-panel.js';
import { ScopeSentryPanel } from './scopesentry-panel.js';

type View = 'assets' | 'companies' | 'tasks' | 'sync';
const kinds = { root_domain: '根域名', subdomain: '子域名', ip: 'IP', app: '应用', service: '服务', endpoint: '端点' };
type Kind = keyof typeof kinds;
const label = (asset: AssetView) => asset.url || asset.domain || asset.ip || asset.app_name || asset.id;
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const styles = `${taskWorkspaceStyles}.am-json{white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.6 var(--ds-font-family-code,monospace);max-height:320px;overflow:auto;margin:0}.am-select{min-width:0;max-width:100%}.am-assets{display:grid;gap:8px}.am-field{display:grid;gap:5px}.am-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.am-editor{display:grid;gap:10px}.am-editor textarea{min-height:100px;resize:vertical}.am-check{display:flex;gap:8px;align-items:flex-start}.am-label{overflow-wrap:anywhere;min-width:0;flex:1}.am-actions{display:flex;flex-wrap:wrap;gap:6px}`;

/** Native BetterSidebar tab. All changes use the owner-authenticated management routes. */
export function AssetManagementTab(props: TabComponentProps): React.ReactNode {
  const [view, setView] = React.useState<View>('assets'); const id = React.useId();
  return <section className="tw-root" aria-label="资产管理"><style>{styles}</style>
    <header className="tw-top"><h2>资产管理</h2></header>
    <div className="tw-toolbar"><SegmentedTabs label="资产管理视图" value={view} onChange={value => setView(value as View)} items={[
      { value: 'assets', label: '全局资产', id: `${id}-assets`, panelId: `${id}-assets-panel` },
      { value: 'companies', label: '公司范围', id: `${id}-companies`, panelId: `${id}-companies-panel` },
      { value: 'tasks', label: '任务资产', id: `${id}-tasks`, panelId: `${id}-tasks-panel` },
      { value: 'sync', label: 'ScopeSentry', id: `${id}-sync`, panelId: `${id}-sync-panel` },
    ]} /></div>
    <main className="tw-scroll" role="tabpanel" id={`${id}-${view}-panel`} aria-labelledby={`${id}-${view}`}>
      {props.visible !== false && (view === 'assets' ? <AssetsPanel /> : view === 'companies' ? <CompanyPanel /> : view === 'tasks' ? <TaskAssetPanel /> : <ScopeSentryPanel />)}
    </main>
  </section>;
}

function AssetsPanel() {
  const [type, setType] = React.useState('root_domain'), [dsl, setDsl] = React.useState(''), [search, setSearch] = React.useState(''), [company, setCompany] = React.useState(''), [page, setPage] = React.useState(0);
  const [data, setData] = React.useState<{total: number; assets: AssetView[]}>(), [companies, setCompanies] = React.useState<CompanyView[]>([]);
  const [selected, setSelected] = React.useState<string[]>([]), [editing, setEditing] = React.useState<AssetView | 'new'>(), [detail, setDetail] = React.useState<AssetView>();
  const [confirmDelete, setConfirmDelete] = React.useState(false), [busy, setBusy] = React.useState(false), [error, setError] = React.useState(''), [notice, setNotice] = React.useState('');
  const sequence = React.useRef(0), busyRef = React.useRef(false), life = React.useRef(new AbortController());
  React.useEffect(() => { const controller = new AbortController(); life.current = controller; return () => controller.abort(); }, []);
  const refresh = React.useCallback(async () => {
    const n = ++sequence.current;
    try {
      const params = new URLSearchParams({ type, limit: '30', offset: String(page * 30) });
      if (search) params.set('dsl', search); if (company && !search) params.set('company_id', company);
      const [rows, owners] = await Promise.all([request<{total: number; assets: AssetView[]}>(`assets?${params}`, { signal: life.current.signal }), request<CompanyView[]>('companies', { signal: life.current.signal })]);
      if (life.current.signal.aborted || n !== sequence.current) return;
      setData(rows); setCompanies(owners); setError(''); setSelected(current => current.filter(id => rows.assets.some(asset => asset.id === id)));
      if (page > 0 && page * 30 >= rows.total) setPage(Math.max(0, Math.ceil(rows.total / 30) - 1));
    } catch (failure) { if (!life.current.signal.aborted && n === sequence.current) setError(errorText(failure)); }
  }, [type, search, company, page]);
  React.useEffect(() => { void refresh(); }, [refresh]);
  async function change(work: () => Promise<unknown>, success: string) {
    if (busyRef.current) return false;
    busyRef.current = true; setBusy(true); setError(''); setNotice(''); ++sequence.current;
    try { await work(); if (life.current.signal.aborted) return false; setNotice(success); await refresh(); return true; }
    catch (failure) { if (!life.current.signal.aborted) setError(errorText(failure)); return false; }
    finally { busyRef.current = false; if (!life.current.signal.aborted) setBusy(false); }
  }
  return <div className="tw-stack">
    {error && <p role="alert" className="tw-notice">{error}</p>}{notice && <p role="status" className="tw-notice">{notice}</p>}
    <div className="am-toolbar"><Button size="sm" variant="primary" disabled={busy} onClick={() => setEditing('new')}>登记资产</Button><Button size="sm" disabled={busy} onClick={() => { void refresh(); }}>刷新</Button><span className="tw-muted">{data ? `共 ${data.total} 条` : '正在加载…'}</span></div>
    <form className="am-toolbar" onSubmit={event => { event.preventDefault(); setSearch(dsl); setPage(0); }}>
      <select aria-label="资产类型" disabled={busy} value={type} onChange={event => { setType(event.target.value); setPage(0); setSelected([]); }}>{Object.entries(kinds).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select>
      <select aria-label="按公司筛选" className="am-select" disabled={busy || !!search} value={company} onChange={event => { setCompany(event.target.value); setPage(0); }}><option value="">全部公司</option>{companies.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
      <Input aria-label="资产 DSL 筛选" value={dsl} onChange={event => setDsl(event.target.value)} placeholder='domain="example.com"' disabled={busy}/><Button size="sm" type="submit" disabled={busy}>筛选</Button>
    </form>
    {search && <p className="tw-muted">已应用 DSL 条件；公司下拉筛选在清空 DSL 后生效。</p>}
    {editing && <AssetEditor key={editing === 'new' ? 'new' : editing.id} asset={editing === 'new' ? undefined : editing} companies={companies} busy={busy} onCancel={() => setEditing(undefined)} onSave={async asset => {
      const ok = await change(async () => { const result = await request<{errors: {error:string}[]}>('assets', { method: 'POST', body: {assets:[asset]}, signal:life.current.signal }); if (result.errors.length) throw new Error(result.errors.map(row => row.error).join('\n')); }, '资产已保存');
      if (ok) setEditing(undefined); return ok;
    }}/>}
    {!!selected.length && <div className="tw-card tw-stack"><div className="am-toolbar"><span>已选择 {selected.length} 条资产</span><Button size="sm" disabled={busy} onClick={() => setConfirmDelete(true)}>批量删除</Button></div>{confirmDelete && <><p>确认删除这 {selected.length} 条全局资产？相关任务关联和实时锚点会移除，漏洞历史证据保留。</p><div className="am-actions"><Button size="sm" disabled={busy} onClick={() => { void change(() => request('assets', {method:'DELETE',body:{ids:selected},signal:life.current.signal}), '已删除所选资产').then(ok => { if(ok){setSelected([]);setConfirmDelete(false);setDetail(undefined);} }); }}>确认删除</Button><Button size="sm" disabled={busy} onClick={() => setConfirmDelete(false)}>取消</Button></div></>}</div>}
    <div className="am-assets">{data?.assets.length === 0 && <p className="tw-muted">没有符合条件的资产。</p>}{data?.assets.map(asset => <article key={asset.id} className="tw-card tw-stack">
      <div className="am-check"><Checkbox checked={selected.includes(asset.id)} disabled={busy} onChange={checked => {setConfirmDelete(false);setSelected(ids => checked === true ? [...ids, asset.id] : ids.filter(id => id !== asset.id));}} label={`选择资产 ${label(asset)}`}/><div className="am-label"><strong>{label(asset)}</strong><p className="tw-muted tw-small">{companies.find(row => row.id === asset.company_id)?.name ?? '未归属公司'} · {(asset.task_ids ?? []).length} 个任务</p></div></div>
      <div className="am-actions"><Button size="sm" disabled={busy} onClick={() => setEditing(asset)}>编辑</Button><Button size="sm" disabled={busy} onClick={() => {void change(async()=>setDetail(await request<AssetView>(`assets/${encodeURIComponent(asset.id)}`,{signal:life.current.signal})), '已读取资产详情');}}>详情</Button></div>
    </article>)}</div>
    <div className="am-toolbar"><Button size="sm" disabled={busy || page === 0} onClick={() => setPage(page - 1)}>上一页</Button><span>第 {page + 1} 页</span><Button size="sm" disabled={busy || !data || (page + 1) * 30 >= data.total} onClick={() => setPage(page + 1)}>下一页</Button></div>
    {detail && <section className="tw-card tw-stack"><div className="am-toolbar"><h3>资产详情</h3><Button size="sm" onClick={() => setDetail(undefined)}>关闭详情</Button></div><p className="tw-muted">资产 ID：{detail.id}</p><pre className="am-json">{JSON.stringify(detail,null,2)}</pre></section>}
  </div>;
}

function AssetEditor({asset,companies,busy,onCancel,onSave}:{asset?:AssetView;companies:CompanyView[];busy:boolean;onCancel():void;onSave(asset:Record<string,unknown>):Promise<boolean>}) {
  const [kind,setKind]=React.useState<Kind>(asset?.type as Kind ?? 'root_domain');
  const [fields,setFields]=React.useState<Record<string,string>>(()=>Object.fromEntries(Object.entries({...asset,...(typeof asset?.app_description==='string'?{description:asset.app_description}:{}),...(asset?.type==='endpoint'&&asset.ip?{service_ip:asset.ip}:{})}).filter(([,v])=>typeof v==='string'||typeof v==='number').map(([k,v])=>[k,String(v)])));
  const [extra,setExtra]=React.useState(''),[error,setError]=React.useState('');
  const common=kind==='app'?['app_name','bundle_id','app_icp','category','description']:kind==='ip'?['ip']:kind==='endpoint'?['url','method','service_ip']:kind==='service'?(fields.url?['url','ip','page_title','status_code']:['url','domain','ip','port','service_name']):kind==='subdomain'?['domain','record_type','icp']:['domain','icp'];
  const names:Record<string,string>={app_name:'应用名称',bundle_id:'Bundle ID',record_type:'DNS 记录类型',app_icp:'应用 ICP',category:'分类',description:'描述',ip:'IP 地址',service_ip:'服务 IP',url:'URL',method:'HTTP 方法',status_code:'HTTP 状态码',domain:'域名',port:'端口',service_name:'服务名称',page_title:'页面标题',icp:'ICP'};
  const identity=kind==='app'?['app_name','bundle_id']:kind==='ip'?['ip']:kind==='endpoint'?['url','method']:kind==='service'?(asset?.url?['url']:['url','domain','ip','port','service_name']):kind==='subdomain'?['domain','record_type']:['domain'];
  return <form className="tw-card am-editor" onSubmit={event=>{event.preventDefault();setError('');try{
    const input:Record<string,unknown>={type:kind};
    if(extra.trim()){const parsed:unknown=JSON.parse(extra);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('扩展字段必须是 JSON 对象');Object.assign(input,parsed);}
    input.type=kind;for(const key of [...common,...(kind==='app'?['company_id']:[])])if(fields[key])input[key]=['port','status_code'].includes(key)?Number(fields[key]):fields[key];
    if(asset)for(const key of identity){if(fields[key])input[key]=key==='port'?Number(fields[key]):fields[key];else delete input[key];}
    void onSave(input);
  }catch(failure){setError(errorText(failure));}}}>
    <h3>{asset?'编辑资产':'登记资产'}</h3><label className="am-field">类型<select value={kind} disabled={busy||!!asset} onChange={event=>{setKind(event.target.value as Kind);setFields({});}}>{Object.entries(kinds).map(([value,text])=><option key={value} value={value}>{text}</option>)}</select></label>
    {asset&&<p className="tw-muted">身份字段保持不变；登记同一自然键会更新现有资产。</p>}
    {common.map(key=><label key={key} className="am-field">{names[key]}<Input value={fields[key]??''} disabled={busy||!!asset&&identity.includes(key)} onChange={event=>setFields({...fields,[key]:event.target.value})}/></label>)}
    {kind==='app'&&<label className="am-field">公司<select value={fields.company_id??''} disabled={busy} onChange={event=>setFields({...fields,company_id:event.target.value})}><option value="">保持原归属或按范围匹配</option>{companies.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label>}
    <details><summary>扩展字段（JSON）</summary><textarea aria-label="资产扩展字段 JSON" value={extra} disabled={busy} onChange={event=>setExtra(event.target.value)} placeholder='{"technologies":["nginx"]}'/></details>
    {error&&<p role="alert">{error}</p>}<div className="am-actions"><Button type="submit" size="sm" variant="primary" disabled={busy}>保存资产</Button><Button type="button" size="sm" disabled={busy} onClick={onCancel}>取消</Button></div>
  </form>;
}
