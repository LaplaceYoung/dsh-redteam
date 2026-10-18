import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportFindings, renderTaskReport, renderFindingsMarkdown, renderSingleFindingMarkdown, renderFindingsCSV, findingFilename } from '../lib/findings-reports/export.js';

const at = new Date('2026-10-18T01:02:03.000Z');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const body = (head, bytes) => ({ head, bodyBase64: bytes.toString('base64'), length: bytes.length, sha256: hash(bytes) });
const requestBytes = Buffer.from([0, 255, 13, 10, 128]);
const responseBytes = Buffer.from('响应证据');
function finding(patch = {}) {
  return { id: 'f-1', taskId: 't-1', taskDescription: '授权测试', name: '接口注入', vulnClass: 'sqli', severity: 'high', summary: '已验证摘要', status: 'confirmed', createdAt: '2026-10-17T00:00:00.000Z', evidence: { poc: 'original proof' }, report: '原始详细报告', evidenceVersion: 2, reportEvidenceVersion: 1,
    trafficBindings: [{ id: 'b-1', role: 'proof', note: '请求对照\n可复核', position: 0, createdAt: at.toISOString(), snapshot: { id: 'snap-1', sourceTrafficId: 'traffic-1', method: 'POST', url: 'https://example.test/?q=`', status: 200, capturedAt: at.toISOString(), createdAt: at.toISOString(), request: body('POST / HTTP/1.1\r\nHost: example.test\r\n', requestBytes), response: body('HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream', responseBytes) } }], ...patch };
}

test('Markdown exports preserve evidence, reports, stale indication and severity/date order without mutating input', () => {
  const first = finding(), items = [first, finding({ id: 'f-low', severity: 'low' }), finding({ id: 'f-critical', severity: 'critical', name: '严重漏洞' }), finding({ id: 'f-new', name: '近期高危', createdAt: at.toISOString() })];
  const before = structuredClone(items), markdown = renderFindingsMarkdown(items, at);
  assert.ok(markdown.indexOf('严重漏洞') < markdown.indexOf('近期高危'));
  assert.ok(markdown.indexOf('近期高危') < markdown.indexOf('接口注入'));
  assert.match(markdown, /发现总数\*\*：4 个/); assert.match(markdown, /original proof/);
  assert.match(markdown, /原始详细报告/); assert.match(markdown, /证据已变更，详细报告待更新/);
  assert.match(markdown, /https:\/\/example.test\/\?q=%60/); assert.doesNotMatch(markdown, /request.http/);
  assert.deepEqual(items, before);
  assert.match(renderFindingsMarkdown([], at), /无匹配的漏洞/);
  assert.match(renderSingleFindingMarkdown(finding({ evidence: 'text\n```\ninner' }), at), /````\ntext\n```\ninner\n````/);
});

test('CSV contains BOM, correctly escaped multiline text and traffic binding IDs without full evidence', () => {
  const csv = renderFindingsCSV([finding({ name: '名称,"引号"', summary: 'first\nsecond' })]);
  assert.equal(csv.subarray(0, 3).toString('hex'), 'efbbbf');
  assert.match(csv.toString(), /"名称,""引号"""/); assert.match(csv.toString(), /"first\nsecond"/);
  assert.match(csv.toString(), /,1,b-1\n$/); assert.doesNotMatch(csv.toString(), /original proof|原始详细报告/);
});

test('JSON exports structured evidence and binding integrity metadata but omit private HTTP contents', () => {
  const source = finding();
  source.retests = [{ id: 'retest-1', status: 'done', snapshot: { finding: finding(), assets: [], constraints: [] } }];
  source.retests[0].snapshot.finding.trafficBindings[0].snapshot.request.head += '\r\nAuthorization: secret-history-token';
  const before = structuredClone(source), result = exportFindings([source], 'json', at);
  const [row] = JSON.parse(result.data);
  assert.equal(result.filename, 'findings-20261018-010203.json'); assert.equal(result.sha256, hash(result.data));
  assert.deepEqual(row.evidence, { poc: 'original proof' });
  assert.deepEqual(row.trafficBindings[0].snapshot.request, { sha256: hash(requestBytes), length: requestBytes.length });
  assert.equal(row.report, '原始详细报告'); assert.deepEqual(source, before);
  assert.equal('retests' in row, false);
  assert.doesNotMatch(result.data.toString(), /secret-history-token|bodyBase64|POST \/ HTTP\/1.1|retest-1/);
  assert.deepEqual(Object.keys(row).sort(), ['id', 'taskId', 'taskDescription', 'name', 'vulnClass', 'severity', 'summary', 'status', 'createdAt', 'evidence', 'report', 'evidenceVersion', 'reportEvidenceVersion', 'trafficBindings'].sort());
});

test('ZIP is readable by independent bsdtar with exact HTTP and binary attachments and a binding manifest', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'finding-export-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const row = finding(), result = exportFindings([row], 'md-zip', at), path = join(directory, 'export.zip');
  await writeFile(path, result.data);
  const names = execFileSync('tar', ['-tf', path], { encoding: 'utf8' }).trim().split(/\r?\n/);
  assert.equal(names.length, 6); assert.ok(names.includes('evidence/f-1/b-1/request.http'));
  const extract = name => execFileSync('tar', ['-xOf', path, name]);
  assert.deepEqual(extract('evidence/f-1/b-1/request.bin'), requestBytes);
  assert.deepEqual(extract('evidence/f-1/b-1/response.bin'), responseBytes);
  assert.deepEqual(extract('evidence/f-1/b-1/request.http'), Buffer.concat([Buffer.from('POST / HTTP/1.1\r\nHost: example.test\n\n'), requestBytes]));
  assert.deepEqual(JSON.parse(extract('evidence/f-1/b-1/manifest.json')), row.trafficBindings[0]);
  // Windows bsdtar lists names in the console code page; match in the archive instead.
  assert.match(extract('*.md').toString(), /\[请求报文\]\(evidence\/f-1\/b-1\/request.http\)/);
  assert.equal(result.sha256, hash(result.data));
  // The external reader also checks CRCs; corrupt a stored body without updating its CRC.
  const corrupt = Buffer.from(result.data); const position = corrupt.indexOf(requestBytes); assert.ok(position > 0); corrupt[position] ^= 1;
  const corruptPath = join(directory, 'corrupt.zip'); await writeFile(corruptPath, corrupt);
  assert.throws(() => execFileSync('tar', ['-xOf', corruptPath, 'evidence/f-1/b-1/request.http'], { stdio: ['ignore', 'pipe', 'pipe'] }));
});

test('ZIP rejects corrupted evidence and duplicate attachment paths; filenames preserve Unicode and contain no path traversal', async t => {
  const corrupted = finding(); corrupted.trafficBindings[0].snapshot.request.sha256 = '0'.repeat(64);
  assert.throws(() => exportFindings([corrupted], 'md-zip', at), error => error.code === 'integrity');
  const wrongLength = finding(); wrongLength.trafficBindings[0].snapshot.response.length++;
  assert.throws(() => exportFindings([wrongLength], 'md-zip', at), error => error.code === 'integrity');
  assert.throws(() => exportFindings([finding(), finding()], 'md-zip', at), /duplicate ZIP entry/);
  const malicious = finding({ id: '../outside', name: '../../危险\\name\0' }); malicious.trafficBindings[0].id = '..';
  const safeName = findingFilename(malicious); assert.doesNotMatch(safeName, /[\\/\0]/); assert.match(safeName, /危险/);
  assert.ok(Buffer.byteLength(findingFilename(finding({ name: '中文'.repeat(100) }))) <= 123);
  const directory = await mkdtemp(join(tmpdir(), 'finding-safe-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'safe.zip'); await writeFile(path, exportFindings([malicious, finding({ id: 'a', name: 'same', trafficBindings: [] }), finding({ id: 'a', name: 'same', trafficBindings: [] })], 'md-zip', at).data);
  const names = execFileSync('tar', ['-tf', path], { encoding: 'utf8' }).trim().split(/\r?\n/);
  assert.ok(names.some(name => name.endsWith('-2.md'))); assert.ok(names.every(name => !name.split('/').includes('..')));
});

test('task summary renders actual title, goal, asset counts and findings; empty task reports no confirmed vulnerabilities', () => {
  const report = renderTaskReport({ title: '内部任务', goal: '验证接口', generatedAt: at, assetCounts: { ip: 2, endpoint: 4 }, findings: [finding()] });
  assert.match(report, /渗透测试报告 — 内部任务/); assert.match(report, /验证接口/); assert.match(report, /确认发现：\*\*1\*\* 个/);
  assert.match(report, /endpoint 4、ip 2/); assert.match(report, /original proof/);
  assert.match(renderTaskReport({ title: '', goal: '', generatedAt: at, assetCounts: {}, findings: [] }), /本次未确认漏洞/);
  assert.throws(() => exportFindings([], 'unsupported', at), error => error.code === 'invalid');
});
