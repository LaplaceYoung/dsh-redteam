import type { NotificationSnapshot } from './notifications.js';
export declare class PermanentNotificationError extends Error {
}
export interface NotificationMessage {
    items: Array<NotificationSnapshot & {
        detailURL: string;
    }>;
    batch: boolean;
    windowMinutes: number;
    homeURL: string;
}
export interface NotificationSendOptions {
    signal?: AbortSignal;
    allowLocalTargets?: boolean;
    now?: Date;
}
export declare const notificationKinds: readonly ["dingtalk", "email", "feishu", "telegram", "webhook", "wecom"];
export declare function notificationSecretKeys(kind: string): string[];
export declare function maskNotificationConfig(kind: string, config: Record<string, unknown>): Record<string, unknown>;
export declare function prepareNotificationConfigUpdate(kind: string, stored: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown>;
export declare function localNotificationTargetsAllowed(options: NotificationSendOptions): boolean;
export declare function blockedNotificationIP(address: string): boolean;
export declare function resolveNotificationHost(host: string, options: NotificationSendOptions): Promise<{
    address: string;
    family: number;
}>;
export declare function validateNotificationChannel(kind: string, config: Record<string, unknown>): void;
export declare const notificationSeverityLabel: (s: string) => string;
export declare const notificationStatusLabel: (s: string) => string;
export declare const notificationTitle: (m: NotificationMessage) => string;
export declare function renderNotificationMarkdown(m: NotificationMessage, maxBytes: number): {
    text: string;
    kept: number;
};
export declare function renderNotificationTelegram(m: NotificationMessage): {
    text: string;
    kept: number;
};
export declare function renderNotificationFeishu(m: NotificationMessage): {
    card: Record<string, unknown>;
    kept: number;
};
export declare function renderNotificationEmail(m: NotificationMessage): string;
export declare function sendNotification(kind: string, cfg: Record<string, unknown>, m: NotificationMessage, options?: NotificationSendOptions): Promise<number>;
