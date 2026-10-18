import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
export class ScopeSentryError extends Error {
    status;
    upstreamStatus;
    constructor(message, status = 502, upstreamStatus) {
        super(message);
        this.status = status;
        this.upstreamStatus = upstreamStatus;
        this.name = 'ScopeSentryError';
    }
}
const queues = new Map();
const cap = 5000;
function object(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new ScopeSentryError(`${label} must be an object`);
    return Object.fromEntries(Object.entries(value));
}
function optionalText(row, key) {
    const value = row[key];
    if (value === undefined || value === null)
        return '';
    if (typeof value !== 'string')
        throw new ScopeSentryError(`${key} must be text`);
    return value;
}
function optionalStrings(row, key) {
    const value = row[key];
    if (value === undefined || value === null)
        return [];
    if (!Array.isArray(value) || value.some(v => typeof v !== 'string'))
        throw new ScopeSentryError(`${key} must be a string array`);
    return value;
}
function records(value, label) {
    if (!Array.isArray(value))
        throw new ScopeSentryError(`${label} must be an array`);
    return value.map(row => object(row, label));
}
function endpoint(value) {
    let url;
    try {
        url = new URL(value);
    }
    catch {
        throw new ScopeSentryError('ScopeSentry URL must be an absolute HTTP(S) URL', 400);
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash)
        throw new ScopeSentryError('ScopeSentry URL must be HTTP(S) without embedded credentials or fragment', 400);
    return url.href;
}
function publicUrl(value) {
    if (!value)
        return '';
    const url = new URL(value);
    for (const key of new Set(url.searchParams.keys()))
        url.searchParams.set(key, '[redacted]');
    return url.href;
}
function redact(message, key) {
    if (!key)
        return message;
    for (const secret of new Set([key, encodeURIComponent(key), JSON.stringify(key).slice(1, -1)]))
        message = message.split(secret).join('[redacted]');
    return message;
}
function safeFailure(error, key) {
    return redact(error instanceof Error ? error.message : String(error), key);
}
function pageArgs(input) {
    const page = input.page ?? 1, size = input.size ?? 50;
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(size) || size < 1 || size > 500)
        throw new ScopeSentryError('page must be positive and size must be between 1 and 500', 400);
    if (input.search !== undefined && typeof input.search !== 'string')
        throw new ScopeSentryError('search must be text', 400);
    return { pageIndex: page, pageSize: size, ...(input.search ? { search: input.search } : {}) };
}
/** Mapping from ARTEX server/sync_scopesentry.go:ssIngest, using the existing global asset contract. */
export function scopeSentryAssets(assetType, value) {
    const row = object(value, 'ScopeSentry asset');
    if (assetType === 'subdomain') {
        const domain = optionalText(row, 'host');
        if (!domain)
            return [];
        return [{ type: 'subdomain', domain, record_type: optionalText(row, 'type'), record_value: optionalStrings(row, 'value') },
            ...optionalStrings(row, 'ip').filter(Boolean).map(ip => ({ type: 'ip', ip, bound_domains: [domain] }))];
    }
    if (assetType === 'app') {
        const name = optionalText(row, 'name');
        return name ? [{ type: 'app', app_name: name, category: optionalText(row, 'category'), description: optionalText(row, 'description'), app_icp: optionalText(row, 'icp') }] : [];
    }
    if (assetType !== 'service')
        throw new ScopeSentryError('unknown ScopeSentry asset type', 400);
    const service = optionalText(row, 'service'), url = optionalText(row, 'url');
    if (service === 'http' || url) {
        if (!url)
            return [];
        if (row.status !== undefined && row.status !== null && (typeof row.status !== 'number' || !Number.isSafeInteger(row.status)))
            throw new ScopeSentryError('service status must be an integer');
        return [{ type: 'service', url, technologies: optionalStrings(row, 'products'), ...(typeof row.status === 'number' ? { status_code: row.status } : {}), page_title: optionalText(row, 'title'), favicon_mmh3: optionalText(row, 'icon'), ip: optionalText(row, 'ip') }];
    }
    const rawPort = optionalText(row, 'port'), port = /^\d+$/.test(rawPort) ? Number(rawPort) : 0;
    return [{ type: 'service', domain: optionalText(row, 'domain'), ip: optionalText(row, 'ip'), port, service_name: service }];
}
/** One local configuration per RedTeam store; all remote work uses the real MCP SDK. */
export class ScopeSentryRuntime {
    sink;
    path;
    queueKey;
    lifetime = new AbortController();
    pending = new Set();
    constructor(configPath, sink) {
        this.sink = sink;
        this.path = resolve(configPath);
        this.queueKey = process.platform === 'win32' ? this.path.toLowerCase() : this.path;
    }
    async config() {
        let raw;
        try {
            raw = await readFile(this.path, 'utf8');
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return undefined;
            throw error;
        }
        let parsed;
        try {
            parsed = JSON.parse(raw);
        }
        catch {
            throw new ScopeSentryError('Invalid ScopeSentry configuration JSON', 500);
        }
        const row = object(parsed, 'ScopeSentry configuration');
        if (row.version !== 1 || typeof row.url !== 'string' || typeof row.apiKey !== 'string' || typeof row.enabled !== 'boolean')
            throw new ScopeSentryError('Invalid ScopeSentry configuration fields', 500);
        if (row.url)
            endpoint(row.url);
        return { version: 1, url: row.url, apiKey: row.apiKey, enabled: row.enabled };
    }
    serial(run) {
        const pending = (queues.get(this.queueKey) ?? Promise.resolve()).catch(() => { }).then(run);
        queues.set(this.queueKey, pending);
        void pending.then(() => { if (queues.get(this.queueKey) === pending)
            queues.delete(this.queueKey); }, () => { if (queues.get(this.queueKey) === pending)
            queues.delete(this.queueKey); });
        return pending;
    }
    async ready() { this.lifetime.signal.throwIfAborted(); await this.serial(() => this.config()); }
    view(config) {
        return { exists: !!config, configured: !!config?.url && !!config.apiKey.trim(), enabled: config?.enabled ?? false, reachable: false, url: redact(publicUrl(config?.url ?? ''), config?.apiKey ?? ''), hasApiKey: !!config?.apiKey.trim(), tools: [] };
    }
    async configure(input, signal) {
        this.lifetime.signal.throwIfAborted();
        signal?.throwIfAborted();
        for (const field of ['url', 'api_key'])
            if (input[field] !== undefined && typeof input[field] !== 'string')
                throw new ScopeSentryError(`${field} must be text`, 400);
        if (input.enabled !== undefined && typeof input.enabled !== 'boolean')
            throw new ScopeSentryError('enabled must be boolean', 400);
        if (input.api_key && /[\r\n]/.test(input.api_key))
            throw new ScopeSentryError('api_key must not contain newlines', 400);
        await this.serial(async () => {
            this.lifetime.signal.throwIfAborted();
            signal?.throwIfAborted();
            const config = await this.config() ?? { version: 1, url: '', apiKey: '', enabled: false };
            if (input.url?.trim())
                config.url = endpoint(input.url.trim());
            if (input.api_key?.trim())
                config.apiKey = input.api_key.trim();
            config.enabled = input.enabled ?? (!!config.url && !!config.apiKey);
            if (config.enabled && (!config.url || !config.apiKey))
                throw new ScopeSentryError('enabled datasource requires URL and API key', 400);
            await mkdir(dirname(this.path), { recursive: true });
            const temporary = `${this.path}.${randomUUID()}.tmp`;
            try {
                await writeFile(temporary, JSON.stringify(config), { mode: 0o600, flag: 'wx' });
                await rename(temporary, this.path);
            }
            finally {
                try {
                    await unlink(temporary);
                }
                catch (error) {
                    if (error.code !== 'ENOENT')
                        throw error;
                }
            }
        });
        return this.status(signal);
    }
    request(run, signal, timeout = 60000, supplied) {
        const pending = this.connected(run, signal, timeout, supplied);
        this.pending.add(pending);
        void pending.then(() => this.pending.delete(pending), () => this.pending.delete(pending));
        return pending;
    }
    async connected(run, caller, timeout = 60000, supplied) {
        this.lifetime.signal.throwIfAborted();
        caller?.throwIfAborted();
        const config = supplied ?? await this.serial(() => this.config());
        if (!config?.url || !config.apiKey || !config.enabled)
            throw new ScopeSentryError('ScopeSentry datasource is missing, unconfigured or disabled', 503);
        const signal = AbortSignal.any([this.lifetime.signal, ...(caller ? [caller] : []), AbortSignal.timeout(timeout)]);
        const client = new Client({ name: 'dsh-redteam-scopesentry', version: '1' });
        let upstreamStatus;
        const transport = new StreamableHTTPClientTransport(new URL(config.url), {
            requestInit: { headers: { 'X-API-Key': config.apiKey } },
            fetch: async (url, init) => {
                const response = await fetch(url, { ...init, signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]) });
                if (!response.ok)
                    upstreamStatus = response.status;
                return response;
            },
        });
        try {
            await client.connect(transport, { signal, timeout: Math.min(timeout, 60000) });
            return await run(client, signal, config);
        }
        catch (error) {
            caller?.throwIfAborted();
            this.lifetime.signal.throwIfAborted();
            if (error instanceof ScopeSentryError)
                throw new ScopeSentryError(redact(error.message, config.apiKey), error.status, error.upstreamStatus);
            const status = error instanceof StreamableHTTPError ? error.code : upstreamStatus;
            // SDK errors may embed a proxy response body, including echoed credentials.
            throw new ScopeSentryError(`ScopeSentry MCP request failed${status === undefined ? '' : ` (HTTP ${status})`}${signal.aborted ? ': timed out' : ''}`, 502, status);
        }
        finally {
            // Close aborts persistent SSE streams; session DELETE is best-effort in ARTEX.
            try {
                if (transport.sessionId)
                    await transport.terminateSession();
            }
            catch { /* connection already failed or server does not support DELETE */ }
            try {
                await client.close();
            }
            catch {
                throw new ScopeSentryError('ScopeSentry MCP connection cleanup failed');
            }
        }
    }
    async call(client, name, args, signal, key) {
        // SDK also accepts legacy {toolResult: unknown}; ScopeSentry uses standard content results.
        const result = CallToolResultSchema.parse(await client.callTool({ name, arguments: args }, undefined, { signal, timeout: 60000 }));
        const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('');
        if (result.isError)
            throw new ScopeSentryError(`ScopeSentry tool ${name} failed: ${redact(text, key)}`);
        if (result.structuredContent)
            return object(result.structuredContent, name);
        let data;
        try {
            data = JSON.parse(text);
        }
        catch {
            throw new ScopeSentryError(`ScopeSentry tool ${name} returned invalid JSON`);
        }
        return object(data, name);
    }
    async status(signal) {
        this.lifetime.signal.throwIfAborted();
        signal?.throwIfAborted();
        const config = await this.serial(() => this.config()), view = this.view(config);
        if (!config || !view.configured || !view.enabled)
            return view;
        try {
            view.tools = await this.request(async (client, cancellation) => {
                const tools = [], seen = new Set();
                let cursor;
                do {
                    const page = await client.listTools(cursor ? { cursor } : {}, { signal: cancellation, timeout: 12000 });
                    tools.push(...page.tools.map(tool => tool.name));
                    cursor = page.nextCursor;
                    if (cursor && seen.has(cursor))
                        throw new ScopeSentryError('ScopeSentry returned a repeated tool cursor');
                    if (cursor)
                        seen.add(cursor);
                } while (cursor);
                return [...new Set(tools)];
            }, signal, 12000, config);
            view.reachable = true;
        }
        catch (error) {
            signal?.throwIfAborted();
            this.lifetime.signal.throwIfAborted();
            view.error = safeFailure(error, config.apiKey);
        }
        return view;
    }
    projects(input = {}, signal) {
        const args = pageArgs(input);
        return this.request(async (client, cancellation, config) => {
            const data = await this.call(client, 'list_projects_data', args, cancellation, config.apiKey), result = object(data.result, 'project result');
            const tag = {};
            if (data.tag !== undefined && data.tag !== null)
                for (const [name, count] of Object.entries(object(data.tag, 'project tags'))) {
                    if (typeof count !== 'number' || !Number.isSafeInteger(count))
                        throw new ScopeSentryError('project tag count must be an integer');
                    tag[name] = count;
                }
            return { projects: records(result.All, 'projects'), tag };
        }, signal);
    }
    tasks(input = {}, signal) {
        const args = pageArgs(input);
        return this.request(async (client, cancellation, config) => ({ tasks: records((await this.call(client, 'list_tasks', args, cancellation, config.apiKey)).list, 'tasks') }), signal);
    }
    sync(input, signal) {
        if (!['project', 'task'].includes(input.dimension) || !Array.isArray(input.targets) || !input.targets.length || input.targets.some(v => typeof v !== 'string' || !v.trim()))
            throw new ScopeSentryError('dimension must be project/task and targets must contain nonempty IDs', 400);
        if (input.asset_types !== undefined && (!Array.isArray(input.asset_types) || input.asset_types.some(v => typeof v !== 'string')))
            throw new ScopeSentryError('asset_types must be a string array', 400);
        if (input.create_company !== undefined && typeof input.create_company !== 'boolean')
            throw new ScopeSentryError('create_company must be boolean', 400);
        const size = input.page_size === undefined || input.page_size <= 0 || input.page_size > 500 ? 100 : input.page_size;
        if (!Number.isSafeInteger(size))
            throw new ScopeSentryError('page_size must be an integer', 400);
        return this.request(async (client, cancellation, config) => {
            const result = { ok: true, partial: false, synced: { subdomain: 0, app: 0, service: 0, ip: 0 }, companies: [], warnings: [], errors: [] };
            const types = input.asset_types?.length ? [...new Set(input.asset_types)] : ['subdomain', 'service', 'app'];
            for (const target of new Set(input.targets)) {
                cancellation.throwIfAborted();
                if (input.dimension === 'project' && input.create_company) {
                    try {
                        const meta = await this.call(client, 'get_project', { id: target }, cancellation, config.apiKey), name = optionalText(meta, 'name');
                        if (name) {
                            await this.sink.upsertCompany({ name, roots: optionalText(meta, 'target').split('\n').map(v => v.trim()).filter(Boolean), source: `scopesentry:${name}` });
                            result.companies.push(name);
                        }
                    }
                    catch (error) {
                        cancellation.throwIfAborted();
                        result.errors.push(`project metadata/company ${target}: ${safeFailure(error, config.apiKey)}`);
                    }
                }
                for (const type of types) {
                    cancellation.throwIfAborted();
                    if (!['subdomain', 'service', 'app'].includes(type)) {
                        result.warnings.push(`unknown asset type skipped: ${type}`);
                        continue;
                    }
                    const assets = [];
                    try {
                        let count = 0;
                        for (let page = 1;; page++) {
                            const data = await this.call(client, 'list_assets', { asset_type: type === 'service' ? 'asset' : type, pageIndex: page, pageSize: size, filter: { [input.dimension]: [target] } }, cancellation, config.apiKey);
                            const rows = records(data.list, 'assets');
                            for (const row of rows.slice(0, cap - count)) {
                                try {
                                    assets.push(...scopeSentryAssets(type, row));
                                }
                                catch (error) {
                                    result.errors.push(`${type}(${target}): ${safeFailure(error, config.apiKey)}`);
                                }
                            }
                            count += rows.length;
                            if (count >= cap) {
                                result.warnings.push(`${type}(${target}) reached ${cap} item limit; truncated`);
                                break;
                            }
                            if (rows.length < size)
                                break;
                        }
                    }
                    catch (error) {
                        cancellation.throwIfAborted();
                        result.errors.push(`${type}(${target}) fetch failed: ${safeFailure(error, config.apiKey)}`);
                        continue;
                    }
                    cancellation.throwIfAborted();
                    if (!assets.length)
                        continue;
                    try {
                        const saved = await this.sink.insertAssets(assets);
                        for (const row of saved.results) {
                            const kind = assets[row.index].type;
                            if (kind === 'subdomain' || kind === 'service' || kind === 'app' || kind === 'ip')
                                result.synced[kind]++;
                        }
                        for (const row of saved.errors)
                            result.errors.push(`${type}(${target}) item ${row.index}: ${redact(row.error, config.apiKey)}`);
                    }
                    catch (error) {
                        cancellation.throwIfAborted();
                        result.errors.push(`${type}(${target}) write failed: ${safeFailure(error, config.apiKey)}`);
                    }
                }
            }
            if (result.companies.length)
                try {
                    await this.sink.recomputeAttribution();
                }
                catch (error) {
                    cancellation.throwIfAborted();
                    result.errors.push(`company attribution: ${safeFailure(error, config.apiKey)}`);
                }
            result.companies = [...new Set(result.companies)];
            result.ok = result.errors.length === 0;
            result.partial = result.errors.length > 0 || result.warnings.length > 0;
            return result;
        }, signal, 600000);
    }
    async dispose() {
        this.lifetime.abort(new Error('ScopeSentry runtime disposed'));
        await Promise.allSettled([...this.pending]);
    }
}
