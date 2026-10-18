export function managementEndpoint(path) {
    const base = new URL(document.baseURI);
    base.search = '';
    base.hash = '';
    if (!base.pathname.endsWith('/'))
        base.pathname += '/';
    return new URL(`api/redteam/asset-management/${path.replace(/^\/+/, '')}`, base);
}
export async function request(path, options = {}) {
    const response = await fetch(managementEndpoint(path), { method: options.method ?? 'GET', credentials: 'same-origin', cache: 'no-store', signal: options.signal,
        ...(options.body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options.body) }) });
    const body = await response.json();
    if (!response.ok) {
        const message = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : `请求失败（HTTP ${response.status}）`;
        throw new Error(message);
    }
    // The authenticated same-version server owns these DTOs; error status is checked above.
    return body;
}
