import { createServer, request, type Server } from 'node:http';
import { connect, type Socket } from 'node:net';
import { connect as connectTls } from 'node:tls';
import { once } from 'node:events';

export function validateProxyUrl(raw: string): string {
  if (!raw.trim()) return '';
  const url = new URL(raw.trim());
  if (!['http:', 'https:', 'socks5:'].includes(url.protocol) || !url.hostname) throw new Error('proxy requires http://, https:// or socks5:// and a host');
  return url.href;
}

/** A loopback forward proxy gives mitmproxy one stable upstream while the
 * selected ARTEX egress can change per connection, including SOCKS5. */
export class TrafficEgress {
  private server?: Server;
  private sockets = new Set<Socket>();
  constructor(private readonly upstream: () => string) {}

  async start(): Promise<string> {
    const server = createServer((incoming, outgoing) => {
      void (async () => {
        const target = new URL(incoming.url!);
        if (target.protocol !== 'http:') throw new Error('forward requests require an HTTP URL');
        const socket = await this.dial(target.hostname, Number(target.port || 80));
        const headers = { ...incoming.headers };
        delete headers['proxy-authorization']; delete headers['proxy-connection'];
        const forwarded = request({ hostname: target.hostname, port: target.port || 80, path: target.pathname + target.search, method: incoming.method, headers, createConnection: () => socket }, response => {
          outgoing.writeHead(response.statusCode!, response.rawHeaders);
          response.pipe(outgoing);
        });
        forwarded.once('socket', () => socket.resume());
        forwarded.on('error', error => { if (!outgoing.headersSent) outgoing.writeHead(502); outgoing.end(error.message); });
        incoming.on('aborted', () => forwarded.destroy());
        outgoing.on('close', () => { if (!outgoing.writableFinished) forwarded.destroy(); });
        incoming.pipe(forwarded);
      })().catch(error => { outgoing.writeHead(502); outgoing.end(String(error)); });
    });
    server.on('connect', (incoming, client, head) => {
      void (async () => {
        const target = new URL(`http://${incoming.url}`);
        const remote = await this.dial(target.hostname, Number(target.port || 443));
        if (client.destroyed) { remote.destroy(); return; }
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) remote.write(head);
        remote.pipe(client); client.pipe(remote);
        client.on('error', () => remote.destroy()); remote.on('error', () => client.destroy());
        client.on('close', () => remote.destroy()); remote.on('close', () => { if (!remote.readableEnded) client.destroy(); });
      })().catch(() => client.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n'));
    });
    server.on('upgrade', (incoming, client, head) => {
      void (async () => {
        const target = new URL(incoming.url!);
        if (!['http:', 'ws:'].includes(target.protocol)) throw new Error('upgrade requires HTTP or WS');
        const remote = await this.dial(target.hostname, Number(target.port || 80));
        if (client.destroyed) { remote.destroy(); return; }
        const headers: string[] = [];
        for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
          const name = incoming.rawHeaders[index]!;
          if (!['proxy-authorization', 'proxy-connection'].includes(name.toLowerCase())) headers.push(`${name}: ${incoming.rawHeaders[index + 1]}`);
        }
        remote.write(`${incoming.method} ${target.pathname + target.search} HTTP/${incoming.httpVersion}\r\n${headers.join('\r\n')}\r\n\r\n`);
        if (head.length) remote.write(head);
        remote.pipe(client); client.pipe(remote);
        client.on('error', () => remote.destroy()); remote.on('error', () => client.destroy());
        client.on('close', () => remote.destroy()); remote.on('close', () => { if (!remote.readableEnded) client.destroy(); });
      })().catch(() => client.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n'));
    });
    server.on('connection', socket => this.track(socket));
    this.server = server;
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('egress proxy has no TCP address');
    return `http://127.0.0.1:${address.port}`;
  }

  async close(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = undefined;
    for (const socket of this.sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }

  private track(socket: Socket): Socket {
    this.sockets.add(socket);
    socket.once('close', () => this.sockets.delete(socket));
    // Individual request paths own error reporting; disposal can also abort dials.
    socket.on('error', () => {});
    return socket;
  }

  private async dial(host: string, port: number): Promise<Socket> {
    host = host.replace(/^\[|\]$/g, '');
    const raw = this.upstream();
    const upstream = raw ? new URL(raw) : undefined;
    const proxyHost = upstream?.hostname.replace(/^\[|\]$/g, '');
    const socket = this.track(upstream?.protocol === 'https:'
      ? connectTls({ host: proxyHost!, port: Number(upstream.port || 443), servername: proxyHost })
      : connect({ host: proxyHost ?? host, port: upstream ? Number(upstream.port || (upstream.protocol === 'socks5:' ? 1080 : 80)) : port }));
    const timeout = setTimeout(() => socket.destroy(new Error('egress connection timed out')), 30_000);
    try {
      await once(socket, upstream?.protocol === 'https:' ? 'secureConnect' : 'connect');
      if (!upstream) return socket;
      const reader = new SocketReader(socket);
      try {
        if (upstream.protocol === 'socks5:') {
          const user = Buffer.from(decodeURIComponent(upstream.username)), password = Buffer.from(decodeURIComponent(upstream.password));
          socket.write(user.length ? Buffer.from([5, 2, 0, 2]) : Buffer.from([5, 1, 0]));
          const choice = await reader.read(2);
          if (choice[0] !== 5 || ![0, 2].includes(choice[1]!)) throw new Error('SOCKS5 authentication rejected');
          if (choice[1] === 2) {
            if (user.length > 255 || password.length > 255) throw new Error('SOCKS5 credentials exceed 255 bytes');
            socket.write(Buffer.concat([Buffer.from([1, user.length]), user, Buffer.from([password.length]), password]));
            const auth = await reader.read(2);
            if (auth[0] !== 1 || auth[1] !== 0) throw new Error('SOCKS5 credentials rejected');
          }
          const name = Buffer.from(host);
          if (name.length > 255) throw new Error('SOCKS5 hostname exceeds 255 bytes');
          socket.write(Buffer.concat([Buffer.from([5, 1, 0, 3, name.length]), name, Buffer.from([port >> 8, port & 255])]));
          const reply = await reader.read(4);
          if (reply[0] !== 5 || reply[1] !== 0) throw new Error(`SOCKS5 connect rejected: ${reply[1]}`);
          const length = reply[3] === 1 ? 4 : reply[3] === 4 ? 16 : reply[3] === 3 ? (await reader.read(1))[0]! : -1;
          if (length < 0) throw new Error('invalid SOCKS5 bound address');
          await reader.read(length + 2);
        } else {
          const authority = `${host.includes(':') ? `[${host}]` : host}:${port}`;
          const auth = upstream.username ? `Proxy-Authorization: Basic ${Buffer.from(`${decodeURIComponent(upstream.username)}:${decodeURIComponent(upstream.password)}`).toString('base64')}\r\n` : '';
          socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n${auth}\r\n`);
          const response = await reader.header();
          if (!/^HTTP\/1\.[01] 200(?: |\r)/.test(response)) throw new Error(`upstream CONNECT failed: ${response.split('\r\n')[0]}`);
        }
      } finally { reader.release(); }
      return socket;
    } catch (error) { socket.destroy(); throw error; }
    finally { clearTimeout(timeout); }
  }
}

/** Read protocol framing without discarding bytes that arrive with the reply. */
class SocketReader {
  private buffer = Buffer.alloc(0);
  private failure?: Error;
  private wake?: () => void;
  private data = (chunk: Buffer) => { this.buffer = Buffer.concat([this.buffer, chunk]); this.wake?.(); };
  private error = (error: Error) => { this.failure = error; this.wake?.(); };
  private close = () => this.error(new Error('upstream closed during handshake'));
  constructor(private socket: Socket) { socket.on('data', this.data); socket.on('error', this.error); socket.on('close', this.close); }
  async read(size: number): Promise<Buffer> {
    while (this.buffer.length < size) {
      if (this.failure) throw this.failure;
      await new Promise<void>(resolve => { this.wake = resolve; });
    }
    const result = this.buffer.subarray(0, size); this.buffer = this.buffer.subarray(size); return result;
  }
  async header(): Promise<string> {
    let output = '';
    while (!output.endsWith('\r\n\r\n')) {
      if (output.length >= 65536) throw new Error('upstream header exceeds 64 KiB');
      output += (await this.read(1)).toString('latin1');
    }
    return output;
  }
  release(): void {
    this.socket.pause();
    this.socket.off('data', this.data); this.socket.off('error', this.error); this.socket.off('close', this.close);
    if (this.buffer.length) this.socket.unshift(this.buffer);
  }
}
