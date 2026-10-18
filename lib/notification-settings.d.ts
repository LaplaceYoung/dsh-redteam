import type { NotificationChannel } from './types.js';
import { type NotificationState, type NotificationOptions } from './notifications.js';
export interface NotificationSettings {
    notify_enabled: boolean;
    notify_public_base_url: string;
    notify_digest_interval_min: number;
}
export interface NotificationManagementState extends NotificationState {
    notificationSettings: Partial<NotificationSettings>;
    notificationChannels: NotificationChannel[];
}
export interface NotificationManagementRepository {
    read(): NotificationManagementState;
    transaction<T>(mutate: (state: NotificationManagementState) => T): Promise<T>;
}
export declare function notificationSettingsPatch(value: unknown): Partial<NotificationSettings>;
export declare class NotificationSettingsRuntime {
    private repo;
    private defaults;
    constructor(repo: NotificationManagementRepository, defaults?: Pick<NotificationOptions, 'enabled' | 'digestMinutes' | 'publicBaseURL'>);
    read(): NotificationSettings;
    update(input: unknown): Promise<{
        notify_enabled: boolean;
        notify_public_base_url: string;
        notify_digest_interval_min: number;
    }>;
    listChannels(): {
        ratePerMin: number;
        config: Record<string, unknown>;
        secret_keys: string[];
        id: string;
        name: string;
        kind: string;
        mode: "realtime" | "digest";
        enabled: boolean;
        filter?: Record<string, unknown>;
        createdAt: string;
        updatedAt: string;
    }[];
    createChannel(input: unknown): Promise<{
        ratePerMin: number;
        config: Record<string, unknown>;
        secret_keys: string[];
        id: string;
        name: string;
        kind: string;
        mode: "realtime" | "digest";
        enabled: boolean;
        filter?: Record<string, unknown>;
        createdAt: string;
        updatedAt: string;
    }>;
    updateChannel(id: string, input: unknown): Promise<{
        ratePerMin: number;
        config: Record<string, unknown>;
        secret_keys: string[];
        id: string;
        name: string;
        kind: string;
        mode: "realtime" | "digest";
        enabled: boolean;
        filter?: Record<string, unknown>;
        createdAt: string;
        updatedAt: string;
    }>;
    deleteChannel(id: string): Promise<{
        deleted: string;
    }>;
}
export declare function registerNotificationManagementTools(ctx: {
    tools: {
        register(tool: unknown): () => void;
    };
}, runtime: NotificationSettingsRuntime): () => void;
