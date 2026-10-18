import { execFileSync, execFile, spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { mkdir, writeFile, readFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { StringDecoder } from 'node:string_decoder';
import { TrafficEgress, validateProxyUrl } from './traffic-tools/egress.js';
import { incomingTrafficRecord } from './traffic-tools/blobs.js';
const execFileAsync = promisify(execFile);
const diagnosticLimit = 8192;
const ADDON = String.raw `from mitmproxy import http
import json, base64, hashlib, os, tempfile

_passthrough = set()

def tls_clienthello(data):
    target = data.context.server.address
    if data.client_hello.sni in _passthrough or (target and target[0] in _passthrough):
        data.ignore_connection = True

def running():
    print("DSH_TRAFFIC_READY", flush=True)

def _message(message, start):
    value = message.raw_content or b""
    headers = [[k.decode("latin-1"), v.decode("latin-1")] for k, v in message.headers.fields]
    ct = message.headers.get("content-type", "").lower()
    binary = b"\x00" in value[:512] or ct.startswith(("image/", "audio/", "video/", "font/", "application/octet-stream", "application/zip", "application/gzip", "application/x-gzip", "application/x-tar", "application/x-7z-compressed", "application/x-rar", "application/pdf", "application/x-msdownload", "application/vnd.android.package-archive", "application/java-archive", "application/wasm", "application/x-shockwave-flash"))
    result = {"headers": dict(message.headers), "headerFields": headers, "startLine": start, "bodyLength": len(value), "binary": binary}
    if len(value) > 262144:
        digest = hashlib.sha256(value).hexdigest()
        directory = os.environ["DSH_TRAFFIC_INCOMING"]
        os.makedirs(directory, exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix=digest + ".", suffix=".bin", dir=directory)
        try:
            with os.fdopen(fd, "wb") as output:
                output.write(value)
        except:
            os.unlink(temporary)
            raise
        result["bodyFile"] = os.path.basename(temporary)
        result["bodySha256"] = digest
        result["body"] = ("[binary %s, %d bytes, magic=%s]" % (ct or "application/octet-stream", len(value), value[:4].hex())) if binary else value[:8192].decode("utf-8", errors="replace")
    else:
        result["bodyBase64"] = base64.b64encode(value).decode("ascii")
        result["body"] = None if binary else value.decode("utf-8", errors="replace")
    return result

def _record(flow: http.HTTPFlow):
    request = flow.request
    response = flow.response
    row = {
        "host": request.host,
        "method": request.method,
        "url": request.pretty_url,
        "status": response.status_code if response else None,
        "capturedAt": request.timestamp_start,
        "request": _message(request, request.method + " " + request.path + " " + request.http_version),
        "response": _message(response, response.http_version + " " + str(response.status_code) + " " + response.reason) if response else None,
        "error": str(flow.error) if flow.error else None,
    }
    print("DSH_TRAFFIC " + json.dumps(row, ensure_ascii=False, separators=(",", ":")), flush=True)

def response(flow: http.HTTPFlow):
    try:
        _record(flow)
    except Exception as failure:
        print("DSH_TRAFFIC_ERROR " + repr(failure), flush=True)
        raise

def error(flow: http.HTTPFlow):
    if flow.error and any(value in str(flow.error).lower() for value in ("head request", "http2", "http/2", "protocol error", "protocol_error", "malformed")):
        _passthrough.add(flow.request.host)
        print("DSH_TRAFFIC_PASSTHROUGH " + flow.request.host, flush=True)
    response(flow)
`;
export class TrafficRuntime {
    store;
    command;
    capture;
    lastStatus = { running: false };
    operations = Promise.resolve();
    globalProxy = '';
    captureEnabled = false;
    trafficBindingEnabled = false;
    loaded;
    configurationListeners = new Set();
    onConfigurationChange(listener) {
        this.configurationListeners.add(listener);
        return () => { this.configurationListeners.delete(listener); };
    }
    publishConfiguration() { for (const listener of this.configurationListeners)
        listener(); }
    load() {
        return this.loaded ??= (async () => {
            let raw;
            try {
                raw = await readFile(join(dirname(this.store.storagePath), 'traffic-settings.json'), 'utf8');
            }
            catch (error) {
                if (error.code === 'ENOENT')
                    return;
                throw error;
            }
            const settings = JSON.parse(raw);
            if (!settings || typeof settings !== 'object' || !('globalProxy' in settings) || typeof settings.globalProxy !== 'string' || !('captureEnabled' in settings) || typeof settings.captureEnabled !== 'boolean')
                throw new Error('invalid traffic settings');
            this.globalProxy = validateProxyUrl(settings.globalProxy);
            this.captureEnabled = settings.captureEnabled;
            if ('trafficBindingEnabled' in settings) {
                if (typeof settings.trafficBindingEnabled !== 'boolean')
                    throw new Error('invalid traffic binding setting');
                this.trafficBindingEnabled = settings.trafficBindingEnabled;
            }
            this.publishConfiguration();
        })();
    }
    setGlobalProxy(raw) {
        const proxy = validateProxyUrl(raw);
        return this.serialize(async () => { await this.load(); await this.saveSettings(proxy, this.captureEnabled); this.globalProxy = proxy; this.publishConfiguration(); return proxy; });
    }
    setCaptureEnabled(enabled) {
        return this.serialize(async () => { await this.load(); await this.saveSettings(this.globalProxy, enabled); this.captureEnabled = enabled; this.publishConfiguration(); return enabled; });
    }
    setTrafficBindingEnabled(enabled) {
        return this.serialize(async () => { await this.load(); await this.saveSettings(this.globalProxy, this.captureEnabled, enabled); this.trafficBindingEnabled = enabled; this.publishConfiguration(); return enabled; });
    }
    configuration() {
        const url = this.globalProxy ? new URL(this.globalProxy) : undefined;
        if (url?.username)
            url.username = '***';
        if (url?.password)
            url.password = '***';
        return { captureEnabled: this.captureEnabled, globalProxy: url?.href ?? '', trafficBindingEnabled: this.trafficBindingEnabled };
    }
    async saveSettings(globalProxy, captureEnabled, trafficBindingEnabled = this.trafficBindingEnabled) {
        const path = join(dirname(this.store.storagePath), 'traffic-settings.json');
        await mkdir(dirname(path), { recursive: true });
        const temporary = `${path}.${randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify({ globalProxy, captureEnabled, trafficBindingEnabled }), { mode: 0o600 });
        await rename(temporary, path);
    }
    getGlobalProxy() { return this.globalProxy; }
    constructor(store, command = process.env.MITMDUMP_COMMAND ?? 'mitmdump') {
        this.store = store;
        this.command = command;
    }
    start(taskId, port = 8080, binding = {}) {
        return this.serialize(() => this.startCapture(taskId, port, binding.workerSessionId));
    }
    stop() {
        return this.serialize(async () => {
            if (this.capture)
                await this.stopCapture(this.capture);
            if (this.lastStatus.error)
                throw new Error(this.lastStatus.error);
            return this.status();
        });
    }
    status() {
        const run = this.capture;
        return run ? { running: !!run.child && !run.closed, taskId: run.taskId, workerSessionId: run.workerSessionId, port: run.port, pid: run.child?.pid, starting: !run.ready && !run.stopping, stopping: run.stopping, error: run.error?.message, diagnostics: run.diagnostics || undefined, proxyUrl: `http://127.0.0.1:${run.port}`, caCertPath: join(dirname(this.store.storagePath), 'redteam', 'traffic', '_ca', 'mitmproxy-ca-cert.pem') } : { ...this.lastStatus };
    }
    workerEnvironment(taskId, workerSessionId) {
        const status = this.status();
        if (!this.captureEnabled || !status.running || status.starting || status.stopping || status.taskId !== taskId || workerSessionId && status.workerSessionId && workerSessionId !== status.workerSessionId)
            return this.globalProxy ? proxyEnvironment(this.globalProxy) : {};
        const proxy = status.proxyUrl, ca = status.caCertPath;
        return { ...proxyEnvironment(proxy), SSL_CERT_FILE: ca, CURL_CA_BUNDLE: ca, REQUESTS_CA_BUNDLE: ca, GIT_SSL_CAINFO: ca, NODE_EXTRA_CA_CERTS: ca };
    }
    serialize(operation) {
        const result = this.operations.then(operation);
        // Observe failures here; the public caller still receives the original rejection.
        this.operations = result.then(() => undefined, () => undefined);
        return result;
    }
    assertTaskAvailable(taskId) {
        const snapshot = this.store.snapshot();
        if (!snapshot.tasks.some(task => task.id === taskId))
            throw new Error(`task not found: ${taskId}`);
        const archived = snapshot.archives.find(row => row.taskId === taskId && !['failed', 'archive_failed'].includes(row.state));
        if (archived)
            throw new Error(`cannot start traffic for task ${taskId}: archive ${archived.id} is ${archived.state}`);
    }
    async startCapture(taskId, port, workerSessionId) {
        await this.load();
        if (!Number.isInteger(port) || port < 1 || port > 65535)
            throw new Error(`invalid traffic port: ${port}`);
        await this.store.load();
        this.assertTaskAvailable(taskId);
        if (workerSessionId && !this.store.snapshot().intents.some(intent => intent.taskId === taskId && intent.execution?.childSessionId === workerSessionId))
            throw new Error(`worker session is not bound to task ${taskId}: ${workerSessionId}`);
        if (this.capture) {
            if (this.capture.taskId !== taskId || this.capture.port !== port || this.capture.workerSessionId !== workerSessionId)
                throw new Error(`traffic capture already active for task ${this.capture.taskId} on port ${this.capture.port}`);
            if (this.capture.error)
                throw this.capture.error;
            if (!this.captureEnabled) {
                await this.saveSettings(this.globalProxy, true);
                this.captureEnabled = true;
                this.publishConfiguration();
            }
            return this.status();
        }
        let complete;
        let acceptReady;
        let rejectReady;
        let closeProcess;
        const run = {
            taskId, workerSessionId, port, incomingRoot: join(dirname(this.store.storagePath), 'redteam', 'traffic', '_incoming', randomUUID()), lineBuffer: '', decoder: new StringDecoder('utf8'), writes: Promise.resolve(), ready: false, stopping: false, closed: false, diagnostics: '',
            completion: new Promise(resolve => { complete = resolve; }), complete: () => complete(),
            processClosed: new Promise(resolve => { closeProcess = resolve; }), closeProcess: () => closeProcess(),
            readiness: new Promise((resolve, reject) => { acceptReady = resolve; rejectReady = reject; }), acceptReady: () => acceptReady(), rejectReady: error => rejectReady(error),
        };
        // Preparation failures may occur before awaiting readiness.
        void run.readiness.catch(() => { });
        this.capture = run;
        this.lastStatus = { running: false };
        let readyTimer;
        try {
            const dir = join(dirname(this.store.storagePath), 'redteam', 'traffic');
            await mkdir(dir, { recursive: true });
            const addonPath = join(dir, 'redteam-traffic-addon.py');
            await writeFile(addonPath, ADDON, 'utf8');
            // Archiving may have begun while the addon file was being prepared.
            this.assertTaskAvailable(taskId);
            run.egress = new TrafficEgress(() => this.globalProxy);
            const upstream = await run.egress.start();
            const resolved = resolveWindowsCommand(this.command);
            const isCmd = process.platform === 'win32' && resolved.toLowerCase().endsWith('.cmd');
            const executable = isCmd ? (process.env.ComSpec ?? 'cmd.exe') : resolved;
            const commandArgs = ['-p', String(port), '-s', addonPath, '--listen-host', '127.0.0.1', '--mode', `upstream:${upstream}`, '--set', 'block_global=false', '--set', 'ssl_insecure=true', '--set', `confdir=${join(dir, '_ca')}`];
            const args = isCmd ? ['/d', '/s', '/c', `"${[resolved, ...commandArgs].map(quoteWindowsArg).join(' ')}"`] : commandArgs;
            const child = spawn(executable, args, { windowsHide: true, windowsVerbatimArguments: isCmd, env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1', DSH_TRAFFIC_INCOMING: run.incomingRoot } });
            run.child = child;
            child.stdout.on('data', (chunk) => this.consumeOutput(run, run.decoder.write(chunk)));
            child.stderr.setEncoding('utf8');
            child.stderr.on('data', (chunk) => this.diagnostic(run, chunk));
            child.once('error', error => { this.fail(run, new Error(`traffic process failed: ${error.message}`, { cause: error })); run.rejectReady(run.error); });
            child.once('close', (code, signal) => {
                run.closed = true;
                run.closeProcess();
                this.consumeOutput(run, run.decoder.end(), true);
                if (!run.stopping)
                    this.fail(run, new Error(`traffic process exited ${signal ? `with signal ${signal}` : `with code ${code}`}${run.diagnostics ? `: ${run.diagnostics.trim()}` : ''}`));
                if (!run.ready)
                    run.rejectReady(run.error ?? new Error('traffic process closed before it became ready'));
                void run.writes.then(() => this.finish(run));
            });
            readyTimer = setTimeout(() => run.rejectReady(new Error(`traffic startup timed out on port ${port}${run.diagnostics ? `: ${run.diagnostics.trim()}` : ''}`)), 15_000);
            await run.readiness;
            if (run.error)
                throw run.error;
            await this.saveSettings(this.globalProxy, true);
            this.captureEnabled = true;
            this.publishConfiguration();
            return this.status();
        }
        catch (error) {
            const failure = error instanceof Error ? error : new Error(String(error));
            this.fail(run, failure);
            if (run.child && !run.closed) {
                try {
                    await this.stopCapture(run);
                }
                catch (stopError) {
                    if (!run.closed)
                        throw new AggregateError([failure, stopError], 'traffic startup and cleanup failed');
                }
            }
            else if (run.child)
                await run.completion;
            else
                await this.finish(run);
            throw new Error(`${failure.message}${run.diagnostics && !failure.message.includes(run.diagnostics.trim()) ? `: ${run.diagnostics.trim()}` : ''}`, { cause: failure });
        }
        finally {
            clearTimeout(readyTimer);
        }
    }
    async stopCapture(run) {
        run.stopping = true;
        const child = run.child;
        if (child && !run.closed) {
            let terminationError;
            try {
                if (process.platform === 'win32' && child.pid) {
                    await execFileAsync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10_000 });
                }
                else if (child.pid && child.exitCode === null && child.signalCode === null) {
                    child.kill('SIGTERM');
                }
            }
            catch (error) {
                // taskkill /T can report a vanished descendant before Node has delivered
                // the root process close event. Closure, including drained pipes, is the
                // completion criterion; keep the command failure if closure also fails.
                terminationError = error;
            }
            let closeTimer;
            try {
                await Promise.race([run.processClosed, new Promise((_, reject) => {
                        closeTimer = setTimeout(() => reject(new Error(`traffic process ${child.pid} did not close within 10 seconds`)), 10_000);
                    })]);
            }
            catch (error) {
                const failure = terminationError
                    ? new AggregateError([terminationError, error], `failed to stop traffic process ${child.pid}`)
                    : error instanceof Error ? error : new Error(String(error));
                this.fail(run, failure);
                throw failure;
            }
            finally {
                clearTimeout(closeTimer);
            }
            await run.completion;
        }
        else if (child)
            await run.completion;
        else
            await this.finish(run);
        if (run.error)
            throw run.error;
    }
    async finish(run) {
        try {
            await run.egress?.close();
        }
        catch (error) {
            this.fail(run, new Error(`traffic egress cleanup failed: ${String(error)}`, { cause: error }));
        }
        try {
            await rm(run.incomingRoot, { recursive: true, force: true });
        }
        catch (error) {
            this.fail(run, new Error(`traffic incoming cleanup failed: ${String(error)}`, { cause: error }));
        }
        if (this.capture === run) {
            this.lastStatus = { running: false, ...(run.error ? { taskId: run.taskId, port: run.port, error: run.error.message, diagnostics: run.diagnostics || undefined } : {}) };
            this.capture = undefined;
        }
        run.complete();
    }
    fail(run, error) { run.error ??= error; }
    diagnostic(run, text) { run.diagnostics = (run.diagnostics + text).slice(-diagnosticLimit); }
    consumeOutput(run, chunk, end = false) {
        run.lineBuffer += chunk;
        const lines = run.lineBuffer.split(/\r?\n/);
        run.lineBuffer = end ? '' : lines.pop() ?? '';
        for (const line of lines) {
            if (line === 'DSH_TRAFFIC_READY') {
                run.ready = true;
                run.acceptReady();
                continue;
            }
            if (line.startsWith('DSH_TRAFFIC_ERROR ')) {
                this.fail(run, new Error(`traffic capture failed: ${line.slice('DSH_TRAFFIC_ERROR '.length)}`));
                continue;
            }
            if (!line.startsWith('DSH_TRAFFIC ')) {
                if (line)
                    this.diagnostic(run, `${line}\n`);
                continue;
            }
            try {
                const row = JSON.parse(line.slice('DSH_TRAFFIC '.length));
                if (!row || typeof row !== 'object' || !('host' in row) || typeof row.host !== 'string' || !('method' in row) || typeof row.method !== 'string' || !('url' in row) || typeof row.url !== 'string')
                    throw new Error('expected string host, method and url');
                const value = row;
                if (value.status != null && (typeof value.status !== 'number' || !Number.isInteger(value.status) || value.status < 100 || value.status > 599))
                    throw new Error('invalid HTTP status');
                if (value.capturedAt != null && (typeof value.capturedAt !== 'number' || !Number.isFinite(value.capturedAt)))
                    throw new Error('invalid capture timestamp');
                if (value.error != null && typeof value.error !== 'string')
                    throw new Error('invalid capture error');
                const record = { taskId: run.taskId, workerSessionId: run.workerSessionId, capturedAt: typeof value.capturedAt === 'number' ? new Date(value.capturedAt * 1000).toISOString() : undefined, error: typeof value.error === 'string' ? value.error : undefined, host: value.host, method: value.method, url: value.url, status: value.status == null ? undefined : value.status, request: value.request, response: value.response };
                const incoming = incomingTrafficRecord(record, run.incomingRoot, join(dirname(this.store.storagePath), 'redteam', 'traffic', '_blobs', 'sha256'));
                run.writes = run.writes.then(async () => { await this.store.addTraffic(incoming.record, incoming.prepare); }).catch(error => { this.fail(run, new Error(`failed to persist traffic for task ${run.taskId}: ${String(error)}`, { cause: error })); });
            }
            catch (error) {
                this.fail(run, new Error(`invalid traffic capture record: ${String(error)}`, { cause: error }));
            }
        }
    }
}
function resolveWindowsCommand(command) {
    if (process.platform !== 'win32' || command.includes('\\') || command.includes('/'))
        return command;
    try {
        const candidates = execFileSync('where.exe', [command], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/).filter(Boolean);
        return candidates.find(value => value.toLowerCase().endsWith('.cmd')) ?? candidates.find(value => value.toLowerCase().endsWith('.exe')) ?? candidates[0] ?? command;
    }
    catch {
        return command;
    }
}
function quoteWindowsArg(value) { return /[\s"]/.test(value) ? `"${value.replace(/(["%])/g, '^$1')}"` : value; }
function proxyEnvironment(proxy) {
    return { HTTP_PROXY: proxy, HTTPS_PROXY: proxy, http_proxy: proxy, https_proxy: proxy, ALL_PROXY: proxy, all_proxy: proxy, NODE_USE_ENV_PROXY: '1' };
}
