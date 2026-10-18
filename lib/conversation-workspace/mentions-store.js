import { chatMentionKinds } from './files-mentions.js';
import { WorkspaceFileError } from './files.js';
const kinds = new Set(Object.values(chatMentionKinds));
const clip = (value, limit) => Array.from(value).slice(0, limit).join('');
const compareId = (a, b) => /^\d+$/.test(a) && /^\d+$/.test(b) ? (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0) : a.localeCompare(b, 'en');
const assetKind = (asset) => kinds.has(asset.kind) && !['finding', 'company'].includes(asset.kind) ? asset.kind : 'asset';
const metadata = (asset, key) => typeof asset.metadata[key] === 'string' || typeof asset.metadata[key] === 'number' ? String(asset.metadata[key]) : '';
/** Read one committed snapshot for each lookup. Mention labels never determine identity. */
export class ChatMentionStore {
    store;
    constructor(store) {
        this.store = store;
    }
    async load(ref) {
        const state = this.store.snapshot();
        if (ref.kind === 'finding') {
            const finding = state.findings.find(row => row.id === ref.id);
            return finding ? { finding, assets: state.assets.filter(row => finding.assetIds.includes(row.id)) } : null;
        }
        if (ref.kind === 'company') {
            const company = state.companies.find(row => row.id === ref.id);
            return company ? { company, scope: state.scopes.filter(row => row.companyId === company.id) } : null;
        }
        const asset = state.assets.find(row => row.id === ref.id);
        if (!asset || ref.kind !== 'asset' && assetKind(asset) !== ref.kind)
            return null;
        return { asset, ...(asset.companyId ? { company: state.companies.find(row => row.id === asset.companyId) ?? null } : {}) };
    }
    search(input = {}) {
        const query = (input.query ?? '').trim(), scope = input.scope ?? 'all';
        if (Array.from(query).length > 200 || scope !== 'all' && !kinds.has(scope))
            throw new WorkspaceFileError('引用搜索条件无效');
        const state = this.store.snapshot();
        if (input.taskId && !state.tasks.some(row => row.id === input.taskId))
            throw new WorkspaceFileError('任务不存在', 404);
        const rows = [];
        const add = (id, kind, label, description, search) => {
            if (scope !== 'all' && scope !== kind && !(scope === 'asset' && !['finding', 'company'].includes(kind)))
                return;
            if (query && id !== query && !search.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
                return;
            rows.push({ id, kind, label: clip(label, 160), description: clip(description, 240), search, exact: id === query });
        };
        for (const row of state.findings)
            if (!input.taskId || row.taskId === input.taskId)
                add(row.id, 'finding', row.vulnClass, `${row.severity} / ${row.status} / ${row.summary}`, `${row.vulnClass} ${row.summary}`);
        for (const row of state.companies)
            add(row.id, 'company', row.name, row.description ?? '', `${row.name} ${row.description ?? ''}`);
        for (const row of state.assets) {
            if (input.taskId && row.taskId !== input.taskId)
                continue;
            const fields = ['domain', 'root_domain', 'ip', 'url', 'app_name', 'bundle_id', 'page_title', 'service_name', 'method'].map(key => metadata(row, key));
            const kind = assetKind(row), method = metadata(row, 'method'), url = metadata(row, 'url');
            const label = kind === 'endpoint' && url ? `${method} ${url}`.trim() : metadata(row, 'app_name') || url || metadata(row, 'domain') || metadata(row, 'ip') || metadata(row, 'bundle_id') || row.value;
            add(row.id, kind, label, [kind, ...['page_title', 'service_name', 'bundle_id', 'ip', 'port'].map(key => metadata(row, key)).filter(Boolean)].join(' / '), `${row.value} ${fields.join(' ')}`);
        }
        const compare = (a, b) => Number(b.exact) - Number(a.exact) || compareId(b.id, a.id) || a.kind.localeCompare(b.kind, 'en');
        let cursor;
        if (input.cursor) {
            try {
                if (input.cursor.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(input.cursor))
                    throw new Error('invalid encoding');
                const parsed = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8'));
                if (!parsed || typeof parsed !== 'object')
                    throw new Error('invalid cursor');
                const value = parsed;
                if (typeof value.id !== 'string' || !value.id || typeof value.kind !== 'string' || !kinds.has(value.kind) || typeof value.exact !== 'boolean' || value.query !== query || value.scope !== scope || value.taskId !== input.taskId)
                    throw new Error('cursor does not match query');
                cursor = value;
            }
            catch {
                throw new WorkspaceFileError('引用搜索游标无效或不匹配当前搜索条件');
            }
        }
        const page = rows.sort(compare).filter(row => !cursor || compare(row, cursor) > 0).slice(0, 21), selected = page.slice(0, 20);
        const last = selected.at(-1);
        const nextCursor = page.length > 20 && last ? Buffer.from(JSON.stringify({ id: last.id, kind: last.kind, exact: last.exact, scope, query, ...(input.taskId ? { taskId: input.taskId } : {}) })).toString('base64url') : null;
        return { items: selected.map(({ search: _search, exact: _exact, ...row }) => row), nextCursor };
    }
}
