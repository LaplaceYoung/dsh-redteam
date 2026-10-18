import type { Context } from '@deepseek-ai/cordis';
import { credentialKey, credentialRef, isCredentialKeySegment, isCredentialRefName } from '@deepseek-ai/dsh-credentials';
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment';
import type { LlmConfigurableProvider } from '@deepseek-ai/dsh-llm/types';
import type {} from '@deepseek-ai/dsh-settings';
import type { PoolProfileSource } from './model-health.js';
import type { DeepSeekSearchCredentials } from './index.js';

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function optionalString(value: Record<string, unknown>, field: string): string | undefined {
  const entry = value[field];
  if (entry === undefined) return undefined;
  if (typeof entry !== 'string') throw new Error(`Provider ${field} must be a string`);
  return entry;
}
function settingsProfile(value: unknown, path: readonly string[]): Record<string, unknown> {
  let current = value;
  for (const segment of path) {
    const parent = record(current, 'Provider settings');
    if (!Object.hasOwn(parent, segment)) throw new Error('Active provider has no configured settings profile');
    current = parent[segment];
  }
  return record(current, 'Provider settings profile');
}
function checkedKey(value: string | undefined): string {
  // Match a raw HTTP header credential without ever including its contents in diagnostics.
  if (!value || !value.trim()) throw new Error('Active provider has no API key for DeepSeek web search');
  if (/[^\x20-\x7e]/.test(value)) throw new Error('Active provider API key is not a valid HTTP header value');
  return value;
}
function checkedBaseURL(value: string | undefined): string {
  if (!value) throw new Error('Active provider has no base URL for DeepSeek web search');
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error('Active provider base URL is invalid'); }
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Active provider base URL must be an HTTP(S) root without credentials, query or fragment');
  }
  return value;
}

/**
 * DSH 0.2.1-rc.2 adapter contracts, verified from the installed provider sources:
 * llm-deepseek-api-key uses apiKeyEnv on its section root; llm-pi-ai uses
 * providers[route].apiKeyEnv or the llm-pi-ai/route credential record. Namespace
 * IDs can be customized and therefore never determine the record owner.
 * Re-read the registry, live settings and credentials on every operation.
 */
export function createDeepSeekCredentialResolver(ctx: Context, profiles: PoolProfileSource): () => Promise<DeepSeekSearchCredentials> {
  return async () => {
    const state = await profiles.list();
    const active = state.profiles.find(profile => profile.id === state.activeProfileId);
    if (!active) throw new Error('Select an active global model profile before using DeepSeek web search');
    const llm = ctx.get('llm');
    const settings = ctx.get('settings');
    if (!llm || !settings) throw new Error('DeepSeek web search requires the DSH llm and settings services');
    const directory = llm.listConfigurableProviders().filter(entry => entry.provider === active.provider);
    if (directory.length !== 1) throw new Error('Active provider must have exactly one configurable provider directory entry');
    const entry = directory[0];
    if (active.provider === 'deepseek-account') throw new Error('DeepSeek account authentication cannot be used as an API key; select an API-key model profile for web search');
    const section = settings.describe({ redactSecrets: false }).find(item => item.ns === entry.settingsNs);
    if (!section) throw new Error('Active provider settings namespace is not available');
    const profile = settingsProfile(section.value, entry.settingsPath);
    const official = active.provider === 'deepseek-official' && entry.settingsPath.length === 0;
    const pi = entry.settingsPath.length === 2 && entry.settingsPath[0] === 'providers' && entry.settingsPath[1] === active.provider;
    if (!official && !pi) throw new Error('Active provider does not expose a supported DSH API-key settings contract');
    const environment = launchEnvironmentOf(ctx);
    const credentials = ctx.get('credentials');
    const explicitRef = optionalString(profile, 'apiKeyEnv') ?? (official ? 'DEEPSEEK_API_KEY' : undefined);
    let key: string | undefined;
    if (explicitRef !== undefined) {
      if (!isCredentialRefName(explicitRef)) throw new Error('Active provider apiKeyEnv is not a valid credential reference');
      // Explicit references never fall back to a stored route key or another environment name.
      key = credentials ? (await credentials.resolve(credentialRef(explicitRef)))?.value : environment.get(explicitRef)?.value;
    } else {
      const stored = credentials && isCredentialKeySegment(active.provider)
        ? await credentials.readRecord(credentialKey('llm-pi-ai', active.provider)) : undefined;
      if (stored?.kind === 'grant') throw new Error('Active provider uses an OAuth grant; DeepSeek web search requires an API-key profile');
      key = stored?.key;
      if (!key) {
        for (const ref of entry.nativeAuth?.env ?? []) {
          if (!isCredentialRefName(ref)) continue;
          key = (await credentials?.resolve(credentialRef(ref)))?.value ?? environment.get(ref)?.value;
          if (key) break;
        }
      }
    }
    const baseURL = optionalString(profile, 'baseURL') ?? (official
      ? environment.get('DEEPSEEK_BASE_URL')?.value ?? 'https://api.deepseek.com/anthropic'
      : directoryBaseURL(entry, environment));
    return { deepSeekBaseURL: checkedBaseURL(baseURL), deepSeekAPIKey: checkedKey(key), deepSeekModel: active.model };
  };
}

function directoryBaseURL(entry: LlmConfigurableProvider, environment: ReturnType<typeof launchEnvironmentOf>): string | undefined {
  // Some directory env lists are endpoint components (AWS region, Azure resource,
  // Cloudflare IDs), not interchangeable URLs. Do not fabricate their endpoint.
  if (entry.baseURLEnv?.length) {
    if (entry.baseURLEnv.length === 1 && entry.baseURLEnv[0].endsWith('_BASE_URL')) {
      const configured = environment.get(entry.baseURLEnv[0])?.value;
      if (configured !== undefined) return configured;
    } else if (entry.baseURLEnv.some(name => environment.get(name) !== undefined)) {
      throw new Error('Active provider constructs its endpoint from environment components; configure an explicit baseURL for web search');
    }
  }
  return entry.defaultBaseURL;
}
