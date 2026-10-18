import type { Context } from '@deepseek-ai/cordis';
import type { PoolProfileSource } from './model-health.js';
import type { DeepSeekSearchCredentials } from './index.js';
/**
 * DSH 0.2.1-rc.2 adapter contracts, verified from the installed provider sources:
 * llm-deepseek-api-key uses apiKeyEnv on its section root; llm-pi-ai uses
 * providers[route].apiKeyEnv or the llm-pi-ai/route credential record. Namespace
 * IDs can be customized and therefore never determine the record owner.
 * Re-read the registry, live settings and credentials on every operation.
 */
export declare function createDeepSeekCredentialResolver(ctx: Context, profiles: PoolProfileSource): () => Promise<DeepSeekSearchCredentials>;
