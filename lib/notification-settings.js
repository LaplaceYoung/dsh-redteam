import { randomUUID } from 'node:crypto';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { validateNotificationFilter, notificationRateDefaults } from './notifications.js';
import { maskNotificationConfig, notificationSecretKeys, prepareNotificationConfigUpdate, validateNotificationChannel } from './notifications-channels.js';
export function notificationSettingsPatch(value) {
    const input = object(value, 'notification settings');
    const patch = {};
    if (input.notify_enabled !== undefined) {
        if (typeof input.notify_enabled !== 'boolean')
            throw new Error('notify_enabled 必须为布尔值');
        patch.notify_enabled = input.notify_enabled;
    }
    if (input.notify_public_base_url !== undefined) {
        if (typeof input.notify_public_base_url !== 'string')
            throw new Error('notify_public_base_url 必须为字符串');
        const url = input.notify_public_base_url.trim().replace(/\/+$/, '');
        if (url && !url.startsWith('http://') && !url.startsWith('https://'))
            throw new Error('回链地址需以 http:// 或 https:// 开头');
        patch.notify_public_base_url = url;
    }
    if (input.notify_digest_interval_min !== undefined) {
        const minutes = input.notify_digest_interval_min;
        if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 1 || minutes > 1440)
            throw new Error('汇总周期需在 1 到 1440 分钟之间');
        patch.notify_digest_interval_min = minutes;
    }
    return patch;
}
export class NotificationSettingsRuntime {
    repo;
    defaults;
    constructor(repo, defaults = {}) {
        this.repo = repo;
        this.defaults = { notify_enabled: true, notify_public_base_url: '', notify_digest_interval_min: 30, ...notificationSettingsPatch({ notify_enabled: defaults.enabled, notify_public_base_url: defaults.publicBaseURL, notify_digest_interval_min: defaults.digestMinutes }) };
    }
    read() { return { ...this.defaults, ...notificationSettingsPatch(this.repo.read().notificationSettings) }; }
    update(input) {
        const patch = notificationSettingsPatch(input);
        return this.repo.transaction(state => { Object.assign(state.notificationSettings, patch); return { ...this.defaults, ...state.notificationSettings }; });
    }
    listChannels() { return this.repo.read().notificationChannels.map(channelDTO); }
    createChannel(input) {
        const patch = channelPatch(input);
        const { kind, name } = patch;
        if (!kind)
            throw new Error('缺少渠道类型');
        if (!name)
            throw new Error('缺少渠道名称');
        const config = patch.config ?? {};
        validateNotificationChannel(kind, config);
        return this.repo.transaction(state => {
            const at = new Date().toISOString();
            const row = { id: randomUUID(), name, kind, mode: patch.mode ?? 'realtime', enabled: patch.enabled ?? true, filter: patch.filter ?? {}, ratePerMin: patch.ratePerMin ?? notificationRateDefaults[kind], config, createdAt: at, updatedAt: at };
            state.notificationChannels.push(row);
            return channelDTO(row);
        });
    }
    updateChannel(id, input) {
        const patch = channelPatch(input);
        return this.repo.transaction(state => {
            const row = state.notificationChannels.find(channel => channel.id === id);
            if (!row)
                throw new Error(`notification channel not found: ${id}`);
            const kind = patch.kind ?? row.kind;
            const config = prepareNotificationConfigUpdate(kind, kind === row.kind ? row.config : {}, patch.config ?? {});
            validateNotificationChannel(kind, config);
            Object.assign(row, patch, { kind, config, updatedAt: new Date().toISOString() });
            if (!row.enabled)
                for (const delivery of state.notificationDeliveries)
                    if (delivery.channelId === id && ['pending', 'sending'].includes(delivery.state)) {
                        delivery.state = 'skipped';
                        delivery.lastError = '渠道已停用';
                    }
            return channelDTO(row);
        });
    }
    deleteChannel(id) {
        return this.repo.transaction(state => {
            const index = state.notificationChannels.findIndex(channel => channel.id === id);
            if (index < 0)
                throw new Error(`notification channel not found: ${id}`);
            state.notificationChannels.splice(index, 1);
            state.notificationDeliveries = state.notificationDeliveries.filter(delivery => delivery.channelId !== id);
            return { deleted: id };
        });
    }
}
function channelPatch(value) {
    const input = object(value, 'channel'), patch = {};
    for (const key of ['name', 'kind'])
        if (input[key] !== undefined) {
            if (typeof input[key] !== 'string' || !input[key].trim())
                throw new Error(`${key} 必须为非空字符串`);
            patch[key] = input[key].trim();
        }
    if (input.enabled !== undefined) {
        if (typeof input.enabled !== 'boolean')
            throw new Error('enabled 必须为布尔值');
        patch.enabled = input.enabled;
    }
    if (input.mode !== undefined) {
        if (input.mode !== 'realtime' && input.mode !== 'digest')
            throw new Error('推送模式无效，可选 realtime / digest');
        patch.mode = input.mode;
    }
    if (input.rate_per_min !== undefined) {
        if (typeof input.rate_per_min !== 'number' || !Number.isInteger(input.rate_per_min) || input.rate_per_min < 0)
            throw new Error('限流值必须为非负整数');
        patch.ratePerMin = input.rate_per_min;
    }
    if (input.config !== undefined)
        patch.config = object(input.config, 'config');
    if (input.filter !== undefined) {
        patch.filter = object(input.filter, 'filter');
        validateNotificationFilter(patch.filter);
    }
    return patch;
}
function channelDTO(channel) {
    return { ...structuredClone(channel), ratePerMin: channel.ratePerMin ?? notificationRateDefaults[channel.kind], config: maskNotificationConfig(channel.kind, channel.config), secret_keys: notificationSecretKeys(channel.kind) };
}
function object(value, name) { if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${name} 必须为对象`); return value; }
export function registerNotificationManagementTools(ctx, runtime) {
    const output = { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] };
    const json = (value) => JSON.parse(JSON.stringify(value));
    const disposers = [
        ctx.tools.register(defineTool({ name: 'redteam_notification_settings', description: 'Read or update persisted ARTEX notification settings. notify_enabled, notify_public_base_url and notify_digest_interval_min take effect on the next dispatcher tick without restart. Omitted keys retain their current values.', parameters: { action: { type: 'string', required: true, enum: ['get', 'update'] }, settings: { type: 'json' } }, output,
            execute: async (args) => json(args.action === 'get' ? runtime.read() : await runtime.update(args.settings)) })),
        ctx.tools.register(defineTool({ name: 'redteam_notification_channels', description: 'List/create/update/delete notification channels. Channel JSON supports name, kind, enabled, mode, config (including webhook body_template), filter and rate_per_min. Updates preserve omitted fields and masked secrets; changing kind replaces configuration. Delete removes delivery history.', parameters: { action: { type: 'string', required: true, enum: ['list', 'create', 'update', 'delete'] }, channel_id: { type: 'string' }, channel: { type: 'json' } }, output,
            execute: async (args) => {
                if (args.action === 'list')
                    return json(runtime.listChannels());
                if (args.action === 'create')
                    return json(await runtime.createChannel(args.channel));
                if (!args.channel_id)
                    throw new Error('channel_id is required');
                return json(args.action === 'delete' ? await runtime.deleteChannel(args.channel_id) : await runtime.updateChannel(args.channel_id, args.channel));
            } }))
    ];
    return () => disposers.forEach(dispose => dispose());
}
