/** Serialize traffic rows and their shared blob files for one persisted store. */
export declare function withTrafficMutation<T>(storagePath: string, operation: () => Promise<T>): Promise<T>;
