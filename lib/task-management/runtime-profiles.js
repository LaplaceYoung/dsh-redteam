import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { replaceTaskLLMProfiles } from './llm-chain.js';
const roles = ['mainagent', 'planner', 'worker', 'goals', 'reporter', 'retester'];
const writes = new Map();
const json = (value) => JSON.parse(JSON.stringify(value));
function object(value, name) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        throw new Error(`${name} must be an object`);
    return value;
}
function text(value, name) {
    if (typeof value !== 'string' || !value.trim())
        throw new Error(`${name} must be a nonempty string`);
    return value.trim();
}
function profileInput(value, persisted = false) {
    const input = object(value, 'profile');
    const allowed = ['id', 'name', 'provider', 'model', 'maxTokens', 'reasoningEffort', ...(persisted ? ['createdAt', 'updatedAt'] : [])];
    for (const key of Object.keys(input))
        if (!allowed.includes(key))
            throw new Error(`unsupported profile field: ${key}; credentials belong to DSH providers`);
    const result = { name: text(input.name, 'name'), provider: text(input.provider, 'provider'), model: text(input.model, 'model') };
    if (input.id !== undefined)
        result.id = text(input.id, 'id');
    if (input.maxTokens !== undefined) {
        if (typeof input.maxTokens !== 'number' || !Number.isSafeInteger(input.maxTokens) || input.maxTokens <= 0)
            throw new Error('maxTokens must be a positive integer');
        result.maxTokens = input.maxTokens;
    }
    if (input.reasoningEffort !== undefined)
        result.reasoningEffort = text(input.reasoningEffort, 'reasoningEffort');
    return result;
}
function readState(value) {
    const input = object(value, 'task model profiles');
    if (input.version !== 1 || !Array.isArray(input.profiles))
        throw new Error('unsupported task model profile file');
    const profiles = input.profiles.map(value => {
        const parsed = profileInput(value, true), source = object(value, 'profile');
        const createdAt = text(source.createdAt, 'createdAt'), updatedAt = text(source.updatedAt, 'updatedAt');
        if (!Number.isFinite(Date.parse(createdAt)) || !Number.isFinite(Date.parse(updatedAt)))
            throw new Error('invalid profile timestamp');
        return { ...parsed, id: text(parsed.id, 'id'), createdAt, updatedAt };
    });
    const ids = new Set(profiles.map(p => p.id));
    if (ids.size !== profiles.length)
        throw new Error('duplicate persisted profile id');
    const roleBindings = {};
    for (const [role, id] of Object.entries(object(input.roleBindings, 'roleBindings'))) {
        if (!roles.includes(role) || typeof id !== 'string' || !ids.has(id))
            throw new Error(`invalid persisted role binding: ${role}`);
        roleBindings[role] = id;
    }
    const reference = (value, name) => {
        if (value === null)
            return null;
        if (typeof value !== 'string' || !ids.has(value))
            throw new Error(`invalid ${name}`);
        return value;
    };
    const activeProfileId = reference(input.activeProfileId, 'activeProfileId');
    const pendingDeletion = reference(input.pendingDeletion, 'pendingDeletion');
    if (pendingDeletion !== null && pendingDeletion === activeProfileId)
        throw new Error('cannot recover deletion of active profile');
    return { version: 1, profiles, roleBindings, activeProfileId, pendingDeletion };
}
const empty = () => ({ version: 1, profiles: [], roleBindings: {}, activeProfileId: null, pendingDeletion: null });
/** ARTEX deletion preserves the cursor; only ready successors can replace a deleted active profile. */
function removeFromChain(chain, id) {
    const removed = chain.profiles.find(p => p.profileId === id);
    if (!removed)
        return chain;
    const profiles = chain.profiles.filter(p => p.profileId !== id);
    if (chain.activeProfileId !== id)
        return { ...chain, profiles, revision: chain.revision + 1 };
    const successor = profiles.filter(p => p.position > removed.position && p.status === 'ready').sort((a, b) => a.position - b.position)[0];
    const activeProfileId = successor?.profileId ?? null;
    return { profiles: successor ? profiles : [], activeProfileId, legacyProfileId: activeProfileId, revision: chain.revision + 1 };
}
/** Independent IDs/configuration; provider-owned credentials and transport settings are never copied. */
export class TaskProfileRegistry {
    store;
    llm;
    storagePath;
    lockKey;
    constructor(store, llm) {
        this.store = store;
        this.llm = llm;
        this.storagePath = resolve(join(dirname(store.storagePath), 'task-model-profiles.json'));
        this.lockKey = process.platform === 'win32' ? this.storagePath.toLowerCase() : this.storagePath;
    }
    async serial(operation) {
        const previous = writes.get(this.lockKey) ?? Promise.resolve();
        const result = previous.then(operation);
        const settled = result.then(() => { }, () => { });
        writes.set(this.lockKey, settled);
        try {
            return await result;
        }
        finally {
            if (writes.get(this.lockKey) === settled)
                writes.delete(this.lockKey);
        }
    }
    async save(state) {
        await mkdir(dirname(this.storagePath), { recursive: true });
        const temp = `${this.storagePath}.${randomUUID()}.tmp`;
        try {
            await writeFile(temp, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
            await rename(temp, this.storagePath);
        }
        finally {
            await unlink(temp).catch((error) => { if (error.code !== 'ENOENT')
                throw error; });
        }
    }
    async state() {
        await this.store.load();
        let state;
        try {
            state = readState(JSON.parse(await readFile(this.storagePath, 'utf8')));
        }
        catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
                return empty();
            throw error;
        }
        if (state.pendingDeletion !== null)
            await this.finishDeletion(state);
        return state;
    }
    async finishDeletion(state) {
        const id = state.pendingDeletion;
        if (id === null)
            throw new Error('missing profile deletion journal');
        await this.store.transaction(snapshot => {
            for (const task of snapshot.tasks) {
                if (!task.llmChain)
                    throw new Error(`task LLM chain not initialized: ${task.id}`);
                task.llmChain = removeFromChain(task.llmChain, id);
            }
        });
        state.profiles = state.profiles.filter(p => p.id !== id);
        for (const role of roles)
            if (state.roleBindings[role] === id)
                delete state.roleBindings[role];
        state.pendingDeletion = null;
        await this.save(state);
    }
    route(profile) {
        return { provider: profile.provider, model: profile.model,
            ...(profile.maxTokens === undefined ? {} : { maxTokens: profile.maxTokens }),
            ...(profile.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(profile.reasoningEffort) }),
        };
    }
    async availability(profile) {
        if (!this.llm.listProviders().some(p => p.id === profile.provider))
            return { available: false, reason: `provider is not registered: ${profile.provider}` };
        const model = await this.llm.resolveModelInfo(profile.provider, profile.model);
        if (profile.reasoningEffort !== undefined && !model.reasoning?.efforts.some(e => e.id === profile.reasoningEffort))
            return { available: false, reason: `unsupported reasoning effort: ${profile.reasoningEffort}` };
        return { available: true };
    }
    list() { return this.serial(() => this.state()); }
    async listAvailable() {
        const state = await this.list();
        return Promise.all(state.profiles.map(async (profile) => ({ ...profile, ...await this.availability(profile) })));
    }
    async availableProfileIds() { return new Set((await this.listAvailable()).filter(p => p.available).map(p => p.id)); }
    async providerCatalog() {
        const providers = this.llm.listProviders();
        const models = (await Promise.all(providers.map(p => this.llm.listModels(p.id)))).flat();
        return { providers, models };
    }
    upsert(input) {
        const normalized = profileInput(input);
        return this.serial(async () => {
            const state = await this.state();
            const check = await this.availability(normalized);
            if (!check.available)
                throw new Error(check.reason);
            const id = normalized.id ?? randomUUID(), now = new Date().toISOString();
            const old = state.profiles.find(p => p.id === id);
            const profile = { ...normalized, id, createdAt: old?.createdAt ?? now, updatedAt: now };
            if (old)
                state.profiles[state.profiles.indexOf(old)] = profile;
            else
                state.profiles.push(profile);
            await this.save(state);
            return profile;
        });
    }
    delete(profileId) {
        return this.serial(async () => {
            const state = await this.state();
            if (!state.profiles.some(p => p.id === profileId))
                throw new Error(`profile not found: ${profileId}`);
            if (state.activeProfileId === profileId)
                throw new Error('cannot delete active global profile; choose another profile or clear it first');
            state.pendingDeletion = profileId;
            await this.save(state);
            await this.finishDeletion(state);
            return { deleted: profileId };
        });
    }
    bind(role, profileId) {
        if (!roles.includes(role))
            throw new Error(`invalid task model role: ${role}`);
        return this.serial(async () => {
            const state = await this.state();
            if (profileId !== null && !state.profiles.some(p => p.id === profileId))
                throw new Error(`profile not found: ${profileId}`);
            if (profileId === null)
                delete state.roleBindings[role];
            else
                state.roleBindings[role] = profileId;
            await this.save(state);
            return state.roleBindings;
        });
    }
    setActive(profileId) {
        return this.serial(async () => {
            const state = await this.state();
            if (profileId !== null && !state.profiles.some(p => p.id === profileId))
                throw new Error(`profile not found: ${profileId}`);
            state.activeProfileId = profileId;
            await this.save(state);
            return state;
        });
    }
    setTaskChain(taskId, profileIds, activeProfileId = null) {
        return this.serial(async () => {
            const registry = await this.state();
            const ids = new Set(registry.profiles.map(p => p.id));
            return this.store.transaction(state => {
                const task = state.tasks.find(t => t.id === taskId);
                if (!task)
                    throw new Error(`task not found: ${taskId}`);
                if (!task.llmChain)
                    throw new Error(`task LLM chain not initialized: ${taskId}`);
                task.llmChain = replaceTaskLLMProfiles(task.llmChain, profileIds, ids, activeProfileId);
                task.updatedAt = new Date().toISOString();
                return task.llmChain;
            });
        });
    }
    createManagedTask(input) {
        return this.serial(async () => {
            const registry = await this.state();
            return this.store.createManagedTask(input, new Set(registry.profiles.map(profile => profile.id)));
        });
    }
    async resolveId(state, id) {
        const profile = state.profiles.find(p => p.id === id);
        if (!profile || !(await this.availability(profile)).available)
            return null;
        return this.route(profile);
    }
    resolveProfile(profileId) { return this.serial(async () => this.resolveId(await this.state(), profileId)); }
    resolveBinding(_taskId, role) { return this.serial(async () => { const state = await this.state(); return this.resolveId(state, state.roleBindings[role]); }); }
    resolveGlobal() { return this.serial(async () => { const state = await this.state(); return this.resolveId(state, state.activeProfileId); }); }
    resolveBindingSelection(_taskId, role) {
        return this.serial(async () => {
            const state = await this.state(), profileId = state.roleBindings[role];
            if (profileId === undefined)
                return null;
            const route = await this.resolveId(state, profileId);
            return route ? { profileId, route } : null;
        });
    }
    resolveGlobalSelection() {
        return this.serial(async () => {
            const state = await this.state(), profileId = state.activeProfileId;
            if (profileId === null)
                return null;
            const route = await this.resolveId(state, profileId);
            return route ? { profileId, route } : null;
        });
    }
}
/** Install after llm/tools injection. Calls perform awaited recovery before exposing persistent state. */
export function installTaskProfiles(ctx, store) {
    const registry = new TaskProfileRegistry(store, ctx.llm);
    const output = { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] };
    const disposers = [
        ctx.tools.register(defineTool({
            name: 'redteam_list_model_profiles', description: 'List persisted task model profiles, role bindings, active profile, and live DSH provider/model catalog. No credentials are returned.', parameters: {}, output,
            execute: async () => json({ ...await registry.list(), profiles: await registry.listAvailable(), catalog: await registry.providerCatalog() }),
        })),
        ctx.tools.register(defineTool({
            name: 'redteam_upsert_model_profile', description: 'Create or fully replace a named task model profile referencing a registered DSH provider/model. Omit id to generate an independent profile ID. Omitted optional controls reset to provider defaults.',
            parameters: { id: { type: 'string' }, name: { type: 'string', required: true }, provider: { type: 'string', required: true }, model: { type: 'string', required: true }, max_tokens: { type: 'number' }, reasoning_effort: { type: 'string' } }, output,
            execute: async (args) => json(await registry.upsert({ id: args.id, name: args.name, provider: args.provider, model: args.model, maxTokens: args.max_tokens, reasoningEffort: args.reasoning_effort })),
        })),
        ctx.tools.register(defineTool({
            name: 'redteam_delete_model_profile', description: 'Delete a non-active profile, clear its role bindings, and preserve or advance affected task cursors. Interrupted deletions recover on next access.', parameters: { profile_id: { type: 'string', required: true } }, output,
            execute: async (args) => json(await registry.delete(args.profile_id)),
        })),
        ctx.tools.register(defineTool({
            name: 'redteam_bind_role_model', description: 'Bind an ARTEX role to a persisted profile across tasks; omit profile_id to remove the binding and use each task chain/global fallback.',
            parameters: { role: { type: 'string', required: true, enum: roles }, profile_id: { type: 'string' } }, output,
            execute: async (args) => json(await registry.bind(args.role, args.profile_id ?? null)),
        })),
        ctx.tools.register(defineTool({
            name: 'redteam_set_active_model_profile', description: 'Select a global task model profile used after role bindings and empty task chains; omit profile_id to use the parent Agent route.', parameters: { profile_id: { type: 'string' } }, output,
            execute: async (args) => json(await registry.setActive(args.profile_id ?? null)),
        })),
        ctx.tools.register(defineTool({
            name: 'redteam_set_task_model_chain', description: 'Replace and reset a task ordered failover chain using persisted profile IDs. Empty IDs restore global/parent fallback. Omit active_profile_id to start at the first entry.',
            parameters: { task_id: { type: 'string', required: true }, profile_ids: { type: 'array', required: true, items: { type: 'string' } }, active_profile_id: { type: 'string' } }, output,
            execute: async (args) => json(await registry.setTaskChain(args.task_id, args.profile_ids, args.active_profile_id ?? null)),
        })),
    ];
    const dispose = () => { for (const dispose of disposers.splice(0).reverse())
        dispose(); };
    ctx.effect(() => dispose);
    return { resolver: registry, registry, disposers, dispose };
}
