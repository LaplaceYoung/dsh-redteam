import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from 'react';
import { Button, Input, Tag } from '@deepseek-ai/dsh-client-ui-primitives';
import { apiUrl, requestJson, errorMessage, Field, Notice } from '../management-ui/shared.js';
import { ConfirmDelete, conversationPath, jsonBody, useOperation } from './client-common.js';
export function WorkspaceFilesPanel({ visible, initialPath = '' }) {
    const [path, setPath] = React.useState(initialPath), [pathInput, setPathInput] = React.useState(initialPath);
    const [entries, setEntries] = React.useState([]), [loading, setLoading] = React.useState(false), [loadError, setLoadError] = React.useState('');
    const [editor, setEditor] = React.useState(), [content, setContent] = React.useState(''), [dirty, setDirty] = React.useState(false);
    const [newPath, setNewPath] = React.useState(''), [revision, setRevision] = React.useState(0);
    const operation = useOperation();
    React.useEffect(() => {
        if (!visible)
            return;
        const controller = new AbortController();
        setLoading(true);
        void requestJson(apiUrl(`${conversationPath}/files/list`, { path }), { signal: controller.signal })
            .then(result => { if (!controller.signal.aborted) {
            setEntries(result.entries);
            setLoadError('');
        } })
            .catch(failure => { if (!controller.signal.aborted) {
            setEntries([]);
            setLoadError(errorMessage(failure));
        } })
            .finally(() => { if (!controller.signal.aborted)
            setLoading(false); });
        return () => controller.abort();
    }, [path, visible, revision]);
    const refresh = () => setRevision(value => value + 1);
    async function read(file) {
        await operation.run(async () => {
            const result = await requestJson(apiUrl(`${conversationPath}/files/read`, { path: file }));
            setEditor(result);
            setContent(result.content ?? '');
            setDirty(false);
        });
    }
    function navigate(value) { setPath(value); setPathInput(value); setEntries([]); }
    return _jsxs("div", { className: "tw-stack", children: [loadError && _jsx(Notice, { tone: "error", children: loadError }), operation.error && _jsx(Notice, { tone: "error", children: operation.error }), operation.notice && _jsx(Notice, { tone: "success", children: operation.notice }), _jsxs("form", { className: "tw-inline", onSubmit: event => { event.preventDefault(); navigate(pathInput); }, children: [_jsx(Input, { "aria-label": "\u5DE5\u4F5C\u533A\u76EE\u5F55", className: "tw-grow", value: pathInput, onChange: event => setPathInput(event.target.value), placeholder: "\u76F8\u5BF9\u5DE5\u4F5C\u533A\u8DEF\u5F84\uFF1B\u7559\u7A7A\u4E3A\u6839\u76EE\u5F55" }), _jsx(Button, { size: "sm", type: "submit", children: "\u6253\u5F00\u76EE\u5F55" }), _jsx(Button, { size: "sm", type: "button", disabled: loading, onClick: refresh, children: "\u5237\u65B0\u6587\u4EF6" }), path && _jsx(Button, { size: "sm", type: "button", onClick: () => navigate(path.split('/').slice(0, -1).join('/')), children: "\u4E0A\u7EA7\u76EE\u5F55" })] }), _jsxs("div", { className: "tw-card tw-stack", children: [_jsx("h3", { children: "\u65B0\u5EFA\u4E0E\u4E0A\u4F20" }), _jsx(Field, { label: "\u65B0\u6587\u4EF6\u6216\u76EE\u5F55\u8DEF\u5F84", hint: "\u76F8\u5BF9\u4E8E\u5DE5\u4F5C\u533A\u6839\u76EE\u5F55\uFF1B\u4E0A\u4F20\u76EE\u6807\u662F\u5F53\u524D\u6253\u5F00\u7684\u76EE\u5F55\u3002", children: _jsx(Input, { value: newPath, onChange: event => setNewPath(event.target.value), placeholder: path ? `${path}/notes.txt` : 'notes.txt' }) }), _jsxs("div", { className: "tw-actions", children: [_jsx(Button, { size: "sm", disabled: !newPath.trim() || operation.busy || dirty, onClick: () => { setEditor({ path: newPath.trim(), size: 0, binary: false, content: '' }); setContent(''); setDirty(true); }, children: "\u7F16\u8F91\u65B0\u6587\u4EF6" }), _jsx(Button, { size: "sm", disabled: !newPath.trim() || operation.busy, onClick: () => { void operation.run(async () => { await requestJson(`${conversationPath}/files/mkdir`, jsonBody({ path: newPath.trim() })); refresh(); }, '目录已创建'); }, children: "\u521B\u5EFA\u76EE\u5F55" }), _jsxs("label", { className: "tw-field", children: [_jsx("span", { children: "\u4E0A\u4F20\u5230\u5F53\u524D\u76EE\u5F55\uFF08\u540C\u540D\u6587\u4EF6\u4F1A\u8986\u76D6\uFF09" }), _jsx("input", { "aria-label": "\u4E0A\u4F20\u5DE5\u4F5C\u533A\u6587\u4EF6", type: "file", multiple: true, disabled: operation.busy, onChange: event => {
                                            const files = Array.from(event.target.files ?? []);
                                            event.target.value = '';
                                            if (!files.length)
                                                return;
                                            void operation.run(async () => { const form = new FormData(); for (const file of files)
                                                form.append('file', file); await requestJson(apiUrl(`${conversationPath}/files/upload`, { path }), { method: 'POST', body: form }); refresh(); }, '文件已上传');
                                        } })] })] })] }), loading && _jsx("p", { role: "status", children: "\u6B63\u5728\u8BFB\u53D6\u76EE\u5F55\u2026" }), !loading && !loadError && !entries.length && _jsx("p", { className: "tw-muted", children: "\u6B64\u76EE\u5F55\u6CA1\u6709\u6587\u4EF6\u3002" }), _jsx("div", { className: "mg-list", children: entries.map(entry => _jsxs("article", { className: "tw-card tw-gap", children: [_jsxs("div", { className: "tw-card-head", children: [_jsxs("div", { className: "tw-grow", children: [_jsx("strong", { className: "tw-title", children: entry.name }), _jsxs("div", { className: "mg-meta", children: [_jsx("span", { children: entry.dir ? '目录' : `${entry.size.toLocaleString()} 字节` }), _jsx("span", { children: new Date(entry.mtime).toLocaleString() })] })] }), _jsx(Tag, { tone: "outline", children: entry.dir ? '目录' : '文件' })] }), _jsxs("div", { className: "tw-actions", children: [_jsx(Button, { size: "sm", disabled: operation.busy || (!entry.dir && dirty), onClick: () => entry.dir ? navigate(entry.path) : void read(entry.path), children: entry.dir ? '进入目录' : '查看 / 编辑' }), !entry.dir && _jsx("a", { href: apiUrl(`${conversationPath}/files/download`, { path: entry.path }).href, download: entry.name, children: "\u4E0B\u8F7D" }), _jsx(ConfirmDelete, { label: "\u5220\u9664\u6587\u4EF6\u6216\u76EE\u5F55", description: `将永久删除 ${entry.path}${entry.dir ? ' 及其中全部文件' : ''}。`, disabled: operation.busy || (dirty && editor?.path === entry.path), onConfirm: () => operation.run(async () => {
                                        await requestJson(apiUrl(`${conversationPath}/files/delete`, { path: entry.path }), { method: 'DELETE' });
                                        if (editor?.path === entry.path) {
                                            setEditor(undefined);
                                            setDirty(false);
                                        }
                                        refresh();
                                    }, '已删除') })] })] }, entry.path)) }), editor && _jsxs("section", { className: "tw-card tw-stack", "aria-label": "\u6587\u4EF6\u7F16\u8F91\u5668", children: [_jsxs("div", { className: "tw-card-head", children: [_jsx("h3", { className: "tw-title", children: editor.path }), dirty && _jsx(Tag, { tone: "warning", children: "\u672A\u4FDD\u5B58" })] }), editor.binary ? _jsx(Notice, { children: editor.too_large ? '文件超过 2 MiB 预览上限，请下载查看。' : '此文件为二进制或非 UTF-8 内容，请下载查看。' }) : _jsx(Field, { label: "\u6587\u4EF6\u5185\u5BB9", children: _jsx("textarea", { "aria-label": "\u6587\u4EF6\u5185\u5BB9", rows: 16, value: content, onChange: event => { setContent(event.target.value); setDirty(true); } }) }), _jsxs("div", { className: "tw-actions", children: [!editor.binary && _jsx(Button, { size: "sm", variant: "primary", disabled: !dirty || operation.busy, onClick: () => {
                                    void operation.run(async () => {
                                        await requestJson(`${conversationPath}/files/write`, jsonBody({ path: editor.path, content }));
                                        setDirty(false);
                                        refresh();
                                    }, '文件已保存');
                                }, children: "\u4FDD\u5B58\u6587\u4EF6" }), _jsx("a", { href: apiUrl(`${conversationPath}/files/download`, { path: editor.path }).href, download: true, children: "\u4E0B\u8F7D\u6587\u4EF6" }), dirty ? _jsx(ConfirmDelete, { label: "\u653E\u5F03\u7F16\u8F91", description: "\u672A\u4FDD\u5B58\u7684\u6587\u4EF6\u5185\u5BB9\u5C06\u4E22\u5931\u3002", disabled: operation.busy, onConfirm: async () => { setEditor(undefined); setDirty(false); } }) : _jsx(Button, { size: "sm", onClick: () => setEditor(undefined), children: "\u5173\u95ED\u6587\u4EF6" })] })] })] });
}
