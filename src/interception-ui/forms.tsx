import React from 'react';
import { Button, Checkbox, Input } from '@deepseek-ai/dsh-client-ui-primitives';
import { Field } from '../task-workspace/forms.js';
import { request, type JudgeConfig, type Rule, type RuleInput, type Settings } from './api.js';

const freshRule = (): RuleInput => ({ name: '', enabled: true, priority: 0, matchTarget: 'tool_name', matchType: 'string', pattern: '', action: 'ask', message: '', timeoutEnabled: true, timeoutSeconds: 300, timeoutAction: 'deny' });
function ActionSelect({ label, value, change, ask = true }: { label: string; value: string; change: (value: string) => void; ask?: boolean }) {
  return <select aria-label={label} value={value} onChange={event => change(event.target.value)}><option value="allow">允许</option><option value="deny">拒绝</option>{ask && <option value="ask">人工审批</option>}</select>;
}
export function RuleForm({ value, onSaved, onCancel }: { value?: Rule; onSaved: () => void; onCancel: () => void }) {
  const [form, setForm] = React.useState<RuleInput>(() => value ? { name: value.name, enabled: value.enabled, priority: value.priority, matchTarget: value.matchTarget, matchType: value.matchType, pattern: value.pattern, action: value.action, message: value.message, timeoutEnabled: value.timeoutEnabled, timeoutSeconds: value.timeoutSeconds, timeoutAction: value.timeoutAction, ...(value.taskId ? { taskId: value.taskId } : {}) } : freshRule());
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
  const patch = (update: Partial<RuleInput>) => setForm(current => ({ ...current, ...update }));
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    try { await request(`rules${value ? '/' + encodeURIComponent(value.id) : ''}`, { method: value ? 'PUT' : 'POST', body: form }); onSaved(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setBusy(false); }
  }
  return <form className="tw-stack" aria-label={value ? '编辑拦截规则' : '新建拦截规则'} onSubmit={event => { void save(event); }}>
    {error && <div role="alert">{error}</div>}<fieldset disabled={busy} className="tw-stack">
      <Field label="规则名称"><Input aria-label="规则名称" required value={form.name} onChange={event => patch({ name: event.target.value })} /></Field>
      <Field label="任务 ID" hint="留空应用于所有任务。"><Input aria-label="规则任务 ID" value={form.taskId ?? ''} onChange={event => { const taskId = event.target.value; setForm(current => { const next = { ...current }; if (taskId) next.taskId = taskId; else delete next.taskId; return next; }); }} /></Field>
      <Checkbox label="启用规则" checked={form.enabled} onChange={enabled => patch({ enabled })} />
      <div className="tw-grid"><Field label="优先级" hint="数值越大越先匹配。"><Input aria-label="优先级" type="number" step={1} required value={form.priority} onChange={event => patch({ priority: Number(event.target.value) })} /></Field>
        <Field label="匹配对象"><select aria-label="匹配对象" value={form.matchTarget} onChange={event => patch({ matchTarget: event.target.value as RuleInput['matchTarget'] })}><option value="tool_name">工具名称</option><option value="tool_input">工具参数</option></select></Field>
        <Field label="匹配方式"><select aria-label="匹配方式" value={form.matchType} onChange={event => patch({ matchType: event.target.value as RuleInput['matchType'] })}><option value="string">包含字符串</option><option value="regex">正则表达式（RE2）</option></select></Field>
        <Field label="命中后操作"><ActionSelect label="命中后操作" value={form.action} change={action => patch({ action: action as RuleInput['action'] })} /></Field></div>
      <Field label="匹配表达式"><textarea aria-label="匹配表达式" rows={3} required value={form.pattern} onChange={event => patch({ pattern: event.target.value })} /></Field>
      <Field label="判定说明"><textarea aria-label="判定说明" rows={3} value={form.message} onChange={event => patch({ message: event.target.value })} /></Field>
      <Checkbox label="启用审批超时" checked={form.timeoutEnabled} onChange={timeoutEnabled => patch({ timeoutEnabled })} />
      <div className="tw-grid"><Field label="审批超时（秒）"><Input aria-label="审批超时（秒）" type="number" step={1} required value={form.timeoutSeconds} onChange={event => patch({ timeoutSeconds: Number(event.target.value) })} /></Field>
        <Field label="超时操作"><ActionSelect label="超时操作" ask={false} value={form.timeoutAction} change={timeoutAction => patch({ timeoutAction: timeoutAction as RuleInput['timeoutAction'] })} /></Field></div>
      <div className="tw-actions"><Button type="submit" size="sm" variant="primary">{busy ? '保存中…' : '保存规则'}</Button><Button type="button" size="sm" onClick={onCancel}>取消</Button></div>
    </fieldset></form>;
}

export function JudgeSettings({ initial }: { initial: Settings }) {
  const [judge, setJudge] = React.useState(initial.judge), [tools, setTools] = React.useState(initial.enabledTools.join('\n'));
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState(''), [notice, setNotice] = React.useState('');
  const patch = (value: Partial<JudgeConfig>) => setJudge(current => ({ ...current, ...value }));
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError(''); setNotice('');
    try {
      const saved = await request<Settings>('settings', { method: 'PUT', body: { enabledTools: tools.split('\n').map(row => row.trim()).filter(Boolean), judge } });
      setTools(saved.enabledTools.join('\n')); setJudge(saved.judge); setNotice('审批设置已保存');
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setBusy(false); }
  }
  return <form aria-label="审批设置" className="tw-stack" onSubmit={event => { void save(event); }}>
    {error && <div role="alert">{error}</div>}{notice && <div role="status">{notice}</div>}<fieldset disabled={busy} className="tw-stack">
      <Field label="纳入拦截的工具" hint="每行一个准确工具名；留空表示没有工具进入拦截。"><textarea aria-label="纳入拦截的工具" rows={5} value={tools} onChange={event => setTools(event.target.value)} /></Field>
      <Checkbox label="启用模型判定" checked={judge.enabled} onChange={enabled => patch({ enabled })} />
      <Field label="判定模型配置 ID" hint="填写任务工作台中已注册的模型配置 ID；留空按运行时默认模型路由。"><Input aria-label="判定模型配置 ID" value={judge.profileId ?? ''} onChange={event => patch({ profileId: event.target.value || null })} /></Field>
      <Field label="判定提示词" hint="留空恢复原版默认提示词；服务会保留输入边界和输出契约。"><textarea aria-label="判定提示词" rows={12} value={judge.prompt} onChange={event => patch({ prompt: event.target.value })} /></Field>
      <div className="tw-grid"><Field label="模型判定超时（秒）"><Input aria-label="模型判定超时（秒）" required type="number" min={1} step={1} value={judge.timeoutSeconds} onChange={event => patch({ timeoutSeconds: Number(event.target.value) })} /></Field>
        <Field label="模型判定失败时"><ActionSelect label="模型判定失败时" value={judge.failAction} change={failAction => patch({ failAction: failAction as JudgeConfig['failAction'] })} /></Field>
        <Field label="模型转人工超时（秒）"><Input aria-label="模型转人工超时（秒）" required type="number" min={1} step={1} value={judge.askTimeoutSeconds} onChange={event => patch({ askTimeoutSeconds: Number(event.target.value) })} /></Field>
        <Field label="模型转人工超时操作"><ActionSelect label="模型转人工超时操作" ask={false} value={judge.askTimeoutAction} change={askTimeoutAction => patch({ askTimeoutAction: askTimeoutAction as JudgeConfig['askTimeoutAction'] })} /></Field></div>
      <Button type="submit" size="sm" variant="primary">{busy ? '保存中…' : '保存审批设置'}</Button>
    </fieldset></form>;
}
