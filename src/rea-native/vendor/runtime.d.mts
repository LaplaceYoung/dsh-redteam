import type { JsonObject, NativeOperation, NativeService } from '../types.js';
export function createServices(): Record<NativeOperation, NativeService>;
export const inputSchemas: Record<NativeOperation, JsonObject>;
