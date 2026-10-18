import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';

/** A compatibility declaration travels with a package source supplied by an operator. */
export interface VersionCompatibilityManifest {
  packageName?: string;
  packageVersion?: string;
  runtimeVersion: string;
  dataSchemaVersion?: string;
  compatibleWith?: string[];
  migrateFrom?: string[];
  rollback?: boolean;
}

export interface VersionCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface DshPluginVersionOptions {
  /** The installed DSH launcher (the .cmd file is supported on Windows). */
  cliPath?: string;
  profile: string;
  packageName: string;
  runtimeVersion?: string;
  /** A registry spec or an explicit local directory/.tgz. It is never inferred. */
  source?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  commandTimeoutMs?: number;
  execute?: (args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number }) => Promise<VersionCommandResult>;
}

export interface VersionEvent {
  operation: 'check' | 'apply' | 'rollback';
  phase: 'started' | 'command' | 'completed' | 'failed';
  at: string;
  target?: string;
  exitCode?: number;
  message?: string;
}

type VersionInput = {
  source?: unknown;
  spec?: unknown;
  compatibility?: unknown;
  /** Alias accepted by management clients. */
  target?: unknown;
};

const DEFAULT_CLI = 'C:/Users/xiaoz/AppData/Local/Programs/DeepSeek Harness/resources/runtime/cli/bin/dsh.cmd';
const MAX_OUTPUT = 128 * 1024;

function text(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) throw new Error(`${name} must be a non-empty string`);
  return value.trim();
}

function parseJson(value: string): unknown {
  const start = value.search(/[\[{]/);
  if (start < 0) return undefined;
  try { return JSON.parse(value.slice(start)); } catch { return undefined; }
}

function findPackage(value: unknown, name: string): { version?: string; path?: string } | undefined {
  if (Array.isArray(value)) for (const item of value) { const found = findPackage(item, name); if (found) return found; }
  if (!value || typeof value !== 'object') return undefined;
  const row = value as Record<string, unknown>;
  if (row.name === name) return { version: typeof row.version === 'string' ? row.version : undefined, path: typeof row.path === 'string' ? row.path : undefined };
  for (const child of ['dependencies', 'devDependencies', 'packages']) {
    const found = findPackage(row[child], name); if (found) return found;
  }
  return undefined;
}

async function defaultExecute(cliPath: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number }): Promise<VersionCommandResult> {
  return await new Promise((resolveResult, reject) => {
    const child = spawn(cliPath, args, { cwd: options.cwd, env: options.env, shell: cliPath.toLowerCase().endsWith('.cmd'), windowsHide: true });
    let stdout = '', stderr = '', settled = false;
    const finish = (result: VersionCommandResult) => { if (!settled) { settled = true; resolveResult(result); } };
    const timer = setTimeout(() => { child.kill(); finish({ exitCode: 124, stdout, stderr: `${stderr}\ncommand timed out` }); }, options.timeoutMs);
    child.stdout.on('data', chunk => { stdout = (stdout + String(chunk)).slice(-MAX_OUTPUT); });
    child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-MAX_OUTPUT); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); finish({ exitCode: code ?? 1, stdout, stderr }); });
  });
}

function manifest(value: unknown, packageName: string, runtimeVersion: string): VersionCompatibilityManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('compatibility manifest is required for a local package source');
  const input = value as Record<string, unknown>;
  const runtime = text(input.runtimeVersion, 'compatibility.runtimeVersion');
  if (runtime !== runtimeVersion) throw new Error(`compatibility manifest targets DSH ${runtime}, current runtime is ${runtimeVersion}`);
  if (input.packageName !== undefined && input.packageName !== packageName) throw new Error('compatibility manifest packageName does not match the managed package');
  for (const key of ['compatibleWith', 'migrateFrom']) if (input[key] !== undefined && (!Array.isArray(input[key]) || !(input[key] as unknown[]).every(item => typeof item === 'string'))) throw new Error(`compatibility.${key} must be an array of strings`);
  return { runtimeVersion: runtime, packageName, ...(typeof input.packageVersion === 'string' ? { packageVersion: input.packageVersion } : {}), ...(typeof input.dataSchemaVersion === 'string' ? { dataSchemaVersion: input.dataSchemaVersion } : {}), ...(input.compatibleWith ? { compatibleWith: input.compatibleWith as string[] } : {}), ...(input.migrateFrom ? { migrateFrom: input.migrateFrom as string[] } : {}), ...(typeof input.rollback === 'boolean' ? { rollback: input.rollback } : {}) };
}

function localPath(target: string): string {
  return target.startsWith('file:') ? target.slice(5) : target;
}

/**
 * Adapter for the DSH rc.2 public plugin command. It only manages the profile
 * named by the caller; it never uses the reserved desktop profile implicitly.
 */
export class DshPluginVersions {
  private running = false;
  private readonly listeners = new Set<(event: VersionEvent) => void>();
  private current: VersionEvent | undefined;
  private readonly options: Required<Pick<DshPluginVersionOptions, 'profile' | 'packageName'>> & DshPluginVersionOptions;

  constructor(options: DshPluginVersionOptions) {
    this.options = options as typeof this.options;
    text(options.profile, 'profile'); text(options.packageName, 'packageName');
  }

  private emit(event: VersionEvent) { this.current = event; for (const listener of this.listeners) listener(event); }
  status() { return this.current ? structuredClone(this.current) : { operation: 'check', phase: 'completed', at: new Date().toISOString(), message: 'idle' }; }
  stream(listener: (event: VersionEvent) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private async run(operation: VersionEvent['operation'], args: string[], target?: string) {
    if (this.running) throw new Error('a plugin version operation is already running');
    this.running = true; this.emit({ operation, phase: 'started', at: new Date().toISOString(), target });
    try {
      const cwd = this.options.cwd ?? process.cwd();
      const env = { ...process.env, ...this.options.env };
      const result = await (this.options.execute ?? ((argv, opts) => defaultExecute(this.options.cliPath ?? DEFAULT_CLI, argv, opts)))(args, { cwd, env, timeoutMs: this.options.commandTimeoutMs ?? 120_000 });
      this.emit({ operation, phase: 'command', at: new Date().toISOString(), target, exitCode: result.exitCode, message: result.stderr || result.stdout.slice(-1000) });
      return result;
    } catch (error) {
      this.emit({ operation, phase: 'failed', at: new Date().toISOString(), target, message: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally { this.running = false; }
  }

  async check(input: { force?: boolean } = {}) {
    const result = await this.run('check', ['plugin', '--profile', this.options.profile, 'list', '--depth=0', '--json']);
    const parsed = parseJson(result.stdout);
    const installed = findPackage(parsed, this.options.packageName);
    const out: Record<string, unknown> = { ok: result.exitCode === 0, package: this.options.packageName, profile: this.options.profile, runtime: this.options.runtimeVersion, current: installed?.version ?? null, source: this.options.source ?? null, force: Boolean(input.force), diagnostics: result.exitCode === 0 ? undefined : (result.stderr || result.stdout).trim() };
    const localSource = this.options.source && (this.options.source.startsWith('file:') || /\.(?:tgz|tar\.gz)$/i.test(this.options.source) || /^(?:[A-Za-z]:[\\/]|[\\/]|\.\.?[\\/])/.test(this.options.source));
    if (localSource) {
      out.available = false;
      out.reason = 'local archive source has no registry latest version; apply requires an explicit target and compatibility manifest';
    } else {
      const view = await this.run('check', ['plugin', '--profile', this.options.profile, 'view', this.options.packageName, 'version', '--json']);
      const viewed = parseJson(view.stdout);
      const latest = typeof viewed === 'string' ? viewed : viewed && typeof viewed === 'object' && typeof (viewed as Record<string, unknown>).version === 'string' ? (viewed as Record<string, unknown>).version : undefined;
      out.latest = latest ?? null;
      out.registry = { ok: view.exitCode === 0, diagnostics: view.exitCode === 0 ? undefined : (view.stderr || view.stdout).trim() };
      if (view.exitCode !== 0 && result.exitCode === 0) out.ok = false;
    }
    const failed = out.ok !== true;
    this.emit({ operation: 'check', phase: failed ? 'failed' : 'completed', at: new Date().toISOString(), message: failed ? String(out.diagnostics ?? 'registry check failed') : 'profile inspected' });
    return out;
  }

  private target(input: VersionInput, requireCompatibility: boolean) {
    const source = input.source ?? input.spec ?? input.target ?? this.options.source;
    const target = text(source, 'source/spec');
    const local = target.startsWith('file:') || /^(?:[A-Za-z]:[\\/]|[\\/]|\.\.?[\\/])/.test(target) || /\.(?:tgz|tar\.gz)$/i.test(target);
    const compatibility = local || requireCompatibility ? manifest(input.compatibility, this.options.packageName, this.options.runtimeVersion ?? '') : undefined;
    return { target, local, compatibility };
  }

  async apply(input: unknown) {
    const value = (input && typeof input === 'object' ? input : {}) as VersionInput;
    const { target, local, compatibility } = this.target(value, false);
    if (local) { try { await access(resolve(this.options.cwd ?? process.cwd(), localPath(target))); } catch { throw new Error(`source not found: ${target}`); } }
    const result = await this.run('apply', ['plugin', '--profile', this.options.profile, 'add', target, '--save-exact'], target);
    const out = { ok: result.exitCode === 0, operation: 'install', rollback: false, target, local, compatibility, exitCode: result.exitCode, diagnostics: (result.stderr || result.stdout).trim() };
    this.emit({ operation: 'apply', phase: result.exitCode === 0 ? 'completed' : 'failed', at: new Date().toISOString(), target, exitCode: result.exitCode, message: out.diagnostics });
    return out;
  }

  async rollback(input: unknown = {}) {
    const value = (input && typeof input === 'object' ? input : {}) as VersionInput;
    const { target, local, compatibility } = this.target(value, true);
    if (!compatibility || compatibility.rollback !== true) throw new Error('compatibility manifest must set rollback:true for an explicit downgrade');
    if (local) { try { await access(resolve(this.options.cwd ?? process.cwd(), localPath(target))); } catch { throw new Error(`source not found: ${target}`); } }
    const result = await this.run('rollback', ['plugin', '--profile', this.options.profile, 'add', target, '--save-exact'], target);
    const out = { ok: result.exitCode === 0, operation: 'explicit-version-install', rollback: false, target, local, compatibility, exitCode: result.exitCode, diagnostics: (result.stderr || result.stdout).trim(), note: 'DSH exposes transaction recovery for failed installs; it has no installed-version history rollback API.' };
    this.emit({ operation: 'rollback', phase: result.exitCode === 0 ? 'completed' : 'failed', at: new Date().toISOString(), target, exitCode: result.exitCode, message: out.diagnostics });
    return out;
  }
}

export const createDshPluginVersions = (options: DshPluginVersionOptions) => new DshPluginVersions(options);
