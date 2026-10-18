export class AssetManagementError extends Error {
    status;
    constructor(message, status = 400) {
        super(message);
        this.status = status;
        this.name = 'AssetManagementError';
    }
}
export function object(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new AssetManagementError('Expected JSON object');
    return Object.fromEntries(Object.entries(value));
}
export function textField(input, key, required = false) {
    const value = input[key];
    if (value === undefined && !required)
        return undefined;
    if (typeof value !== 'string' || required && !value.trim())
        throw new AssetManagementError(`${key} must be ${required ? 'a nonempty' : 'a'} string`);
    return value;
}
export function booleanField(input, key) {
    const value = input[key];
    if (value !== undefined && typeof value !== 'boolean')
        throw new AssetManagementError(`${key} must be boolean`);
    return value;
}
export function numberField(input, key) {
    const value = input[key];
    if (value !== undefined && (typeof value !== 'number' || !Number.isSafeInteger(value)))
        throw new AssetManagementError(`${key} must be an integer`);
    return value;
}
export function arrayField(input, key, required = false) {
    const value = input[key];
    if (value === undefined && !required)
        return undefined;
    if (!Array.isArray(value))
        throw new AssetManagementError(`${key} must be an array`);
    return value;
}
export function idsField(input, key, required = false) {
    const value = arrayField(input, key, required);
    if (value === undefined)
        return undefined;
    return value.map(id => { if (typeof id !== 'string' || !id.trim())
        throw new AssetManagementError(`${key} must contain nonempty ID strings`); return id; });
}
