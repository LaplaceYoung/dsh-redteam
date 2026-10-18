import type { RedTeamStore } from './store.js';
export interface TrafficStatus {
    running: boolean;
    taskId?: string;
    workerSessionId?: string;
    port?: number;
    pid?: number;
    starting?: boolean;
    stopping?: boolean;
    error?: string;
    diagnostics?: string;
    proxyUrl?: string;
    caCertPath?: string;
}
export declare class TrafficRuntime {
    private readonly store;
    private readonly command;
    private capture;
    private lastStatus;
    private operations;
    private globalProxy;
    private captureEnabled;
    private trafficBindingEnabled;
    private loaded?;
    private readonly configurationListeners;
    onConfigurationChange(listener: () => void): () => void;
    private publishConfiguration;
    load(): Promise<void>;
    setGlobalProxy(raw: string): Promise<string>;
    setCaptureEnabled(enabled: boolean): Promise<boolean>;
    setTrafficBindingEnabled(enabled: boolean): Promise<boolean>;
    configuration(): {
        captureEnabled: boolean;
        globalProxy: string;
        trafficBindingEnabled: boolean;
    };
    private saveSettings;
    getGlobalProxy(): string;
    constructor(store: RedTeamStore, command?: string);
    start(taskId: string, port?: number, binding?: {
        workerSessionId?: string;
    }): Promise<TrafficStatus>;
    stop(): Promise<TrafficStatus>;
    status(): TrafficStatus;
    workerEnvironment(taskId: string, workerSessionId?: string): Record<string, string>;
    private serialize;
    private assertTaskAvailable;
    private startCapture;
    private stopCapture;
    private finish;
    private fail;
    private diagnostic;
    private consumeOutput;
}
