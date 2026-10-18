import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import React from 'react';
import { Button, Checkbox, Input, SegmentedTabs, Tag } from '@deepseek-ai/dsh-client-ui-primitives';
import { errorMessage, Field, JsonDetails, ManagementPage, Notice, requestJson } from '../management-ui/shared.js';
const root = '/api/redteam/system';
const retryLabels = { connect: '连接失败', empty: '空响应', stream: '流中断', breaker: '熔断', intent: '意图重试' };
const tabs = [{ id: 'settings', panelId: 'system-settings-panel', value: 'settings', label: '系统设置' }, { id: 'pool', panelId: 'system-pool-panel', value: 'pool', label: '模型池' }];
export function SystemRuntimeTab({ visible }) {
    const [tab, setTab] = React.useState('settings');
    const [settings, setSettings] = React.useState();
    const [pool, setPool] = React.useState();
    const [loading, setLoading] = React.useState(false), [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState(''), [notice, setNotice] = React.useState('');
    const pending = React.useRef(false);
    const refresh = React.useCallback(async (signal) => {
        setLoading(true);
        setError('');
        const results = await Promise.allSettled([requestJson(`${root}/settings`, { signal }), requestJson(`${root}/model-pool`, { signal })]);
        if (signal?.aborted)
            return;
        if (results[0].status === 'fulfilled')
            setSettings(results[0].value);
        if (results[1].status === 'fulfilled')
            setPool(results[1].value);
        setError(results.filter(result => result.status === 'rejected').map(result => errorMessage(result.reason)).join('\n'));
        setLoading(false);
    }, []);
    React.useEffect(() => { if (!visible)
        return; const controller = new AbortController(); void refresh(controller.signal); return () => controller.abort(); }, [visible, refresh]);
    const act = async (work, success) => {
        if (pending.current)
            return undefined;
        pending.current = true;
        setBusy(true);
        setError('');
        setNotice('');
        try {
            const result = await work();
            setNotice(success);
            return result;
        }
        catch (failure) {
            setError(errorMessage(failure));
            return undefined;
        }
        finally {
            pending.current = false;
            setBusy(false);
        }
    };
    return _jsxs(ManagementPage, { title: "\u7CFB\u7EDF\u8BBE\u7F6E\u4E0E\u6A21\u578B\u6C60", description: "\u8BBE\u7F6E\u4FDD\u5B58\u5728\u5F53\u524D\u63D2\u4EF6\u5B9E\u4F8B\u3002\u641C\u7D22\u548C\u6A21\u578B\u6D4B\u8BD5\u4F1A\u53D1\u9001\u771F\u5B9E\u8BF7\u6C42\u3002", loading: loading, error: error, notice: notice, actions: _jsx(Button, { size: "sm", disabled: loading || busy, onClick: () => void refresh(), children: "\u5237\u65B0\u72B6\u6001" }), toolbar: _jsx(SegmentedTabs, { items: tabs, value: tab, onChange: setTab, label: "\u7CFB\u7EDF\u7BA1\u7406\u89C6\u56FE" }), children: [_jsx("div", { hidden: tab !== 'settings', children: settings && _jsx(SettingsForm, { initial: settings, busy: busy, act: act, onSaved: setSettings }) }), _jsx("div", { hidden: tab !== 'pool', children: pool && _jsx(PoolPanel, { pool: pool, busy: busy, act: act, refresh: () => refresh() }) })] });
}
function SettingsForm({ initial, busy, act, onSaved }) {
    const [patch, setPatch] = React.useState({});
    const [braveMode, setBraveMode] = React.useState('keep'), [tavilyMode, setTavilyMode] = React.useState('keep');
    const [braveKey, setBraveKey] = React.useState(''), [tavilyKey, setTavilyKey] = React.useState('');
    const [test, setTest] = React.useState();
    const current = { ...initial, ...patch };
    const change = (key, value) => setPatch(old => ({ ...old, [key]: value }));
    const dirty = Object.keys(patch).length > 0 || braveMode !== 'keep' || tavilyMode !== 'keep';
    const secretPatch = { ...(braveMode === 'keep' ? {} : { brave_search_api_key: braveMode === 'clear' ? '' : braveKey }), ...(tavilyMode === 'keep' ? {} : { tavily_search_api_key: tavilyMode === 'clear' ? '' : tavilyKey }) };
    async function save(event) {
        event.preventDefault();
        const saved = await act(() => requestJson(`${root}/settings`, { method: 'PUT', body: JSON.stringify({ ...patch, ...secretPatch }) }), '系统设置已保存。');
        if (saved) {
            onSaved(saved);
            setPatch({});
            setBraveMode('keep');
            setTavilyMode('keep');
            setBraveKey('');
            setTavilyKey('');
        }
    }
    async function testSearch() {
        setTest(undefined);
        const result = await act(async () => {
            const result = await requestJson(`${root}/web-search/test`, { method: 'POST', body: JSON.stringify({ web_search_backend: current.web_search_backend, web_search_proxy: current.web_search_proxy, ...(braveMode === 'replace' ? { brave_search_api_key: braveKey } : {}), ...(tavilyMode === 'replace' ? { tavily_search_api_key: tavilyKey } : {}) }) });
            if (!result.ok)
                throw new Error(result.error || '搜索测试没有成功');
            return result;
        }, '搜索测试成功。');
        setTest(result);
    }
    return _jsx("form", { className: "tw-stack", onSubmit: save, children: _jsxs("fieldset", { disabled: busy, className: "tw-stack", children: [_jsxs("section", { className: "tw-card tw-stack", children: [_jsx("h3", { children: "\u7F51\u9875\u641C\u7D22" }), _jsx(Checkbox, { checked: current.web_search_enabled === true, onChange: value => change('web_search_enabled', value), label: "\u542F\u7528\u7F51\u9875\u641C\u7D22" }), _jsxs("div", { className: "tw-grid", children: [_jsx(Field, { label: "\u641C\u7D22\u540E\u7AEF", children: _jsxs("select", { value: current.web_search_backend ?? 'ddgs', onChange: event => change('web_search_backend', event.target.value), children: [_jsx("option", { value: "ddgs", children: "DuckDuckGo" }), _jsx("option", { value: "brave-free", children: "Brave" }), _jsx("option", { value: "tavily", children: "Tavily" }), _jsx("option", { value: "deepseek", children: "DeepSeek" })] }) }), _jsx(Field, { label: "\u641C\u7D22\u4EE3\u7406", hint: "\u7559\u7A7A\u76F4\u8FDE\uFF1B\u72EC\u7ACB\u4E8E\u76EE\u6807\u6D41\u91CF\u4EE3\u7406\u3002", children: _jsx(Input, { value: current.web_search_proxy ?? '', onChange: event => change('web_search_proxy', event.target.value), placeholder: "http://127.0.0.1:8080" }) })] }), _jsx(SecretInput, { label: "Brave API Key", configured: initial.brave_key_set, mode: braveMode, setMode: setBraveMode, value: braveKey, setValue: setBraveKey }), _jsx(SecretInput, { label: "Tavily API Key", configured: initial.tavily_key_set, mode: tavilyMode, setMode: setTavilyMode, value: tavilyKey, setValue: setTavilyKey }), _jsx("p", { className: "tw-muted tw-small", children: "\u6D4B\u8BD5\u4F7F\u7528\u5F53\u524D\u8868\u5355\u7684\u540E\u7AEF\u3001\u4EE3\u7406\u548C\u65B0\u5BC6\u94A5\uFF1B\u4FDD\u7559\u65F6\u4F7F\u7528\u5DF2\u4FDD\u5B58\u5BC6\u94A5\u3002\u6E05\u7A7A\u5BC6\u94A5\u540E\u8BF7\u5148\u4FDD\u5B58\u518D\u6D4B\u8BD5\u3002DeepSeek \u6D4B\u8BD5\u4F1A\u8C03\u7528\u6A21\u578B\u3002" }), _jsx("div", { children: _jsx(Button, { type: "button", size: "sm", disabled: busy || braveMode === 'clear' || tavilyMode === 'clear' || braveMode === 'replace' && !braveKey.trim() || tavilyMode === 'replace' && !tavilyKey.trim(), onClick: () => void testSearch(), children: "\u6D4B\u8BD5\u641C\u7D22\u8FDE\u63A5" }) }), test && _jsxs(Notice, { tone: "success", children: [test.backend, " \u8FD4\u56DE ", test.count, " \u6761\u641C\u7D22\u7ED3\u679C\u3002"] })] }), _jsxs("section", { className: "tw-card tw-stack", children: [_jsx("h3", { children: "\u6267\u884C\u8BBE\u7F6E" }), _jsx(Checkbox, { checked: current.llm_pool_enabled === true, onChange: value => change('llm_pool_enabled', value), label: "\u542F\u7528\u6A21\u578B\u6C60" }), _jsx(Checkbox, { checked: current.llm_pool_bind_fallback === true, onChange: value => change('llm_pool_bind_fallback', value), label: "\u5141\u8BB8\u5DF2\u7ED1\u5B9A\u6A21\u578B\u4F7F\u7528\u6C60\u5185\u56DE\u9000" }), _jsx(Checkbox, { checked: current.constraints_inject_planner === true, onChange: value => change('constraints_inject_planner', value), label: "\u5411 Planner \u6CE8\u5165\u4EFB\u52A1\u7EA6\u675F" }), _jsx(Checkbox, { checked: current.constraints_inject_worker === true, onChange: value => change('constraints_inject_worker', value), label: "\u5411 Worker \u6CE8\u5165\u4EFB\u52A1\u7EA6\u675F" }), _jsx(Checkbox, { checked: current.noa_compaction === true, onChange: value => change('noa_compaction', value), label: "\u542F\u7528 NoA \u4E0A\u4E0B\u6587\u538B\u7F29" })] }), _jsxs("div", { className: "tw-actions", children: [_jsx(Button, { type: "submit", variant: "primary", size: "sm", disabled: !dirty || busy, children: "\u4FDD\u5B58\u8BBE\u7F6E" }), _jsx(Button, { type: "button", size: "sm", disabled: !dirty || busy, onClick: () => { setPatch({}); setBraveMode('keep'); setTavilyMode('keep'); setBraveKey(''); setTavilyKey(''); }, children: "\u64A4\u9500\u672A\u4FDD\u5B58\u4FEE\u6539" }), dirty && _jsx(Tag, { tone: "warning", children: "\u5C1A\u672A\u4FDD\u5B58" })] })] }) });
}
function SecretInput({ label, configured, mode, setMode, value, setValue }) {
    return _jsxs("div", { className: "tw-grid", children: [_jsx(Field, { label: label, hint: configured ? '已配置，服务端不会回传密钥。' : '尚未配置。', children: _jsxs("select", { "aria-label": `${label} 操作`, value: mode, onChange: event => setMode(event.target.value), children: [_jsx("option", { value: "keep", children: "\u4FDD\u7559\u5F53\u524D\u5BC6\u94A5" }), _jsx("option", { value: "replace", children: "\u8BBE\u7F6E\u65B0\u5BC6\u94A5" }), _jsx("option", { value: "clear", children: "\u6E05\u7A7A\u5BC6\u94A5" })] }) }), mode === 'replace' && _jsx(Field, { label: `新 ${label}`, children: _jsx(Input, { type: "password", autoComplete: "new-password", required: true, value: value, onChange: event => setValue(event.target.value) }) })] });
}
function RetryFields({ value, keys, onChange }) {
    return _jsx("div", { className: "tw-stack", children: keys.map(key => _jsxs("div", { className: "tw-grid", children: [_jsx(Field, { label: `${retryLabels[key]}次数`, hint: "0 \u4F7F\u7528\u9ED8\u8BA4\u6216\u7EE7\u627F\uFF1B-1 \u7981\u7528\uFF1B\u6700\u591A 20\u3002", children: _jsx(Input, { type: "number", required: true, min: -1, max: 20, step: 1, value: value[key].attempts, onChange: event => onChange(key, { ...value[key], attempts: event.target.valueAsNumber }) }) }), _jsx(Field, { label: `${retryLabels[key]}间隔（毫秒）`, children: _jsx(Input, { type: "number", required: true, min: 0, max: 3600000, step: 1, value: value[key].interval_ms, onChange: event => onChange(key, { ...value[key], interval_ms: event.target.valueAsNumber }) }) })] }, key)) });
}
function PoolPanel({ pool, busy, act, refresh }) {
    const [selected, setSelected] = React.useState('');
    const [probe, setProbe] = React.useState();
    const [confirmReset, setConfirmReset] = React.useState(false);
    const row = pool.chain.find(item => item.profile_id === selected);
    async function reset(profileId) { await act(async () => { await requestJson(`${root}/model-health/reset`, { method: 'POST', body: JSON.stringify(profileId ? { profile_id: profileId } : {}) }); await refresh(); setConfirmReset(false); }, '模型健康状态已重置。'); }
    async function test(profileId) {
        setProbe(undefined);
        await act(async () => { const result = await requestJson(`${root}/model-test/${encodeURIComponent(profileId)}`, { method: 'POST', body: '{}' }); setProbe(result); await refresh(); if (!result.ok)
            throw new Error('模型测试失败，详见测试结果。'); }, '模型测试成功。');
    }
    return _jsxs("div", { className: "tw-stack", children: [_jsxs("div", { className: "tw-inline", children: [_jsx(Tag, { tone: pool.enabled ? 'success' : 'outline', children: pool.enabled ? '模型池已启用' : '模型池未启用' }), _jsx(Tag, { children: pool.bind_fallback ? '绑定允许回退' : '绑定不回退' })] }), !pool.chain.length ? _jsx("div", { className: "tw-empty", children: "\u5C1A\u65E0\u6A21\u578B\u914D\u7F6E\u3002\u8BF7\u5148\u5728\u4EFB\u52A1\u5DE5\u4F5C\u53F0\u7684\u6A21\u578B\u914D\u7F6E\u4E2D\u6DFB\u52A0\u6A21\u578B\u3002" }) : pool.chain.map(item => _jsxs("article", { className: "tw-card tw-gap", children: [_jsxs("div", { className: "tw-inline", children: [_jsx("strong", { className: "tw-grow", children: item.name }), _jsx(Tag, { tone: item.state === 'ok' ? 'success' : item.state === 'tripped' ? 'danger' : 'warning', children: item.state === 'ok' ? '正常' : item.state === 'tripped' ? '熔断中' : '降级' }), item.active && _jsx(Tag, { tone: "info", children: "\u5F53\u524D" }), item.policy.excluded && _jsx(Tag, { children: "\u5DF2\u6392\u9664" })] }), _jsxs("div", { className: "mg-meta", children: [_jsxs("span", { children: [item.provider, " / ", item.model] }), _jsxs("span", { children: ["\u4F18\u5148\u7EA7 ", item.policy.priority] }), _jsxs("span", { children: ["\u5931\u8D25 ", item.fails, " \u00B7 \u7194\u65AD ", item.trips, " \u00B7 \u51B7\u5374 ", item.cooldown_secs, " \u79D2"] })] }), item.last_error && _jsxs("p", { className: "tw-description", children: [item.last_error, " ", item.last_at && `（${new Date(item.last_at).toLocaleString()}）`] }), _jsxs("div", { className: "tw-actions", children: [_jsx(Button, { size: "sm", disabled: busy, onClick: () => setSelected(item.profile_id), children: "\u7F16\u8F91\u7B56\u7565" }), _jsx(Button, { size: "sm", disabled: busy, onClick: () => void test(item.profile_id), children: "\u6D4B\u8BD5\u6A21\u578B" }), _jsx(Button, { size: "sm", disabled: busy, onClick: () => void reset(item.profile_id), children: "\u91CD\u7F6E\u5065\u5EB7" })] })] }, item.profile_id)), _jsx("p", { className: "tw-muted tw-small", children: "\u6A21\u578B\u6D4B\u8BD5\u4F1A\u53D1\u9001\u4E00\u6B21\u77ED\u8BF7\u6C42\uFF0C\u53EF\u80FD\u6D88\u8017\u63D0\u4F9B\u65B9\u989D\u5EA6\uFF1B\u8D85\u65F6\u4E0A\u9650 30 \u79D2\u3002" }), probe && _jsxs("section", { className: "tw-card tw-gap", children: [_jsx("h3", { children: "\u6D4B\u8BD5\u7ED3\u679C" }), _jsxs("p", { children: [probe.profile_id, " \u00B7 ", probe.elapsed_ms, " \u6BEB\u79D2 \u00B7 ", probe.ok ? '成功' : '失败'] }), _jsx("p", { className: "tw-description", children: probe.response }), probe.failure !== undefined && _jsx(JsonDetails, { value: probe.failure, summary: "\u9519\u8BEF\u8BE6\u60C5", open: true })] }), row && _jsx(ProfileEditor, { row: row, busy: busy, act: act, refresh: refresh, onClose: () => setSelected('') }, row.profile_id), _jsx(GlobalRetry, { initial: pool.retry, busy: busy, act: act, refresh: refresh }), _jsx("div", { className: "tw-actions", children: confirmReset ? _jsxs(_Fragment, { children: [_jsx("span", { children: "\u91CD\u7F6E\u5168\u90E8\u6A21\u578B\u7684\u7194\u65AD\u548C\u5931\u8D25\u72B6\u6001\uFF1F" }), _jsx(Button, { size: "sm", disabled: busy, onClick: () => void reset(), children: "\u786E\u8BA4\u91CD\u7F6E\u5168\u90E8" }), _jsx(Button, { size: "sm", disabled: busy, onClick: () => setConfirmReset(false), children: "\u53D6\u6D88" })] }) : _jsx(Button, { size: "sm", disabled: busy || !pool.chain.length, onClick: () => setConfirmReset(true), children: "\u91CD\u7F6E\u5168\u90E8\u6A21\u578B\u5065\u5EB7" }) })] });
}
function ProfileEditor({ row, busy, act, refresh, onClose }) {
    const [policy, setPolicy] = React.useState(row.policy);
    const numeric = [{ key: 'priority', label: '优先级' }, { key: 'ratePerSecond', label: '每秒请求上限', min: 0 }, { key: 'ratePerMinute', label: '每分钟请求上限', min: 0 }, { key: 'windowTokens', label: '上下文 token 上限', min: 0 }];
    return _jsxs("form", { className: "tw-card tw-stack", onSubmit: event => { event.preventDefault(); void act(async () => { await requestJson(`${root}/model-policy/${encodeURIComponent(row.profile_id)}`, { method: 'PUT', body: JSON.stringify(policy) }); await refresh(); onClose(); }, '模型策略已保存。'); }, children: [_jsxs("h3", { children: [row.name, " \u00B7 \u6A21\u578B\u7B56\u7565"] }), _jsxs("fieldset", { disabled: busy, className: "tw-stack", children: [_jsx(Checkbox, { checked: policy.excluded, onChange: excluded => setPolicy(old => ({ ...old, excluded })), label: "\u4ECE\u6A21\u578B\u6C60\u4E2D\u6392\u9664\u6B64\u914D\u7F6E" }), _jsx("div", { className: "tw-grid", children: numeric.map(({ key, label, min }) => _jsx(Field, { label: label, hint: min === 0 ? '0 表示不限制。' : undefined, children: _jsx(Input, { required: true, type: "number", step: 1, min: min, value: policy[key], onChange: event => setPolicy(old => ({ ...old, [key]: event.target.valueAsNumber })) }) }, key)) }), _jsx(RetryFields, { value: policy.retry, keys: ['connect', 'empty', 'stream'], onChange: (key, rule) => setPolicy(old => ({ ...old, retry: { ...old.retry, [key]: rule } })) }), _jsxs("div", { className: "tw-actions", children: [_jsx(Button, { size: "sm", type: "submit", variant: "primary", children: "\u4FDD\u5B58\u6A21\u578B\u7B56\u7565" }), _jsx(Button, { size: "sm", type: "button", onClick: onClose, children: "\u53D6\u6D88" })] })] })] });
}
function GlobalRetry({ initial, busy, act, refresh }) {
    const [patch, setPatch] = React.useState({});
    const retry = { ...initial, ...patch };
    return _jsxs("details", { className: "tw-card", children: [_jsx("summary", { children: "\u5168\u5C40\u4E94\u5C42\u91CD\u8BD5\u7B56\u7565" }), _jsx("form", { className: "tw-stack", onSubmit: event => { event.preventDefault(); void act(async () => { await requestJson(`${root}/model-retry`, { method: 'PUT', body: JSON.stringify(retry) }); await refresh(); setPatch({}); }, '全局重试策略已保存。'); }, children: _jsxs("fieldset", { disabled: busy, className: "tw-stack", children: [_jsx(RetryFields, { value: retry, keys: ['connect', 'empty', 'stream', 'breaker', 'intent'], onChange: (key, rule) => setPatch(old => ({ ...old, [key]: rule })) }), _jsxs("div", { className: "tw-actions", children: [_jsx(Button, { type: "submit", size: "sm", variant: "primary", disabled: !Object.keys(patch).length, children: "\u4FDD\u5B58\u5168\u5C40\u7B56\u7565" }), _jsx(Button, { type: "button", size: "sm", disabled: !Object.keys(patch).length, onClick: () => setPatch({}), children: "\u64A4\u9500\u4FEE\u6539" })] })] }) })] });
}
