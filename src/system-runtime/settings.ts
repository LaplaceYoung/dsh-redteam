import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export type SearchBackend = 'ddgs' | 'brave-free' | 'tavily' | 'deepseek';
export interface SystemSettings {
  web_search_enabled: boolean;
  web_search_backend: SearchBackend;
  web_search_proxy: string;
  llm_pool_enabled: boolean;
  llm_pool_bind_fallback: boolean;
  constraints_inject_planner: boolean;
  constraints_inject_worker: boolean;
  noa_compaction: boolean;
}
interface PrivateSettings extends SystemSettings { brave_search_api_key: string; tavily_search_api_key: string }
export interface PublicSystemSettings extends SystemSettings { brave_key_set: boolean; tavily_key_set: boolean }
export type SystemSettingsPatch = { [K in keyof PrivateSettings]?: PrivateSettings[K] | null };
const defaults = (): PrivateSettings => ({ web_search_enabled: false, web_search_backend: 'ddgs', web_search_proxy: '', brave_search_api_key: '', tavily_search_api_key: '', llm_pool_enabled: false, llm_pool_bind_fallback: false, constraints_inject_planner: true, constraints_inject_worker: true, noa_compaction: false });
const locks = new Map<string, Promise<unknown>>();
const loaded = new Map<string, PrivateSettings>();
const booleans = new Set(['web_search_enabled', 'llm_pool_enabled', 'llm_pool_bind_fallback', 'constraints_inject_planner', 'constraints_inject_worker', 'noa_compaction']);
function normalizePatch(value: unknown): SystemSettingsPatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('system settings patch must be an object');
  const result: Record<string, unknown> = {};
  for (const [key, input] of Object.entries(value)) {
    if (!Object.hasOwn(defaults(), key)) throw new Error(`unsupported system setting: ${key}`);
    if (input === null || input === undefined) continue;
    if (booleans.has(key)) { if (typeof input !== 'boolean') throw new Error(`${key} must be boolean`); result[key] = input; continue; }
    if (typeof input !== 'string') throw new Error(`${key} must be a string`);
    const text = input.trim();
    if (key === 'web_search_backend') {
      if (text && !['ddgs', 'brave-free', 'tavily', 'deepseek'].includes(text)) throw new Error('unsupported web search backend');
      result[key] = text || 'ddgs';
    } else if (key === 'web_search_proxy') {
      if (text) { const url = new URL(text); if (!['http:', 'https:', 'socks5:', 'socks5h:'].includes(url.protocol) || !url.hostname) throw new Error('search proxy requires http, https or socks5 URL'); }
      result[key] = text;
    } else result[key] = input;
  }
  return result as SystemSettingsPatch;
}
function publicSettings(value: PrivateSettings): PublicSystemSettings {
  const { brave_search_api_key, tavily_search_api_key, ...settings } = value;
  return { ...settings, brave_key_set: !!brave_search_api_key.trim(), tavily_key_set: !!tavily_search_api_key.trim() };
}

/** Private sidecar owns only settings not already owned by traffic/task/platform runtimes. */
export class SystemSettingsStore {
  readonly storagePath: string;
  private readonly key: string;
  private get value(): PrivateSettings | undefined { return loaded.get(this.key); }
  constructor(path: string) { this.storagePath = resolve(path); this.key = process.platform === 'win32' ? this.storagePath.toLowerCase() : this.storagePath; }
  private async read(): Promise<PrivateSettings> {
    let value: unknown;
    try { value = JSON.parse(await readFile(this.storagePath, 'utf8')); }
    catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return defaults(); throw error; }
    if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 || !('settings' in value)) throw new Error('unsupported system settings file');
    return { ...defaults(), ...normalizePatch(value.settings) } as PrivateSettings;
  }
  load(): Promise<PublicSystemSettings> {
    const operation = (locks.get(this.key) ?? Promise.resolve()).catch(() => {}).then(async () => { loaded.set(this.key, await this.read()); return this.snapshot(); });
    locks.set(this.key, operation);
    void operation.finally(() => { if (locks.get(this.key) === operation) locks.delete(this.key); }).catch(() => {});
    return operation;
  }
  snapshot(): PublicSystemSettings { if (!this.value) throw new Error('system settings not loaded'); return publicSettings(this.value); }
  /** Internal transport input. Never expose this object as a tool/API response. */
  searchConfig(): { enabled: boolean; backend: SearchBackend; braveAPIKey: string; tavilyAPIKey: string; proxy: string } {
    if (!this.value) throw new Error('system settings not loaded');
    return { enabled: this.value.web_search_enabled, backend: this.value.web_search_backend, braveAPIKey: this.value.brave_search_api_key, tavilyAPIKey: this.value.tavily_search_api_key, proxy: this.value.web_search_proxy };
  }
  update(patch: SystemSettingsPatch): Promise<PublicSystemSettings> {
    const normalized = normalizePatch(patch), key = this.key;
    const operation = (locks.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
      const next = { ...await this.read(), ...normalized } as PrivateSettings;
      await mkdir(dirname(this.storagePath), { recursive: true });
      const temporary = `${this.storagePath}.${randomUUID()}.tmp`;
      try { await writeFile(temporary, JSON.stringify({ version: 1, settings: next }, null, 2), { encoding: 'utf8', mode: 0o600 }); await rename(temporary, this.storagePath); }
      finally { await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; }); }
      loaded.set(this.key, next); return this.snapshot();
    });
    locks.set(key, operation);
    void operation.finally(() => { if (locks.get(key) === operation) locks.delete(key); }).catch(() => {});
    return operation;
  }
}

export interface PromptConstraint { taskId: string; kind: 'allow' | 'deny'; text: string }
export function selectPromptConstraints<T extends PromptConstraint>(settings: Pick<SystemSettings, 'constraints_inject_planner' | 'constraints_inject_worker'>, constraints: readonly T[], taskId: string, role: 'planner' | 'worker'): T[] {
  if (!settings[role === 'planner' ? 'constraints_inject_planner' : 'constraints_inject_worker']) return [];
  return constraints.filter(row => row.taskId === taskId && row.text !== '[deleted]').sort((a, b) => Number(a.kind === 'deny') - Number(b.kind === 'deny'));
}
