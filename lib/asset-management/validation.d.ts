export declare class AssetManagementError extends Error {
    readonly status: number;
    constructor(message: string, status?: number);
}
export declare function object(value: unknown): Record<string, unknown>;
export declare function textField(input: Record<string, unknown>, key: string, required?: boolean): string | undefined;
export declare function booleanField(input: Record<string, unknown>, key: string): boolean | undefined;
export declare function numberField(input: Record<string, unknown>, key: string): number | undefined;
export declare function arrayField(input: Record<string, unknown>, key: string, required?: boolean): unknown[] | undefined;
export declare function idsField(input: Record<string, unknown>, key: string, required?: boolean): string[] | undefined;
