import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
const DEFAULT_CLI = 'C:/Users/xiaoz/AppData/Local/Programs/DeepSeek Harness/resources/runtime/cli/bin/dsh.cmd';
const MAX_OUTPUT = 128 * 1024;
function text(value, name) {
    if (typeof value !== 'string' || !value.trim() || value.includes('\0'))
        throw new Error(`${name} must be a non-empty string`);
    return value.trim();
}
function parseJson(value) {
    const start = value.search(/[\[{]/);
    if (start < 0)
        return undefined;
    try {
        return JSON.parse(value.slice(start));
    }
    catch {
        return undefined;
    }
}
function findPackage(value, name) {
    if (Array.isArray(value))
        for (const item of value) {
            const found = findPackage(item, name);
            if (found)
                return found;
        }
    if (!value || typeof value !== 'object')
        return undefined;
    const row = value;
    if (row.name === name)
        return { version: typeof row.version === 'string' ? row.version : undefined, path: typeof row.path === 'string' ? row.path : undefined };
    for (const child of ['dependencies', 'devDependencies', 'packages']) {
        const found = findPackage(row[child], name);
        if (found)
            return found;
    }
    return undefined;
}
async function defaultExecute(cliPath, args, options) {
    return await new Promise((resolveResult, reject) => {
        const child = spawn(cliPath, args, { cwd: options.cwd, env: options.env, shell: cliPath.toLowerCase().endsWith('.cmd'), windowsHide: true });
        let stdout = '', stderr = '', settled = false;
        const finish = (result) => { if (!settled) {
            settled = true;
            resolveResult(result);
        } };
        const timer = setTimeout(() => { child.kill(); finish({ exitCode: 124, stdout, stderr: `${stderr}\ncommand timed out` }); }, options.timeoutMs);
        child.stdout.on('data', chunk => { stdout = (stdout + String(chunk)).slice(-MAX_OUTPUT); });
        child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-MAX_OUTPUT); });
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('close', code => { clearTimeout(timer); finish({ exitCode: code ?? 1, stdout, stderr }); });
    });
}
function manifest(value, packageName, runtimeVersion) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('compatibility manifest is required for a local package source');
    const input = value;
    const runtime = text(input.runtimeVersion, 'compatibility.runtimeVersion');
    if (runtime !== runtimeVersion)
        throw new Error(`compatibility manifest targets DSH ${runtime}, current runtime is ${runtimeVersion}`);
    if (input.packageName !== undefined && input.packageName !== packageName)
        throw new Error('compatibility manifest packageName does not match the managed package');
    for (const key of ['compatibleWith', 'migrateFrom'])
        if (input[key] !== undefined && (!Array.isArray(input[key]) || !input[key].every(item => typeof item === 'string')))
            throw new Error(`compatibility.${key} must be an array of strings`);
    return { runtimeVersion: runtime, packageName, ...(typeof input.packageVersion === 'string' ? { packageVersion: input.packageVersion } : {}), ...(typeof input.dataSchemaVersion === 'string' ? { dataSchemaVersion: input.dataSchemaVersion } : {}), ...(input.compatibleWith ? { compatibleWith: input.compatibleWith } : {}), ...(input.migrateFrom ? { migrateFrom: input.migrateFrom } : {}), ...(typeof input.rollback === 'boolean' ? { rollback: input.rollback } : {}) };
}
function localPath(target) {
    return target.startsWith('file:') ? target.slice(5) : target;
}
/**
 * Adapter for the DSH rc.2 public plugin command. It only manages the profile
 * named by the caller; it never uses the reserved desktop profile implicitly.
 */
export class DshPluginVersions {
    running = false;
    listeners = new Set();
    current;
    options;
    constructor(options) {
        this.options = options;
        text(options.profile, 'profile');
        text(options.packageName, 'packageName');
    }
    emit(event) { this.current = event; for (const listener of this.listeners)
        listener(event); }
    status() { return this.current ? structuredClone(this.current) : { operation: 'check', phase: 'completed', at: new Date().toISOString(), message: 'idle' }; }
    stream(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
    async run(operation, args, target) {
        if (this.running)
            throw new Error('a plugin version operation is already running');
        this.running = true;
        this.emit({ operation, phase: 'started', at: new Date().toISOString(), target });
        try {
            const cwd = this.options.cwd ?? process.cwd();
            const env = { ...process.env, ...this.options.env };
            const result = await (this.options.execute ?? ((argv, opts) => defaultExecute(this.options.cliPath ?? DEFAULT_CLI, argv, opts)))(args, { cwd, env, timeoutMs: this.options.commandTimeoutMs ?? 120_000 });
            this.emit({ operation, phase: 'command', at: new Date().toISOString(), target, exitCode: result.exitCode, message: result.stderr || result.stdout.slice(-1000) });
            return result;
        }
        catch (error) {
            this.emit({ operation, phase: 'failed', at: new Date().toISOString(), target, message: error instanceof Error ? error.message : String(error) });
            throw error;
        }
        finally {
            this.running = false;
        }
    }
    async check(input = {}) {
        const result = await this.run('check', ['plugin', '--profile', this.options.profile, 'list', '--depth=0', '--json']);
        const parsed = parseJson(result.stdout);
        const installed = findPackage(parsed, this.options.packageName);
        const out = { ok: result.exitCode === 0, package: this.options.packageName, profile: this.options.profile, runtime: this.options.runtimeVersion, current: installed?.version ?? null, source: this.options.source ?? null, force: Boolean(input.force), diagnostics: result.exitCode === 0 ? undefined : (result.stderr || result.stdout).trim() };
        const localSource = this.options.source && (this.options.source.startsWith('file:') || /\.(?:tgz|tar\.gz)$/i.test(this.options.source) || /^(?:[A-Za-z]:[\\/]|[\\/]|\.\.?[\\/])/.test(this.options.source));
        if (localSource) {
            out.available = false;
            out.reason = 'local archive source has no registry latest version; apply requires an explicit target and compatibility manifest';
        }
        else {
            const view = await this.run('check', ['plugin', '--profile', this.options.profile, 'view', this.options.packageName, 'version', '--json']);
            const viewed = parseJson(view.stdout);
            const latest = typeof viewed === 'string' ? viewed : viewed && typeof viewed === 'object' && typeof viewed.version === 'string' ? viewed.version : undefined;
            out.latest = latest ?? null;
            out.registry = { ok: view.exitCode === 0, diagnostics: view.exitCode === 0 ? undefined : (view.stderr || view.stdout).trim() };
            if (view.exitCode !== 0 && result.exitCode === 0)
                out.ok = false;
        }
        const failed = out.ok !== true;
        this.emit({ operation: 'check', phase: failed ? 'failed' : 'completed', at: new Date().toISOString(), message: failed ? String(out.diagnostics ?? 'registry check failed') : 'profile inspected' });
        return out;
    }
    target(input, requireCompatibility) {
        const source = input.source ?? input.spec ?? input.target ?? this.options.source;
        const target = text(source, 'source/spec');
        const local = target.startsWith('file:') || /^(?:[A-Za-z]:[\\/]|[\\/]|\.\.?[\\/])/.test(target) || /\.(?:tgz|tar\.gz)$/i.test(target);
        const compatibility = local || requireCompatibility ? manifest(input.compatibility, this.options.packageName, this.options.runtimeVersion ?? '') : undefined;
        return { target, local, compatibility };
    }
    async apply(input) {
        const value = (input && typeof input === 'object' ? input : {});
        const { target, local, compatibility } = this.target(value, false);
        if (local) {
            try {
                await access(resolve(this.options.cwd ?? process.cwd(), localPath(target)));
            }
            catch {
                throw new Error(`source not found: ${target}`);
            }
        }
        const result = await this.run('apply', ['plugin', '--profile', this.options.profile, 'add', target, '--save-exact'], target);
        const out = { ok: result.exitCode === 0, operation: 'install', rollback: false, target, local, compatibility, exitCode: result.exitCode, diagnostics: (result.stderr || result.stdout).trim() };
        this.emit({ operation: 'apply', phase: result.exitCode === 0 ? 'completed' : 'failed', at: new Date().toISOString(), target, exitCode: result.exitCode, message: out.diagnostics });
        return out;
    }
    async rollback(input = {}) {
        const value = (input && typeof input === 'object' ? input : {});
        const { target, local, compatibility } = this.target(value, true);
        if (!compatibility || compatibility.rollback !== true)
            throw new Error('compatibility manifest must set rollback:true for an explicit downgrade');
        if (local) {
            try {
                await access(resolve(this.options.cwd ?? process.cwd(), localPath(target)));
            }
            catch {
                throw new Error(`source not found: ${target}`);
            }
        }
        const result = await this.run('rollback', ['plugin', '--profile', this.options.profile, 'add', target, '--save-exact'], target);
        const out = { ok: result.exitCode === 0, operation: 'explicit-version-install', rollback: false, target, local, compatibility, exitCode: result.exitCode, diagnostics: (result.stderr || result.stdout).trim(), note: 'DSH exposes transaction recovery for failed installs; it has no installed-version history rollback API.' };
        this.emit({ operation: 'rollback', phase: result.exitCode === 0 ? 'completed' : 'failed', at: new Date().toISOString(), target, exitCode: result.exitCode, message: out.diagnostics });
        return out;
    }
}
export const createDshPluginVersions = (options) => new DshPluginVersions(options);
