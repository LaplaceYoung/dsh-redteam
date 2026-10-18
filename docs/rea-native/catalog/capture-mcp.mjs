import { spawn } from 'node:child_process';
import { readFile, writeFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';

// Read-only catalog capture. Only initialize and tools/list are sent; no analysis
// target is opened and no REA setup/configuration command is invoked.
if (!process.argv[2]) throw new Error('Usage: node capture-mcp.mjs <installed REA package root>');
const root = await realpath(process.argv[2]);
const child = spawn(process.execPath, [join(root, 'scripts/rea.mjs'), 'mcp'], { stdio: ['pipe', 'pipe', 'pipe'] });
let buffer = '';
let stderr = '';
let nextId = 1;
const pending = new Map();
const timer = setTimeout(() => { child.kill(); throw new Error('MCP catalog capture timed out after 60 seconds'); }, 60_000);
child.stderr.setEncoding('utf8').on('data', text => { stderr += text; });
child.stdout.setEncoding('utf8').on('data', text => {
  buffer += text;
  for (;;) {
    const end = buffer.indexOf('\n');
    if (end < 0) break;
    const line = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    const handler = pending.get(message.id);
    if (handler) { pending.delete(message.id); message.error ? handler.reject(new Error(JSON.stringify(message.error))) : handler.resolve(message.result); }
  }
});
child.on('error', error => { for (const handler of pending.values()) handler.reject(error); });
child.on('exit', code => { for (const handler of pending.values()) handler.reject(new Error(`MCP exited ${code}: ${stderr}`)); });
function request(method, params) {
  const id = nextId++;
  const promise = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  return promise;
}
try {
  const initialization = await request('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'dsh-rea-catalog-audit', version: '1.0.0' } });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const tools = [];
  let cursor;
  do {
    const page = await request('tools/list', cursor ? { cursor } : {});
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor);
  await writeFile(new URL('mcp-tools.json', import.meta.url), JSON.stringify({ upstream: { package: 'rea-agents', version: JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version, root, capturedAt: new Date().toISOString() }, initialization, tools }, null, 2) + '\n');
  console.log(JSON.stringify({ count: tools.length, uniqueNames: new Set(tools.map(tool => tool.name)).size, root }));
} finally { clearTimeout(timer); child.stdin.end(); child.kill(); }
