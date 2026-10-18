import { randomUUID } from 'node:crypto';
import { BlockList, isIP } from 'node:net';
import { getDomain } from 'tldts';
import { assertAssetInsertionAllowed, intentAssetIds } from '../task-asset-runtime.js';
import { requireManagedTask } from '../task-management/index.js';
const domainKey = (value) => value.trim().toLowerCase().replace(/\.$/, '');
const rootDomain = (value) => isIP(value) ? value : getDomain(value, { allowPrivateDomains: true }) ?? value;
const icpKey = (value) => value.replace(/\s+/gu, '').toLowerCase();
const strings = (value) => Array.isArray(value) ? value.filter((v) => typeof v === 'string') : [];
const records = (value) => Array.isArray(value) ? value.filter((v) => typeof v === 'object' && v !== null && !Array.isArray(v)) : [];
const str = (value) => typeof value === 'string' ? value : '';
const unique = (values) => [...new Set(values)];
const canonical = (value) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
/** Go's normalizeURL preserves explicit default ports, path spelling and query order. */
export function normalizeAssetURL(raw) {
    const match = /^([a-z][a-z0-9+.-]*:)?\/\/([^/?#]*)(.*)$/i.exec(raw);
    if (!match)
        return raw;
    const authority = match[2], at = authority.lastIndexOf('@');
    const host = authority.slice(at + 1).toLowerCase();
    const result = `${(match[1] ?? '').toLowerCase()}//${authority.slice(0, at + 1)}${host}${match[3]}`;
    return match[3] === '/' ? result.slice(0, -1) : result;
}
function urlFields(raw) {
    const url = normalizeAssetURL(raw);
    const match = /^([a-z][a-z0-9+.-]*:)?\/\/([^/?#]*)/i.exec(url);
    const authority = match?.[2] ?? '', hostPort = authority.slice(authority.lastIndexOf('@') + 1);
    const parts = hostPort.startsWith('[') ? /^\[([^\]]+)\](?::(\d+))?$/.exec(hostPort) : /^([^:]*)(?::(\d+))?$/.exec(hostPort);
    const domain = (parts?.[1] ?? '').toLowerCase(), scheme = (match?.[1] ?? '').replace(/:$/, '').toLowerCase();
    return { url, domain, root_domain: rootDomain(domain), port: parts?.[2] ? Number(parts[2]) : scheme === 'https' ? 443 : scheme === 'http' ? 80 : 0, service_name: scheme.toUpperCase() };
}
function cSegment(ip) {
    if (isIP(ip) === 4)
        return `${ip.split('.').slice(0, 3).join('.')}.0/24`;
    if (isIP(ip) === 6) {
        const host = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
        const sides = host.split('::'), left = sides[0].split(':').filter(Boolean), right = (sides[1] ?? '').split(':').filter(Boolean);
        const words = sides.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
        const network = `${words.slice(0, 3).join(':')}:0:0:0:0:0`;
        return `${new URL(`http://[${network}]/`).hostname.slice(1, -1)}/48`;
    }
    return '';
}
function validateInput(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('asset must be an object');
    const input = Object.fromEntries(Object.entries(value));
    if (typeof input.type !== 'string')
        throw new Error('asset.type must be a string');
    for (const key of ['domain', 'icp', 'record_type', 'ip', 'app_name', 'bundle_id', 'category', 'description', 'app_icp', 'company_id', 'url', 'page_title', 'favicon_mmh3', 'service_name', 'service_ip', 'proto', 'method'])
        if (input[key] !== undefined && typeof input[key] !== 'string')
            throw new Error(`${key} must be a string`);
    for (const key of ['record_value', 'bound_domains', 'technologies']) {
        const field = input[key];
        if (field !== undefined && (!Array.isArray(field) || field.some(v => typeof v !== 'string')))
            throw new Error(`${key} must be a string array`);
    }
    for (const key of ['auth', 'params']) {
        const field = input[key];
        if (field !== undefined && (!Array.isArray(field) || records(field).length !== field.length))
            throw new Error(`${key} must be an object array`);
    }
    for (const key of ['port', 'status_code', 'content_length'])
        if (input[key] !== undefined && !Number.isSafeInteger(input[key]))
            throw new Error(`${key} must be an integer`);
    if (input.open_ports !== undefined && (!Array.isArray(input.open_ports) || records(input.open_ports).length !== input.open_ports.length || records(input.open_ports).some(v => !Number.isSafeInteger(v.port) || (v.service !== undefined && typeof v.service !== 'string'))))
        throw new Error('open_ports must contain integer port and optional string service');
}
export function parseAssetInput(value) {
    if (value && typeof value === 'object' && !Array.isArray(value) && 'company_id' in value && typeof value.company_id === 'number') {
        if (!Number.isSafeInteger(value.company_id) || value.company_id <= 0)
            throw new Error('company_id must be a positive integer or ID string');
        value = { ...value, company_id: String(value.company_id) };
    }
    validateInput(value);
    return { ...value, type: value.type.trim() };
}
export function normalizeAsset(input) {
    validateInput(input);
    const kind = input.type.trim(), metadata = {};
    const put = (key, value) => { if (value !== undefined && value !== '')
        metadata[key] = value; };
    const required = (value, field) => { if (!value)
        throw new Error(`${field} is required`); return value; };
    let value;
    switch (kind) {
        case 'root_domain':
        case 'subdomain': {
            value = domainKey(required(input.domain, 'domain'));
            required(value, 'domain');
            metadata.domain = value;
            metadata.root_domain = kind === 'root_domain' ? value : rootDomain(value);
            put('icp', input.icp);
            if (kind === 'subdomain') {
                put('record_type', input.record_type);
                put('record_value', input.record_value);
                if (input.record_type === 'A' || input.record_type === 'AAAA')
                    put('ip', input.record_value?.flatMap(v => v.split(',')).map(v => v.trim()).find(v => isIP(v)));
            }
            break;
        }
        case 'ip':
            value = required(input.ip, 'ip');
            metadata.ip = value;
            put('bound_domains', input.bound_domains);
            put('open_ports', input.open_ports);
            break;
        case 'app':
            value = required(input.app_name, 'app name');
            metadata.app_name = value;
            put('bundle_id', input.bundle_id);
            put('category', input.category);
            put('app_description', input.description);
            put('app_icp', input.app_icp);
            break;
        case 'service':
        case 'endpoint': {
            if (kind === 'endpoint' || input.url) {
                const fields = urlFields(required(input.url, 'url'));
                Object.assign(metadata, fields);
                value = fields.url;
                if (kind === 'endpoint') {
                    metadata.method = required(input.method, 'method').toUpperCase();
                    put('params', input.params);
                    // The actual ARTEX tool passes service_ip only for endpoint (its ip description is stale).
                    put('ip', input.service_ip);
                }
                else {
                    metadata.service_type = 'http';
                    put('ip', input.service_ip || input.ip);
                    for (const key of ['technologies', 'auth', 'status_code', 'content_length', 'page_title', 'favicon_mmh3'])
                        put(key, input[key]);
                }
            }
            else {
                const domain = domainKey(input.domain ?? ''), ip = input.ip ?? '';
                if (!domain && !ip)
                    throw new Error('domain or ip is required');
                if (!input.port)
                    throw new Error('port is required');
                const name = required(input.service_name, 'service_name').trim().toLowerCase();
                metadata.service_type = 'other';
                metadata.service_name = name;
                metadata.port = input.port;
                put('domain', domain);
                put('root_domain', rootDomain(domain));
                put('ip', ip);
                put('auth', input.auth);
                value = `${name}://${domain || ip}:${input.port}`;
            }
            break;
        }
        default: throw new Error(`unknown type: ${kind}`);
    }
    if (metadata.ip !== undefined && !isIP(str(metadata.ip)))
        throw new Error(`invalid asset ip: ip 必须是 IPv4/IPv6 地址，收到 ${JSON.stringify(metadata.ip)}；主机名请使用 type=subdomain 的 domain 字段`);
    if (metadata.ip)
        put('c_segment', cSegment(str(metadata.ip)));
    return { kind, value, metadata };
}
export function assetKey(asset) {
    const m = asset.metadata;
    switch (asset.kind) {
        case 'root_domain': return canonical([asset.kind, domainKey(str(m.domain) || asset.value)]);
        case 'subdomain': return canonical([asset.kind, domainKey(str(m.domain) || asset.value), str(m.record_type)]);
        case 'app': return canonical([asset.kind, m.bundle_id ? 'bundle' : 'name', m.bundle_id || m.app_name || asset.value]);
        case 'service': return m.service_type === 'other' ? canonical(['service', 'other', str(m.domain), str(m.ip), m.port, m.service_name]) : canonical(['service', 'http', normalizeAssetURL(str(m.url) || asset.value)]);
        case 'endpoint': return canonical(['endpoint', normalizeAssetURL(str(m.url) || asset.value), m.method]);
        default: return canonical([asset.kind, asset.value]);
    }
}
/** Projects legacy generic assets without rewriting their persisted representation. */
export function assetRow(asset, taskId) {
    const m = { ...asset.metadata };
    const sources = records(m.task_sources);
    delete m.task_sources;
    delete m.task_source;
    delete m.task_source_summary;
    delete m.task_source_node_id;
    if (taskId) {
        const source = sources.find(row => row.task_id === taskId);
        if (source) {
            m.task_source = source.source;
            m.task_source_summary = source.summary;
            if (source.node_id)
                m.task_source_node_id = source.node_id;
        }
    }
    if (['domain', 'root_domain', 'subdomain'].includes(asset.kind)) {
        m.domain ??= domainKey(asset.value);
        m.root_domain ??= asset.kind === 'root_domain' ? m.domain : rootDomain(str(m.domain));
    }
    if (asset.kind === 'ip')
        m.ip ??= asset.value;
    if (['url', 'service', 'endpoint'].includes(asset.kind) && /^https?:\/\//i.test(asset.value))
        Object.assign(m, { ...urlFields(asset.value), ...m });
    return { ...m, id: asset.id, type: asset.kind, ...(asset.companyId ? { company_id: asset.companyId } : {}), task_ids: unique([...(asset.taskId === 'global' ? [] : [asset.taskId]), ...strings(m.task_ids)]), last_seen: str(m.last_seen) || asset.createdAt };
}
function inNetwork(ip, network) {
    if (!isIP(ip))
        return false;
    const [address, rawBits] = network.split('/'), family = isIP(address);
    if (!family)
        return false;
    const bits = rawBits === undefined ? (family === 4 ? 32 : 128) : Number(rawBits);
    if (!Number.isInteger(bits) || bits < 0 || bits > (family === 4 ? 32 : 128))
        return false;
    const block = new BlockList();
    block.addSubnet(address, bits, family === 4 ? 'ipv4' : 'ipv6');
    return block.check(ip, isIP(ip) === 4 ? 'ipv4' : 'ipv6');
}
function scopeMatches(scope, asset, coverage) {
    const m = assetRow(asset);
    switch (scope.kind) {
        case 'company': return asset.companyId === (scope.companyId || scope.value);
        case 'root_domain': return m.root_domain === domainKey(scope.value);
        case 'subdomain': return m.domain === domainKey(scope.value);
        case 'ip':
        case 'cidr': return inNetwork(str(m.ip), scope.value) || (!coverage && inNetwork(str(m.domain), scope.value));
        case 'icp': return [m.icp, m.app_icp].some(v => typeof v === 'string' && icpKey(v) === icpKey(scope.value));
        case 'keyword': return false; // ARTEX preserves text scope but does not include it in asset membership.
    }
}
function contextTasks(state, taskId) {
    const task = requireManagedTask(state, taskId);
    return new Set([taskId, ...(task.sourceTaskIds ?? []).filter(id => state.tasks.some(t => t.id === id))]);
}
export function scopedAssets(state, taskId, includeAnchors = false) {
    const owners = contextTasks(state, taskId), scopes = state.scopes.filter(s => owners.has(s.taskId));
    const anchors = new Set(includeAnchors ? state.nodes.filter(n => owners.has(n.taskId)).flatMap(n => [...strings(n.data.asset_ids), ...strings(n.data.assetIds)]) : []);
    if (includeAnchors) {
        for (const intent of state.intents)
            if (owners.has(intent.taskId))
                for (const id of intentAssetIds(intent.input))
                    anchors.add(id);
        for (const finding of state.findings)
            if (owners.has(finding.taskId))
                for (const id of finding.assetIds)
                    anchors.add(id);
        for (const edge of state.edges)
            if (owners.has(edge.taskId) && edge.relation === 'anchors') {
                anchors.add(edge.from);
                anchors.add(edge.to);
            }
    }
    return state.assets.filter(asset => anchors.has(asset.id) || scopes.some(scope => scopeMatches(scope, asset, includeAnchors)));
}
function testedAssets(state, taskId) {
    const owners = contextTasks(state, taskId), facts = state.nodes.filter(n => owners.has(n.taskId) && n.kind === 'fact' && n.data.hint !== true && !['strategic_hint', 'digest'].includes(str(n.data.kind)));
    const ids = new Set(facts.flatMap(n => [...strings(n.data.asset_ids), ...strings(n.data.assetIds)])), factIds = new Set(facts.map(n => n.id));
    for (const edge of state.edges)
        if (owners.has(edge.taskId) && edge.relation === 'anchors') {
            if (factIds.has(edge.from))
                ids.add(edge.to);
            if (factIds.has(edge.to))
                ids.add(edge.from);
        }
    return ids;
}
function mergeMetadata(previous, next) {
    const merged = { ...previous, ...next };
    for (const key of ['technologies', 'bound_domains', 'record_value', 'task_ids'])
        if (previous[key] !== undefined || next[key] !== undefined)
            merged[key] = unique([...strings(previous[key]), ...strings(next[key])]);
    if (previous.auth !== undefined || next.auth !== undefined)
        merged.auth = [...new Map([...records(previous.auth), ...records(next.auth)].map(v => [canonical(v), v])).values()];
    if (previous.params !== undefined || next.params !== undefined) {
        const sorted = [...records(previous.params), ...records(next.params)].sort((a, b) => canonical(b).localeCompare(canonical(a)));
        const params = new Map();
        for (const item of sorted) {
            const key = canonical([item.location ?? null, item.name ?? null]);
            if (!params.has(key))
                params.set(key, item);
        }
        merged.params = [...params.values()].sort((a, b) => str(a.location).localeCompare(str(b.location)) || str(a.name).localeCompare(str(b.name)));
    }
    if (previous.open_ports !== undefined || next.open_ports !== undefined) {
        const ports = new Map();
        for (const item of [...records(previous.open_ports), ...records(next.open_ports)]) {
            const port = Number(item.port), old = ports.get(port);
            if (!old || (!old.service && item.service))
                ports.set(port, item);
        }
        merged.open_ports = [...ports.entries()].sort(([a], [b]) => a - b).map(([, value]) => value);
    }
    return merged;
}
function attributedCompany(state, m) {
    const scopes = state.scopes.filter(s => s.taskId === 'global' && s.companyId).sort((a, b) => str(a.companyId).localeCompare(str(b.companyId)));
    return scopes.find(s => s.kind === 'root_domain' && domainKey(s.value) === m.root_domain)?.companyId
        ?? scopes.filter(s => ['ip', 'cidr'].includes(s.kind) && inNetwork(str(m.ip), s.value)).sort((a, b) => Number(b.value.split('/')[1] ?? 128) - Number(a.value.split('/')[1] ?? 128))[0]?.companyId
        ?? scopes.find(s => s.kind === 'icp' && icpKey(s.value) === icpKey(str(m.icp || m.app_icp)) && icpKey(s.value))?.companyId;
}
function upsert(state, taskId, input, at, derived = false) {
    const normalized = normalizeAsset(input), key = assetKey(normalized);
    if (!derived)
        assertAssetInsertionAllowed(state, { taskId, kind: 'artex_input', value: normalized.value, metadata: { domain: input.domain, bound_domains: input.bound_domains, ip: input.ip, service_ip: input.service_ip, url: input.url } });
    if (input.company_id && input.type === 'app' && !state.companies.some(c => c.id === input.company_id))
        throw new Error(`company not found: ${input.company_id}`);
    const m = normalized.metadata, domain = str(m.domain), root = str(m.root_domain), ip = str(m.ip);
    // ARTEX assigns root/IP IDs before the subdomain ID; the insertion order is
    // also the stable tie breaker for assets seen in the same transaction.
    if (input.type === 'subdomain') {
        upsert(state, taskId, { type: 'root_domain', domain: root }, at, true);
        if (input.record_type === 'A' || input.record_type === 'AAAA')
            for (const candidate of (input.record_value ?? []).flatMap(v => v.split(',')).map(v => v.trim()).filter(v => isIP(v)))
                upsert(state, taskId, { type: 'ip', ip: candidate, bound_domains: [domain] }, at, true);
    }
    const previous = state.assets.find(a => assetKey(a) === key);
    const companyId = input.type === 'app' && input.company_id ? input.company_id : previous?.metadata.company_source === 'explicit' ? previous.companyId : attributedCompany(state, normalized.metadata) ?? previous?.companyId;
    const metadata = mergeMetadata(previous?.metadata ?? {}, { ...normalized.metadata, task_ids: taskId === 'global' ? [] : [taskId], last_seen: at });
    if (input.type === 'app' && input.company_id)
        metadata.company_source = 'explicit';
    const asset = previous ?? { ...normalized, id: randomUUID(), taskId, source: 'worker', createdAt: at };
    asset.value = normalized.value;
    asset.metadata = metadata;
    if (companyId)
        asset.companyId = companyId;
    if (!previous)
        state.assets.push(asset);
    if (['service', 'endpoint'].includes(input.type)) {
        if (root)
            upsert(state, taskId, { type: 'root_domain', domain: root }, at, true);
        if (domain && domain !== root && !isIP(domain))
            upsert(state, taskId, { type: 'subdomain', domain }, at, true);
        if (ip)
            upsert(state, taskId, { type: 'ip', ip, ...(input.type === 'service' ? { bound_domains: domain ? [domain] : [], open_ports: Number(m.port) > 0 ? [{ port: Number(m.port), service: str(m.service_name) }] : [] } : {}) }, at, true);
    }
    return asset;
}
function autoScope(state, taskId, item, at) {
    if (taskId === 'global')
        return;
    let kind, value = '';
    if (item.type === 'root_domain' || item.type === 'subdomain') {
        kind = item.type;
        value = domainKey(item.domain ?? '');
    }
    if (item.type === 'service' || item.type === 'endpoint') {
        const host = domainKey(item.domain || (item.url ? urlFields(item.url).domain : ''));
        if (host && !isIP(host)) {
            kind = 'subdomain';
            value = host;
        }
    }
    const ip = item.service_ip || item.ip;
    if ((item.type === 'ip' || item.type === 'service' || item.type === 'endpoint') && !kind && ip && isIP(ip)) {
        kind = 'ip';
        value = `${ip}/${isIP(ip) === 4 ? 32 : 128}`;
    }
    if (kind && value && !state.scopes.some(s => s.taskId === taskId && s.kind === kind && s.value === value))
        state.scopes.push({ id: randomUUID(), taskId, kind, value, source: 'auto', createdAt: at });
}
const stringFields = new Set('domain root_domain ip url page_title icp service_name app_name bundle_id category app_icp method service_type record_type'.split(' '));
const aliases = { title: 'page_title', status: 'status_code', technology: 'technologies', tech: 'technologies' };
const fullTextFields = 'domain root_domain ip url page_title icp service_name app_name app_description technologies bound_domains'.split(' ');
function like(value, query) {
    let pattern = '';
    for (let i = 0; i < query.length; i++) {
        const c = query[i];
        if (c === '\\' && i + 1 < query.length)
            pattern += query[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        else
            pattern += c === '%' ? '[\\s\\S]*' : c === '_' ? '[\\s\\S]' : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp(pattern, 'iu').test(value);
}
function leaf(field, op, value) {
    const key = aliases[field] ?? field;
    if (!field)
        return row => fullTextFields.some(k => typeof row[k] === 'string' ? like(str(row[k]), value) : strings(row[k]).some(v => like(v, value)));
    // IDs are opaque UUIDs in DSH. Preserve ARTEX's equality-only special fields.
    if (key === 'task_id')
        return row => row.task_ids.includes(value);
    if (key === 'company_id')
        return row => row.company_id === value;
    if (key === 'port' || key === 'status_code') {
        if (!/^[+-]?\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
            throw new Error(`字段 ${key} 需要整数值: ${value}`);
        const n = Number(value);
        return row => { const actual = row[key]; if (typeof actual !== 'number')
            return false; switch (op) {
            case '=':
            case '==': return actual === n;
            case '!=': return actual !== n;
            case '>': return actual > n;
            case '>=': return actual >= n;
            case '<': return actual < n;
            case '<=': return actual <= n;
            default: return false;
        } };
    }
    if (!['=', '==', '!='].includes(op))
        throw new Error(`字段 ${field} 不支持运算符 ${op}`);
    if (key === 'technologies')
        return row => op === '=' ? strings(row[key]).some(v => like(v, value)) : op === '==' ? strings(row[key]).includes(value) : !strings(row[key]).includes(value);
    return row => { const actual = row[key]; if (typeof actual !== 'string')
        return false; return op === '==' ? actual === value : op === '!=' ? !like(actual, value) : like(actual, value); };
}
/** Small recursive-descent parser matching ARTEX AND > OR precedence and quoted tokens. */
export function compileAssetDSL(dsl) {
    const tokens = [];
    let i = 0;
    const read = () => { if (dsl[i] === '"') {
        const start = ++i;
        while (i < dsl.length && dsl[i] !== '"')
            i++;
        const value = dsl.slice(start, i);
        if (i < dsl.length)
            i++;
        return value;
    } const start = i; while (i < dsl.length && !/[\s()]/u.test(dsl[i]))
        i++; return dsl.slice(start, i); };
    while (i < dsl.length) {
        if (/\s/u.test(dsl[i])) {
            i++;
            continue;
        }
        if (dsl[i] === '(' || dsl[i] === ')') {
            tokens.push(dsl[i++]);
            continue;
        }
        const found = /^([a-z_][a-z_0-9]*)(==|!=|>=|<=|=|>|<)/i.exec(dsl.slice(i));
        const field = found?.[1].toLowerCase(), mapped = field ? aliases[field] ?? field : '';
        if (found && (stringFields.has(mapped) || ['technologies', 'port', 'status_code', 'company_id', 'task_id'].includes(mapped)) && i + found[0].length < dsl.length) {
            i += found[0].length;
            tokens.push(leaf(field, found[2], read()));
        }
        else {
            const word = read(), upper = word.toUpperCase();
            tokens.push(upper === 'AND' || upper === 'OR' ? upper : leaf('', '=', word));
        }
    }
    let cursor = 0;
    const atom = () => { const token = tokens[cursor++]; if (typeof token === 'function')
        return token; if (token === '(') {
        const result = or();
        if (tokens[cursor++] !== ')')
            throw new Error("DSL 语法错误：缺少右括号 ')'");
        return result;
    } throw new Error('DSL 语法错误：表达式不完整'); };
    const and = () => { let result = atom(); while (tokens[cursor] === 'AND') {
        cursor++;
        const left = result, right = atom();
        result = row => left(row) && right(row);
    } return result; };
    const or = () => { let result = and(); while (tokens[cursor] === 'OR') {
        cursor++;
        const left = result, right = and();
        result = row => left(row) || right(row);
    } return result; };
    if (!tokens.length)
        return () => true;
    const result = or();
    if (cursor !== tokens.length)
        throw new Error('DSL 语法错误：条件之间需要 AND/OR');
    return result;
}
function pageNumber(value, fallback) { if (value !== undefined && !Number.isSafeInteger(value))
    throw new Error('pagination must be an integer'); return value !== undefined && value > 0 ? value : fallback; }
function ordered(state, assets) {
    const positions = new Map(state.assets.map((a, i) => [a.id, i]));
    return assets.sort((a, b) => assetRow(b).last_seen.localeCompare(assetRow(a).last_seen) || positions.get(b.id) - positions.get(a.id));
}
export class GraphAssetRuntime {
    store;
    constructor(store) {
        this.store = store;
    }
    async insertAssets(taskId, assets, options = {}) {
        if (!Array.isArray(assets))
            throw new Error('assets must be an array');
        return this.store.transaction(state => {
            if (taskId !== 'global')
                requireManagedTask(state, taskId);
            if (options.ownerIntentId && !state.intents.some(intent => intent.id === options.ownerIntentId && intent.taskId === taskId))
                throw new Error(`owner intent not in current task: ${options.ownerIntentId}`);
            const results = [], errors = [];
            for (const [index, value] of assets.entries()) {
                // Per-item staging preserves successful siblings and prevents partial derived writes.
                const staged = structuredClone(state), at = new Date().toISOString();
                try {
                    const item = parseAssetInput(value);
                    const asset = upsert(staged, taskId, item, at);
                    autoScope(staged, taskId, item, at);
                    const ownerId = options.ownerIntentId;
                    if (taskId !== 'global')
                        asset.metadata.task_sources = [...records(asset.metadata.task_sources).filter(row => row.task_id !== taskId), { task_id: taskId, source: 'agent', summary: ownerId ? `Worker 意图 #${ownerId} 通过 insert_assets 登记` : 'Agent 通过 insert_assets 登记', ...(ownerId ? { node_id: ownerId } : {}) }];
                    if (ownerId) {
                        const intent = staged.intents.find(row => row.id === ownerId && row.taskId === taskId);
                        intent.input.asset_ids = unique([...intentAssetIds(intent.input), asset.id]);
                        const node = staged.nodes.find(row => row.id === ownerId);
                        node.data.asset_ids = unique([...strings(node.data.asset_ids), asset.id]);
                        if (!staged.edges.some(edge => edge.taskId === taskId && edge.from === ownerId && edge.to === asset.id && edge.relation === 'anchors'))
                            staged.edges.push({ id: randomUUID(), taskId, from: ownerId, to: asset.id, relation: 'anchors' });
                        state.intents = staged.intents;
                        state.nodes = staged.nodes;
                        state.edges = staged.edges;
                    }
                    state.assets = staged.assets;
                    state.scopes = staged.scopes;
                    results.push({ index, id: asset.id, type: asset.kind });
                }
                catch (error) {
                    errors.push({ index, error: error instanceof Error ? error.message : String(error) });
                }
            }
            return { results, errors };
        });
    }
    listAssets(taskId, args = {}) {
        const state = this.store.snapshot();
        let assets = taskId === 'global' ? state.assets : scopedAssets(state, taskId);
        if (args.id)
            assets = assets.filter(a => a.id === args.id);
        else if (args.ids?.length) {
            const ids = new Set(args.ids);
            assets = assets.filter(a => ids.has(a.id));
        }
        else {
            if (!args.dsl)
                throw new Error('未传 id/ids 时 dsl 不能为空：不允许无条件查询全部资产，请提供查询条件');
            const matches = compileAssetDSL(args.dsl);
            assets = assets.filter(a => (!args.type || a.kind === args.type) && matches(assetRow(a)));
            const limit = pageNumber(args.limit, 10), offset = pageNumber(args.offset, 0);
            assets = ordered(state, assets).slice(offset, offset + limit);
        }
        const rows = ordered(state, assets).map(asset => assetRow(asset, taskId));
        return { count: rows.length, assets: rows };
    }
    listUntestedAssets(taskId, args = {}) {
        const state = this.store.snapshot(), tested = testedAssets(state, taskId), page = pageNumber(args.page, 1), pageSize = pageNumber(args.page_size, 10);
        const assets = scopedAssets(state, taskId, true).filter(a => (!args.type?.trim() || a.kind === args.type.trim()) && !tested.has(a.id));
        return { assets: assets.slice((page - 1) * pageSize, page * pageSize).map(a => ({ id: a.id, type: a.kind, label: str(a.metadata.url || a.metadata.domain || a.metadata.ip || a.metadata.app_name) || a.value })), total: assets.length, page, page_size: pageSize };
    }
    coverage(taskId, includeSources = true) {
        const snapshot = this.store.snapshot();
        const state = includeSources ? snapshot : { ...snapshot, tasks: snapshot.tasks.map(task => task.id === taskId ? { ...task, sourceTaskIds: [] } : task) };
        const assets = scopedAssets(state, taskId, true), tested = testedAssets(state, taskId);
        const byType = unique(assets.map(a => a.kind)).sort().map(type => { const group = assets.filter(a => a.kind === type); return { type, total: group.length, tested: group.filter(a => tested.has(a.id)).length }; });
        const denominator = assets.length, count = byType.reduce((n, row) => n + row.tested, 0);
        const owners = contextTasks(state, taskId);
        const hostAssets = state.assets.filter(asset => assets.some(a => a.id === asset.id) || assetRow(asset).task_ids.some(id => owners.has(id)));
        const hosts = new Set(hostAssets.flatMap(a => { const row = assetRow(a); return [str(row.domain), str(row.ip), row.url ? urlFields(str(row.url)).domain : ''].map(v => v.trim().toLowerCase()).filter(Boolean); }));
        return { denominator, tested: count, pct: denominator ? count / denominator : null, by_type: byType, host_count: hosts.size, scope_rows: state.scopes.filter(s => owners.has(s.taskId)).length };
    }
    assetNeighbors(taskId, args) {
        const state = this.store.snapshot(), visible = scopedAssets(state, taskId, true), target = visible.find(a => a.id === args.id);
        if (!target)
            throw new Error(`asset not in task or direct sources scope: ${args.id}`);
        const base = assetRow(target, taskId), owners = contextTasks(state, taskId);
        const related = visible.filter(a => a.id !== target.id && (['domain', 'root_domain', 'ip'].some(key => base[key] && assetRow(a)[key] === base[key]) || state.edges.some(e => owners.has(e.taskId) && ((e.from === target.id && e.to === a.id) || (e.to === target.id && e.from === a.id)))));
        const offset = pageNumber(args.offset, 0), limit = pageNumber(args.limit, 10);
        return { asset: base, assets: ordered(state, related).slice(offset, offset + limit).map(asset => assetRow(asset, taskId)), total: related.length, limit, offset };
    }
}
