import { defineTool } from '@deepseek-ai/dsh-tools';
import { dirname, join } from 'node:path';
import { SystemSettingsStore, selectPromptConstraints } from './settings.js';
import { WebSearchClient } from './web-search.js';
import { ModelHealthRuntime } from './model-health.js';
import { createDeepSeekCredentialResolver } from './host-profile-adapter.js';
import { installCompactionHost } from './compaction-host.js';
export * from './settings.js';
export * from './web-search.js';
export * from './model-health.js';
export * from './host-profile-adapter.js';
export * from './model-attribution.js';
export * from './compaction.js';
export * from './compaction-host.js';
const searchNames = new Set(['web_search', 'WebSearch', 'search_web']);
const output = { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] };
const json = (value) => JSON.parse(JSON.stringify(value));
export class SystemRuntime {
    ctx;
    store;
    options;
    settings;
    models;
    compaction;
    lifetime = new AbortController();
    pending = new Set();
    cleanup = [];
    constructor(ctx, store, options) {
        this.ctx = ctx;
        this.store = store;
        this.options = options;
        this.settings = new SystemSettingsStore(join(options.root ?? dirname(store.storagePath), 'system-settings.json'));
    }
    constraints(taskId, role) {
        return selectPromptConstraints(this.settings.snapshot(), this.store.snapshot().constraints, taskId, role);
    }
    searchAvailable() {
        const config = this.settings.searchConfig();
        return config.enabled && !(config.backend === 'brave-free' && !config.braveAPIKey.trim()) && !(config.backend === 'tavily' && !config.tavilyAPIKey.trim());
    }
    async searchConfiguration(input) {
        const stored = this.settings.searchConfig();
        const config = input ? {
            backend: input.web_search_backend?.trim() || stored.backend,
            // The probe tests exactly the form's proxy, including empty/omitted = direct.
            proxy: input.web_search_proxy?.trim() ?? '',
            braveAPIKey: input.brave_search_api_key?.trim() || stored.braveAPIKey,
            tavilyAPIKey: input.tavily_search_api_key?.trim() || stored.tavilyAPIKey,
        } : stored;
        if (config.backend === 'deepseek') {
            const resolve = this.options.resolveDeepSeekCredentials ?? createDeepSeekCredentialResolver(this.ctx, this.options.profiles);
            Object.assign(config, await resolve());
        }
        return config;
    }
    runSearch(config, operation, signal) {
        this.lifetime.signal.throwIfAborted();
        const cancellation = signal ? AbortSignal.any([signal, this.lifetime.signal]) : this.lifetime.signal;
        const pending = (async () => {
            cancellation.throwIfAborted();
            const client = new WebSearchClient(config, this.options.search);
            try {
                return await operation(client, cancellation);
            }
            finally {
                await client.close();
            }
        })();
        this.pending.add(pending);
        void pending.finally(() => this.pending.delete(pending)).catch(() => { });
        return pending;
    }
    async search(query, limit = 5, signal) {
        if (!this.searchAvailable())
            throw new Error('Web search is disabled or its required API key is not configured');
        return this.runSearch(await this.searchConfiguration(), (client, cancellation) => client.search(query, limit, cancellation), signal);
    }
    async testSearch(input = {}, signal) {
        let config;
        const backend = input.web_search_backend?.trim() || this.settings.snapshot().web_search_backend;
        try {
            config = await this.searchConfiguration(input);
            const rows = await this.runSearch(config, (client, cancellation) => client.probe(backend === 'deepseek' ? 'DeepSeek company official website' : 'test', 3, cancellation), signal);
            return rows.length ? { ok: true, backend, count: rows.length } : { ok: false, backend, error: 'Search returned zero results; verify the backend, proxy and rate limits' };
        }
        catch (error) {
            signal?.throwIfAborted();
            this.lifetime.signal.throwIfAborted();
            let message = error instanceof Error ? error.message : String(error);
            for (const key of [config?.braveAPIKey, config?.tavilyAPIKey, config?.deepSeekAPIKey])
                if (key)
                    message = message.split(key).join('[redacted]');
            return { ok: false, backend, error: message };
        }
    }
    /** Source-compatible search surface snapshots at run construction; constraint reads remain per step. */
    wrapPrepareRun(prepare) {
        const configured = this.compaction?.wrapPrepareRun(prepare) ?? prepare;
        return async (input) => {
            const tools = input.baseTools ?? this.ctx.tools.schemas(input.parent).map(schema => this.ctx.tools.get(schema.name, input.parent));
            return configured({ ...input, baseTools: tools.filter(tool => !searchNames.has(tool.name) || this.searchAvailable()) });
        };
    }
    async initialize() {
        await this.settings.load();
        this.models = await ModelHealthRuntime.open({ storagePath: join(this.options.root ?? dirname(this.store.storagePath), 'model-health.json'), profiles: this.options.profiles, stream: request => this.ctx.llm.stream(request) });
    }
    async install() {
        await this.initialize();
        this.compaction = installCompactionHost(this.ctx, { enabled: () => this.settings.snapshot().noa_compaction, archiveRoot: join(this.options.root ?? dirname(this.store.storagePath), 'noa'), onWarn: message => this.ctx.logger?.warn?.(message), ...this.options.compaction });
        const definitions = [
            defineTool({ name: 'redteam_get_system_settings', description: 'Read ARTEX search, model pool, constraint injection and context compression settings. Keys are represented only by presence flags.', parameters: {}, output, execute: async () => json(this.settings.snapshot()) }),
            defineTool({ name: 'redteam_update_system_settings', description: 'Persist a partial settings change. Omitted/null fields preserve stored values; empty API keys or search proxy clear them. Search proxy is independent of global target traffic proxy.', parameters: { patch: { type: 'json', required: true } }, output, execute: async (args) => json(await this.settings.update(args.patch)) }),
            defineTool({ name: 'redteam_test_web_search', description: 'Perform a real search against an unsaved form configuration. Empty keys use saved keys, empty/omitted proxy means direct. DeepSeek consumes one model call.', parameters: { web_search_backend: { type: 'string' }, web_search_proxy: { type: 'string' }, brave_search_api_key: { type: 'string' }, tavily_search_api_key: { type: 'string' } }, output, execute: async (args, exec) => json(await this.testSearch(args, exec.signal)) }),
            defineTool({ name: 'web_search', description: 'Search the configured web backend for ranked title, URL and description metadata. Makes a real external network request; limit 1–20, default 5.', parameters: { query: { type: 'string', required: true }, limit: { type: 'number' } }, output, execute: async (args, exec) => json(await this.search(args.query, args.limit, exec.signal)) }),
            defineTool({ name: 'redteam_model_pool_status', description: 'Read the ordered model pool, per-profile policies, shared circuit-breaker health and five retry layers.', parameters: {}, output, execute: async () => json({ ...await this.models.status(), enabled: this.settings.snapshot().llm_pool_enabled, bind_fallback: this.settings.snapshot().llm_pool_bind_fallback }) }),
            defineTool({ name: 'redteam_reset_model_health', description: 'Immediately clear a profile circuit breaker; omit profile_id to clear all profiles.', parameters: { profile_id: { type: 'string' } }, output, execute: async (args) => { await this.models.reset(args.profile_id); return json(await this.models.status()); } }),
            defineTool({ name: 'redteam_set_model_pool_policy', description: 'Replace one profile pool policy: priority, excluded, ratePerSecond, ratePerMinute, windowTokens, and retry connect/empty/stream rules. Each retry rule has attempts and interval_ms; zero inherits, minus one disables.', parameters: { profile_id: { type: 'string', required: true }, policy: { type: 'json', required: true } }, output, execute: async (args) => json(await this.models.setProfilePolicy(args.profile_id, args.policy)) }),
            defineTool({ name: 'redteam_set_model_retry_policy', description: 'Replace the five-layer global retry policy: connect, empty, stream, breaker and intent, each with attempts and interval_ms. Zero selects ARTEX defaults; minus one disables.', parameters: { policy: { type: 'json', required: true } }, output, execute: async (args) => json(await this.models.setRetryPolicy(args.policy)) }),
            defineTool({ name: 'redteam_test_model_profile', description: 'Make a real short completion through the selected registered DSH provider/model, capped at 30 seconds. This can consume provider quota.', parameters: { profile_id: { type: 'string', required: true } }, output, execute: async (args, exec) => json(await this.models.probe(args.profile_id, exec.signal)) }),
        ];
        for (const tool of definitions)
            this.cleanup.push(this.ctx.tools.register(tool));
        this.cleanup.push(this.ctx.tools.guard(exec => searchNames.has(exec.name) && !this.searchAvailable() ? 'Web search is disabled or unconfigured' : undefined));
        this.cleanup.push(this.ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
            const assembly = await next();
            return this.searchAvailable() ? assembly : { ...assembly, tools: assembly.tools.filter(tool => !searchNames.has(tool.name)) };
        }));
    }
    async dispose() {
        this.lifetime.abort();
        for (const remove of this.cleanup.splice(0).reverse())
            remove();
        this.compaction?.dispose();
        await Promise.allSettled([...this.pending]);
    }
}
export async function installSystemRuntime(ctx, store, options) {
    const runtime = new SystemRuntime(ctx, store, options);
    try {
        await runtime.install();
    }
    catch (error) {
        await runtime.dispose();
        throw error;
    }
    ctx.effect(() => () => runtime.dispose());
    return runtime;
}
