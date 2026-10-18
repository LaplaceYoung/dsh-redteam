import type { NativeOperation, NativeInspectOptions, NativePathInput, NativePeResourcesInput, NativeResult } from './types.js';
export type * from './types.js';
export * from './evidence/index.js';
export declare const nativeOperations: readonly ["inspect_go_binary", "inspect_rust_binary", "inspect_pe_resources", "inspect_electron_fuses"];
/** Exact upstream input JSON Schemas, suitable for DSH tool registration. */
export declare const nativeInputSchemas: Record<NativeOperation, import("./types.js").JsonObject>;
export declare function isNativeOperation(value: string): value is NativeOperation;
/** DSH-owned in-process services. No CLI, MCP server, target execution or REA installation. */
export declare class ReaNativeRuntime {
    private readonly services;
    invoke(operation: NativeOperation, input: unknown, options?: NativeInspectOptions): Promise<NativeResult>;
    inspectGoBinary(input: NativePathInput, options?: NativeInspectOptions): Promise<NativeResult>;
    inspectRustBinary(input: NativePathInput, options?: NativeInspectOptions): Promise<NativeResult>;
    inspectPeResources(input: NativePeResourcesInput, options?: NativeInspectOptions): Promise<NativeResult>;
    inspectElectronFuses(input: NativePathInput, options?: NativeInspectOptions): Promise<NativeResult>;
    close(): Promise<void>;
}
