import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import { WorkspaceFiles } from './files.js';
export class ConversationError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
        this.name = 'ConversationError';
    }
}
function bounded(value, field, max) {
    if (typeof value !== 'string' || !value.trim() || [...value.trim()].length > max)
        throw new ConversationError(400, `${field} must contain 1-${max} characters`);
    return value.trim();
}
function isMissing(error) { return error instanceof Error && 'code' in error && error.code === 'ENOENT'; }
function profileId(value) {
    if (value === undefined || value === null)
        return null;
    return bounded(value, 'profileId', 200);
}
function validateState(value) {
    if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 || !('conversations' in value) || !Array.isArray(value.conversations))
        throw new Error('Invalid conversation metadata');
    const ids = new Set(), sessions = new Set();
    for (const row of value.conversations) {
        if (!row || typeof row !== 'object')
            throw new Error('Invalid conversation record');
        for (const field of ['id', 'sessionId', 'agentKey', 'title', 'cwd', 'createdAt', 'updatedAt'])
            if (typeof row[field] !== 'string' || !row[field])
                throw new Error(`Invalid conversation ${field}`);
        if (ids.has(row.id) || sessions.has(row.sessionId) || !isAbsolute(row.cwd))
            throw new Error('Invalid duplicate conversation or working directory');
        ids.add(row.id);
        sessions.add(row.sessionId);
        for (const field of ['createdAt', 'updatedAt', 'pinnedAt', 'deletedAt'])
            if (row[field] !== null && (typeof row[field] !== 'string' || !Number.isFinite(Date.parse(row[field]))))
                throw new Error(`Invalid conversation ${field}`);
        if (row.profileId !== null && (typeof row.profileId !== 'string' || !row.profileId))
            throw new Error('Invalid conversation profile');
        if (row.taskId !== undefined && (typeof row.taskId !== 'string' || !row.taskId || !Number.isSafeInteger(row.segment) || row.segment < 0))
            throw new Error('Invalid task conversation segment');
    }
    return value;
}
/** Owns real DSH handles; the metadata file contains references, never a second transcript. */
export class ConversationRuntime {
    ctx;
    options;
    state = { version: 1, conversations: [] };
    ready;
    tail = Promise.resolve();
    owned = new Map();
    runs = new Map();
    deletingTasks = new Set();
    sideDeletes = new Map();
    closed = false;
    constructor(ctx, options) {
        this.ctx = ctx;
        this.options = options;
    }
    initialize() {
        return this.ready ??= (async () => {
            try {
                this.state = validateState(JSON.parse(await readFile(this.options.storagePath, 'utf8')));
            }
            catch (error) {
                if (!isMissing(error))
                    throw error;
            }
        })();
    }
    serial(fn) {
        const result = this.tail.then(async () => { await this.initialize(); if (this.closed)
            throw new Error('Conversation runtime is disposed'); return fn(); });
        this.tail = result.catch(() => { });
        return result;
    }
    now() { return (this.options.now?.() ?? new Date()).toISOString(); }
    async save(next) {
        await mkdir(dirname(this.options.storagePath), { recursive: true });
        const temporary = `${this.options.storagePath}.${randomUUID()}.tmp`;
        try {
            await writeFile(temporary, JSON.stringify(next, null, 2), 'utf8');
            await rename(temporary, this.options.storagePath);
        }
        catch (error) {
            try {
                await unlink(temporary);
            }
            catch (cleanup) {
                if (!isMissing(cleanup))
                    throw new AggregateError([error, cleanup], 'Conversation metadata write and temporary cleanup failed');
            }
            throw error;
        }
        this.state = next;
    }
    record(id) {
        const record = this.state.conversations.find(row => row.id === id && !row.deletedAt);
        if (!record)
            throw new ConversationError(404, `Conversation not found: ${id}`);
        return record;
    }
    async assertTaskOpen(row) {
        if (row.taskId && this.deletingTasks.has(row.taskId))
            throw new ConversationError(409, 'Task is being deleted');
        if (row.taskId && this.options.taskExists && !await this.options.taskExists(row.taskId))
            throw new ConversationError(404, 'Task not found');
    }
    busy(row) {
        return this.state.conversations.some(other => (other.id === row.id || (row.taskId && other.taskId === row.taskId)) && (this.runs.has(other.id) || this.owned.get(other.id)?.handle.agent.status === 'running'));
    }
    async list(filter = {}) {
        await this.initialize();
        const query = filter.query?.toLocaleLowerCase();
        const rows = this.state.conversations.filter(row => !row.deletedAt && (filter.taskId === undefined || row.taskId === filter.taskId));
        const matched = [];
        for (const row of rows) {
            if (row.taskId && this.options.taskExists && !await this.options.taskExists(row.taskId))
                continue;
            let match = !query || `${row.title}\n${row.agentKey}`.toLocaleLowerCase().includes(query);
            if (!match && query) {
                const log = await this.ctx.sessionQuery.readSession(SessionId(row.sessionId));
                match = log.events.some(event => JSON.stringify(event).toLocaleLowerCase().includes(query));
            }
            if (match)
                matched.push({ ...structuredClone(row), pinned: row.pinnedAt !== null, running: this.busy(row) });
        }
        return matched.sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.pinnedAt ?? '').localeCompare(a.pinnedAt ?? '') || b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
    }
    async get(id) { await this.initialize(); const row = this.record(id); return { ...structuredClone(row), pinned: row.pinnedAt !== null, running: this.busy(row) }; }
    async segments(taskId) {
        const sessions = (await this.list({ taskId })).sort((a, b) => b.segment - a.segment);
        return { sessions, current: sessions[0]?.segment ?? 0 };
    }
    create(input, parent) {
        return this.serial(() => this.createRecord(input, parent));
    }
    ensureMainSession(taskId, parent) {
        return this.serial(async () => {
            await this.assertTaskOpen({ taskId });
            const existing = this.state.conversations.find(row => row.taskId === taskId && row.segment === 0 && !row.deletedAt);
            return existing ? structuredClone(existing) : this.createRecord({ agentKey: 'mainagent', taskId }, parent, 0);
        });
    }
    async createRecord(input, parent, segment) {
        const agentKey = bounded(input.agentKey, 'agentKey', 120);
        await this.assertTaskOpen(input);
        if (!await this.options.resolveAgent(agentKey))
            throw new ConversationError(404, `Agent not found: ${agentKey}`);
        const pin = profileId(input.profileId);
        if (pin && !await this.options.profiles.resolveProfile(pin))
            throw new ConversationError(409, 'Conversation profile is unavailable');
        const id = randomUUID(), now = this.now();
        const workspace = new WorkspaceFiles(this.options.workspaceRoot);
        await workspace.initialize();
        if (input.taskId && !/^[A-Za-z0-9_-]+$/.test(input.taskId))
            throw new ConversationError(400, 'Invalid task workspace identifier');
        const cwd = await workspace.resolvePath(input.cwd ?? (input.taskId ? `tasks/${input.taskId}` : `sessions/${id}`), false);
        const record = { id, sessionId: randomUUID(), agentKey, title: bounded(input.title?.trim() || '新对话', 'title', 200), profileId: pin, cwd, pinnedAt: null, createdAt: now, updatedAt: now, deletedAt: null };
        if (input.taskId) {
            record.taskId = input.taskId;
            record.segment = segment ?? Math.max(-1, ...this.state.conversations.filter(row => row.taskId === input.taskId).map(row => row.segment)) + 1;
        }
        await mkdir(cwd, { recursive: true });
        const owned = await this.open(record, false, parent);
        try {
            await this.ctx.sessionPersistence.flush();
            await this.save({ version: 1, conversations: [...this.state.conversations, record] });
        }
        catch (error) {
            await this.release(owned);
            throw error;
        }
        this.owned.set(id, owned);
        return structuredClone(record);
    }
    update(id, patch) {
        return this.serial(async () => {
            const row = this.record(id);
            await this.assertTaskOpen(row);
            if (!Object.keys(patch).length)
                throw new ConversationError(400, 'An update field is required');
            const pin = profileId(patch.profileId);
            if (pin && !await this.options.profiles.resolveProfile(pin))
                throw new ConversationError(409, 'Conversation profile is unavailable');
            const next = structuredClone(this.state), updated = next.conversations.find(item => item.id === id);
            if (patch.title !== undefined)
                updated.title = bounded(patch.title, 'title', 200);
            if (patch.pinned !== undefined) {
                if (typeof patch.pinned !== 'boolean')
                    throw new ConversationError(400, 'pinned must be boolean');
                updated.pinnedAt = patch.pinned ? row.pinnedAt ?? this.now() : null;
            }
            if (patch.profileId !== undefined)
                updated.profileId = pin;
            await this.save(next);
            return structuredClone(updated);
        });
    }
    async preparation(row, parent, signal, allowUnconfigured = false) {
        const prepared = await this.options.prepareRun({ agentKey: row.agentKey, taskId: row.taskId, sessionId: row.sessionId, workingDirectory: row.cwd, parent, signal });
        try {
            const pinned = row.profileId ? await this.options.profiles.resolveProfile(row.profileId) : null;
            // ARTEX: the Agent's binding precedes the conversation pin and global profile.
            const bound = await this.options.resolveAgentProfile?.(row.agentKey);
            const route = bound ?? pinned ?? await this.options.profiles.resolveGlobal?.() ?? (prepared.provider && prepared.model ? { provider: prepared.provider, model: prepared.model } : null);
            if ((!route && !allowUnconfigured) || (row.profileId && !pinned && !bound))
                throw new ConversationError(409, 'No available conversation model profile');
            return { prepared, route };
        }
        catch (error) {
            await prepared.dispose();
            throw error;
        }
    }
    async open(row, resume, parent) {
        if (this.ctx.agents.get(SessionId(row.sessionId)))
            throw new ConversationError(409, 'Conversation session is owned by another runtime');
        const workspace = new WorkspaceFiles(this.options.workspaceRoot);
        await workspace.initialize();
        await workspace.resolvePath(relative(resolve(this.options.workspaceRoot), row.cwd), false);
        const { prepared, route } = await this.preparation(row, parent, undefined, !resume);
        let detach = () => { }, selectedRoute = route;
        try {
            const setup = async (scope, agent) => {
                await this.options.setupAgent?.(scope, agent, parent);
                // Task-main routing belongs to TaskLifecycle, including its chain and role bindings.
                if (!row.taskId)
                    scope.on('agent/request', async (payload, next) => {
                        const config = await next();
                        if (payload.agent !== agent || !selectedRoute)
                            return config;
                        const { provider: _provider, model: _model, maxTokens: _tokens, reasoningEffort: _effort, ...rest } = config;
                        return { ...rest, ...selectedRoute };
                    });
                detach = prepared.attach(scope, agent);
            };
            const handle = resume
                ? await this.ctx.agents.resume({ resumeSessionId: SessionId(row.sessionId), agentOptions: route ?? {}, setup })
                : await this.ctx.agents.create({ sessionId: SessionId(row.sessionId), meta: { cwd: row.cwd }, agentOptions: route ?? {}, setup });
            const owned = { handle, prepared, detach, setRoute: (value) => { selectedRoute = value; } };
            try {
                if (row.taskId) {
                    const unbind = await this.options.bindTask?.(row.taskId, handle.agent);
                    if (unbind)
                        handle.agent.ctx.effect(() => unbind);
                }
            }
            catch (error) {
                await handle.dispose();
                throw error;
            }
            return owned;
        }
        catch (error) {
            detach();
            await prepared.dispose();
            throw error;
        }
    }
    recover(id, parent) {
        return this.serial(async () => { const row = this.record(id); await this.assertTaskOpen(row); let owned = this.owned.get(id); if (!owned) {
            owned = await this.open(row, true, parent);
            this.owned.set(id, owned);
        } return owned.handle.agent; });
    }
    send(id, message, options = {}) {
        return this.serial(async () => {
            options.signal?.throwIfAborted();
            const row = this.record(id);
            await this.assertTaskOpen(row);
            if (typeof message !== 'string')
                throw new ConversationError(400, 'message must be a string');
            const attachments = options.attachments ?? [];
            if (!message.trim() && !attachments.length)
                throw new ConversationError(400, 'Message is empty');
            if (attachments.length && !this.options.prepareMessage)
                throw new Error('Attachment workspace resolver is not configured');
            if (this.busy(row))
                throw new ConversationError(409, 'Conversation is already running');
            const content = await this.options.prepareMessage?.(message, attachments, structuredClone(row)) ?? message;
            let owned = this.owned.get(id);
            const needsPreparation = owned !== undefined;
            if (!owned) {
                owned = await this.open(row, true, options.parent);
                this.owned.set(id, owned);
            }
            if (owned.handle.agent.status === 'running')
                throw new ConversationError(409, 'Recovered conversation is processing pending input');
            options.signal?.throwIfAborted();
            const agent = owned.handle.agent;
            const abort = () => agent.cancel({ kind: 'user' });
            options.signal?.addEventListener('abort', abort, { once: true });
            const input = createUserMessage({ content: [{ type: 'text', text: content }], source: { kind: 'artex-conversation-user', text: message, attachments: structuredClone(attachments) } });
            const entry = owned;
            try {
                await this.ctx.agents.withInitiator(agent, () => agent.runMaintenance(async (signal) => {
                    const cancellation = options.signal ? AbortSignal.any([signal, options.signal]) : signal;
                    if (needsPreparation) {
                        const { prepared, route } = await this.preparation(row, options.parent, cancellation);
                        try {
                            cancellation.throwIfAborted();
                            entry.detach();
                            await entry.prepared.dispose();
                            entry.detach = prepared.attach(agent.ctx, agent);
                        }
                        catch (error) {
                            await prepared.dispose();
                            throw error;
                        }
                        entry.prepared = prepared;
                        entry.setRoute(route);
                    }
                    cancellation.throwIfAborted();
                    const next = structuredClone(this.state), updated = next.conversations.find(item => item.id === id);
                    updated.updatedAt = this.now();
                    if (updated.title === '新对话')
                        updated.title = [...message.trim().split(/\r?\n/)[0]].slice(0, 40).join('') || '附件消息';
                    await this.save(next);
                    cancellation.throwIfAborted();
                    agent.followup(input);
                }));
            }
            catch (error) {
                options.signal?.removeEventListener('abort', abort);
                throw error;
            }
            const run = agent.whenIdle().then(() => this.ctx.sessionPersistence.flush()).finally(() => { options.signal?.removeEventListener('abort', abort); this.runs.delete(id); });
            this.runs.set(id, run);
            void run.catch(error => this.options.onError?.(error));
            return { status: 'accepted', id, sessionId: row.sessionId, messageId: input.id };
        });
    }
    async wait(id) { await this.tail; await this.runs.get(id); const owned = this.owned.get(id); if (owned)
        await owned.handle.agent.whenIdle(); }
    async cancel(id) {
        // Cancel maintenance/model work immediately; do not queue behind its pending preparation.
        this.owned.get(id)?.handle.agent.cancel({ kind: 'user' });
        const run = await this.serial(async () => { this.record(id); this.owned.get(id)?.handle.agent.cancel({ kind: 'user' }); return { pending: this.runs.get(id), agent: this.owned.get(id)?.handle.agent }; });
        await run.pending;
        await run.agent?.whenIdle();
    }
    async messages(id, since = 0, limit = 200) {
        await this.initialize();
        const row = this.record(id);
        if (!Number.isSafeInteger(since) || since < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
            throw new ConversationError(400, 'Invalid conversation event pagination');
        const log = await this.ctx.sessionQuery.readSession(SessionId(row.sessionId));
        const events = log.events.filter(event => event.seq >= since).slice(0, limit);
        const cursor = events.length ? Number(events[events.length - 1].seq) + 1 : since;
        return { events, cursor, hasMore: log.events.some(event => event.seq >= cursor), running: this.busy(row) };
    }
    async release(owned) { await owned.handle.dispose(); owned.detach(); await owned.prepared.dispose(); }
    async remove(ids) {
        try {
            for (const id of ids) {
                if (this.options.prepareSideQuestionDelete && !this.sideDeletes.has(id))
                    this.sideDeletes.set(id, await this.options.prepareSideQuestionDelete(id));
                const owned = this.owned.get(id);
                if (owned) {
                    await this.release(owned);
                    this.owned.delete(id);
                }
                await this.runs.get(id);
            }
            const next = structuredClone(this.state);
            for (const row of next.conversations)
                if (ids.includes(row.id))
                    row.deletedAt ??= this.now();
            // DSH exposes no destructive persistence API. Tombstones hide these sessions here; native history remains auditable.
            await this.save(next);
        }
        catch (error) {
            for (const id of ids) {
                await this.sideDeletes.get(id)?.rollback();
                this.sideDeletes.delete(id);
            }
            throw error;
        }
        // A failed post-commit cleanup stays cached and can be retried through delete(id).
        for (const id of ids) {
            const side = this.sideDeletes.get(id);
            if (side) {
                await side.commit();
                this.sideDeletes.delete(id);
            }
            else
                await this.options.drainSideQuestions?.(id);
        }
    }
    delete(id) {
        return this.serial(async () => {
            const row = this.state.conversations.find(item => item.id === id);
            if (!row)
                throw new ConversationError(404, 'Conversation not found');
            // Post-commit cleanup retries must remain available after the parent task disappears.
            if (!row.deletedAt)
                await this.assertTaskOpen(row);
            await this.remove([id]);
        });
    }
    async deleteMany(ids) {
        if (!Array.isArray(ids) || !ids.length || ids.length > 100)
            throw new ConversationError(400, 'Select 1-100 conversations');
        const result = [];
        for (const id of new Set(ids)) {
            try {
                await this.delete(id);
                result.push({ id, ok: true });
            }
            catch (error) {
                result.push({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
            }
        }
        return result;
    }
    async prepareTaskDelete(taskId) {
        const ids = await this.serial(async () => {
            if (this.deletingTasks.has(taskId))
                throw new ConversationError(409, 'Task deletion already prepared');
            this.deletingTasks.add(taskId);
            const ids = this.state.conversations.filter(row => row.taskId === taskId && !row.deletedAt).map(row => row.id);
            try {
                for (const id of ids) {
                    const owned = this.owned.get(id);
                    owned?.handle.agent.cancel({ kind: 'parent' });
                    await this.runs.get(id);
                    await owned?.handle.agent.whenIdle();
                }
            }
            catch (error) {
                this.deletingTasks.delete(taskId);
                throw error;
            }
            return ids;
        });
        let committed = false;
        return {
            commit: () => this.serial(async () => { if (committed)
                return; await this.remove(ids); committed = true; this.deletingTasks.delete(taskId); }),
            rollback: () => this.serial(async () => { if (!committed)
                this.deletingTasks.delete(taskId); }),
        };
    }
    async drainTask(taskId) { const deletion = await this.prepareTaskDelete(taskId); await deletion.commit(); }
    quiesceTask(taskId) {
        return this.serial(async () => {
            for (const row of this.state.conversations.filter(row => row.taskId === taskId)) {
                const owned = this.owned.get(row.id), agent = owned?.handle.agent;
                agent?.cancel({ kind: 'parent' });
                await this.runs.get(row.id);
                await agent?.whenIdle();
                // Archive retains native history but cannot leave a live direct-send bypass behind.
                if (owned) {
                    await this.release(owned);
                    this.owned.delete(row.id);
                }
            }
            await this.ctx.sessionPersistence.flush();
        });
    }
    exportTaskArchive(taskId) {
        return this.serial(async () => ({ version: 1, conversations: structuredClone(this.state.conversations.filter(row => row.taskId === taskId)) }));
    }
    async archiveRows(taskId, data) {
        const incoming = validateState(data).conversations;
        const workspace = new WorkspaceFiles(this.options.workspaceRoot);
        await workspace.initialize();
        const combined = [...this.state.conversations];
        for (const row of incoming) {
            if (row.taskId !== taskId)
                throw new ConversationError(400, 'Conversation archive contains a different task');
            await workspace.resolvePath(relative(resolve(this.options.workspaceRoot), row.cwd), false);
            const sameId = this.state.conversations.find(current => current.id === row.id);
            if (sameId && !isDeepStrictEqual(sameId, row))
                throw new ConversationError(409, `Conversation archive conflicts with existing metadata: ${row.id}`);
            const sameSession = this.state.conversations.find(current => current.sessionId === row.sessionId);
            if (sameSession && sameSession.id !== row.id)
                throw new ConversationError(409, 'Conversation archive session is already mapped');
            if (!sameId)
                combined.push(row);
        }
        const segments = new Set();
        for (const row of combined.filter(row => row.taskId === taskId && !row.deletedAt)) {
            if (segments.has(row.segment))
                throw new ConversationError(409, 'Conversation archive duplicates an active main segment');
            segments.add(row.segment);
        }
        return structuredClone(incoming);
    }
    preflightTaskArchive(taskId, data) { return this.serial(async () => { await this.archiveRows(taskId, data); }); }
    restoreTaskArchive(taskId, data) {
        return this.serial(async () => {
            const rows = await this.archiveRows(taskId, data);
            const ids = new Set(this.state.conversations.map(row => row.id));
            const additions = rows.filter(row => !ids.has(row.id));
            if (additions.length)
                await this.save({ version: 1, conversations: [...this.state.conversations, ...additions] });
        });
    }
    async dispose() {
        await this.tail;
        if (this.closed)
            return;
        this.closed = true;
        const errors = [];
        for (const owned of this.owned.values()) {
            try {
                await this.release(owned);
            }
            catch (error) {
                errors.push(error);
            }
        }
        this.owned.clear();
        await Promise.allSettled(this.runs.values());
        if (errors.length)
            throw new AggregateError(errors, 'Conversation shutdown failed');
    }
}
