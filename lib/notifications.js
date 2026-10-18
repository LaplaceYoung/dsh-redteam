import { randomUUID } from 'node:crypto';
import { sendNotification } from './notifications-channels.js';
export * from './notifications-channels.js';
const ranks = { low: 1, medium: 2, high: 3, critical: 4 };
export function validateNotificationFilter(filter = {}) {
    if (filter.min_severity !== undefined && filter.min_severity !== '' && (typeof filter.min_severity !== 'string' || !(filter.min_severity in ranks)))
        throw new Error('最低级别必须为 low / medium / high / critical');
    for (const key of ['task_ids', 'asset_ids', 'vulnclass_include', 'vulnclass_exclude']) {
        const value = filter[key];
        if (value !== undefined && (!Array.isArray(value) || value.some(x => typeof x !== 'string')))
            throw new Error(`${key} 必须为字符串数组`);
    }
    if (filter.on_status_change !== undefined && typeof filter.on_status_change !== 'boolean')
        throw new Error('on_status_change 必须为布尔值');
}
export function matchNotification(filter = {}, s) {
    // ARTEX deliberately tolerates malformed historical filters on reads; writes validate separately.
    let f;
    try {
        validateNotificationFilter(filter);
        f = filter;
    }
    catch {
        f = {};
    }
    const contains = (keys) => keys.some(k => k.trim() && s.vulnClass.toLowerCase().includes(k.trim().toLowerCase()));
    if (s.kind === 'finding_status_changed' && !f.on_status_change)
        return false;
    if (f.min_severity && (ranks[s.severity] ?? 0) < (ranks[f.min_severity] ?? 0))
        return false;
    if (f.task_ids?.length && !f.task_ids.includes(s.taskId))
        return false;
    if (f.asset_ids?.length && !s.assetIds.some(id => f.asset_ids.includes(id)))
        return false;
    if (f.vulnclass_exclude?.length && contains(f.vulnclass_exclude))
        return false;
    return !f.vulnclass_include?.length || contains(f.vulnclass_include);
}
export function snapshotForFinding(finding, assets, fromStatus) {
    return { kind: fromStatus === undefined ? 'finding_created' : 'finding_status_changed', findingId: finding.id, taskId: finding.taskId,
        vulnClass: finding.vulnClass, name: finding.name ?? '', severity: finding.severity, summary: finding.summary, assetIds: [...finding.assetIds],
        assets: assets.filter(a => finding.assetIds.includes(a.id)).map(a => a.value),
        ...(fromStatus === undefined ? {} : { fromStatus, toStatus: finding.status }) };
}
export function recordNotificationEvent(state, snapshot, now = new Date()) {
    const event = { id: randomUUID(), snapshot: structuredClone(snapshot), createdAt: now.toISOString(), fannedOut: false };
    state.notificationEvents.push(event);
    return event;
}
export const notificationRateDefaults = { dingtalk: 20, feishu: 100, wecom: 20, webhook: 0, telegram: 20, email: 60 };
export class NotificationDispatcher {
    repo;
    channels;
    options;
    active;
    buckets = new Map();
    constructor(repo, channels, options = {}) {
        this.repo = repo;
        this.channels = channels;
        this.options = options;
    }
    now() { return this.options.now?.() ?? new Date(); }
    enqueue(snapshot) { return this.repo.transaction(s => recordNotificationEvent(s, snapshot, this.now())); }
    retry(id) {
        return this.repo.transaction(s => {
            const d = s.notificationDeliveries.find(row => row.id === id);
            if (!d)
                throw new Error(`投递不存在: ${id}`);
            if (d.state !== 'failed' && d.state !== 'skipped')
                throw new Error('只能重试 failed / skipped 投递');
            if (!this.channels().some(c => c.id === d.channelId && c.enabled))
                throw new Error('投递渠道已停用或删除');
            d.state = 'pending';
            d.attempts = 0;
            d.nextAttemptAt = this.now().toISOString();
            delete d.lastError;
            return structuredClone(d);
        });
    }
    skipChannel(id) {
        return this.repo.transaction(s => {
            for (const d of s.notificationDeliveries)
                if (d.channelId === id && ['pending', 'sending'].includes(d.state)) {
                    d.state = 'skipped';
                    d.lastError = '渠道已停用';
                }
        });
    }
    step(signal) {
        if (this.active)
            return this.active;
        this.active = this.run(signal).finally(() => { this.active = undefined; });
        return this.active;
    }
    take(id, rate, want, now) {
        if (rate <= 0)
            return Math.min(want, 50);
        const b = this.buckets.get(id) ?? { tokens: rate, time: now };
        b.tokens = Math.min(rate, b.tokens + Math.max(0, now - b.time) * rate / 60_000);
        b.time = now;
        const taken = Math.min(want, Math.floor(b.tokens + 1e-9));
        b.tokens -= taken;
        this.buckets.set(id, b);
        return taken;
    }
    async run(signal) {
        const settings = this.options.settings?.() ?? { notify_enabled: this.options.enabled ?? true, notify_public_base_url: this.options.publicBaseURL ?? '', notify_digest_interval_min: this.options.digestMinutes ?? 30 };
        if (!settings.notify_enabled)
            return;
        signal?.throwIfAborted();
        await this.repo.transaction(s => {
            for (const event of s.notificationEvents.filter(e => !e.fannedOut).slice(0, 200)) {
                if (this.options.isTaskAvailable?.(event.snapshot.taskId) === false)
                    continue;
                for (const ch of this.channels()) {
                    if (!ch.enabled || (ch.mode === 'digest' && event.snapshot.kind === 'finding_status_changed') || !matchNotification(ch.filter, event.snapshot))
                        continue;
                    if (!s.notificationDeliveries.some(d => d.eventId === event.id && d.channelId === ch.id))
                        s.notificationDeliveries.push({
                            id: randomUUID(), eventId: event.id, channelId: ch.id, state: 'pending', attempts: 0,
                            nextAttemptAt: this.now().toISOString(), createdAt: this.now().toISOString(),
                        });
                }
                event.fannedOut = true;
            }
        });
        for (const ch of this.channels()) {
            signal?.throwIfAborted();
            if (!ch.enabled) {
                await this.skipChannel(ch.id);
                continue;
            }
            const now = this.now().getTime();
            const digest = ch.mode === 'digest';
            const pending = this.repo.read().notificationDeliveries.filter(d => d.channelId === ch.id && ['pending', 'sending'].includes(d.state));
            if (!pending.length)
                continue;
            if (digest && Math.min(...pending.map(d => Date.parse(d.createdAt))) > now - settings.notify_digest_interval_min * 60_000)
                continue;
            const allowance = this.take(ch.id, ch.ratePerMin ?? notificationRateDefaults[ch.kind] ?? 0, digest ? 1 : 5, now);
            if (!allowance)
                continue;
            const claimed = await this.repo.transaction(s => {
                const rows = s.notificationDeliveries.filter(d => d.channelId === ch.id && ['pending', 'sending'].includes(d.state) && Date.parse(d.nextAttemptAt) <= now)
                    .filter(d => { const event = s.notificationEvents.find(e => e.id === d.eventId); return !event || this.options.isTaskAvailable?.(event.snapshot.taskId) !== false; })
                    .sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, digest ? 500 : allowance);
                for (const row of rows) {
                    row.state = 'sending';
                    row.attempts++;
                    row.nextAttemptAt = new Date(now + 180_000).toISOString();
                    if (digest)
                        row.batchId ??= rows[0].id;
                }
                return structuredClone(rows);
            });
            for (const batch of digest ? [claimed] : claimed.map(d => [d])) {
                if (!batch.length)
                    continue;
                await this.send(ch, batch, settings, signal);
            }
        }
    }
    async send(ch, batch, settings, signal) {
        let kept = 0;
        let failure;
        try {
            const base = settings.notify_public_base_url.replace(/\/+$/, '');
            const message = { batch: ch.mode === 'digest', windowMinutes: settings.notify_digest_interval_min, homeURL: base,
                items: batch.map(d => {
                    const e = this.repo.read().notificationEvents.find(e => e.id === d.eventId);
                    if (!e)
                        throw new PermanentNotificationError(`通知事件不存在: ${d.eventId}`);
                    return { ...e.snapshot, detailURL: base ? `${base}/?redteamFinding=${encodeURIComponent(e.snapshot.findingId)}` : '' };
                }) };
            kept = await sendNotification(ch.kind, ch.config, message, { signal, allowLocalTargets: this.options.allowLocalTargets, now: this.now() });
            if (kept <= 0)
                throw new Error('渠道未报告送达条数');
        }
        catch (error) {
            failure = error;
        }
        await this.repo.transaction(s => {
            for (let i = 0; i < batch.length; i++) {
                const previous = batch[i], row = s.notificationDeliveries.find(d => d.id === previous.id);
                // A disabled channel or newer lease owns the row now; do not overwrite that decision.
                if (!row || row.state !== 'sending' || row.attempts !== previous.attempts || row.nextAttemptAt !== previous.nextAttemptAt)
                    continue;
                if (!failure && i < kept) {
                    row.state = 'sent';
                    row.sentAt = this.now().toISOString();
                    delete row.lastError;
                }
                else if (!failure) {
                    row.state = 'pending';
                    row.attempts--;
                    row.nextAttemptAt = this.now().toISOString();
                    row.lastError = '消息长度上限，其余条目留待下一批';
                }
                else {
                    row.lastError = failure instanceof Error ? failure.message : String(failure);
                    if (failure instanceof PermanentNotificationError || row.attempts >= 3)
                        row.state = 'failed';
                    else {
                        row.state = 'pending';
                        row.nextAttemptAt = new Date(this.now().getTime() + [1000, 5000, 30000][row.attempts]).toISOString();
                    }
                }
            }
        });
    }
}
import { PermanentNotificationError } from './notifications-channels.js';
