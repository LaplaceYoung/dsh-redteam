import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
export class ReaRuntime {
    store;
    config;
    constructor(store, config = {}) {
        this.store = store;
        this.config = config;
    }
    async analyze(taskId, target, provider) {
        const command = this.config.command ?? process.env.REA_COMMAND ?? 'rea';
        const args = ['analyze', target, '--format', 'json', '--full-output'];
        if (provider)
            args.push('--provider', provider);
        return this.run(taskId, args, target, command);
    }
    async run(taskId, args, target, command = this.config.command ?? process.env.REA_COMMAND ?? 'rea') {
        const rawText = await this.execute(command, args);
        let raw;
        try {
            raw = JSON.parse(rawText);
        }
        catch {
            raw = { text: rawText };
        }
        const summary = summarize(raw);
        const evidence = await this.store.addEvidence({ taskId, provider: 'rea', command: [command, ...args].join(' '), target, summary, raw });
        return { evidenceId: evidence.id, provider: 'rea', command: evidence.command, target: target ?? '', summary, raw };
    }
    async manifest() {
        const command = this.config.command ?? process.env.REA_COMMAND ?? 'rea';
        return JSON.parse(await this.execute(command, ['--llms', '--format', 'json']));
    }
    execute(command, args) {
        return new Promise((resolve, reject) => {
            const resolved = process.platform === 'win32' ? resolveWindowsCommand(command) : command;
            const isPowerShell = process.platform === 'win32' && resolved.toLowerCase().endsWith('.ps1');
            const isCmd = process.platform === 'win32' && resolved.toLowerCase().endsWith('.cmd');
            const executable = isPowerShell ? 'powershell.exe' : isCmd ? (process.env.ComSpec ?? 'cmd.exe') : resolved;
            const spawnArgs = isPowerShell ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolved, ...args] : isCmd ? ['/d', '/s', '/c', [quoteWindowsArg(resolved), ...args.map(quoteWindowsArg)].join(' ')] : args;
            const child = spawn(executable, spawnArgs, { windowsHide: true });
            let stdout = '';
            let stderr = '';
            child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
            child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
            child.once('error', reject);
            child.once('close', (code) => code === 0 ? resolve(stdout) : reject(new Error(`REA exited with ${code}: ${stderr.trim() || stdout.trim()}`)));
        });
    }
}
function quoteWindowsArg(value) {
    return /[\s"]/.test(value) ? `"${value.replace(/(["%])/g, '^$1')}"` : value;
}
function resolveWindowsCommand(command) {
    if (command.includes('\\') || command.includes('/'))
        return command;
    try {
        const candidates = execFileSync('where.exe', [command], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/).filter(Boolean);
        return candidates.find((value) => value.toLowerCase().endsWith('.ps1')) ?? candidates.find((value) => value.toLowerCase().endsWith('.cmd')) ?? candidates.find((value) => value.toLowerCase().endsWith('.exe')) ?? candidates[0] ?? command;
    }
    catch {
        return command;
    }
}
function summarize(value) {
    if (value && typeof value === 'object') {
        const record = value;
        for (const key of ['summary', 'title', 'overview', 'name'])
            if (typeof record[key] === 'string')
                return record[key];
    }
    return 'REA analysis completed';
}
