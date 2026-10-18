import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { validateRecord } from './repository.js';
import { validateRule } from './model.js';
function decode(value, taskId) {
    if (!value || typeof value !== 'object' || !('format' in value) || value.format !== 'dsh-redteam-interception' || !('version' in value) || value.version !== 1 || !('taskId' in value) || value.taskId !== taskId || !('rules' in value) || !Array.isArray(value.rules) || !('records' in value) || !Array.isArray(value.records))
        throw new Error('Invalid task interception archive');
    const data = value;
    data.judgeCalls ??= [];
    if (!Array.isArray(data.judgeCalls) || data.judgeCalls.some(call => !call || call.taskId !== taskId || typeof call.id !== 'string' || typeof call.provider !== 'string' || typeof call.model !== 'string' || typeof call.startedAt !== 'string' || !['succeeded', 'failed', 'cancelled', 'unknown'].includes(call.status)))
        throw new Error('Invalid archived judge call');
    for (const rule of data.rules) {
        validateRule(rule);
        if (rule.taskId !== taskId || typeof rule.id !== 'string' || !Number.isSafeInteger(rule.order))
            throw new Error('Invalid archived rule ownership');
    }
    for (const row of data.records) {
        validateRecord(row);
        if (!row || row.taskId !== taskId || typeof row.id !== 'string' || typeof row.sessionId !== 'string' || typeof row.callId !== 'string' || !['allowed', 'denied', 'timeout'].includes(row.status) || !row.execution || !['succeeded', 'failed', 'not_executed', 'unknown'].includes(row.execution.status))
            throw new Error('Invalid archived approval');
    }
    if (new Set(data.rules.map(r => r.id)).size !== data.rules.length || new Set(data.records.map(r => r.id)).size !== data.records.length || new Set(data.judgeCalls.map(r => r.id)).size !== data.judgeCalls.length)
        throw new Error('Duplicate archived interception ID');
    return data;
}
/** Like native session logs, the live audit is retained; export is a complete independent backup. */
export class InterceptionArchive {
    repository;
    constructor(repository) {
        this.repository = repository;
    }
    async capture(directory, taskId, _snapshot) {
        const state = await this.repository.snapshot();
        const records = state.records.filter(row => row.taskId === taskId);
        const judgeCalls = state.judgeCalls.filter(call => call.taskId === taskId);
        if (records.some(row => row.status === 'pending' || row.execution.status === 'pending') || judgeCalls.some(call => call.status === 'running'))
            throw new Error('Task has live interception approvals or tool executions; quiesce before archiving');
        const data = { format: 'dsh-redteam-interception', version: 1, taskId, rules: state.rules.filter(rule => rule.taskId === taskId), records, judgeCalls };
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, 'interception.json'), JSON.stringify(data), { flag: 'wx', mode: 0o600 });
    }
    async restore(directory, taskId) {
        const data = decode(JSON.parse(await readFile(join(directory, 'interception.json'), 'utf8')), taskId);
        await this.repository.transaction(state => {
            // Preflight every conflict before adding any row; a failed restore changes nothing.
            for (const collection of ['rules', 'records', 'judgeCalls'])
                for (const row of data[collection]) {
                    const existing = state[collection].find(item => item.id === row.id);
                    if (existing && !isDeepStrictEqual(existing, row))
                        throw new Error(`Interception restore conflict: ${row.id}`);
                }
            for (const rule of data.rules)
                if (!state.rules.some(row => row.id === rule.id))
                    state.rules.push(rule);
            for (const row of data.records)
                if (!state.records.some(item => item.id === row.id))
                    state.records.push(row);
            for (const call of data.judgeCalls)
                if (!state.judgeCalls.some(item => item.id === call.id))
                    state.judgeCalls.push(call);
            state.nextOrder = Math.max(state.nextOrder, ...data.rules.map(rule => rule.order + 1));
        });
    }
    async preflight(directory, taskId) {
        const data = decode(JSON.parse(await readFile(join(directory, 'interception.json'), 'utf8')), taskId);
        const state = await this.repository.snapshot();
        for (const collection of ['rules', 'records', 'judgeCalls'])
            for (const row of data[collection]) {
                const existing = state[collection].find(item => item.id === row.id);
                if (existing && !isDeepStrictEqual(existing, row))
                    throw new Error(`Interception restore conflict: ${row.id}`);
            }
    }
}
/** Keep the existing session manifest marker and directory layout backward compatible. */
export function withInterceptionArchive(sessions, repository) {
    const audit = new InterceptionArchive(repository);
    return {
        ...(sessions.prepare ? { prepare: sessions.prepare.bind(sessions) } : {}),
        async capture(directory, taskId, snapshot, additionalSessionIds) { await sessions.capture(directory, taskId, snapshot, additionalSessionIds); await audit.capture(directory, taskId, snapshot); },
        async restore(directory, taskId) {
            let exists = true;
            try {
                await readFile(join(directory, 'interception.json'));
            }
            catch (error) {
                if (error.code === 'ENOENT')
                    exists = false;
                else
                    throw error;
            }
            if (exists)
                await audit.preflight(directory, taskId);
            await sessions.restore(directory, taskId);
            if (exists)
                await audit.restore(directory, taskId);
        },
    };
}
