interface Attempt {
    status?: number;
    request: Buffer[];
    response: Buffer[];
    error?: string;
    complete: boolean;
}
export interface WireCapture {
    attempts: Attempt[];
}
export type WireRecord = {
    available: false;
    reason: string;
} | {
    available: true;
    /** Exact body bytes, including SSE framing; base64 preserves non-UTF8 error bodies. */
    attempts: {
        status?: number;
        requestBase64: string;
        responseBase64: string;
        requestText: string;
        responseText: string;
        error?: string;
        complete: boolean;
    }[];
};
/** Wrap the host's existing official proxy dispatcher; never close its connections. */
export declare function installWireCapture(): () => void;
/** Bind iterator execution, not just iterator construction, to the call identity. */
export declare function observeWire<T>(capture: WireCapture | undefined, source: AsyncIterable<T>): AsyncGenerator<T>;
export declare function wireRecord(capture: WireCapture): WireRecord;
export {};
