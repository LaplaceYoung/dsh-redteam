import { randomUUID } from 'node:crypto';
import { BlockList, isIP } from 'node:net';
import { domainToASCII } from 'node:url';
import { parse as parseDomain } from 'tldts';
import { assetRow } from '../graph-tools/assets.js';
import { deleteAssetsInState } from './assets.js';
import { AssetManagementError, object } from './validation.js';
const normalizedName = (name) => name.trim().toLowerCase().replace(/\s+/gu, ' ');
const normalizeICP = (value) => value.replace(/\s+/gu, '').toLowerCase();
const text = (value) => typeof value === 'string' ? value : '';
const invalid = (message) => { throw new AssetManagementError(message); };
const companyIdOrder = (a, b) => /^\d+$/.test(a) && /^\d+$/.test(b) ? (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0) : a.localeCompare(b);
function canonicalAddress(ip) {
    if (!isIP(ip) || ip.includes('%'))
        return invalid(`无效 IP: ${ip}`);
    if (isIP(ip) === 4)
        return ip;
    const normalized = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
    const mapped = /^::ffff:([a-f\d]+):([a-f\d]+)$/i.exec(normalized);
    if (mapped) {
        const value = (parseInt(mapped[1], 16) * 65536) + parseInt(mapped[2], 16);
        return [24, 16, 8, 0].map(shift => (value >>> shift) & 255).join('.');
    }
    return normalized;
}
function canonicalNetwork(address, bits) {
    const family = isIP(address);
    if (!family || address.includes('%') || !Number.isInteger(bits) || bits < 0 || bits > (family === 4 ? 32 : 128))
        return invalid(`无效 CIDR: ${address}/${bits}`);
    if (bits < (family === 4 ? 16 : 32))
        return invalid(`网段过宽(${family === 4 ? 'IPv4 需 >= /16' : 'IPv6 需 >= /32'}): ${address}/${bits}`);
    if (family === 4) {
        const value = address.split('.').reduce((n, byte) => (n << 8n) | BigInt(byte), 0n);
        const masked = value >> BigInt(32 - bits) << BigInt(32 - bits);
        return `${[24n, 16n, 8n, 0n].map(shift => Number((masked >> shift) & 255n)).join('.')}/${bits}`;
    }
    const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
    const [left, right] = canonical.split('::'), first = left.split(':').filter(Boolean), last = (right ?? '').split(':').filter(Boolean);
    const words = right === undefined ? first : [...first, ...Array(8 - first.length - last.length).fill('0'), ...last];
    const value = words.reduce((n, word) => (n << 16n) | BigInt(`0x${word}`), 0n);
    const masked = value >> BigInt(128 - bits) << BigInt(128 - bits);
    const expanded = Array.from({ length: 8 }, (_, index) => ((masked >> BigInt((7 - index) * 16)) & 65535n).toString(16)).join(':');
    return `${new URL(`http://[${expanded}]/`).hostname.slice(1, -1)}/${bits}`;
}
function looksLikeIP(value) {
    if (/\s|:\/\//u.test(value))
        return false;
    if (/^[\d.]+$/.test(value) && value.includes('.'))
        return true;
    if (!value.includes(':'))
        return false;
    let segments = 0;
    for (const part of value.split(':')) {
        if (!part) {
            if (segments || value.startsWith('::'))
                return true;
            continue;
        }
        if (!/^[a-f\d]{1,4}$/i.test(part))
            return false;
        if (++segments >= 2)
            return true;
    }
    return false;
}
function parseNetworkOrDomain(raw) {
    if (!raw)
        return invalid('空行');
    const network = /^(.*)\/(\d+)$/.exec(raw);
    if (network && isIP(network[1])) {
        const net = canonicalNetwork(network[1], Number(network[2]));
        return { kind: 'cidr', value: net, net, raw };
    }
    if (isIP(raw)) {
        const ip = canonicalAddress(raw), net = `${ip}/${isIP(ip) === 4 ? 32 : 128}`;
        return { kind: 'ip', value: net, net, raw };
    }
    const candidate = raw.startsWith('//') ? `http:${raw}` : raw.includes('://') ? raw : `http://${raw}`;
    const authority = /^[^:]+:\/\/([^/?#]+)/.exec(candidate)?.[1];
    if (!authority || /\s/u.test(authority))
        return invalid(`无法识别为有效域名/IP/CIDR: ${raw}`);
    const hostPort = authority.slice(authority.lastIndexOf('@') + 1);
    const hostMatch = hostPort.startsWith('[') ? /^\[([^\]]+)\](?::\d+)?$/.exec(hostPort) : /^([^:]+)(?::\d+)?$/.exec(hostPort);
    if (!hostMatch)
        return invalid(`无法识别为有效域名/IP/CIDR: ${raw}`);
    const host = hostMatch[1].replace(/\.$/, '');
    if (isIP(host)) {
        const ip = canonicalAddress(host), net = `${ip}/${isIP(ip) === 4 ? 32 : 128}`;
        return { kind: 'ip', value: net, net, raw };
    }
    if (looksLikeIP(host))
        return invalid(`无效 IP: ${raw}`);
    const domain = domainToASCII(host).toLowerCase();
    const labels = domain.split('.');
    if (!domain || domain.length > 253 || labels.length < 2 || labels.some(label => !/^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label)))
        return invalid(`无法识别为有效域名/IP/CIDR: ${raw}`);
    if (raw.includes('-') && (raw.match(/\./g)?.length ?? 0) >= 6)
        return invalid(`IP 段请用 CIDR 表示: ${raw}`);
    const parsed = parseDomain(domain, { allowPrivateDomains: true });
    if (parsed.isIcann && parsed.publicSuffix === domain)
        return invalid(`不能用裸 TLD 作为范围: ${raw}`);
    // ARTEX ParseScopeLine calls DomainKey (case/last-dot only), not RootDomain.
    return { kind: 'domain', value: domain, domain, raw };
}
function parseRule(kind, raw) {
    if (!kind) {
        if (!raw)
            return invalid('空行');
        if (isIP(raw) || /^(.*)\/\d+$/.test(raw) && isIP(raw.slice(0, raw.lastIndexOf('/'))))
            return parseNetworkOrDomain(raw);
        const slash = raw.lastIndexOf('/');
        if (slash > 0 && (isIP(raw.slice(0, slash).trim()) || looksLikeIP(raw.slice(0, slash).trim())))
            return invalid(`无效 CIDR: ${raw}`);
        if (looksLikeIP(raw))
            return invalid(`无效 IP: ${raw}`);
        if (raw.includes('://') || raw.includes('.') && !/\s/u.test(raw))
            return parseNetworkOrDomain(raw);
        kind = !/[.．。]/u.test(raw) && (/icp/i.test(raw) || raw.includes('备案')) ? 'icp' : 'keyword';
    }
    if (['domain', 'ip', 'cidr'].includes(kind)) {
        const rule = parseNetworkOrDomain(raw);
        if (rule.kind !== kind)
            return invalid(`${raw} 不是有效的 ${kind} 范围`);
        return rule;
    }
    if (kind === 'icp' || kind === 'keyword') {
        const value = kind === 'icp' ? normalizeICP(raw) : normalizedName(raw);
        if (!value)
            return invalid(`${kind} 不能为空`);
        return { kind, value, raw };
    }
    return invalid(`不支持的范围类型: ${kind}`);
}
/** Request-shape/bounds errors reject the request; invalid individual rules are reported. */
export function parseCompanyScopeInputs(inputs) {
    if (!Array.isArray(inputs))
        return invalid('scope must be an array');
    const normalized = inputs.map(input => {
        const row = typeof input === 'string' ? { value: input, kind: '' } : object(input);
        if (typeof row.value !== 'string' || row.kind !== undefined && typeof row.kind !== 'string')
            return invalid('scope entries must be strings or {kind?:string,value:string}');
        if (Array.from(row.value).length > 1024)
            return invalid('企业范围原始值过长: 最多 1024 个字符');
        return { value: row.value.trim(), kind: text(row.kind).trim().toLowerCase() };
    });
    const result = { rules: [], invalid: 0, errors: [] };
    for (const input of normalized) {
        try {
            result.rules.push(parseRule(input.kind, input.value));
        }
        catch (error) {
            if (!(error instanceof AssetManagementError))
                throw error;
            result.invalid++;
            result.errors.push(`${input.value}: ${error.message}`);
        }
    }
    if (result.rules.some(rule => Array.from(rule.value).length > 1024))
        return invalid('企业范围规范化值过长: 最多 1024 个字符');
    return result;
}
function companyScopes(state, companyId) {
    return state.scopes.filter(scope => scope.taskId === 'global' && scope.companyId && (!companyId || scope.companyId === companyId));
}
function scopeDTO(scope) {
    const kind = scope.kind === 'root_domain' ? 'domain' : scope.kind;
    return { id: scope.id, company_id: scope.companyId, kind, ...(kind === 'domain' ? { domain: scope.value } : kind === 'ip' || kind === 'cidr' ? { net: scope.value } : { value: scope.value }), raw: scope.raw ?? scope.value, reason: scope.reason ?? '' };
}
function requireCompany(state, id) {
    const row = state.companies.find(company => company.id === id);
    if (!row)
        throw new AssetManagementError(`company not found: ${id}`, 404);
    return row;
}
function companyDTO(company) { return { ...company, nkey: company.nkey ?? normalizedName(company.name), created_at: company.createdAt, updated_at: company.updatedAt }; }
function view(state, id) { const company = requireCompany(state, id); return { ...companyDTO(company), scope: companyScopes(state, id).map(scopeDTO), asset_count: state.assets.filter(asset => asset.companyId === id).length }; }
function matchesNetwork(ip, network) {
    if (!isIP(ip) || ip.includes('%'))
        return false;
    const [address, mask] = network.split('/'), family = isIP(address), bits = mask === undefined ? family === 4 ? 32 : 128 : Number(mask);
    if (!family || !Number.isInteger(bits) || bits < 0 || bits > (family === 4 ? 32 : 128))
        return false;
    const block = new BlockList();
    block.addSubnet(address, bits, family === 4 ? 'ipv4' : 'ipv6');
    return block.check(ip, isIP(ip) === 4 ? 'ipv4' : 'ipv6');
}
/** Shared insert-time attribution; callers mark the resulting ownership as scope-derived. */
export function attributedCompanyForAsset(state, asset) {
    const ids = new Set(state.companies.map(company => company.id));
    const scopes = companyScopes(state).filter(scope => ids.has(scope.companyId)).sort((a, b) => companyIdOrder(a.companyId, b.companyId));
    const row = assetRow(asset);
    if (['root_domain', 'subdomain', 'service', 'endpoint'].includes(asset.kind)) {
        const domain = scopes.find(scope => scope.kind === 'root_domain' && scope.value === row.root_domain);
        if (domain)
            return domain.companyId;
    }
    if (['ip', 'subdomain', 'service', 'endpoint'].includes(asset.kind)) {
        const networks = scopes.filter(scope => ['ip', 'cidr'].includes(scope.kind) && matchesNetwork(text(row.ip), scope.value));
        networks.sort((a, b) => Number(b.value.split('/')[1] ?? (isIP(b.value) === 4 ? 32 : 128)) - Number(a.value.split('/')[1] ?? (isIP(a.value) === 4 ? 32 : 128)) || companyIdOrder(a.companyId, b.companyId));
        if (networks.length)
            return networks[0].companyId;
    }
    return scopes.find(scope => scope.kind === 'icp' && scope.value && [row.icp, row.app_icp].some(value => normalizeICP(text(value)) === scope.value))?.companyId;
}
function attributionWarnings(state) {
    const malformed = state.assets.filter(asset => {
        const ip = text(assetRow(asset).ip);
        return ['ip', 'subdomain', 'service', 'endpoint'].includes(asset.kind) && ip && (!isIP(ip) || ip.includes('%'));
    });
    return malformed.length ? [`${malformed.length} 条资产的 ip 字段不是合法 IP，已跳过 IP/CIDR 范围匹配：${malformed.slice(0, 5).map(asset => `#${asset.id} ${text(assetRow(asset).ip)}`).join('、')}`] : [];
}
export function recomputeCompanyAttribution(state) {
    let updated = 0;
    for (const asset of state.assets) {
        const old = asset.companyId;
        if (asset.metadata.company_source === 'scope')
            delete asset.companyId;
        // Migrated legacy ownership without provenance is explicit, as in ARTEX schema.sql.
        if (!asset.companyId) {
            const owner = attributedCompanyForAsset(state, asset);
            if (owner) {
                asset.companyId = owner;
                asset.metadata.company_source = 'scope';
            }
        }
        if (asset.companyId !== old)
            updated++;
    }
    return { updated, warnings: attributionWarnings(state) };
}
function insertScopes(state, companyId, rules, reason) {
    let added = 0, skipped = 0, needsAttribution = false;
    for (const rule of rules) {
        const kind = rule.kind === 'domain' ? 'root_domain' : rule.kind;
        // The SQL network uniqueness constraint is shared by ip and cidr kinds.
        if (companyScopes(state, companyId).some(scope => scope.value === rule.value && (scope.kind === kind || ['ip', 'cidr'].includes(scope.kind) && ['ip', 'cidr'].includes(kind)))) {
            skipped++;
            continue;
        }
        const scope = { id: randomUUID(), taskId: 'global', companyId, kind, value: rule.value, raw: rule.raw, reason, source: 'human', createdAt: new Date().toISOString() };
        state.scopes.push(scope);
        added++;
        needsAttribution ||= kind !== 'keyword';
    }
    return { added, skipped, needsAttribution };
}
export class CompanyManagementRuntime {
    store;
    constructor(store) {
        this.store = store;
    }
    list() { const state = this.store.snapshot(); return state.companies.map(company => view(state, company.id)).sort((a, b) => a.name.localeCompare(b.name)); }
    get(id) { const state = this.store.snapshot(); return { company: companyDTO(requireCompany(state, id)), scope: companyScopes(state, id).map(scopeDTO) }; }
    async create(input) {
        if (typeof input.name !== 'string' || !input.name.trim())
            return invalid('name required');
        if (input.logo !== undefined && typeof input.logo !== 'string')
            return invalid('logo must be a string');
        const name = input.name.trim(), nkey = normalizedName(name), parsed = parseCompanyScopeInputs(input.scope ?? []);
        return this.store.transaction(state => {
            if (state.companies.some(company => normalizedName(company.name) === nkey))
                throw new AssetManagementError('企业名称已存在', 409);
            const at = new Date().toISOString(), company = { id: randomUUID(), name, nkey, ...(input.logo ? { logo: input.logo } : {}), createdAt: at, updatedAt: at };
            state.companies.push(company);
            const inserted = insertScopes(state, company.id, parsed.rules, 'api'), attribution = inserted.needsAttribution ? recomputeCompanyAttribution(state) : { updated: 0, warnings: [] };
            return { ...view(state, company.id), created: true, added: inserted.added, skipped: inserted.skipped, invalid: parsed.invalid, errors: parsed.errors, scope_added: inserted.added, scope_skipped: inserted.skipped, scope_invalid: parsed.invalid, scope_errors: parsed.errors, warnings: attribution.warnings };
        });
    }
    async scope(id, input) {
        if (input.reset !== undefined && typeof input.reset !== 'boolean')
            return invalid('reset must be boolean');
        if (input.reason !== undefined && typeof input.reason !== 'string')
            return invalid('reason must be a string');
        const parsed = parseCompanyScopeInputs(input.scope);
        if (input.reset && parsed.invalid)
            return invalid(`企业范围包含 ${parsed.invalid} 条无效规则，未覆盖原有范围: ${parsed.errors.join('; ')}`);
        return this.store.transaction(state => {
            requireCompany(state, id);
            if (input.reset)
                state.scopes = state.scopes.filter(scope => !(scope.taskId === 'global' && scope.companyId === id));
            const inserted = insertScopes(state, id, parsed.rules, input.reason ?? '');
            const attribution = input.reset || inserted.needsAttribution ? recomputeCompanyAttribution(state) : { updated: 0, warnings: attributionWarnings(state) };
            return { added: inserted.added, skipped: input.reset ? 0 : inserted.skipped, invalid: parsed.invalid, errors: parsed.errors, scope: companyScopes(state, id).map(scopeDTO), warnings: attribution.warnings };
        });
    }
    async delete(id, deleteAssets = false) {
        if (typeof deleteAssets !== 'boolean')
            return invalid('deleteAssets must be boolean');
        return this.store.transaction(state => {
            requireCompany(state, id);
            const assetsDeleted = deleteAssets ? deleteAssetsInState(state, new Set(state.assets.filter(asset => asset.companyId === id).map(asset => asset.id))) : 0;
            state.companies = state.companies.filter(company => company.id !== id);
            state.scopes = state.scopes.filter(scope => scope.companyId !== id && !(scope.kind === 'company' && scope.value === id));
            for (const task of state.tasks)
                if (task.companyIds)
                    task.companyIds = task.companyIds.filter(companyId => companyId !== id);
            for (const asset of state.assets)
                if (asset.companyId === id)
                    delete asset.companyId;
            const attribution = recomputeCompanyAttribution(state);
            return { ok: true, deleted: 1, assets_deleted: assetsDeleted, warnings: attribution.warnings };
        });
    }
    async reattribute() { return this.store.transaction(state => ({ ok: true, ...recomputeCompanyAttribution(state) })); }
    async upsertFromSync(input) {
        if (typeof input.name !== 'string' || !input.name.trim())
            return invalid('name required');
        if (typeof input.source !== 'string')
            return invalid('source must be a string');
        if (!Array.isArray(input.roots) || input.roots.some(root => typeof root !== 'string'))
            return invalid('roots must be a string array');
        const parsed = parseCompanyScopeInputs(input.roots.map(value => ({ kind: 'domain', value }))), name = input.name.trim();
        return this.store.transaction(state => {
            let company = state.companies.find(row => normalizedName(row.name) === normalizedName(name));
            const created = !company, at = new Date().toISOString();
            if (!company) {
                company = { id: randomUUID(), name, nkey: normalizedName(name), createdAt: at, updatedAt: at };
                state.companies.push(company);
            }
            else {
                company.name = name;
                company.updatedAt = at;
            }
            const inserted = insertScopes(state, company.id, parsed.rules, input.source);
            const attribution = inserted.needsAttribution ? recomputeCompanyAttribution(state) : { updated: 0, warnings: [] };
            return { id: company.id, created, added: inserted.added, skipped: inserted.skipped, invalid: parsed.invalid, errors: parsed.errors, warnings: attribution.warnings };
        });
    }
}
