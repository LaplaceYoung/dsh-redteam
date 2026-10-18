import { createServices, inputSchemas } from './vendor/runtime.mjs';
export * from './evidence/index.js';
export const nativeOperations = [
    'inspect_go_binary', 'inspect_rust_binary', 'inspect_pe_resources', 'inspect_electron_fuses',
];
/** Exact upstream input JSON Schemas, suitable for DSH tool registration. */
export const nativeInputSchemas = inputSchemas;
export function isNativeOperation(value) {
    return nativeOperations.some(operation => operation === value);
}
/** DSH-owned in-process services. No CLI, MCP server, target execution or REA installation. */
export class ReaNativeRuntime {
    services = createServices();
    invoke(operation, input, options) {
        return this.services[operation].inspect(input, options);
    }
    inspectGoBinary(input, options) {
        return this.invoke('inspect_go_binary', input, options);
    }
    inspectRustBinary(input, options) {
        return this.invoke('inspect_rust_binary', input, options);
    }
    inspectPeResources(input, options) {
        return this.invoke('inspect_pe_resources', input, options);
    }
    inspectElectronFuses(input, options) {
        return this.invoke('inspect_electron_fuses', input, options);
    }
    async close() {
        await Promise.all(Object.values(this.services).map(service => service.close?.()));
    }
}
