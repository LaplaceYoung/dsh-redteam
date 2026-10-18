export class HttpError extends Error {
    status;
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}
export function endpoint(path) {
    const base = new URL(document.baseURI);
    base.search = '';
    base.hash = '';
    if (!base.pathname.endsWith('/'))
        base.pathname += '/';
    return new URL(`api/redteam/interception/${path}`, base);
}
export async function request(path, options = {}) {
    const response = await fetch(endpoint(path), { method: options.method ?? 'GET', credentials: 'same-origin', cache: 'no-store', signal: options.signal,
        ...(options.method ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options.body ?? {}) } : {}) });
    const body = await response.json();
    if (!response.ok) {
        const message = typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string' ? body.error
            : response.status === 409 ? '这条审批已由其他操作处理，已重新读取最新状态。' : `请求失败（HTTP ${response.status}）`;
        throw new HttpError(message, response.status);
    }
    return body;
}
export function listPath(view, taskId, page) {
    const query = new URLSearchParams({ offset: String(page * 30), limit: '30' });
    if (taskId.trim())
        query.set('task_id', taskId.trim());
    return `${view}?${query}`;
}
