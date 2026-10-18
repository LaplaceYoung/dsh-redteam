import { defineTool } from '@deepseek-ai/dsh-tools';
import { createAssetManagementServices } from './services.js';
import { executeManagement } from './operations.js';
import { AssetManagementError, object } from './validation.js';
export function installAssetManagementTools(ctx, store, options) {
    if (typeof options.authorize !== 'function')
        throw new Error('Asset management tools require host authorization');
    const services = createAssetManagementServices(store, options), lifetime = new AbortController();
    const definitions = [
        { name: 'redteam_manage_assets', resource: 'assets', actions: ['list', 'get', 'counts', 'upsert', 'delete'], description: 'Owner management of global assets: paginated list/DSL, detail/counts, natural-key upsert or explicit IDs deletion. Existing shared asset IDs are preserved; upsert accepts assets and optional task_id.' },
        { name: 'redteam_manage_companies', resource: 'companies', actions: ['list', 'get', 'create', 'scope', 'delete', 'reattribute'], description: 'Owner management of companies and typed scope. Delete accepts delete_assets; scope accepts reset; attribution is recomputed from real global assets.' },
        { name: 'redteam_manage_task_assets', resource: 'task-assets', actions: ['list', 'attach', 'detach', 'refs'], description: 'Owner management of task asset membership and provenance. Requires task_id. Attach accepts asset_ids with a nonempty source_summary, or scope. Detach accepts asset_id; refs accepts optional asset_id and returns actual references including direct source tasks.' },
        { name: 'redteam_scopesentry', resource: 'scopesentry', actions: ['status', 'projects', 'tasks', 'sync'], description: 'Read configured ScopeSentry MCP status, query real remote projects/tasks, or synchronize selected targets. Sync requires dimension and targets, with optional asset_types/create_company/page_size. Credentials are configured only in the owner HTTP management API.' },
    ];
    const disposers = definitions.map(definition => ctx.tools.register(defineTool({ name: definition.name, description: definition.description,
        parameters: { action: { type: 'string', required: true, enum: definition.actions }, input: { type: 'json', description: 'Action fields as JSON; IDs are opaque strings.' } },
        output: { schema: { type: 'json' }, render: (_args, output) => [{ type: 'text', text: JSON.stringify(output) }] },
        execute: async (args, exec) => {
            const signal = AbortSignal.any([exec.signal, lifetime.signal]);
            signal.throwIfAborted();
            if (await options.authorize(exec) !== true)
                throw new AssetManagementError('Owner management access required', 403);
            const value = await executeManagement(services, definition.resource, args.action, args.input === undefined ? {} : object(args.input), signal, options);
            return JSON.parse(JSON.stringify(value));
        }
    })));
    return { ...services, dispose: async () => { lifetime.abort(new Error('Asset management tools disposed')); for (const dispose of disposers)
            dispose(); await services.dispose(); } };
}
