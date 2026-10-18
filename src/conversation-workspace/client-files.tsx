import React from 'react';
import { Button, Input, Tag } from '@deepseek-ai/dsh-client-ui-primitives';
import { apiUrl, requestJson, errorMessage, Field, Notice } from '../management-ui/shared.js';
import type { WorkspaceEntry, WorkspaceRead } from './files.js';
import { ConfirmDelete, conversationPath, jsonBody, useOperation } from './client-common.js';

export function WorkspaceFilesPanel({ visible, initialPath = '' }: { visible: boolean; initialPath?: string }) {
  const [path, setPath] = React.useState(initialPath), [pathInput, setPathInput] = React.useState(initialPath);
  const [entries, setEntries] = React.useState<WorkspaceEntry[]>([]), [loading, setLoading] = React.useState(false), [loadError, setLoadError] = React.useState('');
  const [editor, setEditor] = React.useState<WorkspaceRead>(), [content, setContent] = React.useState(''), [dirty, setDirty] = React.useState(false);
  const [newPath, setNewPath] = React.useState(''), [revision, setRevision] = React.useState(0);
  const operation = useOperation();
  React.useEffect(() => {
    if (!visible) return;
    const controller = new AbortController(); setLoading(true);
    void requestJson<{ path: string; entries: WorkspaceEntry[] }>(apiUrl(`${conversationPath}/files/list`, { path }), { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) { setEntries(result.entries); setLoadError(''); } })
      .catch(failure => { if (!controller.signal.aborted) { setEntries([]); setLoadError(errorMessage(failure)); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [path, visible, revision]);
  const refresh = () => setRevision(value => value + 1);
  async function read(file: string) {
    await operation.run(async () => {
      const result = await requestJson<WorkspaceRead>(apiUrl(`${conversationPath}/files/read`, { path: file }));
      setEditor(result); setContent(result.content ?? ''); setDirty(false);
    });
  }
  function navigate(value: string) { setPath(value); setPathInput(value); setEntries([]); }
  return <div className="tw-stack">
    {loadError && <Notice tone="error">{loadError}</Notice>}{operation.error && <Notice tone="error">{operation.error}</Notice>}{operation.notice && <Notice tone="success">{operation.notice}</Notice>}
    <form className="tw-inline" onSubmit={event => { event.preventDefault(); navigate(pathInput); }}>
      <Input aria-label="工作区目录" className="tw-grow" value={pathInput} onChange={event => setPathInput(event.target.value)} placeholder="相对工作区路径；留空为根目录" />
      <Button size="sm" type="submit">打开目录</Button><Button size="sm" type="button" disabled={loading} onClick={refresh}>刷新文件</Button>
      {path && <Button size="sm" type="button" onClick={() => navigate(path.split('/').slice(0, -1).join('/'))}>上级目录</Button>}
    </form>
    <div className="tw-card tw-stack"><h3>新建与上传</h3>
      <Field label="新文件或目录路径" hint="相对于工作区根目录；上传目标是当前打开的目录。"><Input value={newPath} onChange={event => setNewPath(event.target.value)} placeholder={path ? `${path}/notes.txt` : 'notes.txt'} /></Field>
      <div className="tw-actions"><Button size="sm" disabled={!newPath.trim() || operation.busy || dirty} onClick={() => { setEditor({ path: newPath.trim(), size: 0, binary: false, content: '' }); setContent(''); setDirty(true); }}>编辑新文件</Button>
        <Button size="sm" disabled={!newPath.trim() || operation.busy} onClick={() => { void operation.run(async () => { await requestJson(`${conversationPath}/files/mkdir`, jsonBody({ path: newPath.trim() })); refresh(); }, '目录已创建'); }}>创建目录</Button>
        <label className="tw-field"><span>上传到当前目录（同名文件会覆盖）</span><input aria-label="上传工作区文件" type="file" multiple disabled={operation.busy} onChange={event => {
          const files = Array.from(event.target.files ?? []); event.target.value = ''; if (!files.length) return;
          void operation.run(async () => { const form = new FormData(); for (const file of files) form.append('file', file); await requestJson(apiUrl(`${conversationPath}/files/upload`, { path }), { method: 'POST', body: form }); refresh(); }, '文件已上传');
        }} /></label>
      </div>
    </div>
    {loading && <p role="status">正在读取目录…</p>}
    {!loading && !loadError && !entries.length && <p className="tw-muted">此目录没有文件。</p>}
    <div className="mg-list">{entries.map(entry => <article key={entry.path} className="tw-card tw-gap">
      <div className="tw-card-head"><div className="tw-grow"><strong className="tw-title">{entry.name}</strong><div className="mg-meta"><span>{entry.dir ? '目录' : `${entry.size.toLocaleString()} 字节`}</span><span>{new Date(entry.mtime).toLocaleString()}</span></div></div><Tag tone="outline">{entry.dir ? '目录' : '文件'}</Tag></div>
      <div className="tw-actions"><Button size="sm" disabled={operation.busy || (!entry.dir && dirty)} onClick={() => entry.dir ? navigate(entry.path) : void read(entry.path)}>{entry.dir ? '进入目录' : '查看 / 编辑'}</Button>
        {!entry.dir && <a href={apiUrl(`${conversationPath}/files/download`, { path: entry.path }).href} download={entry.name}>下载</a>}
        <ConfirmDelete label="删除文件或目录" description={`将永久删除 ${entry.path}${entry.dir ? ' 及其中全部文件' : ''}。`} disabled={operation.busy || (dirty && editor?.path === entry.path)} onConfirm={() => operation.run(async () => {
          await requestJson(apiUrl(`${conversationPath}/files/delete`, { path: entry.path }), { method: 'DELETE' });
          if (editor?.path === entry.path) { setEditor(undefined); setDirty(false); } refresh();
        }, '已删除')} />
      </div>
    </article>)}</div>
    {editor && <section className="tw-card tw-stack" aria-label="文件编辑器"><div className="tw-card-head"><h3 className="tw-title">{editor.path}</h3>{dirty && <Tag tone="warning">未保存</Tag>}</div>
      {editor.binary ? <Notice>{editor.too_large ? '文件超过 2 MiB 预览上限，请下载查看。' : '此文件为二进制或非 UTF-8 内容，请下载查看。'}</Notice> : <Field label="文件内容"><textarea aria-label="文件内容" rows={16} value={content} onChange={event => { setContent(event.target.value); setDirty(true); }} /></Field>}
      <div className="tw-actions">{!editor.binary && <Button size="sm" variant="primary" disabled={!dirty || operation.busy} onClick={() => { void operation.run(async () => {
        await requestJson(`${conversationPath}/files/write`, jsonBody({ path: editor.path, content })); setDirty(false); refresh();
      }, '文件已保存'); }}>保存文件</Button>}
      <a href={apiUrl(`${conversationPath}/files/download`, { path: editor.path }).href} download>下载文件</a>
      {dirty ? <ConfirmDelete label="放弃编辑" description="未保存的文件内容将丢失。" disabled={operation.busy} onConfirm={async () => { setEditor(undefined); setDirty(false); }} /> : <Button size="sm" onClick={() => setEditor(undefined)}>关闭文件</Button>}</div>
    </section>}
  </div>;
}
