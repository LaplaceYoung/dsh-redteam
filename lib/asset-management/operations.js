import { arrayField, AssetManagementError, booleanField, idsField, numberField, textField } from './validation.js';
export async function executeManagement(services, resource, action, input, signal, options = {}) {
    await services.ready;
    signal.throwIfAborted();
    const id = () => textField(input, 'id', true);
    switch (resource) {
        case 'assets':
            switch (action) {
                case 'list': return services.assets.list({ type: textField(input, 'type'), dsl: textField(input, 'dsl'), task_id: textField(input, 'task_id'), company_id: textField(input, 'company_id'), limit: numberField(input, 'limit'), offset: numberField(input, 'offset') });
                case 'get': return services.assets.get(id());
                case 'counts': return services.assets.counts(textField(input, 'task_id'));
                case 'upsert': {
                    const taskId = textField(input, 'task_id') ?? 'global';
                    const result = await services.assets.insert(arrayField(input, 'assets', true), taskId);
                    if (taskId !== 'global' && result.results.length)
                        await options.onTaskMutation?.(taskId);
                    return result;
                }
                case 'delete': return services.assets.delete(idsField(input, 'ids', true));
            }
            break;
        case 'companies':
            switch (action) {
                case 'list': return services.companies.list();
                case 'get': return services.companies.get(id());
                case 'create': return services.companies.create({ name: textField(input, 'name', true), logo: textField(input, 'logo'), scope: arrayField(input, 'scope') });
                case 'scope': return services.companies.scope(id(), { scope: arrayField(input, 'scope', true), reset: booleanField(input, 'reset'), reason: textField(input, 'reason') });
                case 'delete': return services.companies.delete(id(), booleanField(input, 'delete_assets') ?? false);
                case 'reattribute': return services.companies.reattribute();
            }
            break;
        case 'task-assets':
            {
                if (action === 'catalog')
                    return services.tasks.catalog();
                const taskId = textField(input, 'task_id', true);
                if (action === 'list')
                    return services.assets.list({ task_id: taskId, type: textField(input, 'type'), dsl: textField(input, 'dsl'), limit: numberField(input, 'limit'), offset: numberField(input, 'offset') });
                if (action === 'refs') {
                    const assetId = textField(input, 'asset_id');
                    return assetId ? services.tasks.refs(taskId, assetId) : services.tasks.intentAssets(taskId);
                }
                if (action === 'attach' || action === 'detach') {
                    const result = action === 'attach' ? await services.tasks.attach(taskId, { asset_ids: idsField(input, 'asset_ids'), source_summary: textField(input, 'source_summary'), scope: arrayField(input, 'scope') }) : await services.tasks.detach(taskId, textField(input, 'asset_id', true));
                    await options.onTaskMutation?.(taskId);
                    return result;
                }
            }
            break;
        case 'scopesentry':
            switch (action) {
                case 'status': return services.scopesentry.status(signal);
                case 'projects':
                case 'tasks': return services.scopesentry[action]({ page: numberField(input, 'page'), size: numberField(input, 'size'), search: textField(input, 'search') }, signal);
                case 'configure': return services.scopesentry.configure({ url: textField(input, 'url'), api_key: textField(input, 'api_key'), enabled: booleanField(input, 'enabled') }, signal);
                case 'sync': return services.scopesentry.sync({ dimension: textField(input, 'dimension', true), targets: idsField(input, 'targets', true), asset_types: idsField(input, 'asset_types'), create_company: booleanField(input, 'create_company'), page_size: numberField(input, 'page_size') }, signal);
            }
            break;
    }
    throw new AssetManagementError(`Unknown ${resource} action: ${action}`, 404);
}
