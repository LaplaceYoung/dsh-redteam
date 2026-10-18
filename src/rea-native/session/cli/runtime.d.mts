export interface NativeCliRequest { signal?: AbortSignal; onProgress?: (update: unknown) => void | Promise<void>; }
export interface NativeCliInput { args?: Record<string, unknown>; options?: Record<string, unknown>; }
export interface NativeCliResult { isError: boolean; value: unknown; error?: unknown; }
export interface NativeCliDescription {
  name: string; description?: string; argsSchema: Record<string, unknown>; optionsSchema: Record<string, unknown>;
  classification: 'external-installation-management' | 'native-workflow'; unavailableReason?: string;
}
export interface NativeCli {
  readonly commands: readonly string[];
  describe(name: string): NativeCliDescription;
  invoke(name: string, input?: NativeCliInput, request?: NativeCliRequest): Promise<NativeCliResult>;
}
/** session is the host-owned upstream BinarySession aggregate, not the public tool dispatcher. */
export function createNativeCli(options?: { environment?: Record<string, string | undefined>; session?: object }): NativeCli;
