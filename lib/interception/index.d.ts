import type { Context } from '@deepseek-ai/cordis';
import type { RedTeamStore } from '../store.js';
import { InterceptionRuntime, type InterceptionOptions } from './runtime.js';
export { InterceptionRuntime, type InterceptionOptions } from './runtime.js';
export { InterceptionRepository } from './repository.js';
export * from './model.js';
export { installInterceptionHttp } from './http.js';
export { InterceptionArchive, withInterceptionArchive } from './archive.js';
/** Install once in each Agent scope after tools/llm/approval services are available. */
export declare function installInterception(ctx: Context, store: RedTeamStore, options?: InterceptionOptions): InterceptionRuntime;
