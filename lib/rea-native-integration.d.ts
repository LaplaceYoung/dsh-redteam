import type { Context } from '@deepseek-ai/cordis';
import type { RedTeamStore } from './store.js';
import { NativeReaSessions } from './rea-native/dsh-sessions.js';
export declare function installNativeRea(ctx: Pick<Context, 'tools' | 'effect' | 'on'>, store: RedTeamStore): NativeReaSessions;
