import React from 'react';
import { Button, Input, Tag } from '@deepseek-ai/dsh-client-ui-primitives';
import type { Goal, Constraint, ScopeEntry } from '../types.js';
import { Field } from './forms.js';

export function DeleteAction({ label, disabled, onDelete }: { label: string; disabled: boolean; onDelete: () => Promise<boolean> }) {
  const [confirming, setConfirming] = React.useState(false);
  return confirming ? <span className="tw-inline" role="group" aria-label={`确认${label}`}><span className="tw-small">确认{label}？</span><Button type="button" size="sm" disabled={disabled} onClick={() => { void onDelete().then(ok => { if (ok) setConfirming(false); }); }}>确认删除</Button><Button type="button" size="sm" disabled={disabled} onClick={() => setConfirming(false)}>取消</Button></span>
    : <Button type="button" size="sm" disabled={disabled} onClick={() => setConfirming(true)}>{label}</Button>;
}

export function GoalsEditor({ goals, busy, onSave, onDelete }: {
  goals: Goal[]; busy: boolean; onSave: (id: string | undefined, text: string) => Promise<boolean>; onDelete: (id: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = React.useState<string>();
  const [text, setText] = React.useState('');
  const shown = goals.filter(goal => goal.state !== 'deleted');
  return <div className="tw-stack">
    <div className="tw-inline"><h3 className="tw-grow">可验证目标</h3><span className="tw-muted">{shown.filter(goal => goal.state === 'met').length} / {shown.length} 已达成</span></div>
    {shown.length === 0 && <p className="tw-muted">还没有分解目标。任务启动时 Planner 会从任务描述与目标初始化，也可在此添加。</p>}
    <div>{shown.map(goal => <article className="tw-record tw-gap" key={goal.id} aria-label={`目标：${goal.text}`}>
      <div className="tw-card-head"><p className="tw-row-content">{goal.text}</p><Tag tone={goal.state === 'met' ? 'success' : 'outline'}>{goal.state === 'met' ? '已证明' : '待验证'}</Tag></div>
      <div className="tw-actions"><Button size="sm" disabled={busy} onClick={() => { setEditing(goal.id); setText(goal.text); }}>编辑目标</Button><DeleteAction label="删除目标" disabled={busy} onDelete={() => onDelete(goal.id)} /></div>
    </article>)}</div>
    <form className="tw-stack tw-section" aria-label="目标编辑表单" onSubmit={event => { event.preventDefault(); void onSave(editing, text).then(ok => { if (ok) { setEditing(undefined); setText(''); } }); }}>
      <Field label={editing ? '编辑目标内容' : '新增目标'}><textarea aria-label="目标内容" required rows={3} value={text} disabled={busy} onChange={event => setText(event.target.value)} placeholder="描述可由证据验证的结果。" /></Field>
      <div className="tw-actions"><Button type="submit" size="sm" variant="primary" disabled={busy}>{editing ? '保存目标' : '添加目标'}</Button>{editing && <Button type="button" size="sm" disabled={busy} onClick={() => { setEditing(undefined); setText(''); }}>取消编辑</Button>}</div>
    </form>
  </div>;
}

export function ConstraintsEditor({ constraints, scopes, busy, onSave, onDelete }: {
  constraints: Constraint[]; scopes: ScopeEntry[]; busy: boolean;
  onSave: (id: string | undefined, text: string, kind: 'allow' | 'deny') => Promise<boolean>; onDelete: (id: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = React.useState<string>();
  const [text, setText] = React.useState('');
  const [kind, setKind] = React.useState<'allow' | 'deny'>('deny');
  return <div className="tw-stack"><h3>任务约束</h3>
    {constraints.length === 0 && <p className="tw-muted">尚无约束。可以明确允许的范围和禁止的操作。</p>}
    <div>{constraints.map(row => <article className="tw-record tw-gap" key={row.id} aria-label={`约束：${row.text}`}>
      <div className="tw-card-head"><p className="tw-row-content">{row.text}</p><Tag tone={row.kind === 'deny' ? 'warning' : 'info'}>{row.kind === 'deny' ? '禁止' : '允许'}</Tag></div>
      <div className="tw-actions"><Button size="sm" disabled={busy} onClick={() => { setEditing(row.id); setText(row.text); setKind(row.kind); }}>编辑约束</Button><DeleteAction label="删除约束" disabled={busy} onDelete={() => onDelete(row.id)} /></div>
    </article>)}</div>
    <form className="tw-stack tw-section" aria-label="约束编辑表单" onSubmit={event => { event.preventDefault(); void onSave(editing, text, kind).then(ok => { if (ok) { setEditing(undefined); setText(''); } }); }}>
      <Field label="约束类型"><select aria-label="约束类型" disabled={busy} value={kind} onChange={event => setKind(event.target.value as 'allow' | 'deny')}><option value="deny">禁止</option><option value="allow">允许</option></select></Field>
      <Field label="约束内容"><Input aria-label="约束内容" required disabled={busy} value={text} onChange={event => setText(event.target.value)} placeholder="例如：只使用测试账号，不修改生产数据" /></Field>
      <div className="tw-actions"><Button type="submit" size="sm" variant="primary" disabled={busy}>{editing ? '保存约束' : '添加约束'}</Button>{editing && <Button type="button" size="sm" onClick={() => { setEditing(undefined); setText(''); }}>取消编辑</Button>}</div>
    </form>
    <section className="tw-stack tw-section" aria-label="任务范围"><h3>任务范围</h3>{scopes.length === 0 ? <p className="tw-muted">尚无范围条目。初始化结果将在这里显示。</p> : scopes.map(row => <div className="tw-inline" key={row.id}><Tag>{row.kind}</Tag><span className="tw-row-content">{row.value}</span></div>)}</section>
  </div>;
}
