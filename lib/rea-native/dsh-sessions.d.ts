import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ReaNativeSession } from '@dsh-redteam/rea-native-session';
export declare class NativeReaSessions {
    private readonly sessions;
    private disposed;
    private disposal?;
    get(agent: Agent | undefined, signal: AbortSignal): Promise<ReaNativeSession>;
    private closeOwned;
    close(agentId: string): Promise<void>;
    dispose(): Promise<void>;
}
