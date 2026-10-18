import type { Asset, Finding, NotificationChannel } from './types.js';
import type { NotificationSettings } from './notification-settings.js';
export * from './notifications-channels.js';
export interface NotificationSnapshot {
    kind: 'finding_created' | 'finding_status_changed';
    findingId: string;
    taskId: string;
    vulnClass: string;
    name: string;
    severity: string;
    summary: string;
    assetIds: string[];
    assets: string[];
    fromStatus?: string;
    toStatus?: string;
}
export interface NotificationEvent {
    id: string;
    snapshot: NotificationSnapshot;
    createdAt: string;
    fannedOut: boolean;
}
export interface NotificationDelivery {
    id: string;
    eventId: string;
    channelId: string;
    state: 'pending' | 'sending' | 'sent' | 'failed' | 'skipped';
    attempts: number;
    nextAttemptAt: string;
    lastError?: string;
    createdAt: string;
    sentAt?: string;
    batchId?: string;
}
export interface NotificationState {
    notificationEvents: NotificationEvent[];
    notificationDeliveries: NotificationDelivery[];
}
export interface NotificationRepository {
    read(): NotificationState;
    transaction<T>(mutate: (state: NotificationState) => T): Promise<T>;
}
export interface NotificationFilter {
    min_severity?: string;
    task_ids?: string[];
    asset_ids?: string[];
    vulnclass_include?: string[];
    vulnclass_exclude?: string[];
    on_status_change?: boolean;
}
export declare function validateNotificationFilter(filter?: Record<string, unknown>): void;
export declare function matchNotification(filter: Record<string, unknown> | undefined, s: NotificationSnapshot): boolean;
export declare function snapshotForFinding(finding: Finding, assets: Asset[], fromStatus?: string): NotificationSnapshot;
export declare function recordNotificationEvent(state: NotificationState, snapshot: NotificationSnapshot, now?: Date): NotificationEvent;
export interface NotificationOptions {
    enabled?: boolean;
    digestMinutes?: number;
    publicBaseURL?: string;
    allowLocalTargets?: boolean;
    isTaskAvailable?: (taskId: string) => boolean;
    now?: () => Date;
    settings?: () => NotificationSettings;
}
export declare const notificationRateDefaults: Record<string, number>;
export declare class NotificationDispatcher {
    private repo;
    private channels;
    private options;
    private active?;
    private buckets;
    constructor(repo: NotificationRepository, channels: () => Array<NotificationChannel & {
        ratePerMin?: number;
    }>, options?: NotificationOptions);
    private now;
    enqueue(snapshot: NotificationSnapshot): Promise<NotificationEvent>;
    retry(id: string): Promise<NotificationDelivery>;
    skipChannel(id: string): Promise<void>;
    step(signal?: AbortSignal): Promise<void>;
    private take;
    private run;
    private send;
}
