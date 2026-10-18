import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives';
import { apiUrl, errorMessage, Field, JsonDetails, ManagementPage, Notice, requestJson } from '../management-ui/shared.js';
export function HostManagementPage({ visible = true }) {
    const [health, setHealth] = useState();
    const [stats, setStats] = useState();
    const [logs, setLogs] = useState([]);
    const [update, setUpdate] = useState();
    const [updateAvailable, setUpdateAvailable] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [spec, setSpec] = useState('');
    const [busy, setBusy] = useState(false);
    const refresh = async () => { setError(''); const results = await Promise.allSettled([requestJson('/api/redteam/host/health'), requestJson('/api/redteam/host/stats'), requestJson('/api/redteam/host/logs?limit=100'), requestJson('/api/redteam/host/update/check')]); const [h, s, l, u] = results; if (h.status === 'fulfilled')
        setHealth(h.value); if (s.status === 'fulfilled')
        setStats(s.value); if (l.status === 'fulfilled')
        setLogs(l.value.items); if (u.status === 'fulfilled') {
        setUpdate(u.value);
        setUpdateAvailable(true);
    }
    else {
        setUpdateAvailable(false);
        setUpdate(undefined);
    } const core = results.slice(0, 3).filter(result => result.status === 'rejected'); if (core.length)
        setError(core.map(result => errorMessage(result.reason)).join('\n')); };
    useEffect(() => { if (visible)
        void refresh(); }, [visible]);
    useEffect(() => {
        if (!visible)
            return;
        const source = new EventSource(apiUrl('/api/redteam/host/logs/stream').toString(), { withCredentials: true });
        source.onmessage = event => { try {
            const row = JSON.parse(event.data);
            setLogs(current => [...current, row].slice(-200));
        }
        catch { /* malformed events are ignored by the browser client */ } };
        source.onerror = () => source.close();
        return () => source.close();
    }, [visible]);
    const loadHistory = async () => { const before = logs[0]?.seq; if (!before || busy)
        return; setBusy(true); try {
        const result = await requestJson('/api/redteam/host/logs/history?before=' + encodeURIComponent(String(before)) + '&limit=100');
        setLogs(current => [...result.items, ...current.filter(row => !result.items.some(item => item.seq === row.seq))]);
    }
    catch (cause) {
        setError(errorMessage(cause));
    }
    finally {
        setBusy(false);
    } };
    const apply = async () => { if (busy)
        return; setBusy(true); try {
        setError('');
        setNotice('');
        const result = await requestJson('/api/redteam/host/update/apply', { method: 'POST', body: JSON.stringify(spec ? { spec } : {}) });
        setNotice('更新操作已提交，页面会通过日志流显示进度。');
        setUpdate(result);
    }
    catch (cause) {
        setError(errorMessage(cause));
    }
    finally {
        setBusy(false);
    } };
    const rollback = async () => { if (busy)
        return; setBusy(true); try {
        if (!spec.trim() || typeof update?.runtime !== 'string' || !update.runtime)
            throw new Error('请先检查版本并填写目标包源；显式降级还需要匹配当前 DSH runtime 的兼容性清单。');
        setError('');
        setNotice('');
        const result = await requestJson('/api/redteam/host/update/rollback', { method: 'POST', body: JSON.stringify({ spec: spec.trim(), compatibility: { runtimeVersion: update.runtime, rollback: true } }) });
        setNotice('已提交显式版本安装请求，宿主会返回可核验状态。');
        setUpdate(result);
    }
    catch (cause) {
        setError(errorMessage(cause));
    }
    finally {
        setBusy(false);
    } };
    return _jsxs(ManagementPage, { title: "\u5BBF\u4E3B\u4E0E\u66F4\u65B0", description: "\u67E5\u770B DSH \u5BBF\u4E3B\u5065\u5EB7\u72B6\u6001\u3001\u5F15\u64CE\u7EDF\u8BA1\u548C\u670D\u52A1\u65E5\u5FD7\uFF0C\u5E76\u7BA1\u7406\u63D2\u4EF6\u7248\u672C\u3002", loading: !health && !stats && !logs.length && !error, error: error, notice: notice, actions: _jsx(Button, { size: "sm", disabled: !visible || busy, onClick: () => void refresh(), children: "\u5237\u65B0" }), children: [_jsxs("div", { className: "tw-grid", children: [_jsxs("div", { className: "tw-card", children: [_jsx("h3", { children: "\u5065\u5EB7" }), health ? _jsxs("p", { role: "status", children: [health.ok ? '运行正常' : '异常', " \u00B7 ", health.service, " \u00B7 ", health.version] }) : _jsx("p", { className: "tw-muted", children: "\u6682\u65E0\u6570\u636E" })] }), _jsxs("div", { className: "tw-card", children: [_jsx("h3", { children: "\u5F15\u64CE\u7EDF\u8BA1" }), stats ? _jsx(JsonDetails, { value: stats, open: true }) : _jsx("p", { className: "tw-muted", children: "\u6682\u65E0\u6570\u636E" })] })] }), _jsxs("div", { className: "tw-card", children: [_jsx("h3", { children: "\u63D2\u4EF6\u7248\u672C" }), updateAvailable ? _jsxs(_Fragment, { children: [_jsx(Field, { label: "\u5305\u89C4\u683C", hint: "\u4F8B\u5982 registry \u5305\u540D\u6216\u9694\u79BB\u6D4B\u8BD5\u7528\u672C\u5730 tarball\uFF1B\u663E\u5F0F\u7248\u672C\u5B89\u88C5\u9700\u8981\u5305\u6E90\u53CA\u517C\u5BB9\u6027\u6E05\u5355", children: _jsx(Input, { value: spec, onChange: event => setSpec(event.target.value), placeholder: "package@version \u6216\u672C\u5730 .tgz", disabled: busy }) }), _jsxs("div", { className: "tw-actions", children: [_jsx(Button, { size: "sm", disabled: busy, onClick: () => void refresh(), children: "\u68C0\u67E5\u7248\u672C" }), _jsx(Button, { size: "sm", disabled: busy || !spec.trim(), onClick: () => void apply(), children: "\u63D0\u4EA4\u5B89\u88C5/\u5347\u7EA7" }), _jsx(Button, { size: "sm", disabled: busy || !spec.trim(), onClick: () => void rollback(), children: "\u63D0\u4EA4\u663E\u5F0F\u7248\u672C\u5B89\u88C5\uFF08\u56DE\u9000\uFF09" })] }), update && _jsx(JsonDetails, { value: update, summary: "\u7248\u672C\u68C0\u67E5\u7ED3\u679C", open: true })] }) : _jsx(Notice, { children: "\u5F53\u524D\u5BBF\u4E3B\u6CA1\u6709\u5B89\u88C5 DSH \u7248\u672C\u7BA1\u7406\u9002\u914D\u5668\uFF0C\u65E0\u6CD5\u63D0\u4F9B update/check/apply/rollback\uFF1B\u63D2\u4EF6 CLI \u7684\u771F\u5B9E\u80FD\u529B\u4E0E\u7F3A\u53E3\u89C1 parity \u77E9\u9635\u3002" })] }), _jsxs("div", { className: "tw-card", children: [_jsxs("div", { className: "tw-card-head", children: [_jsx("h3", { children: "\u670D\u52A1\u65E5\u5FD7" }), _jsx(Button, { size: "sm", disabled: busy || !logs.length, onClick: () => void loadHistory(), children: "\u52A0\u8F7D\u66F4\u65E9\u65E5\u5FD7" })] }), _jsx("div", { className: "mg-list", children: logs.length ? logs.map(row => _jsxs("div", { className: "mg-meta", children: [_jsxs("span", { className: "mg-code", children: ["#", row.seq] }), _jsx("span", { children: row.ts }), _jsx("span", { children: row.level }), _jsx("span", { children: row.tag }), _jsx("span", { children: row.text })] }, row.seq)) : _jsx("p", { className: "tw-muted", children: "\u6682\u65E0\u65E5\u5FD7" }) })] })] });
}
