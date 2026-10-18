import React from 'react';
import { Button, Checkbox, Input } from '@deepseek-ai/dsh-client-ui-primitives';
import { taskWorkspaceStyles } from '../task-workspace/styles.js';
import { request, type CompanyView, type CompanyScopeView } from './client-api.js';

interface MutationResult {
  id?: string; scope_added?: number; scope_skipped?: number; scope_invalid?: number; scope_errors?: string[];
  added?: number; skipped?: number; invalid?: number; errors?: string[]; warnings?: string[]; assets_deleted?: number; updated?: number;
}
interface CompanyDetailView { company: Pick<CompanyView, 'id' | 'name' | 'logo'>; scope: CompanyScopeView[] }
type Mutate = (path: string, body: unknown, label: string, method?: 'POST' | 'DELETE') => Promise<MutationResult | undefined>;
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const scopeLabels: Record<string, string> = { domain: '域名', ip: 'IP 地址', cidr: '网段', icp: '备案号', keyword: '关键词' };
function scopeValue(scope: CompanyScopeView): string { return scope.domain || scope.net || scope.value || scope.raw || ''; }
function scopeEditorText(scopes: CompanyScopeView[]): string {
  return scopes.map(scope => `${scope.kind}: ${scope.kind === 'ip' ? scopeValue(scope).split('/')[0] : scopeValue(scope)}`).join('\n');
}
function scopeInputs(value: string): Array<string | { kind: string; value: string }> {
  return value.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
    const typed = /^(domain|ip|cidr|icp|keyword)\s*:\s*(.*)$/i.exec(line);
    return typed ? { kind: typed[1].toLowerCase(), value: typed[2] } : line;
  });
}
function mutationMessage(label: string, result: MutationResult): string {
  const parts = [label], added = result.scope_added ?? result.added, skipped = result.scope_skipped ?? result.skipped, invalid = result.scope_invalid ?? result.invalid;
  if (added !== undefined) parts.push(`范围规则：新增 ${added} 条，重复 ${skipped ?? 0} 条，无效 ${invalid ?? 0} 条。`);
  if (result.assets_deleted !== undefined) parts.push(`删除资产 ${result.assets_deleted} 条。`);
  if (result.updated !== undefined) parts.push(`更新了 ${result.updated} 条资产的公司归属。`);
  const errors = result.scope_errors ?? result.errors;
  if (errors?.length) parts.push(`以下范围未保存：\n${errors.join('\n')}`);
  if (result.warnings?.length) parts.push(result.warnings.join('\n'));
  return parts.join('\n');
}

/** Company mutations use the same authenticated native workspace API as the asset panel. */
export function CompanyPanel(): React.ReactNode {
  const [companies, setCompanies] = React.useState<CompanyView[]>([]), [loaded, setLoaded] = React.useState(false);
  const [loading, setLoading] = React.useState(true), [busy, setBusy] = React.useState(false);
  const [loadError, setLoadError] = React.useState(''), [actionError, setActionError] = React.useState(''), [notice, setNotice] = React.useState('');
  const [selected, setSelected] = React.useState(''), [creating, setCreating] = React.useState(false), [query, setQuery] = React.useState('');
  const [revision, refresh] = React.useReducer((value: number) => value + 1, 0);
  const lifetime = React.useRef<AbortController | null>(null), mutationPending = React.useRef(false);
  React.useEffect(() => { const controller = new AbortController(); lifetime.current = controller; return () => controller.abort(); }, []);
  React.useEffect(() => {
    const controller = new AbortController(); setLoading(true); setLoadError('');
    void request<CompanyView[]>('companies', { signal: controller.signal }).then(rows => {
      if (!controller.signal.aborted) { setCompanies(rows); setLoaded(true); }
    }).catch(error => { if (!controller.signal.aborted) setLoadError(errorText(error)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);
  const mutate: Mutate = async (path, body, label, method = 'POST') => {
    if (mutationPending.current) return;
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted) return;
    mutationPending.current = true; setBusy(true); setActionError(''); setNotice('');
    try {
      const result = await request<MutationResult>(path, { method, body, signal });
      if (signal.aborted) return;
      setNotice(mutationMessage(label, result)); refresh(); return result;
    } catch (error) { if (!signal.aborted) setActionError(errorText(error)); return; }
    finally { mutationPending.current = false; if (!signal.aborted) setBusy(false); }
  };
  const filtered = companies.filter(company => company.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <section className="tw-root" aria-label="公司管理">
    <style>{taskWorkspaceStyles}</style>
    <header className="tw-top"><h2>公司与范围</h2><div className="tw-actions">
      <Button size="sm" disabled={busy || loading} onClick={() => refresh()}>{loading ? '加载中…' : '刷新公司'}</Button>
      <Button size="sm" variant="primary" disabled={busy} onClick={() => { setCreating(true); setSelected(''); setActionError(''); setNotice(''); }}>新建公司</Button>
    </div></header>
    {loadError && <div className="tw-notice" role="alert">公司列表加载失败：{loadError} <Button size="sm" disabled={busy || loading} onClick={() => refresh()}>重试加载公司</Button></div>}
    {actionError && <div className="tw-notice" role="alert">{actionError}</div>}
    {notice && <div className="tw-notice" role="status">{notice}</div>}
    <div className="tw-toolbar">
      <Input className="tw-grow" aria-label="搜索公司" placeholder="搜索公司名称" value={query} disabled={busy} onChange={event => setQuery(event.target.value)} />
      <Button size="sm" disabled={busy || loading} onClick={() => { void mutate('companies/reattribute', {}, '已重新计算公司归属。'); }}>重新计算归属</Button>
    </div>
    <div className="tw-scroll tw-stack" aria-busy={busy || loading}>
      <p className="tw-muted">范围用于自动匹配资产所属公司。域名、网段和备案号参与匹配；关键词用于描述范围。</p>
      {busy && <p role="status" className="tw-muted">正在保存，请稍候…</p>}
      {creating && <NewCompany busy={busy} mutate={mutate} onCancel={() => setCreating(false)} onCreated={id => { setCreating(false); setSelected(id); }} />}
      {selected && <CompanyDetail key={selected} id={selected} assetCount={companies.find(company => company.id === selected)?.asset_count} revision={revision} busy={busy} mutate={mutate} onBack={() => setSelected('')} onDeleted={() => setSelected('')} />}
      {!selected && !creating && <div className="tw-stack">
        {loading && !loaded ? <p role="status">正在加载公司…</p> : loaded && !filtered.length ? <div className="tw-empty"><h3>{companies.length ? '没有匹配的公司' : '还没有公司'}</h3><p>{companies.length ? '调整搜索名称后重试。' : '创建公司并添加范围，已有资产会按范围重新匹配归属。'}</p></div> : null}
        {filtered.map(company => <article className="tw-card tw-gap" key={company.id}>
          <div className="tw-card-head"><Button size="sm" className="tw-task-button" disabled={busy} onClick={() => { setSelected(company.id); setActionError(''); setNotice(''); }}>{company.name}</Button><span className="tw-muted">{company.asset_count} 条资产</span></div>
          <p className="tw-muted">{company.scope.length} 条范围规则</p>
          {company.scope.length > 0 && <p className="tw-description tw-small">{company.scope.slice(0, 3).map(scopeValue).join(' · ')}{company.scope.length > 3 ? ' …' : ''}</p>}
        </article>)}
      </div>}
    </div>
  </section>;
}

function NewCompany({ busy, mutate, onCancel, onCreated }: { busy: boolean; mutate: Mutate; onCancel: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = React.useState(''), [logo, setLogo] = React.useState(''), [scope, setScope] = React.useState('');
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const result = await mutate('companies', { name: name.trim(), ...(logo.trim() ? { logo: logo.trim() } : {}), scope: scopeInputs(scope) }, '公司已创建。');
    if (result?.id) onCreated(result.id);
  }
  return <form className="tw-card tw-stack" aria-label="新建公司" onSubmit={event => { void submit(event); }}>
    <h3>新建公司</h3><fieldset disabled={busy} className="tw-stack">
      <label className="tw-field"><span>公司名称</span><Input aria-label="公司名称" required value={name} onChange={event => setName(event.target.value)} placeholder="例如：示例科技" /></label>
      <label className="tw-field"><span>Logo 地址（可选）</span><Input aria-label="公司 Logo 地址" value={logo} onChange={event => setLogo(event.target.value)} placeholder="https://…" /></label>
      <label className="tw-field"><span>初始范围（每行一条）</span><textarea aria-label="初始公司范围" rows={6} value={scope} onChange={event => setScope(event.target.value)} placeholder={'example.com\n192.0.2.0/24\n京ICP备123号\nkeyword: 示例品牌'} /><small>支持域名、IP、网段、备案号和关键词。可用 domain:、ip:、cidr:、icp:、keyword: 明确类型。</small></label>
      <div className="tw-actions"><Button type="submit" size="sm" variant="primary" disabled={!name.trim() || busy}>{busy ? '创建中…' : '创建公司'}</Button><Button type="button" size="sm" disabled={busy} onClick={onCancel}>取消创建</Button></div>
    </fieldset>
  </form>;
}

function CompanyDetail({ id, assetCount, revision, busy, mutate, onBack, onDeleted }: { id: string; assetCount?: number; revision: number; busy: boolean; mutate: Mutate; onBack: () => void; onDeleted: () => void }) {
  const [detail, setDetail] = React.useState<CompanyDetailView>();
  const [loading, setLoading] = React.useState(true), [error, setError] = React.useState(''), [attempt, retry] = React.useReducer((value: number) => value + 1, 0);
  const [scope, setScope] = React.useState(''), [reset, setReset] = React.useState(false), [reason, setReason] = React.useState('');
  const [deleteAssets, setDeleteAssets] = React.useState(false), [confirming, setConfirming] = React.useState(false);
  const path = `companies/${encodeURIComponent(id)}`;
  React.useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    void request<CompanyDetailView>(path, { signal: controller.signal }).then(row => { if (!controller.signal.aborted) setDetail(row); })
      .catch(failure => { if (!controller.signal.aborted) setError(errorText(failure)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [path, revision, attempt]);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    const result = await mutate(`${path}/scope`, { scope: scopeInputs(scope), reset, reason: reason.trim() }, reset ? '公司范围已替换。' : '已追加公司范围。');
    if (result) { setScope(''); setReset(false); setReason(''); }
  }
  const disabled = busy || loading || Boolean(error);
  return <section className="tw-card tw-stack" aria-label="公司详情" aria-busy={loading || busy}>
    <div className="tw-inline"><h3 className="tw-grow">{detail?.company.name ?? '公司详情'}</h3><Button size="sm" disabled={busy} onClick={onBack}>返回公司列表</Button></div>
    {loading && <p className="tw-muted" role="status">正在加载公司详情…</p>}
    {error && <div className="tw-notice" role="alert">{error} <Button size="sm" disabled={busy || loading} onClick={() => retry()}>重试公司详情</Button></div>}
    {detail && <>
      <p className="tw-muted">{assetCount === undefined ? '' : `${assetCount} 条资产 · `}{detail.scope.length} 条范围规则</p>
      {detail.company.logo && <p className="tw-description tw-small tw-muted">Logo 地址：{detail.company.logo}</p>}
      <div className="tw-gap" aria-label="已保存的公司范围">{!detail.scope.length ? <p className="tw-muted">尚未设置范围。</p> : detail.scope.map(item => <div className="tw-record tw-gap" key={item.id}>
        <div className="tw-inline"><span className="tw-muted">{scopeLabels[item.kind] ?? item.kind}</span><span className="tw-row-content">{scopeValue(item)}</span></div>
        {item.reason && <p className="tw-small tw-muted tw-description">备注：{item.reason}</p>}
      </div>)}</div>
      <form className="tw-section tw-stack" aria-label="编辑公司范围" onSubmit={event => { void save(event); }}><h3>编辑范围</h3><fieldset disabled={disabled} className="tw-stack">
        <Checkbox label="替换全部范围" checked={reset} disabled={disabled} onChange={checked => { setReset(checked); setScope(checked ? scopeEditorText(detail.scope) : ''); }} />
        <label className="tw-field"><span>{reset ? '替换后的范围' : '追加范围'}（每行一条）</span><textarea aria-label="编辑公司范围内容" rows={6} value={scope} onChange={event => setScope(event.target.value)} placeholder={'example.com\n192.0.2.0/24\nkeyword: 示例品牌'} /><small>{reset ? '保存时覆盖全部现有规则；留空会清空范围，并重新计算自动归属。无效规则会阻止整次替换。' : '现有规则保持不变；重复规则会跳过，无效规则会在结果中列出。'}</small></label>
        <label className="tw-field"><span>范围变更备注（可选）</span><Input aria-label="范围变更备注" value={reason} onChange={event => setReason(event.target.value)} /></label>
        <Button type="submit" size="sm" variant="primary" disabled={disabled || !reset && !scope.trim()}>{reset ? '保存替换范围' : '追加范围'}</Button>
      </fieldset></form>
      <section className="tw-section tw-stack" aria-label="删除公司"><h3>删除公司</h3>
        <fieldset disabled={disabled || confirming}><Checkbox label="同时删除该公司当前归属的全部资产" checked={deleteAssets} disabled={disabled || confirming} onChange={setDeleteAssets} /></fieldset>
        <p className="tw-muted">{deleteAssets ? '这些资产也会从当前任务引用中移除；漏洞的历史证据记录保留。' : '保留已有资产，删除公司范围，并按其他公司范围重新匹配资产归属。'}</p>
        {confirming ? <div className="tw-gap" role="group" aria-label="确认删除公司"><p className="tw-description">确认删除「{detail.company.name}」{deleteAssets ? '及当前归属的全部资产' : '并保留资产'}？</p><div className="tw-actions">
          <Button size="sm" disabled={disabled} onClick={() => { void mutate(path, { delete_assets: deleteAssets }, '公司已删除。', 'DELETE').then(result => { if (result) onDeleted(); }); }}>确认删除公司{deleteAssets ? '及资产' : ''}</Button>
          <Button size="sm" disabled={busy} onClick={() => setConfirming(false)}>取消删除</Button>
        </div></div> : <Button size="sm" disabled={disabled} onClick={() => setConfirming(true)}>删除公司…</Button>}
      </section>
    </>}
  </section>;
}
