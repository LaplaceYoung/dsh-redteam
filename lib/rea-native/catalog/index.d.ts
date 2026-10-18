export type ReaJsonSchema = Record<string, unknown>;
export interface ReaToolContract {
    name: string;
    title?: string;
    description: string;
    inputSchema: ReaJsonSchema;
    annotations?: Record<string, unknown>;
    effects?: Record<string, boolean>;
    nativeStatus: string;
    cliCommands: string[];
    sources: {
        file: string;
        line: number;
        sha256: string;
    }[];
}
export declare const reaUpstreamVersion = "6.5.0";
export declare const reaToolContracts: readonly ReaToolContract[];
export declare function getReaToolContract(name: string): ReaToolContract | undefined;
