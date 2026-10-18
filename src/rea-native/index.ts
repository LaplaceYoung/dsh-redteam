import { createServices, inputSchemas } from './vendor/runtime.mjs';
import type { NativeOperation, NativeInspectOptions, NativePathInput, NativePeResourcesInput, NativeResult } from './types.js';
export type * from './types.js';
export * from './evidence/index.js';

export const nativeOperations = [
  'inspect_go_binary', 'inspect_rust_binary', 'inspect_pe_resources', 'inspect_electron_fuses',
] as const;

/** Exact upstream input JSON Schemas, suitable for DSH tool registration. */
export const nativeInputSchemas = inputSchemas;

export function isNativeOperation(value: string): value is NativeOperation {
  return nativeOperations.some(operation => operation === value);
}

/** DSH-owned in-process services. No CLI, MCP server, target execution or REA installation. */
export class ReaNativeRuntime {
  private readonly services = createServices();

  invoke(operation: NativeOperation, input: unknown, options?: NativeInspectOptions): Promise<NativeResult> {
    return this.services[operation].inspect(input, options);
  }

  inspectGoBinary(input: NativePathInput, options?: NativeInspectOptions): Promise<NativeResult> {
    return this.invoke('inspect_go_binary', input, options);
  }

  inspectRustBinary(input: NativePathInput, options?: NativeInspectOptions): Promise<NativeResult> {
    return this.invoke('inspect_rust_binary', input, options);
  }

  inspectPeResources(input: NativePeResourcesInput, options?: NativeInspectOptions): Promise<NativeResult> {
    return this.invoke('inspect_pe_resources', input, options);
  }

  inspectElectronFuses(input: NativePathInput, options?: NativeInspectOptions): Promise<NativeResult> {
    return this.invoke('inspect_electron_fuses', input, options);
  }

  async close(): Promise<void> {
    await Promise.all(Object.values(this.services).map(service => service.close?.()));
  }
}
