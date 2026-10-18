import { randomUUID } from 'node:crypto';
import { compressToolSchema, createCompactionRuntime } from './compaction.js';
/** Enumerable symbol survives route/signal object spreads but never enters provider JSON. */
export const NOA_PROJECTED_REQUEST = Symbol('dsh-redteam.noa.projected-request');
const redispatchedRequests = new WeakSet();
/** Observers check after iteration and record the inner projected call instead of this outer envelope. */
export function isNoaRedispatchedRequest(request) { return redispatchedRequests.has(request); }
function role(key) {
    if (key === 'planner' || key === 'goals')
        return 'planner';
    if (key === 'mainagent')
        return 'mainagent';
    if (key === 'chat')
        return 'chat';
    return 'worker';
}
/** Installs real stream projection and mutual exclusion with the public DSH compaction service. */
export function installCompactionHost(ctx, options) {
    const runtime = createCompactionRuntime(options);
    const runs = new Map();
    const runIdentities = new Map();
    const projected = new WeakSet();
    const requestOwners = new WeakMap();
    const removers = [];
    const owners = new Set();
    let disposed = false;
    let engine;
    let restoreEngine;
    const engineTag = Symbol('noa-compaction-owner');
    const engineOwner = {};
    const active = (sessionId) => runs.get(sessionId)?.run?.enabled === true;
    function manageBuiltIn() {
        const current = ctx.get('compaction');
        // Cordis returns caller-bound service proxies, so object equality is not service identity.
        if (current?.[engineTag] === engineOwner || (!current && !engine))
            return;
        if (engine && owners.size)
            throw new Error('DSH compaction service changed during a noa run; stop the run before replacing the service.');
        restoreEngine?.();
        restoreEngine = undefined;
        engine = current;
        if (!engine)
            return;
        const target = engine;
        const automatic = target.compactIfNeeded, manual = target.compactNow, region = target.compactRegion;
        const automaticWrapper = function (agent, trigger, signal) {
            return active(String(agent.session.id)) ? Promise.resolve(null) : automatic.call(this, agent, trigger, signal);
        };
        const manualWrapper = function (agent, signal, command) {
            if (active(String(agent.session.id)))
                return Promise.reject(new Error('Built-in manual compaction is disabled while noa owns this run.'));
            return manual.call(this, agent, signal, command);
        };
        const regionWrapper = function (start, end, agent, signal) {
            if (active(String(agent.session.id)))
                return Promise.reject(new Error('Built-in region compaction is disabled while noa owns this run.'));
            return region.call(this, start, end, agent, signal);
        };
        // These are the published service entry points, not backend-private policy internals.
        // An immutable/custom service refuses assignment rather than silently enabling two owners.
        const owns = (key, value) => Object.getOwnPropertyDescriptor(target, key)?.value === value;
        try {
            target.compactIfNeeded = automaticWrapper;
            target.compactNow = manualWrapper;
            target.compactRegion = regionWrapper;
            Object.defineProperty(target, engineTag, { value: engineOwner, configurable: true });
        }
        catch (error) {
            if (owns('compactIfNeeded', automaticWrapper))
                target.compactIfNeeded = automatic;
            if (owns('compactNow', manualWrapper))
                target.compactNow = manual;
            if (owns('compactRegion', regionWrapper))
                target.compactRegion = region;
            engine = undefined;
            throw new Error('Cannot disable built-in DSH compaction for noa.', { cause: error });
        }
        restoreEngine = () => {
            if (owns('compactIfNeeded', automaticWrapper))
                target.compactIfNeeded = automatic;
            if (owns('compactNow', manualWrapper))
                target.compactNow = manual;
            if (owns('compactRegion', regionWrapper))
                target.compactRegion = region;
            Reflect.deleteProperty(target, engineTag);
        };
    }
    function select(request) {
        if (disposed || request.purpose)
            return undefined;
        const marker = request[NOA_PROJECTED_REQUEST];
        const run = (marker ? runIdentities.get(marker.runId) : undefined) ?? requestOwners.get(request) ?? (request.sessionId ? runs.get(String(request.sessionId))?.run : undefined);
        if (run?.enabled)
            manageBuiltIn();
        return run;
    }
    function projectRequest(request) {
        if (projected.has(request) || request[NOA_PROJECTED_REQUEST])
            return request;
        const run = select(request);
        const result = run?.prepareRequest(request) ?? request;
        if (result !== request) {
            projected.add(result);
            requestOwners.set(result, run);
            Object.assign(result, { [NOA_PROJECTED_REQUEST]: { runId: run.options.sessionId, original: request } });
        }
        return result;
    }
    if ((options.projectionBoundary ?? 'llm-stream') === 'llm-stream') {
        removers.push(ctx.on('llm/stream', async function* (request, next) {
            if (projected.has(request) || request[NOA_PROJECTED_REQUEST]) {
                for await (const chunk of next()) {
                    if (chunk.type === 'usage')
                        select(request)?.noteInputTokens(chunk.usage.inputTokens + (chunk.usage.cacheReadTokens ?? 0) + (chunk.usage.cacheWriteTokens ?? 0));
                    yield chunk;
                }
                return;
            }
            const run = select(request);
            if (!run?.enabled) {
                yield* next();
                return;
            }
            const prepared = projectRequest(request);
            redispatchedRequests.add(request);
            let yielded = false;
            let failure, terminalError;
            try {
                for await (const chunk of ctx.llm.stream(prepared)) {
                    if (!yielded && chunk.type === 'finish' && chunk.reason.kind === 'error') {
                        terminalError = chunk;
                        failure = new Error(chunk.reason.failure.message);
                        break;
                    }
                    yielded = true;
                    yield chunk;
                }
            }
            catch (error) {
                failure = error;
            }
            if (failure) {
                request.signal?.throwIfAborted();
                // Never replay a partially published assistant response. One measured retry only.
                const retry = yielded ? undefined : run.recoverOverflow(request, failure);
                if (!retry) {
                    if (terminalError) {
                        yield terminalError;
                        return;
                    }
                    throw failure;
                }
                projected.add(retry);
                Object.assign(retry, { [NOA_PROJECTED_REQUEST]: { runId: run.options.sessionId, original: request } });
                yield* ctx.llm.stream(retry);
            }
        }));
    }
    const host = {
        projectRequest,
        getRun: (sessionId) => runs.get(sessionId)?.run,
        noteUsage(request, inputTokens) { select(request)?.noteInputTokens(inputTokens); },
        recoverOverflow(request, error) {
            const marker = request[NOA_PROJECTED_REQUEST];
            const run = select(request), original = marker?.original ?? request;
            const result = run?.recoverOverflow(original, error);
            if (result) {
                projected.add(result);
                Object.assign(result, { [NOA_PROJECTED_REQUEST]: { runId: run.options.sessionId, original } });
            }
            return result;
        },
        wrapPrepareRun(prepare) {
            return async (input) => {
                if (disposed)
                    throw new Error('Compaction host is disposed.');
                const enabled = options.enabled();
                if (!enabled)
                    return prepare(input);
                manageBuiltIn();
                const owner = { aliases: new Set(), disposed: false };
                const kind = role(input.agentKey);
                const runId = 'runId' in input && typeof input.runId === 'string' ? input.runId : randomUUID();
                if (runIdentities.has(runId))
                    throw new Error(`noa runId is already active: ${runId}`);
                const bind = (sessionId) => {
                    if (owner.disposed)
                        throw new Error('noa run is disposed.');
                    const previous = runs.get(sessionId);
                    if (previous && previous !== owner)
                        throw new Error(`Concurrent noa runs need distinct session ids: ${sessionId}`);
                    runs.set(sessionId, owner);
                    owner.aliases.add(sessionId);
                    return owner.run;
                };
                const release = () => {
                    owner.disposed = true;
                    owners.delete(owner);
                    runIdentities.delete(runId);
                    for (const alias of owner.aliases)
                        if (runs.get(alias) === owner)
                            runs.delete(alias);
                    owner.aliases.clear();
                };
                owners.add(owner);
                try {
                    const parentLedger = input.parent ? runs.get(String(input.parent.id))?.run?.options.sessionId : undefined;
                    owner.run = runtime.createRun({ sessionId: runId, kind, contextWindow: options.contextWindow?.(input), ...(parentLedger ? { parentSessionIds: [parentLedger] } : {}) }, enabled);
                    if (!owner.run.enabled) {
                        release();
                        return prepare(input);
                    }
                    runIdentities.set(runId, owner.run);
                    const definition = { ...compressToolSchema,
                        output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
                        execute: async (args, exec) => {
                            exec.signal.throwIfAborted();
                            if (owner.disposed)
                                throw new Error('noa run is disposed.');
                            const run = owner.run;
                            if (!run)
                                throw new Error('Compress requires an attached agent or an explicit planner sessionId.');
                            return run.compress(args, exec.callId);
                        },
                    };
                    const baseTools = input.baseTools ?? ctx.tools.schemas(input.parent).map(schema => ctx.tools.get(schema.name, input.parent));
                    if (baseTools.some(tool => tool.name === 'Compress'))
                        throw new Error('Compress is already registered by another context manager.');
                    const prepared = await prepare({ ...input, runId, baseTools: [...baseTools, definition] });
                    if (!prepared.tools.some(tool => tool.name === 'Compress')) {
                        await prepared.dispose();
                        throw new Error('Platform policy removed Compress; cannot enable noa without its real executable tool.');
                    }
                    const wrapped = { ...prepared, runId,
                        transformRequest(request) {
                            if (owner.disposed)
                                throw new Error('noa run is disposed.');
                            const transformed = prepared.transformRequest ? prepared.transformRequest(request) : request;
                            requestOwners.set(transformed, owner.run);
                            return projectRequest(transformed);
                        },
                        attach(agentCtx, agent, attachOptions) {
                            const detach = prepared.attach(agentCtx, agent, attachOptions);
                            try {
                                bind(String(agent.id));
                                manageBuiltIn();
                                // The platform installs definition and its policy guard from baseTools.
                                const removeCheck = agentCtx.on('agent/pre-step', async (payload, next) => { if (payload.agent === agent)
                                    manageBuiltIn(); return next(); });
                                return () => { removeCheck(); detach(); if (runs.get(String(agent.id)) === owner)
                                    runs.delete(String(agent.id)); owner.aliases.delete(String(agent.id)); };
                            }
                            catch (error) {
                                detach();
                                throw error;
                            }
                        },
                        async dispose() { release(); await prepared.dispose(); }, };
                    return wrapped;
                }
                catch (error) {
                    release();
                    throw error;
                }
            };
        },
        dispose() {
            if (disposed)
                return;
            disposed = true;
            for (const remove of removers.splice(0).reverse())
                remove();
            restoreEngine?.();
            restoreEngine = undefined;
            for (const owner of owners)
                owner.disposed = true;
            owners.clear();
            runs.clear();
            runIdentities.clear();
        },
    };
    return host;
}
