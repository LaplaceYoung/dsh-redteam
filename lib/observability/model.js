export function matches(row, filter) {
    for (const key of ['taskId', 'sessionId', 'agentId', 'runId', 'profileId', 'role', 'status'])
        if (filter[key] && row[key] !== filter[key])
            return false;
    if ('model' in row && (filter.model && row.model !== filter.model || filter.provider && row.provider !== filter.provider))
        return false;
    if ('tool' in row && (filter.tool && row.tool !== filter.tool || filter.q && !JSON.stringify([row.tool, row.input, row.result]).toLowerCase().includes(filter.q.toLowerCase())))
        return false;
    return (!filter.from || row.startedAt >= filter.from) && (!filter.until || row.startedAt < filter.until);
}
export function page(rows, filter) {
    const offset = filter.offset ?? 0, limit = filter.limit ?? 50;
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
        throw new Error('Invalid pagination');
    return { total: rows.length, items: rows.slice().reverse().slice(offset, offset + limit) };
}
