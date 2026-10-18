import React from 'react';
import { Button, Checkbox, Input } from '@deepseek-ai/dsh-client-ui-primitives';
import type { NewTaskInput, TaskCategory, TaskTemplate, TaskTemplateInput } from '../task-management/index.js';
import type { RedTeamTask } from '../types.js';

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="tw-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

export function CategorySelect({ categories, value, onChange, label = '任务分类' }: {
  categories: TaskCategory[]; value: string; onChange: (id: string) => void; label?: string;
}) {
  return <select aria-label={label} value={value} onChange={event => onChange(event.target.value)}><option value="">未分类</option>{categories.map(row => <option value={row.id} key={row.id}>{row.name}</option>)}</select>;
}

export function NewTaskForm({ categories, templates, tasks, busy, onCreate, onCancel }: {
  categories: TaskCategory[]; templates: TaskTemplate[]; tasks: RedTeamTask[]; busy: boolean;
  onCreate: (input: NewTaskInput) => Promise<boolean>; onCancel: () => void;
}) {
  const [templateId, setTemplateId] = React.useState('');
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [goal, setGoal] = React.useState('');
  const [categoryId, setCategoryId] = React.useState('');
  const [timeout, setTimeout] = React.useState('0');
  const [heartbeat, setHeartbeat] = React.useState('600');
  const [coverage, setCoverage] = React.useState(true);
  const [seed, setSeed] = React.useState(false);
  const [sources, setSources] = React.useState<string[]>([]);
  const template = templates.find(row => row.id === templateId);
  function useTemplate(id: string) {
    setTemplateId(id);
    const selected = templates.find(row => row.id === id);
    if (selected) { setDescription(selected.description); setGoal(selected.goal); setCategoryId(selected.categoryId ?? ''); }
  }
  return <form className="tw-stack" aria-label="新建任务表单" onSubmit={event => {
    event.preventDefault();
    void onCreate({ ...(title.trim() ? { title: title.trim() } : {}), description, goal, categoryId: categoryId || null,
      ...(templateId ? { templateId } : {}), timeoutSeconds: Number(timeout), planHeartbeatSeconds: Number(heartbeat),
      coverageEnabled: coverage, seedFirstIntent: seed, sourceTaskIds: sources });
  }}><fieldset disabled={busy} className="tw-stack">
    <div className="tw-grid">
      <Field label="使用模板"><select aria-label="使用模板" value={templateId} onChange={event => useTemplate(event.target.value)}><option value="">空白任务</option>{templates.map(row => <option value={row.id} key={row.id}>{row.name}</option>)}</select></Field>
      <Field label="任务分类"><CategorySelect categories={categories} value={categoryId} onChange={setCategoryId} /></Field>
    </div>
    {template && <p className="tw-muted tw-small">模板包含 {template.interceptRules.length} 条资产规则，创建时一并应用。</p>}
    <Field label="任务名称" hint="留空时从任务描述生成名称。"><Input aria-label="任务名称" maxLength={200} value={title} onChange={event => setTitle(event.target.value)} placeholder="例如：核验测试环境的登录流程" /></Field>
    <Field label="任务描述"><textarea aria-label="任务描述" required maxLength={16000} rows={4} value={description} onChange={event => setDescription(event.target.value)} placeholder="说明授权目标、背景和需要执行的工作。" /></Field>
    <Field label="任务目标" hint="Planner 会分解为可验证目标；无目标的直投任务可留空。"><textarea aria-label="任务目标" maxLength={16000} rows={3} value={goal} onChange={event => setGoal(event.target.value)} placeholder="写明预期结果和验收条件。" /></Field>
    <details><summary>执行设置与来源任务</summary><div className="tw-stack">
      <div className="tw-grid"><Field label="任务时限（秒）" hint="0 表示不限时；从实际模型运行开始计时。"><Input aria-label="任务时限（秒）" type="number" min={0} step={1} required value={timeout} onChange={event => setTimeout(event.target.value)} /></Field>
        <Field label="Planner 心跳（秒）" hint="至少 600 秒。"><Input aria-label="Planner 心跳（秒）" type="number" min={600} step={1} required value={heartbeat} onChange={event => setHeartbeat(event.target.value)} /></Field></div>
      <Checkbox checked={coverage} onChange={setCoverage} label="启用覆盖分析" />
      <Checkbox checked={seed} onChange={setSeed} label="将描述作为首个意图直接执行" />
      {tasks.length > 0 && <div className="tw-gap"><span>只读引用来源任务的事实和发现</span>{tasks.map(row => <Checkbox key={row.id} checked={sources.includes(row.id)} label={row.title} onChange={checked => setSources(values => checked ? [...values, row.id] : values.filter(id => id !== row.id))} />)}</div>}
    </div></details>
    <div className="tw-actions"><Button type="submit" size="sm" variant="primary">{busy ? '正在创建…' : '创建任务'}</Button><Button type="button" size="sm" onClick={onCancel}>取消</Button></div>
    <p className="tw-muted tw-small">创建后可检查目标与模型配置，再从当前会话启动。</p>
  </fieldset></form>;
}

export function TemplateForm({ value, categories, busy, onSave, onCancel }: {
  value?: TaskTemplate; categories: TaskCategory[]; busy: boolean;
  onSave: (input: TaskTemplateInput) => Promise<boolean>; onCancel: () => void;
}) {
  const [name, setName] = React.useState(value?.name ?? '');
  const [description, setDescription] = React.useState(value?.description ?? '');
  const [goal, setGoal] = React.useState(value?.goal ?? '');
  const [categoryId, setCategoryId] = React.useState(value?.categoryId ?? '');
  return <form className="tw-stack" aria-label="任务模板表单" onSubmit={event => { event.preventDefault(); void onSave({ name, description, goal, categoryId: categoryId || null, interceptRules: value?.interceptRules ?? [] }); }}>
    <fieldset disabled={busy} className="tw-stack">
      <Field label="模板名称"><Input aria-label="模板名称" required maxLength={120} value={name} onChange={event => setName(event.target.value)} /></Field>
      <Field label="模板分类"><CategorySelect label="模板分类" categories={categories} value={categoryId} onChange={setCategoryId} /></Field>
      <Field label="模板描述"><textarea aria-label="模板描述" required maxLength={16000} value={description} onChange={event => setDescription(event.target.value)} rows={3} /></Field>
      <Field label="模板目标"><textarea aria-label="模板目标" required maxLength={16000} value={goal} onChange={event => setGoal(event.target.value)} rows={3} /></Field>
      {value && value.interceptRules.length > 0 && <p className="tw-muted">保留模板现有的 {value.interceptRules.length} 条资产规则。</p>}
      <div className="tw-actions"><Button type="submit" variant="primary" size="sm">保存模板</Button><Button type="button" size="sm" onClick={onCancel}>取消编辑</Button></div>
    </fieldset>
  </form>;
}
