import { open } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isIP } from 'node:net';
import { TrafficDeletion } from './deletion.js';
/** Both old manually recorded messages and new lossless capture rows remain readable. */
function message(value) {
    if (value == null)
        return {};
    if (typeof value !== 'object' || Array.isArray(value))
        throw new Error('invalid stored traffic message');
    const row = value;
    if (row.bodySha256 !== undefined && !/^[a-f0-9]{64}$/.test(row.bodySha256))
        throw new Error('invalid traffic blob hash');
    if (row.bodyBase64 !== undefined && (typeof row.bodyBase64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(row.bodyBase64)))
        throw new Error('invalid traffic body encoding');
    if (row.bodyLength !== undefined && (!Number.isSafeInteger(row.bodyLength) || row.bodyLength < 0))
        throw new Error('invalid traffic body length');
    return row;
}
function inlineBody(part) {
    return part.bodyBase64 !== undefined ? Buffer.from(part.bodyBase64, 'base64') : Buffer.from(part.body ?? '', 'utf8');
}
function fields(part) { return part.headerFields ?? Object.entries(part.headers ?? {}); }
function header(part, key) { return fields(part).find(([name]) => name.toLowerCase() === key)?.[1] ?? ''; }
function head(part) { return [part.startLine ?? '', ...fields(part).map(([name, value]) => `${name}: ${value}`)].join('\n'); }
function bodyLength(part) { return part.bodyLength ?? inlineBody(part).length; }
function templatePath(url) {
    return new URL(url).pathname.split('/').map(segment => /^\d+$/.test(segment) ? '{id}' : /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(segment) ? '{uuid}' : /^[\da-f]{16,}$/i.test(segment) ? '{hex}' : /^[\w-]{24,}$/.test(segment) ? '{token}' : segment).join('/');
}
function metadata(row) {
    const response = message(row.response);
    return { id: row.id, ts: row.capturedAt ?? row.createdAt, host: row.host, method: row.method, url_template: templatePath(row.url), url: row.url, status: row.status ?? 0, content_type: header(response, 'content-type'), resp_len: bodyLength(response), task_id: row.taskId, worker_session_id: row.workerSessionId, error: row.error };
}
function normalizeHost(raw) {
    raw = raw.trim();
    if (!raw)
        throw new Error('host 为必填参数');
    if (isIP(raw))
        return { host: raw.toLowerCase() };
    if (/^\[[^\]]+\]$/.test(raw))
        return { host: raw.slice(1, -1).toLowerCase() };
    let url;
    try {
        url = new URL(raw.includes('://') ? raw : `http://${raw}`);
    }
    catch {
        throw new Error(`无法解析 host：${raw}`);
    }
    const authority = raw.includes('://') ? raw.split('://')[1].split(/[/?#]/)[0] : raw.split(/[/?#]/)[0];
    const explicitPort = /:(\d+)$/.exec(authority)?.[1];
    if (explicitPort && (Number(explicitPort) < 1 || Number(explicitPort) > 65535))
        throw new Error(`端口无效：${explicitPort}`);
    return { host: url.hostname.replace(/^\[|\]$/g, '').toLowerCase(), port: explicitPort ? String(Number(explicitPort)) : undefined };
}
function includes(value, term) { return value.toLowerCase().includes(term.toLowerCase()); }
function integer(value, fallback, name) {
    if (value === undefined)
        return fallback;
    if (!Number.isSafeInteger(value))
        throw new Error(`${name} must be an integer`);
    return value;
}
export class TrafficQuery {
    store;
    blobRoot;
    constructor(store) {
        this.store = store;
        this.blobRoot = join(dirname(store.storagePath), 'redteam', 'traffic', '_blobs', 'sha256');
    }
    deleteHost(host) { return new TrafficDeletion(this.store).deleteHost(host); }
    deleteHostsExact(hosts) { return new TrafficDeletion(this.store).deleteHostsExact(hosts); }
    deleteAll() { return new TrafficDeletion(this.store).deleteAll(); }
    rows(binding = {}) {
        return this.store.snapshot().traffic.filter(row => (!binding.task_id || row.taskId === binding.task_id) && (!binding.worker_session_id || row.workerSessionId === binding.worker_session_id));
    }
    row(id) {
        const row = this.rows().find(row => row.id === id);
        if (!row)
            throw new Error(`traffic exchange not found: ${id}`);
        return row;
    }
    async readBlob(hash, offset, length) {
        if (!/^[a-f0-9]{64}$/.test(hash))
            throw new Error('invalid traffic blob hash');
        const file = await open(join(this.blobRoot, hash.slice(0, 2), `${hash}.bin`), 'r');
        try {
            const total = (await file.stat()).size;
            const buffer = Buffer.alloc(Math.max(0, Math.min(length, total - offset)));
            const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
            return { data: buffer.subarray(0, bytesRead), total };
        }
        finally {
            await file.close();
        }
    }
    async capturedText(row) {
        const texts = [row.url];
        for (const raw of [row.request, row.response]) {
            const part = message(raw);
            texts.push(head(part));
            if (!part.binary)
                texts.push((part.bodySha256 ? (await this.readBlob(part.bodySha256, 0, 4 * 1024 * 1024)).data : inlineBody(part).subarray(0, 4 * 1024 * 1024)).toString('utf8'));
        }
        return texts.join('\n');
    }
    async search(filter) {
        const { host, port } = normalizeHost(filter.host);
        const body = filter.body_contains?.trim() ?? '';
        if (body && [...body].length < 3)
            throw new Error('正文搜索关键词至少需要 3 个字符');
        const limit = Math.min(10, Math.max(1, integer(filter.limit, 3, 'limit') || 3));
        const page = Math.max(0, integer(filter.page, 0, 'page'));
        const rows = [];
        for (const row of this.rows(filter)) {
            if (row.host.toLowerCase() !== host)
                continue;
            const url = new URL(row.url);
            const recordedPort = /:(\d+)(?:[/?#]|$)/.exec(row.url.split('://')[1] ?? '')?.[1];
            if (port && (recordedPort ?? url.port) !== port)
                continue;
            if (filter.contains && !includes(row.url, filter.contains) && !includes(templatePath(row.url), filter.contains))
                continue;
            if (body && !includes(await this.capturedText(row), body))
                continue;
            rows.push(metadata(row));
        }
        rows.sort((a, b) => b.ts.localeCompare(a.ts) || b.id.localeCompare(a.id));
        return rows.slice(page * limit, (page + 1) * limit).map(({ id, method, url, status, resp_len }) => ({ id, method, url, status, resp_len }));
    }
    async page(filter = {}) {
        const page = Math.max(0, integer(filter.page, 0, 'page'));
        const requestedSize = integer(filter.size, 100, 'size');
        const size = requestedSize <= 0 || requestedSize > 500 ? 100 : requestedSize;
        const rows = [];
        for (const row of this.rows(filter)) {
            const meta = metadata(row);
            if (filter.host?.trim() && !includes(row.host, filter.host.trim()))
                continue;
            if (filter.method?.trim() && row.method.toUpperCase() !== filter.method.trim().toUpperCase())
                continue;
            if (filter.path?.trim() && !includes(meta.url_template, filter.path.trim()))
                continue;
            const status = filter.status?.trim().toLowerCase() ?? '';
            if (/^[1-5]xx$/.test(status) && Math.floor(meta.status / 100) !== Number(status[0]))
                continue;
            if (/^-?\d+$/.test(status) && meta.status !== Number(status))
                continue;
            if (filter.resp_min !== undefined && filter.resp_min >= 0 && meta.resp_len < filter.resp_min)
                continue;
            if (filter.resp_max !== undefined && filter.resp_max >= 0 && meta.resp_len > filter.resp_max)
                continue;
            const query = filter.q?.trim() ?? '', body = filter.body?.trim() ?? '';
            if (query && ![meta.host, meta.url, meta.url_template, meta.method, meta.content_type, String(meta.status)].some(value => includes(value, query)) && ([...query].length < 3 || !includes(await this.capturedText(row), query)))
                continue;
            // ARTEX Page skips too-short body filters; the agent Search reports them.
            if ([...body].length >= 3 && !includes(await this.capturedText(row), body))
                continue;
            rows.push(meta);
        }
        const sort = filter.sort ?? 'ts', direction = filter.order === 'asc' ? 1 : -1;
        rows.sort((a, b) => ((sort === 'ts' ? a.ts.localeCompare(b.ts) : a[sort] - b[sort]) * direction) || b.id.localeCompare(a.id));
        return { count: this.store.snapshot().traffic.length, total: rows.length, page, size, exchanges: rows.slice(page * size, (page + 1) * size) };
    }
    detail(id) {
        const row = this.row(id);
        return { ...metadata(row), request: message(row.request), response: row.response == null ? null : message(row.response) };
    }
    get(id) {
        const row = this.row(id);
        const raw = (value, max) => {
            const part = message(value);
            const text = `${head(part)}\n\n${part.binary ? part.body ?? '[binary body; read traffic body as base64]' : part.body ?? inlineBody(part).toString('utf8')}`;
            const bytes = Buffer.from(text);
            return bytes.subarray(0, max).toString('utf8') + (bytes.length > max ? `\n…[truncated, ${bytes.length} bytes]` : '') + (part.bodySha256 ? `\n…[truncated] @blob sha256:${part.bodySha256} (len=${bodyLength(part)})` : '');
        };
        return `=== REQUEST ===\n${raw(row.request, 2500)}\n\n=== RESPONSE ===\n${raw(row.response, 4000)}`;
    }
    async body(id, side, offset = 0, length = 8192) {
        if (side !== 'request' && side !== 'response')
            throw new Error('side must be request or response');
        if (!Number.isSafeInteger(offset) || offset < 0)
            throw new Error('offset must be a nonnegative integer');
        if (!Number.isSafeInteger(length))
            throw new Error('length must be an integer');
        length = length <= 0 || length > 8192 ? 8192 : length;
        const part = message(this.row(id)[side]);
        const bytes = part.bodySha256 ? await this.readBlob(part.bodySha256, offset, length) : { data: inlineBody(part).subarray(offset, offset + length), total: bodyLength(part) };
        return { offset, length: bytes.data.length, total: bytes.total, base64: bytes.data.toString('base64'), text: part.binary ? undefined : bytes.data.toString('utf8'), binary: part.binary ?? false };
    }
    async blob(hash, offset = 0, length = 8192) {
        const row = this.rows().find(row => [row.request, row.response].some(raw => message(raw).bodySha256 === hash));
        if (!row)
            throw new Error(`traffic blob not referenced: ${hash}`);
        const side = message(row.request).bodySha256 === hash ? 'request' : 'response';
        return this.body(row.id, side, offset, length);
    }
    stats(binding = {}) {
        const rows = this.rows(binding), hosts = new Map();
        const methods = {}, statuses = {};
        let requestBytes = 0, responseBytes = 0;
        for (const row of rows) {
            const ts = row.capturedAt ?? row.createdAt, group = hosts.get(row.host) ?? { host: row.host, count: 0, last: ts };
            group.count++;
            if (ts > group.last)
                group.last = ts;
            hosts.set(row.host, group);
            methods[row.method] = (methods[row.method] ?? 0) + 1;
            const status = String(row.status ?? 0);
            statuses[status] = (statuses[status] ?? 0) + 1;
            requestBytes += bodyLength(message(row.request));
            responseBytes += bodyLength(message(row.response));
        }
        return { count: rows.length, request_bytes: requestBytes, response_bytes: responseBytes, methods, statuses, hosts: [...hosts.values()].sort((a, b) => b.last.localeCompare(a.last)).map(({ host, count }) => ({ host, count })) };
    }
}
