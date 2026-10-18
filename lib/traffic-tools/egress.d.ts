export declare function validateProxyUrl(raw: string): string;
/** A loopback forward proxy gives mitmproxy one stable upstream while the
 * selected ARTEX egress can change per connection, including SOCKS5. */
export declare class TrafficEgress {
    private readonly upstream;
    private server?;
    private sockets;
    constructor(upstream: () => string);
    start(): Promise<string>;
    close(): Promise<void>;
    private track;
    private dial;
}
