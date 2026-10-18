import net from 'node:net';
import tls from 'node:tls';
import { PermanentNotificationError, notificationTitle, renderNotificationEmail, resolveNotificationHost } from './notifications-channels.js';
class SMTPConversation {
    socket;
    buffer = '';
    replies = [];
    lines = [];
    waiting;
    error;
    constructor(socket) {
        this.socket = socket;
        socket.on('data', this.data);
        socket.on('error', this.fail);
        socket.on('close', this.close);
    }
    data = (chunk) => {
        this.buffer += chunk.toString('utf8');
        let index;
        if (this.buffer.length > 8192) {
            this.fail(new Error('SMTP 响应过长'));
            this.socket.destroy();
            return;
        }
        while ((index = this.buffer.indexOf('\n')) >= 0) {
            const line = this.buffer.slice(0, index).replace(/\r$/, '');
            this.buffer = this.buffer.slice(index + 1);
            this.lines.push(line);
            if (this.buffer.length > 8192 || this.lines.join('').length > 8192) {
                this.fail(new Error('SMTP 响应过长'));
                this.socket.destroy();
                return;
            }
            if (/^\d{3} /.test(line)) {
                const reply = this.lines;
                this.lines = [];
                if (this.waiting) {
                    const wait = this.waiting;
                    this.waiting = undefined;
                    wait.resolve(reply);
                }
                else
                    this.replies.push(reply);
            }
        }
    };
    fail = (error) => { this.error = error; this.waiting?.reject(error); this.waiting = undefined; };
    close = () => this.fail(new Error('SMTP 连接已关闭'));
    detach() { this.socket.off('data', this.data); this.socket.off('error', this.fail); this.socket.off('close', this.close); }
    async expect(codes) {
        const lines = this.replies.shift() ?? await new Promise((resolve, reject) => { if (this.error)
            reject(this.error);
        else
            this.waiting = { resolve, reject }; });
        const code = Number(lines.at(-1).slice(0, 3));
        if (!codes.includes(code)) {
            const message = `SMTP 返回 ${code}`;
            if (code >= 500)
                throw new PermanentNotificationError(message);
            throw new Error(message);
        }
        return lines;
    }
    async command(command, codes) { this.socket.write(command + '\r\n'); return this.expect(codes); }
}
const field = (cfg, name) => typeof cfg[name] === 'string' ? cfg[name].trim() : '';
export async function sendSMTP(cfg, message, options) {
    const host = field(cfg, 'host'), port = Number(cfg.port), from = field(cfg, 'from');
    const recipients = (Array.isArray(cfg.to) ? cfg.to : [cfg.to]).filter((v) => typeof v === 'string').map(v => v.trim()).filter(Boolean);
    for (const value of [host, from, ...recipients])
        if (/[\r\n]/.test(value))
            throw new PermanentNotificationError('邮件地址不允许换行');
    const address = await resolveNotificationHost(host, options);
    const implicitTLS = cfg.tls === true || /^(1|true|yes)$/i.test(String(cfg.tls));
    const signal = AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(30_000)]);
    let socket = implicitTLS ? tls.connect({ host: address.address, port, servername: host, minVersion: 'TLSv1.2' }) : net.connect({ host: address.address, port });
    const cancel = () => socket.destroy(new Error('SMTP 已取消或超时'));
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted)
        cancel();
    let conversation = new SMTPConversation(socket);
    try {
        await conversation.expect([220]);
        let hello = await conversation.command('EHLO localhost', [250]);
        let encrypted = implicitTLS;
        if (!encrypted && hello.some(line => /STARTTLS/i.test(line))) {
            await conversation.command('STARTTLS', [220]);
            conversation.detach();
            socket = tls.connect({ socket, servername: host, minVersion: 'TLSv1.2' });
            conversation = new SMTPConversation(socket);
            hello = await conversation.command('EHLO localhost', [250]);
            encrypted = true;
        }
        const username = field(cfg, 'username');
        if (username) {
            if (!encrypted && !['localhost', '127.0.0.1', '::1'].includes(host))
                throw new PermanentNotificationError('拒发凭据：SMTP 连接未加密');
            const credentials = Buffer.from(`\0${username}\0${field(cfg, 'password')}`).toString('base64');
            const reply = await conversation.command(`AUTH PLAIN ${credentials}`, [235, 334]);
            if (reply.at(-1).startsWith('334'))
                await conversation.command(credentials, [235]);
        }
        await conversation.command(`MAIL FROM:<${from}>`, [250]);
        for (const recipient of recipients)
            await conversation.command(`RCPT TO:<${recipient}>`, [250, 251]);
        await conversation.command('DATA', [354]);
        const body = renderNotificationEmail(message);
        const encoded = Buffer.from(body).toString('base64').match(/.{1,76}/g).join('\r\n');
        const mail = [`From: ${from}`, `To: ${recipients.join(', ')}`, `Date: ${(options.now ?? new Date()).toUTCString()}`, `Subject: =?UTF-8?B?${Buffer.from(notificationTitle(message)).toString('base64')}?=`, 'MIME-Version: 1.0', 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', encoded].join('\r\n');
        await conversation.command(mail + '\r\n.', [250]);
        // The DATA acknowledgement is the delivery boundary; a QUIT failure cannot undo it.
        try {
            await conversation.command('QUIT', [221]);
        }
        catch { /* Server already accepted DATA. */ }
        return message.items.length;
    }
    finally {
        signal.removeEventListener('abort', cancel);
        socket.end();
    }
}
