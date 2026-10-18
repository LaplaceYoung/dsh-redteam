import { readFileSync } from 'node:fs';
import { rootCertificates } from 'node:tls';
import { Agent, ProxyAgent, Socks5ProxyAgent, fetch } from 'undici';
import { parse } from 'parse5';
const endpoints = {
    ddgs: 'https://html.duckduckgo.com/html/',
    'brave-free': 'https://api.search.brave.com/res/v1/web/search',
    tavily: 'https://api.tavily.com/search',
};
const maxFetchBytes = 2 << 20;
export class WebSearchHTTPError extends Error {
    backend;
    status;
    constructor(backend, status) {
        super(backend === 'ddgs' && (status === 202 || status === 429)
            ? `DuckDuckGo is rate-limiting (HTTP ${status}); try again later or switch backend`
            : `${backend} search returned HTTP ${status}`);
        this.backend = backend;
        this.status = status;
        this.name = 'WebSearchHTTPError';
    }
}
export function deepSeekMessagesURL(base) {
    const value = base.trim().replace(/\/+$/, '');
    return value.endsWith('/v1/messages') ? value : value.endsWith('/v1') ? `${value}/messages` : `${value}/v1/messages`;
}
/** Same protocol and transport for the agent tool and settings connectivity probe. */
export class WebSearchClient {
    backend;
    dispatcher;
    endpoint;
    key;
    model;
    constructor(config, options = {}) {
        const backend = config.backend?.trim().toLowerCase() || 'ddgs';
        if (backend !== 'ddgs' && backend !== 'brave-free' && backend !== 'tavily' && backend !== 'deepseek')
            throw new Error(`web_search: unknown backend ${backend}`);
        this.backend = backend;
        this.key = (backend === 'brave-free' ? config.braveAPIKey : backend === 'tavily' ? config.tavilyAPIKey : config.deepSeekAPIKey)?.trim() || '';
        this.model = config.deepSeekModel?.trim() || '';
        if (backend !== 'ddgs' && !this.key)
            throw new Error(`web_search: backend ${backend} requires an API key`);
        if (backend === 'deepseek' && (!config.deepSeekBaseURL?.trim() || !this.model))
            throw new Error('web_search: deepseek requires an Anthropic-format base URL and model name');
        this.endpoint = backend === 'deepseek' ? deepSeekMessagesURL(config.deepSeekBaseURL) : options.endpoints?.[backend] || endpoints[backend];
        const target = new URL(this.endpoint);
        if (!['http:', 'https:'].includes(target.protocol))
            throw new Error('web_search: endpoint requires HTTP or HTTPS');
        const tls = {
            rejectUnauthorized: !config.insecureTLS,
            ...(config.caCert ? { ca: [...rootCertificates, readFileSync(config.caCert, 'utf8')] } : {}),
        };
        const proxy = config.proxy?.trim();
        if (!proxy)
            this.dispatcher = new Agent({ connect: tls });
        else {
            const url = new URL(proxy);
            if (url.protocol === 'socks5h:')
                url.protocol = 'socks5:';
            if (url.protocol === 'socks5:')
                this.dispatcher = new Socks5ProxyAgent(url, { requestTls: tls });
            else if (url.protocol === 'http:' || url.protocol === 'https:')
                this.dispatcher = new ProxyAgent({ uri: url.href, requestTls: tls, proxyTls: tls });
            else
                throw new Error('web_search: proxy requires HTTP, HTTPS or SOCKS5');
        }
    }
    async close() { await this.dispatcher.close(); }
    async probe(query = 'test', limit = 3, signal) {
        return this.search(query, limit <= 0 ? 3 : limit, signal);
    }
    async search(query, limit = 5, signal) {
        if (typeof query !== 'string' || !query.trim())
            throw new Error('query must not be empty');
        if (!Number.isInteger(limit))
            throw new Error('limit must be an integer');
        query = query.trim();
        limit = limit <= 0 ? 5 : Math.min(limit, 20);
        const deadline = AbortSignal.timeout(this.backend === 'deepseek' ? 120_000 : 30_000);
        const init = { dispatcher: this.dispatcher, signal: signal ? AbortSignal.any([signal, deadline]) : deadline };
        let url = this.endpoint;
        if (this.backend === 'ddgs') {
            init.method = 'POST';
            init.headers = { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0', Referer: 'https://html.duckduckgo.com/' };
            init.body = new URLSearchParams({ q: query, kl: 'wt-wt' }).toString();
        }
        else if (this.backend === 'brave-free') {
            const target = new URL(url);
            target.searchParams.set('q', query);
            target.searchParams.set('count', String(limit));
            url = target.href;
            init.headers = { Accept: 'application/json', 'X-Subscription-Token': this.key };
        }
        else if (this.backend === 'tavily') {
            init.method = 'POST';
            init.headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
            init.body = JSON.stringify({ api_key: this.key, query, max_results: limit, search_depth: 'basic' });
        }
        else {
            init.method = 'POST';
            init.headers = { 'Content-Type': 'application/json', Accept: 'text/event-stream', 'x-api-key': this.key, 'anthropic-version': '2023-06-01' };
            init.body = JSON.stringify({ model: this.model, max_tokens: 1024, stream: true,
                messages: [{ role: 'user', content: `Search the web for: ${query}\n\nUse the web_search tool. Do not answer from memory; reply with at most one short sentence once the search is done.` }],
                tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: Math.min(3, Math.max(1, Math.ceil(limit / 10))) }],
            });
        }
        const response = await fetch(url, init);
        if (response.status !== 200) {
            await response.body?.cancel();
            throw new WebSearchHTTPError(this.backend, response.status);
        }
        if (this.backend === 'deepseek')
            return parseDeepSeekResponse(response, limit);
        const raw = await readBody(response);
        if (this.backend === 'ddgs')
            return parseDDGS(raw, limit);
        const payload = JSON.parse(raw);
        const body = object(payload, `${this.backend} response`);
        const results = this.backend === 'brave-free'
            ? (body.web === undefined ? [] : object(body.web, 'Brave web').results ?? [])
            : body.results ?? [];
        if (!Array.isArray(results))
            throw new Error(`${this.backend} results must be an array`);
        return results.slice(0, limit).map((value, i) => {
            const hit = object(value, 'search result');
            return { title: stringField(hit, 'title'), url: stringField(hit, 'url'), description: stringField(hit, this.backend === 'tavily' ? 'content' : 'description'), position: i + 1 };
        });
    }
}
function object(value, label) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        throw new Error(`${label} must be an object`);
    return value;
}
function stringField(value, name) {
    if (value[name] === undefined || value[name] === null)
        return '';
    if (typeof value[name] !== 'string')
        throw new Error(`search result ${name} must be a string`);
    return value[name];
}
async function* chunks(response) {
    if (!response.body)
        throw new Error('web_search: response has no body');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let total = 0;
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done)
                break;
            total += value.byteLength;
            if (total > maxFetchBytes)
                throw new Error('web_search: response exceeds 2 MiB');
            yield decoder.decode(value, { stream: true });
        }
        yield decoder.decode();
    }
    finally {
        await reader.cancel();
        reader.releaseLock();
    }
}
async function readBody(response) {
    let value = '';
    for await (const chunk of chunks(response))
        value += chunk;
    return value;
}
function parseDDGS(raw, limit) {
    const hits = [], snippets = [];
    function text(node) {
        if ('value' in node)
            return node.value;
        return 'childNodes' in node ? node.childNodes.map(text).join('') : '';
    }
    function walk(node) {
        if ('tagName' in node) {
            const classes = node.attrs.find(x => x.name === 'class')?.value.split(/\s+/) || [];
            const content = text(node).replace(/\s+/g, ' ').trim();
            if (node.tagName === 'a' && classes.includes('result__a')) {
                const href = node.attrs.find(x => x.name === 'href')?.value || '';
                let url = '';
                if (href) {
                    try {
                        const parsed = new URL(href.startsWith('//') ? `https:${href}` : href);
                        url = parsed.searchParams.get('uddg') || (['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '');
                    }
                    catch {
                        url = '';
                    }
                }
                hits.push({ title: content, url });
            }
            if (classes.includes('result__snippet'))
                snippets.push(content);
        }
        if ('childNodes' in node)
            for (const child of node.childNodes)
                walk(child);
    }
    walk(parse(raw));
    return hits.map((hit, i) => ({ ...hit, description: snippets[i] || '' })).filter(hit => hit.url).slice(0, limit).map((hit, i) => ({ ...hit, position: i + 1 }));
}
async function parseDeepSeekResponse(response, limit) {
    const out = [], seen = new Set();
    let pending = '', toolError = '';
    function line(raw) {
        raw = raw.trim();
        if (!raw.startsWith('data:'))
            return;
        const data = raw.slice(5).trim();
        if (!data || data === '[DONE]')
            return;
        let parsed;
        try {
            parsed = JSON.parse(data);
        }
        catch {
            return;
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
            return;
        const frame = object(parsed, 'DeepSeek frame');
        if (frame.type === 'error') {
            const error = object(frame.error, 'DeepSeek error');
            throw new Error(`DeepSeek search stream error: ${stringField(error, 'message') || stringField(error, 'type')}`);
        }
        if (frame.type !== 'content_block_start')
            return;
        const block = object(frame.content_block, 'DeepSeek content block');
        if (block.type !== 'web_search_tool_result')
            return;
        if (!Array.isArray(block.content))
            throw new Error('DeepSeek search result content must be an array');
        for (const value of block.content) {
            const hit = object(value, 'DeepSeek search hit');
            const code = stringField(hit, 'error_code');
            if (code) {
                toolError ||= code;
                continue;
            }
            const url = stringField(hit, 'url');
            if (!url || seen.has(url))
                continue;
            seen.add(url);
            let title = stringField(hit, 'title');
            if (!title.trim()) {
                try {
                    title = new URL(url).host || url;
                }
                catch {
                    title = url;
                }
            }
            out.push({ title, url, description: '', position: out.length + 1 });
            if (out.length >= limit)
                return;
        }
    }
    for await (const chunk of chunks(response)) {
        pending += chunk;
        let at;
        while ((at = pending.indexOf('\n')) !== -1) {
            line(pending.slice(0, at));
            pending = pending.slice(at + 1);
            if (out.length >= limit)
                return out;
        }
    }
    if (pending)
        line(pending);
    if (!out.length && toolError)
        throw new Error(`DeepSeek web search failed: ${toolError}`);
    return out;
}
