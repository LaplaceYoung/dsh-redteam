import type { RedTeamStore } from '../store.js';
import { type ChatMentionKind, type ChatMentionRef } from './files-mentions.js';
export interface MentionSearchInput {
    query?: string;
    scope?: ChatMentionKind | 'all';
    cursor?: string;
    taskId?: string;
}
export interface MentionSearchItem {
    id: string;
    kind: ChatMentionKind;
    label: string;
    description: string;
}
/** Read one committed snapshot for each lookup. Mention labels never determine identity. */
export declare class ChatMentionStore {
    private readonly store;
    constructor(store: Pick<RedTeamStore, 'snapshot'>);
    load(ref: ChatMentionRef): Promise<unknown | null>;
    search(input?: MentionSearchInput): {
        items: MentionSearchItem[];
        nextCursor: string | null;
    };
}
