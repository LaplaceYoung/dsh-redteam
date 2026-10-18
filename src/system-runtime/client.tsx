import React from 'react';
import { Button, Checkbox, Input, SegmentedTabs, Tag, type SegmentedTab } from '@deepseek-ai/dsh-client-ui-primitives';
import type { TabComponentProps } from 'dsh-better-sidebar/client/service';
import { errorMessage, Field, JsonDetails, ManagementPage, Notice, requestJson } from '../management-ui/shared.js';
import type { PublicSystemSettings, SearchBackend, SystemSettingsPatch } from './settings.js';
import type { ModelRetryPolicy, ProfilePoolPolicy, RetryRule } from './model-health.js';

const root = '/api/redteam/system';
type PoolEntry = { profile_id: string; name: string; provider: string; model: string; active: boolean; state: string; fails: number; trips: number; cooldown_secs: number; last_error: string; last_at: string | null; policy: ProfilePoolPolicy };
type Pool = { chain: PoolEntry[]; retry: ModelRetryPolicy; enabled: boolean; bind_fallback: boolean };
type Act = <T>(work: () => Promise<T>, success: string) => Promise<T | undefined>;
const retryLabels: Record<keyof ModelRetryPolicy, string> = { connect: '连接失败', empty: '空响应', stream: '流中断', breaker: '熔断', intent: '意图重试' };
const tabs: [SegmentedTab<'settings' | 'pool'>, ...SegmentedTab<'settings' | 'pool'>[]] = [{ id: 'settings', panelId: 'system-settings-panel', value: 'settings', label: '系统设置' }, { id: 'pool', panelId: 'system-pool-panel', value: 'pool', label: '模型池' }];

export function SystemRuntimeTab({ visible }: TabComponentProps): React.ReactNode {
  const [tab, setTab] = React.useState<'settings' | 'pool'>('settings');
  const [settings, setSettings] = React.useState<PublicSystemSettings>();
  const [pool, setPool] = React.useState<Pool>();
  const [loading, setLoading] = React.useState(false), [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(''), [notice, setNotice] = React.useState('');
  const pending = React.useRef(false);
  const refresh = React.useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError('');
    const results = await Promise.allSettled([requestJson<PublicSystemSettings>(`${root}/settings`, { signal }), requestJson<Pool>(`${root}/model-pool`, { signal })]);
    if (signal?.aborted) return;
    if (results[0].status === 'fulfilled') setSettings(results[0].value);
    if (results[1].status === 'fulfilled') setPool(results[1].value);
    setError(results.filter(result => result.status === 'rejected').map(result => errorMessage(result.reason)).join('\n'));
    setLoading(false);
  }, []);
  React.useEffect(() => { if (!visible) return; const controller = new AbortController(); void refresh(controller.signal); return () => controller.abort(); }, [visible, refresh]);
  const act: Act = async (work, success) => {
    if (pending.current) return undefined;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    try { const result = await work(); setNotice(success); return result; }
    catch (failure) { setError(errorMessage(failure)); return undefined; }
    finally { pending.current = false; setBusy(false); }
  };
  return <ManagementPage title="系统设置与模型池" description="设置保存在当前插件实例。搜索和模型测试会发送真实请求。" loading={loading} error={error} notice={notice}
    actions={<Button size="sm" disabled={loading || busy} onClick={() => void refresh()}>刷新状态</Button>}
    toolbar={<SegmentedTabs items={tabs} value={tab} onChange={setTab} label="系统管理视图" />}>
    <div hidden={tab !== 'settings'}>{settings && <SettingsForm initial={settings} busy={busy} act={act} onSaved={setSettings} />}</div>
    <div hidden={tab !== 'pool'}>{pool && <PoolPanel pool={pool} busy={busy} act={act} refresh={() => refresh()} />}</div>
  </ManagementPage>;
}

function SettingsForm({ initial, busy, act, onSaved }: { initial: PublicSystemSettings; busy: boolean; act: Act; onSaved(value: PublicSystemSettings): void }) {
  const [patch, setPatch] = React.useState<SystemSettingsPatch>({});
  const [braveMode, setBraveMode] = React.useState('keep'), [tavilyMode, setTavilyMode] = React.useState('keep');
  const [braveKey, setBraveKey] = React.useState(''), [tavilyKey, setTavilyKey] = React.useState('');
  const [test, setTest] = React.useState<{ ok: boolean; backend: string; count?: number; error?: string }>();
  const current = { ...initial, ...patch };
  const change = <K extends keyof SystemSettingsPatch>(key: K, value: SystemSettingsPatch[K]) => setPatch(old => ({ ...old, [key]: value }));
  const dirty = Object.keys(patch).length > 0 || braveMode !== 'keep' || tavilyMode !== 'keep';
  const secretPatch = { ...(braveMode === 'keep' ? {} : { brave_search_api_key: braveMode === 'clear' ? '' : braveKey }), ...(tavilyMode === 'keep' ? {} : { tavily_search_api_key: tavilyMode === 'clear' ? '' : tavilyKey }) };
  async function save(event: React.FormEvent) {
    event.preventDefault();
    const saved = await act(() => requestJson<PublicSystemSettings>(`${root}/settings`, { method: 'PUT', body: JSON.stringify({ ...patch, ...secretPatch }) }), '系统设置已保存。');
    if (saved) { onSaved(saved); setPatch({}); setBraveMode('keep'); setTavilyMode('keep'); setBraveKey(''); setTavilyKey(''); }
  }
  async function testSearch() {
    setTest(undefined);
    const result = await act(async () => {
      const result = await requestJson<{ ok: boolean; backend: string; count?: number; error?: string }>(`${root}/web-search/test`, { method: 'POST', body: JSON.stringify({ web_search_backend: current.web_search_backend, web_search_proxy: current.web_search_proxy, ...(braveMode === 'replace' ? { brave_search_api_key: braveKey } : {}), ...(tavilyMode === 'replace' ? { tavily_search_api_key: tavilyKey } : {}) }) });
      if (!result.ok) throw new Error(result.error || '搜索测试没有成功');
      return result;
    }, '搜索测试成功。');
    setTest(result);
  }
  return <form className="tw-stack" onSubmit={save}><fieldset disabled={busy} className="tw-stack">
    <section className="tw-card tw-stack"><h3>网页搜索</h3><Checkbox checked={current.web_search_enabled === true} onChange={value => change('web_search_enabled', value)} label="启用网页搜索" />
      <div className="tw-grid"><Field label="搜索后端"><select value={current.web_search_backend ?? 'ddgs'} onChange={event => change('web_search_backend', event.target.value as SearchBackend)}><option value="ddgs">DuckDuckGo</option><option value="brave-free">Brave</option><option value="tavily">Tavily</option><option value="deepseek">DeepSeek</option></select></Field>
      <Field label="搜索代理" hint="留空直连；独立于目标流量代理。"><Input value={current.web_search_proxy ?? ''} onChange={event => change('web_search_proxy', event.target.value)} placeholder="http://127.0.0.1:8080" /></Field></div>
      <SecretInput label="Brave API Key" configured={initial.brave_key_set} mode={braveMode} setMode={setBraveMode} value={braveKey} setValue={setBraveKey} />
      <SecretInput label="Tavily API Key" configured={initial.tavily_key_set} mode={tavilyMode} setMode={setTavilyMode} value={tavilyKey} setValue={setTavilyKey} />
      <p className="tw-muted tw-small">测试使用当前表单的后端、代理和新密钥；保留时使用已保存密钥。清空密钥后请先保存再测试。DeepSeek 测试会调用模型。</p>
      <div><Button type="button" size="sm" disabled={busy || braveMode === 'clear' || tavilyMode === 'clear' || braveMode === 'replace' && !braveKey.trim() || tavilyMode === 'replace' && !tavilyKey.trim()} onClick={() => void testSearch()}>测试搜索连接</Button></div>
      {test && <Notice tone="success">{test.backend} 返回 {test.count} 条搜索结果。</Notice>}
    </section>
    <section className="tw-card tw-stack"><h3>执行设置</h3>
      <Checkbox checked={current.llm_pool_enabled === true} onChange={value => change('llm_pool_enabled', value)} label="启用模型池" />
      <Checkbox checked={current.llm_pool_bind_fallback === true} onChange={value => change('llm_pool_bind_fallback', value)} label="允许已绑定模型使用池内回退" />
      <Checkbox checked={current.constraints_inject_planner === true} onChange={value => change('constraints_inject_planner', value)} label="向 Planner 注入任务约束" />
      <Checkbox checked={current.constraints_inject_worker === true} onChange={value => change('constraints_inject_worker', value)} label="向 Worker 注入任务约束" />
      <Checkbox checked={current.noa_compaction === true} onChange={value => change('noa_compaction', value)} label="启用 NoA 上下文压缩" />
    </section>
    <div className="tw-actions"><Button type="submit" variant="primary" size="sm" disabled={!dirty || busy}>保存设置</Button><Button type="button" size="sm" disabled={!dirty || busy} onClick={() => { setPatch({}); setBraveMode('keep'); setTavilyMode('keep'); setBraveKey(''); setTavilyKey(''); }}>撤销未保存修改</Button>{dirty && <Tag tone="warning">尚未保存</Tag>}</div>
  </fieldset></form>;
}

function SecretInput({ label, configured, mode, setMode, value, setValue }: { label: string; configured: boolean; mode: string; setMode(value: string): void; value: string; setValue(value: string): void }) {
  return <div className="tw-grid"><Field label={label} hint={configured ? '已配置，服务端不会回传密钥。' : '尚未配置。'}><select aria-label={`${label} 操作`} value={mode} onChange={event => setMode(event.target.value)}><option value="keep">保留当前密钥</option><option value="replace">设置新密钥</option><option value="clear">清空密钥</option></select></Field>{mode === 'replace' && <Field label={`新 ${label}`}><Input type="password" autoComplete="new-password" required value={value} onChange={event => setValue(event.target.value)} /></Field>}</div>;
}

function RetryFields<K extends keyof ModelRetryPolicy>({ value, keys, onChange }: { value: Pick<ModelRetryPolicy, K>; keys: readonly K[]; onChange(key: K, rule: RetryRule): void }) {
  return <div className="tw-stack">{keys.map(key => <div key={key} className="tw-grid"><Field label={`${retryLabels[key]}次数`} hint="0 使用默认或继承；-1 禁用；最多 20。"><Input type="number" required min={-1} max={20} step={1} value={value[key].attempts} onChange={event => onChange(key, { ...value[key], attempts: event.target.valueAsNumber })} /></Field><Field label={`${retryLabels[key]}间隔（毫秒）`}><Input type="number" required min={0} max={3600000} step={1} value={value[key].interval_ms} onChange={event => onChange(key, { ...value[key], interval_ms: event.target.valueAsNumber })} /></Field></div>)}</div>;
}

function PoolPanel({ pool, busy, act, refresh }: { pool: Pool; busy: boolean; act: Act; refresh(): Promise<void> }) {
  const [selected, setSelected] = React.useState('');
  const [probe, setProbe] = React.useState<{ ok: boolean; profile_id: string; elapsed_ms: number; response: string; failure?: unknown }>();
  const [confirmReset, setConfirmReset] = React.useState(false);
  const row = pool.chain.find(item => item.profile_id === selected);
  async function reset(profileId?: string) { await act(async () => { await requestJson(`${root}/model-health/reset`, { method: 'POST', body: JSON.stringify(profileId ? { profile_id: profileId } : {}) }); await refresh(); setConfirmReset(false); }, '模型健康状态已重置。'); }
  async function test(profileId: string) {
    setProbe(undefined);
    await act(async () => { const result = await requestJson<NonNullable<typeof probe>>(`${root}/model-test/${encodeURIComponent(profileId)}`, { method: 'POST', body: '{}' }); setProbe(result); await refresh(); if (!result.ok) throw new Error('模型测试失败，详见测试结果。'); }, '模型测试成功。');
  }
  return <div className="tw-stack"><div className="tw-inline"><Tag tone={pool.enabled ? 'success' : 'outline'}>{pool.enabled ? '模型池已启用' : '模型池未启用'}</Tag><Tag>{pool.bind_fallback ? '绑定允许回退' : '绑定不回退'}</Tag></div>
    {!pool.chain.length ? <div className="tw-empty">尚无模型配置。请先在任务工作台的模型配置中添加模型。</div> : pool.chain.map(item => <article className="tw-card tw-gap" key={item.profile_id}><div className="tw-inline"><strong className="tw-grow">{item.name}</strong><Tag tone={item.state === 'ok' ? 'success' : item.state === 'tripped' ? 'danger' : 'warning'}>{item.state === 'ok' ? '正常' : item.state === 'tripped' ? '熔断中' : '降级'}</Tag>{item.active && <Tag tone="info">当前</Tag>}{item.policy.excluded && <Tag>已排除</Tag>}</div><div className="mg-meta"><span>{item.provider} / {item.model}</span><span>优先级 {item.policy.priority}</span><span>失败 {item.fails} · 熔断 {item.trips} · 冷却 {item.cooldown_secs} 秒</span></div>{item.last_error && <p className="tw-description">{item.last_error} {item.last_at && `（${new Date(item.last_at).toLocaleString()}）`}</p> }<div className="tw-actions"><Button size="sm" disabled={busy} onClick={() => setSelected(item.profile_id)}>编辑策略</Button><Button size="sm" disabled={busy} onClick={() => void test(item.profile_id)}>测试模型</Button><Button size="sm" disabled={busy} onClick={() => void reset(item.profile_id)}>重置健康</Button></div></article>)}
    <p className="tw-muted tw-small">模型测试会发送一次短请求，可能消耗提供方额度；超时上限 30 秒。</p>
    {probe && <section className="tw-card tw-gap"><h3>测试结果</h3><p>{probe.profile_id} · {probe.elapsed_ms} 毫秒 · {probe.ok ? '成功' : '失败'}</p><p className="tw-description">{probe.response}</p>{probe.failure !== undefined && <JsonDetails value={probe.failure} summary="错误详情" open />}</section>}
    {row && <ProfileEditor key={row.profile_id} row={row} busy={busy} act={act} refresh={refresh} onClose={() => setSelected('')} />}
    <GlobalRetry initial={pool.retry} busy={busy} act={act} refresh={refresh} />
    <div className="tw-actions">{confirmReset ? <><span>重置全部模型的熔断和失败状态？</span><Button size="sm" disabled={busy} onClick={() => void reset()}>确认重置全部</Button><Button size="sm" disabled={busy} onClick={() => setConfirmReset(false)}>取消</Button></> : <Button size="sm" disabled={busy || !pool.chain.length} onClick={() => setConfirmReset(true)}>重置全部模型健康</Button>}</div>
  </div>;
}

function ProfileEditor({ row, busy, act, refresh, onClose }: { row: PoolEntry; busy: boolean; act: Act; refresh(): Promise<void>; onClose(): void }) {
  const [policy, setPolicy] = React.useState(row.policy);
  const numeric: { key: 'priority' | 'ratePerSecond' | 'ratePerMinute' | 'windowTokens'; label: string; min?: number }[] = [{ key: 'priority', label: '优先级' }, { key: 'ratePerSecond', label: '每秒请求上限', min: 0 }, { key: 'ratePerMinute', label: '每分钟请求上限', min: 0 }, { key: 'windowTokens', label: '上下文 token 上限', min: 0 }];
  return <form className="tw-card tw-stack" onSubmit={event => { event.preventDefault(); void act(async () => { await requestJson(`${root}/model-policy/${encodeURIComponent(row.profile_id)}`, { method: 'PUT', body: JSON.stringify(policy) }); await refresh(); onClose(); }, '模型策略已保存。'); }}><h3>{row.name} · 模型策略</h3><fieldset disabled={busy} className="tw-stack"><Checkbox checked={policy.excluded} onChange={excluded => setPolicy(old => ({ ...old, excluded }))} label="从模型池中排除此配置" /><div className="tw-grid">{numeric.map(({ key, label, min }) => <Field key={key} label={label} hint={min === 0 ? '0 表示不限制。' : undefined}><Input required type="number" step={1} min={min} value={policy[key]} onChange={event => setPolicy(old => ({ ...old, [key]: event.target.valueAsNumber }))} /></Field>)}</div><RetryFields value={policy.retry} keys={['connect', 'empty', 'stream']} onChange={(key, rule) => setPolicy(old => ({ ...old, retry: { ...old.retry, [key]: rule } }))} /><div className="tw-actions"><Button size="sm" type="submit" variant="primary">保存模型策略</Button><Button size="sm" type="button" onClick={onClose}>取消</Button></div></fieldset></form>;
}

function GlobalRetry({ initial, busy, act, refresh }: { initial: ModelRetryPolicy; busy: boolean; act: Act; refresh(): Promise<void> }) {
  const [patch, setPatch] = React.useState<Partial<ModelRetryPolicy>>({});
  const retry = { ...initial, ...patch };
  return <details className="tw-card"><summary>全局五层重试策略</summary><form className="tw-stack" onSubmit={event => { event.preventDefault(); void act(async () => { await requestJson(`${root}/model-retry`, { method: 'PUT', body: JSON.stringify(retry) }); await refresh(); setPatch({}); }, '全局重试策略已保存。'); }}><fieldset disabled={busy} className="tw-stack"><RetryFields value={retry} keys={['connect', 'empty', 'stream', 'breaker', 'intent']} onChange={(key, rule) => setPatch(old => ({ ...old, [key]: rule }))} /><div className="tw-actions"><Button type="submit" size="sm" variant="primary" disabled={!Object.keys(patch).length}>保存全局策略</Button><Button type="button" size="sm" disabled={!Object.keys(patch).length} onClick={() => setPatch({})}>撤销修改</Button></div></fieldset></form></details>;
}
