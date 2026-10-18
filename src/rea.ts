import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import type { ReaRunResult } from './types.js';
import type { RedTeamStore } from './store.js';

interface ReaConfig { command?: string }

export class ReaRuntime {
  constructor(private readonly store: RedTeamStore, private readonly config: ReaConfig = {}) {}

  async analyze(taskId: string, target: string, provider?: string): Promise<ReaRunResult> {
    const command = this.config.command ?? process.env.REA_COMMAND ?? 'rea';
    const args = ['analyze', target, '--format', 'json', '--full-output'];
    if (provider) args.push('--provider', provider);
    return this.run(taskId, args, target, command);
  }

  async run(taskId: string, args: string[], target?: string, command = this.config.command ?? process.env.REA_COMMAND ?? 'rea'): Promise<ReaRunResult> {
    const rawText = await this.execute(command, args);
    let raw: unknown;
    try { raw = JSON.parse(rawText); } catch { raw = { text: rawText }; }
    const summary = summarize(raw);
    const evidence = await this.store.addEvidence({ taskId, provider: 'rea', command: [command, ...args].join(' '), target, summary, raw });
    return { evidenceId: evidence.id, provider: 'rea', command: evidence.command!, target: target ?? '', summary, raw };
  }

  async manifest(): Promise<unknown> {
    const command = this.config.command ?? process.env.REA_COMMAND ?? 'rea';
    return JSON.parse(await this.execute(command, ['--llms', '--format', 'json']));
  }

  private execute(command: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const resolved = process.platform === 'win32' ? resolveWindowsCommand(command) : command;
      const isPowerShell = process.platform === 'win32' && resolved.toLowerCase().endsWith('.ps1');
      const isCmd = process.platform === 'win32' && resolved.toLowerCase().endsWith('.cmd');
      const executable = isPowerShell ? 'powershell.exe' : isCmd ? (process.env.ComSpec ?? 'cmd.exe') : resolved;
      const spawnArgs = isPowerShell ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolved, ...args] : isCmd ? ['/d', '/s', '/c', [quoteWindowsArg(resolved), ...args.map(quoteWindowsArg)].join(' ')] : args;
      const child = spawn(executable, spawnArgs, { windowsHide: true });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      child.once('error', reject);
      child.once('close', (code) => code === 0 ? resolve(stdout) : reject(new Error(`REA exited with ${code}: ${stderr.trim() || stdout.trim()}`)));
    });
  }
}

function quoteWindowsArg(value: string): string {
  return /[\s"]/.test(value) ? `"${value.replace(/(["%])/g, '^$1')}"` : value;
}

function resolveWindowsCommand(command: string): string {
  if (command.includes('\\') || command.includes('/')) return command;
  try {
    const candidates = execFileSync('where.exe', [command], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/).filter(Boolean);
    return candidates.find((value) => value.toLowerCase().endsWith('.ps1')) ?? candidates.find((value) => value.toLowerCase().endsWith('.cmd')) ?? candidates.find((value) => value.toLowerCase().endsWith('.exe')) ?? candidates[0] ?? command;
  } catch { return command; }
}

function summarize(value: unknown): string {
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['summary', 'title', 'overview', 'name']) if (typeof record[key] === 'string') return record[key] as string;
  }
  return 'REA analysis completed';
}
