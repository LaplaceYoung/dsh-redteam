import React from 'react';
import { Button, Checkbox, Input } from '@deepseek-ai/dsh-client-ui-primitives';
import { taskWorkspaceStyles } from '../task-workspace/styles.js';
import { request } from './client-api.js';
import type { ScopeSentryStatus, ScopeSentrySyncResult } from './scopesentry.js';

type Dimension = 'project' | 'task';
interface Target { id: string; name: string; detail: string }
const assetTypes = [{ key: 'subdomain', label: '子域名及关联 IP' }, { key: 'service', label: '服务' }, { key: 'app', label: '应用' }];
const pageSize = 50;
function targets(rows: Record<string, unknown>[], dimension: Dimension): Target[] {
  return rows.map(row => {
    const id = dimension === 'project' ? row.id : row.name;
    if (typeof id !== 'string' || !id.trim()) throw new Error(`ScopeSentry 返回的${dimension === 'project' ? '项目缺少 ID' : '任务缺少名称'}`);
    const name = typeof row.name === 'string' && row.name ? row.name : id;
    const detail = typeof row.AssetCount === 'number' ? `${row.AssetCount} 个资产` : typeof row.status === 'string' || typeof row.status === 'number' ? `状态：${row.status}` : '';
    return { id, name, detail };
  });
}
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export function ScopeSentryPanel(): React.ReactNode {
  const [status, setStatus] = React.useState<ScopeSentryStatus | null>(null);
  const [url, setUrl] = React.useState(''), [apiKey, setApiKey] = React.useState(''), [enabled, setEnabled] = React.useState(true);
  const [dimension, setDimension] = React.useState<Dimension>('project');
  const [search, setSearch] = React.useState(''), [appliedSearch, setAppliedSearch] = React.useState('');
  const [page, setPage] = React.useState(1), [rows, setRows] = React.useState<Target[]>([]), [loaded, setLoaded] = React.useState(false);
  const [selected, setSelected] = React.useState<string[]>([]), [chosenTypes, setChosenTypes] = React.useState(['subdomain', 'service', 'app']);
  const [createCompany, setCreateCompany] = React.useState(true);
  const [statusBusy, setStatusBusy] = React.useState(true), [configBusy, setConfigBusy] = React.useState(false);
  const [listBusy, setListBusy] = React.useState(false), [syncBusy, setSyncBusy] = React.useState(false);
  const [error, setError] = React.useState(''), [notice, setNotice] = React.useState('');
  const [result, setResult] = React.useState<ScopeSentrySyncResult | null>(null);
  const mounted = React.useRef(false), requests = React.useRef(new Set<AbortController>()), syncRequest = React.useRef<AbortController | null>(null);
  const busy = statusBusy || configBusy || listBusy || syncBusy;
  const ready = Boolean(status?.configured && status.enabled);
  function controller() { const value = new AbortController(); requests.current.add(value); return value; }

  async function loadTargets(nextDimension: Dimension, nextPage: number, query: string) {
    const pending = controller(); setListBusy(true); setError(''); setSelected([]); setRows([]); setLoaded(false);
    try {
      const params = new URLSearchParams({ page: String(nextPage), size: String(pageSize), ...(query ? { search: query } : {}) });
      let nextRows: Target[];
      if (nextDimension === 'project') {
        const response = await request<{ projects: Record<string, unknown>[] }>(`scopesentry/projects?${params}`, { signal: pending.signal });
        nextRows = targets(response.projects, nextDimension);
      } else {
        const response = await request<{ tasks: Record<string, unknown>[] }>(`scopesentry/tasks?${params}`, { signal: pending.signal });
        nextRows = targets(response.tasks, nextDimension);
      }
      if (!mounted.current || pending.signal.aborted) return;
      setRows(nextRows); setPage(nextPage); setAppliedSearch(query); setLoaded(true);
    } catch (failure) { if (mounted.current && !pending.signal.aborted) setError(`加载目标失败：${message(failure)}`); }
    finally { requests.current.delete(pending); if (mounted.current && !pending.signal.aborted) setListBusy(false); }
  }
  async function refreshStatus() {
    const pending = controller(); setStatusBusy(true); setError('');
    try {
      const next = await request<ScopeSentryStatus>('scopesentry/status', { signal: pending.signal });
      if (!mounted.current || pending.signal.aborted) return;
      setStatus(next); setEnabled(next.exists ? next.enabled : true);
      if (next.configured && next.enabled) await loadTargets(dimension, 1, search.trim());
      else { setRows([]); setSelected([]); setLoaded(false); }
    } catch (failure) { if (mounted.current && !pending.signal.aborted) setError(`读取数据源状态失败：${message(failure)}`); }
    finally { requests.current.delete(pending); if (mounted.current && !pending.signal.aborted) setStatusBusy(false); }
  }
  React.useEffect(() => {
    mounted.current = true; void refreshStatus();
    return () => { mounted.current = false; for (const pending of requests.current) pending.abort(); requests.current.clear(); };
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault(); if (busy) return;
    const pending = controller(); setConfigBusy(true); setError(''); setNotice(''); setResult(null);
    try {
      const next = await request<ScopeSentryStatus>('scopesentry/datasource', {
        method: 'POST', signal: pending.signal,
        body: { ...(url.trim() ? { url: url.trim() } : {}), ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}), enabled },
      });
      if (!mounted.current || pending.signal.aborted) return;
      setApiKey(''); setUrl(''); setStatus(next); setEnabled(next.enabled);
      setNotice(next.reachable ? '配置已保存，连接正常。' : next.enabled ? '配置已保存，连接检查未通过。' : '配置已保存，数据源已停用。');
      setRows([]); setSelected([]); setLoaded(false);
      if (next.configured && next.enabled && next.reachable) await loadTargets(dimension, 1, search.trim());
    } catch (failure) { if (mounted.current && !pending.signal.aborted) setError(`保存配置失败：${message(failure)}`); }
    finally { requests.current.delete(pending); if (mounted.current && !pending.signal.aborted) setConfigBusy(false); }
  }
  function changeDimension(next: Dimension) {
    if (next === dimension || busy) return;
    setDimension(next); setSearch(''); setAppliedSearch(''); setPage(1); setSelected([]); setResult(null); setNotice('');
    if (ready) void loadTargets(next, 1, '');
  }
  async function synchronize() {
    if (busy || !ready || !selected.length || !chosenTypes.length || syncRequest.current) return;
    const pending = controller(); syncRequest.current = pending;
    setSyncBusy(true); setError(''); setNotice(''); setResult(null);
    try {
      const response = await request<ScopeSentrySyncResult>('scopesentry/sync', {
        method: 'POST', signal: pending.signal,
        body: { dimension, targets: selected, asset_types: chosenTypes, create_company: dimension === 'project' && createCompany, page_size: 100 },
      });
      if (mounted.current && !pending.signal.aborted) setResult(response);
    } catch (failure) {
      if (mounted.current) {
        if (pending.signal.aborted) setNotice('同步请求已取消；取消前已写入的资产会保留。');
        else setError(`同步失败：${message(failure)}`);
      }
    } finally { requests.current.delete(pending); if (syncRequest.current === pending) syncRequest.current = null; if (mounted.current) setSyncBusy(false); }
  }
  const resultFailed = result !== null && (!result.ok || result.errors.length > 0);
  return <section className="tw-stack" aria-label="ScopeSentry 资产同步">
    <style>{taskWorkspaceStyles}</style>
    {error && <div className="tw-notice" role="alert">{error}</div>}
    {notice && <div className="tw-notice" role="status">{notice}</div>}
    <section className="tw-card tw-stack" aria-label="ScopeSentry 数据源配置">
      <div className="tw-card-head"><h3>ScopeSentry 数据源</h3><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { void refreshStatus(); }}>{statusBusy ? '检查中…' : '检查连接'}</Button></div>
      <div className="tw-gap" aria-live="polite">
        <p>{statusBusy ? '正在读取数据源状态…' : status === null ? '尚未取得数据源状态' : !status.exists || !status.configured ? '尚未配置完整的数据源' : !status.enabled ? '数据源已停用' : status.reachable ? '已连接' : '连接失败'}</p>
        {status?.error && <p className="tw-description" role="alert">{status.error}</p>}
        {status?.url && <p className="tw-muted tw-description">当前地址：{status.url}</p>}
        {status?.hasApiKey && <p className="tw-muted">已保存 API Key；留空会保留现有密钥。</p>}
        {status?.tools.length ? <details><summary>已发现 {status.tools.length} 个工具</summary><p className="tw-description">{status.tools.join('、')}</p></details> : null}
      </div>
      <form className="tw-stack" onSubmit={event => { void save(event); }}>
        <fieldset className="tw-stack" disabled={busy}>
          <label className="tw-field"><span>MCP 地址</span><Input aria-label="ScopeSentry MCP 地址" type="url" autoComplete="off" placeholder={status?.url ? '留空保留当前地址' : 'https://scopesentry.example/mcp'} required={!status?.url && enabled} value={url} onChange={event => setUrl(event.target.value)} /><small>填写新地址可替换当前地址。</small></label>
          <label className="tw-field"><span>API Key</span><Input aria-label="ScopeSentry API Key" type="password" autoComplete="new-password" placeholder={status?.hasApiKey ? '留空保留现有密钥' : '输入 API Key'} required={!status?.hasApiKey && enabled} value={apiKey} onChange={event => setApiKey(event.target.value)} /></label>
          <Checkbox label="启用 ScopeSentry 数据源" checked={enabled} onChange={setEnabled} disabled={busy} />
          <div className="tw-actions"><Button type="submit" variant="primary" size="sm">{configBusy ? '保存中…' : '保存配置'}</Button></div>
        </fieldset>
      </form>
    </section>
    <section className="tw-card tw-stack" aria-label="选择同步目标">
      <h3>选择项目或任务</h3>
      {!ready && <p className="tw-muted">配置并启用数据源后，可加载项目或任务。</p>}
      <div className="tw-actions" aria-label="同步维度">
        <Button type="button" size="sm" variant={dimension === 'project' ? 'primary' : 'outline'} aria-pressed={dimension === 'project'} disabled={busy} onClick={() => changeDimension('project')}>按项目</Button>
        <Button type="button" size="sm" variant={dimension === 'task' ? 'primary' : 'outline'} aria-pressed={dimension === 'task'} disabled={busy} onClick={() => changeDimension('task')}>按任务</Button>
      </div>
      <form className="tw-inline" onSubmit={event => { event.preventDefault(); if (!busy && ready) void loadTargets(dimension, 1, search.trim()); }}>
        <Input className="tw-grow" aria-label="搜索 ScopeSentry 项目或任务" placeholder={dimension === 'project' ? '搜索项目' : '搜索任务'} disabled={!ready || busy} value={search} onChange={event => setSearch(event.target.value)} />
        <Button type="submit" size="sm" variant="outline" disabled={!ready || busy}>{listBusy ? '加载中…' : '搜索 / 加载'}</Button>
      </form>
      {listBusy ? <p role="status">正在加载目标…</p> : loaded && rows.length === 0 ? <p className="tw-muted">本页没有匹配的{dimension === 'project' ? '项目' : '任务'}。</p> : rows.length > 0 ? <div className="tw-gap">
        <Checkbox label={`选择本页全部 ${rows.length} 项`} checked={rows.every(row => selected.includes(row.id))} disabled={busy} onChange={checked => setSelected(checked ? rows.map(row => row.id) : [])} />
        {rows.map(row => <div className="tw-record tw-gap" key={row.id}>
          <Checkbox className="tw-title" label={row.name} checked={selected.includes(row.id)} disabled={busy} onChange={checked => setSelected(current => checked ? [...current, row.id] : current.filter(id => id !== row.id))} />
          {row.detail && <p className="tw-muted tw-small">{row.detail}</p>}
          {dimension === 'project' && <p className="tw-muted tw-small tw-description">{row.id}</p>}
        </div>)}
      </div> : null}
      <div className="tw-actions">
        <Button type="button" size="sm" disabled={!ready || busy || page <= 1} onClick={() => { void loadTargets(dimension, page - 1, appliedSearch); }}>上一页</Button>
        <span className="tw-muted">第 {page} 页 · 每页 {pageSize} 项</span>
        <Button type="button" size="sm" disabled={!ready || busy || !loaded || rows.length < pageSize} onClick={() => { void loadTargets(dimension, page + 1, appliedSearch); }}>下一页</Button>
      </div>
      <p className="tw-muted tw-small">分页、搜索或切换维度后需重新选择目标。</p>
    </section>
    <section className="tw-card tw-stack" aria-label="同步选项">
      <h3>同步内容</h3>
      <fieldset className="tw-gap" disabled={busy || !ready}>
        {assetTypes.map(type => <Checkbox key={type.key} label={type.label} checked={chosenTypes.includes(type.key)} disabled={busy || !ready} onChange={checked => setChosenTypes(current => checked ? [...current, type.key] : current.filter(value => value !== type.key))} />)}
        {dimension === 'project' && <Checkbox label="按项目创建公司及范围，并更新资产归属" checked={createCompany} onChange={setCreateCompany} disabled={busy || !ready} />}
      </fieldset>
      <p className="tw-muted">已选择 {selected.length} 个{dimension === 'project' ? '项目' : '任务'}、{chosenTypes.length} 类资产。每个目标每类资产最多同步 5000 条。</p>
      <div className="tw-actions"><Button type="button" size="sm" variant="primary" disabled={!ready || busy || selected.length === 0 || chosenTypes.length === 0} onClick={() => { void synchronize(); }}>{syncBusy ? '正在同步…' : '同步所选目标'}</Button>
        {syncBusy && <Button type="button" size="sm" variant="outline" onClick={() => syncRequest.current?.abort()}>取消同步</Button>}</div>
    </section>
    {result && <section className="tw-card tw-stack" aria-label="ScopeSentry 同步结果">
      <h3 role={resultFailed ? 'alert' : 'status'}>{resultFailed ? '同步存在失败' : result.partial || result.warnings.length > 0 ? '同步完成（部分结果）' : '同步完成'}</h3>
      <p className="tw-muted">以下是成功入库或更新的记录数，包含已存在资产的更新。</p>
      <dl className="tw-kv"><dt>子域名</dt><dd>{result.synced.subdomain}</dd><dt>关联 IP</dt><dd>{result.synced.ip}</dd><dt>服务</dt><dd>{result.synced.service}</dd><dt>应用</dt><dd>{result.synced.app}</dd></dl>
      {result.companies.length > 0 && <div className="tw-gap"><h3>公司</h3><p className="tw-description">{result.companies.join('、')}</p></div>}
      {result.warnings.length > 0 && <div className="tw-gap"><h3>提醒</h3><ul>{result.warnings.map((warning, index) => <li className="tw-description" key={index}>{warning}</li>)}</ul></div>}
      {result.errors.length > 0 && <div className="tw-gap" role="alert"><h3>错误</h3><ul>{result.errors.map((failure, index) => <li className="tw-description" key={index}>{failure}</li>)}</ul></div>}
    </section>}
  </section>;
}
