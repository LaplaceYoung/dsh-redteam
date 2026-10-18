export declare const chatMentionKinds: {
    readonly 漏洞: "finding";
    readonly 资产: "asset";
    readonly 企业: "company";
    readonly 接口: "endpoint";
    readonly IP: "ip";
    readonly 应用: "app";
    readonly 域名: "root_domain";
    readonly 子域名: "subdomain";
    readonly 服务: "service";
};
export type ChatMentionKind = typeof chatMentionKinds[keyof typeof chatMentionKinds];
export interface ChatMentionRef {
    kind: ChatMentionKind;
    id: string;
    name: string;
}
export declare function parseChatMentions(message: string): ChatMentionRef[];
export declare function boundChatMentionValue(value: unknown): unknown;
export declare function composeChatMentionMessage(message: string, load: (ref: ChatMentionRef) => Promise<unknown | null>): Promise<string>;
