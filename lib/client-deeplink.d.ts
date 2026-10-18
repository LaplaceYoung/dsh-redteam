import type { BetterSidebarService } from 'dsh-better-sidebar/client/service';
export interface FindingNavigation {
    findingId: string;
    revision: number;
}
export declare const readFindingNavigation: () => FindingNavigation;
export declare function subscribeFindingNavigation(listener: () => void): () => void;
/** DSH may not have an active session when plugins load. Keep the landing pending
 * until BetterSidebar announces a session, then let its public open API reveal it. */
export declare function installFindingDeepLink(sidebar: Pick<BetterSidebarService, 'openTab' | 'getSnapshot' | 'subscribeState'>): () => void;
