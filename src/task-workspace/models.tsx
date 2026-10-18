import React from 'react';
import { Button, Input, Tag } from '@deepseek-ai/dsh-client-ui-primitives';
import type { RedTeamTask } from '../types.js';
import type { TaskWorkspace, TaskWorkspaceAction } from './contracts.js';
import { Field } from './forms.js';
import { DeleteAction } from './records.js';

export function ModelsEditor({ task, workspace, busy, act }: {
  task: RedTeamTask; workspace: TaskWorkspace; busy: boolean; act: (action: TaskWorkspaceAction) => Promise<boolean>;
}) {
  const chain = task.llmChain;
  const [ids, setIds] = React.useState(() => [...(chain?.profiles ?? [])].sort((a, b) => a.position - b.position).map(row => row.profileId));
  const [activeId, setActiveId] = React.useState(chain?.activeProfileId ?? '');
  const [dirty, setDirty] = React.useState(false);
  const [candidate, setCandidate] = React.useState('');
  const [creating, setCreating] = React.useState(false);
  const [editingProfile, setEditingProfile] = React.useState<string>();
  const profile = (id: string) => workspace.profiles.find(row => row.id === id);
  React.useEffect(() => {
    if (dirty) return;
    setIds([...(chain?.profiles ?? [])].sort((a, b) => a.position - b.position).map(row => row.profileId));
    setActiveId(chain?.activeProfileId ?? '');
  }, [chain, dirty]);
  const move = (index: number, delta: number) => {
    setDirty(true);
    setIds(prior => { const next = [...prior]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; return next; });
  };
  return <div className="tw-stack">
    <div className="tw-gap"><h3>任务模型链</h3><p className="tw-muted">按顺序选择真实模型配置，额度耗尽时由运行时切换。空链按角色、全局配置及当前会话继承。</p></div>
    {ids.length === 0 && <div className="tw-card tw-muted">当前未指定任务模型链。</div>}
    {ids.map((id, index) => {
      const entry = profile(id), state = chain?.profiles.find(row => row.profileId === id);
      return <article key={id} className="tw-card tw-gap" aria-label={`模型链配置：${entry?.name ?? id}`}><div className="tw-card-head"><span className="tw-order">{index + 1}</span><div className="tw-grow"><strong>{entry?.name ?? '配置已不存在'}</strong><p className="tw-muted tw-small">{entry ? `${entry.provider} / ${entry.model}` : id}</p></div><Tag tone={state?.status === 'quota_exhausted' || entry?.available === false ? 'warning' : 'info'}>{state?.status === 'quota_exhausted' ? '额度耗尽' : entry?.available === false ? '不可用' : '可用'}</Tag></div>
        {(state?.lastError || entry?.reason) && <p className="tw-muted tw-small tw-description">{state?.lastError || entry?.reason}</p>}
        <div className="tw-actions"><Button size="sm" disabled={busy || index === 0} aria-label={`上移${entry?.name ?? id}`} onClick={() => move(index, -1)}>上移</Button><Button size="sm" disabled={busy || index === ids.length - 1} aria-label={`下移${entry?.name ?? id}`} onClick={() => move(index, 1)}>下移</Button><Button size="sm" disabled={busy} aria-label={`移出${entry?.name ?? id}`} onClick={() => { setDirty(true); setIds(prior => prior.filter(value => value !== id)); if (activeId === id) setActiveId(''); }}>移出链</Button></div>
      </article>;
    })}
    <div className="tw-inline"><select className="tw-grow" aria-label="添加模型配置" disabled={busy} value={candidate} onChange={event => setCandidate(event.target.value)}><option value="">选择已有模型配置</option>{workspace.profiles.filter(row => !ids.includes(row.id)).map(row => <option key={row.id} value={row.id}>{row.name}{row.available ? '' : '（不可用）'}</option>)}</select><Button size="sm" disabled={busy || !candidate} onClick={() => { setDirty(true); setIds(prior => [...prior, candidate]); setCandidate(''); }}>加入链</Button></div>
    {ids.length > 0 && <Field label="从哪个配置开始"><select aria-label="当前模型配置" disabled={busy} value={activeId} onChange={event => { setDirty(true); setActiveId(event.target.value); }}><option value="">从第一项开始</option>{ids.map(id => <option value={id} key={id}>{profile(id)?.name ?? id}</option>)}</select></Field>}
    <div className="tw-actions"><Button size="sm" variant="primary" disabled={busy} onClick={async () => { if (await act({ action: 'chain.set', taskId: task.id, profileIds: ids, activeProfileId: activeId || null })) setDirty(false); }}>保存模型链</Button><Button size="sm" disabled={busy || ids.length === 0} onClick={() => { setDirty(true); setIds([]); setActiveId(''); }}>清空选择</Button></div>
    {dirty && <p className="tw-muted tw-small" role="status">模型链有未保存的修改。</p>}
    <p className="tw-muted tw-small">保存会重置链内的额度耗尽标记。清空选择后需保存才会生效。</p>
    <section className="tw-stack tw-section" aria-label="模型配置管理"><div className="tw-inline"><h3 className="tw-grow">可用配置</h3><Button size="sm" disabled={busy} onClick={() => { setEditingProfile(undefined); setCreating(value => !value); }}>{creating ? '收起配置表单' : '新建模型配置'}</Button></div>
      {creating && <ProfileForm key={editingProfile ?? 'new'} value={profile(editingProfile ?? '')} workspace={workspace} busy={busy} onSave={async input => { const ok = await act({ action: 'profile.upsert', input }); if (ok) setCreating(false); return ok; }} />}
      {!workspace.profiles.length && <p className="tw-muted">尚未创建配置。可从 DSH 已注册的 provider 和模型中选择；凭证仍由 DSH 管理。</p>}
      {workspace.profiles.map(row => <div className="tw-record tw-gap" key={row.id}><div className="tw-card-head"><div className="tw-grow"><strong>{row.name}</strong><p className="tw-muted tw-small">{row.provider} / {row.model}</p></div><Tag tone={row.available ? 'success' : 'warning'}>{row.available ? '已就绪' : '不可用'}</Tag></div>{row.reason && <p className="tw-muted tw-small">{row.reason}</p>}<div className="tw-actions"><Button size="sm" disabled={busy} onClick={() => { setEditingProfile(row.id); setCreating(true); }}>编辑配置 {row.name}</Button><DeleteAction label={`删除配置 ${row.name}`} disabled={busy} onDelete={() => act({ action: 'profile.delete', id: row.id })} /></div></div>)}
      {workspace.profiles.length > 0 && <p className="tw-muted tw-small">删除配置会移除各任务对它的引用；正在使用的全局配置须先在宿主中切换。</p>}
    </section>
  </div>;
}

function ProfileForm({ value, workspace, busy, onSave }: {
  value?: TaskWorkspace['profiles'][number]; workspace: TaskWorkspace; busy: boolean; onSave: (input: Extract<TaskWorkspaceAction, { action: 'profile.upsert' }>['input']) => Promise<boolean>;
}) {
  const [name, setName] = React.useState(value?.name ?? '');
  const [provider, setProvider] = React.useState(value?.provider ?? '');
  const [model, setModel] = React.useState(value?.model ?? '');
  const [effort, setEffort] = React.useState(value?.reasoningEffort ?? '');
  const [maxTokens, setMaxTokens] = React.useState(value?.maxTokens?.toString() ?? '');
  const models = workspace.catalog.models.filter(row => row.provider === provider);
  const selected = models.find(row => row.id === model);
  return <form className="tw-card tw-stack" aria-label={value ? '编辑模型配置表单' : '新建模型配置表单'} onSubmit={event => {
    event.preventDefault(); void onSave({ ...(value ? { id: value.id } : {}), name, provider, model, ...(maxTokens ? { maxTokens: Number(maxTokens) } : {}), ...(effort ? { reasoningEffort: effort } : {}) });
  }}><fieldset disabled={busy} className="tw-stack">
    <Field label="配置名称"><Input aria-label="配置名称" required value={name} onChange={event => setName(event.target.value)} /></Field>
    <Field label="模型提供方"><select aria-label="模型提供方" required value={provider} onChange={event => { setProvider(event.target.value); setModel(''); setEffort(''); }}><option value="">选择 DSH 提供方</option>{workspace.catalog.providers.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field>
    <Field label="模型"><select aria-label="模型" required value={model} onChange={event => { setModel(event.target.value); setEffort(''); }}><option value="">选择模型</option>{models.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field>
    {selected && selected.reasoningEfforts.length > 0 && <Field label="推理强度"><select aria-label="推理强度" value={effort} onChange={event => setEffort(event.target.value)}><option value="">模型默认值</option>{selected.reasoningEfforts.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field>}
    <Field label="最大输出 token" hint="留空时使用宿主默认值。"><Input aria-label="最大输出 token" type="number" min={1} step={1} value={maxTokens} onChange={event => setMaxTokens(event.target.value)} /></Field>
    <Button type="submit" size="sm" variant="primary">保存模型配置</Button>
  </fieldset></form>;
}
