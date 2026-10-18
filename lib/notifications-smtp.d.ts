import { type NotificationMessage, type NotificationSendOptions } from './notifications-channels.js';
export declare function sendSMTP(cfg: Record<string, unknown>, message: NotificationMessage, options: NotificationSendOptions): Promise<number>;
