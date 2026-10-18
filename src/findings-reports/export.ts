import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { verifyBody } from './evidence.js';
import { FindingsError, type TrafficBinding } from './types.js';

export interface FindingView {
  id: string; taskId?: string; taskDescription?: string; name?: string; vulnClass: string;
  severity: string; summary: string; status: string; createdAt: string; evidence?: unknown;
  report?: string; evidenceVersion?: number; reportEvidenceVersion?: number; trafficBindings?: TrafficBinding[];
}
export interface TaskReportInput {
  title: string; goal: string; generatedAt: Date; assetCounts: Record<string, number>; findings: FindingView[];
}
export type FindingExportFormat = 'md-single' | 'md-zip' | 'csv' | 'json';
export interface FindingExport { filename: string; contentType: string; data: Buffer; sha256: string }

const severities = ['critical', 'high', 'medium', 'low', 'info'];
const rank = (severity: string) => { const index = severities.indexOf(severity); return index < 0 ? severities.length : index; };
const title = (finding: FindingView) => finding.name?.trim() || finding.vulnClass.trim() || '未分类';
const timestamp = (value: Date | string) => new Date(value).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
const sorted = (findings: FindingView[]) => [...findings].sort((a, b) => rank(a.severity) - rank(b.severity) || Date.parse(b.createdAt) - Date.parse(a.createdAt));
function evidenceText(value: unknown): string {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value.trim() : JSON.stringify(value, null, 2);
}
function fenced(value: string): string {
  const longest = Math.max(2, ...[...value.matchAll(/`+/g)].map(match => match[0].length));
  const fence = '`'.repeat(longest + 1);
  return `${fence}\n${value}\n${fence}`;
}
function pathSegment(id: string): string {
  if (!id) throw new FindingsError('invalid', 'evidence identifier must not be empty');
  return encodeURIComponent(id).replace(/\./g, '%2E');
}
function evidencePrefix(findingId: string, bindingId: string): string { return `evidence/${pathSegment(findingId)}/${pathSegment(bindingId)}/`; }
function trafficMarkdown(finding: FindingView, attachments: boolean): string {
  const bindings = finding.trafficBindings ?? [];
  const stale = Boolean(finding.report) && (finding.evidenceVersion ?? 0) !== (finding.reportEvidenceVersion ?? 0);
  if (!bindings.length && !stale) return '';
  let out = `\n## 关联流量证据\n\n证据版本：${finding.evidenceVersion ?? 0}；绑定数量：${bindings.length}。\n\n`;
  if (stale) out += '证据已变更，详细报告待更新。\n\n';
  bindings.forEach((binding, index) => {
    out += `${index + 1}. **证据 #${binding.id} · ${binding.role}** — \`${binding.snapshot.method} ${binding.snapshot.url.replace(/`/g, '%60')}\`，状态码 ${binding.snapshot.status ?? '未知'}\n`;
    if (binding.note) out += `   ${binding.note.replace(/\n/g, '\n   ')}\n`;
    if (attachments) {
      const prefix = evidencePrefix(finding.id, binding.id);
      out += `   [请求报文](${prefix}request.http) · [响应报文](${prefix}response.http)\n`;
    }
  });
  return `${out}\n`;
}
function metadata(finding: FindingView): string {
  let out = finding.vulnClass ? `- **类别**：${finding.vulnClass}\n` : '';
  out += `- **状态**：${finding.status || 'pending'}\n`;
  if (finding.taskDescription?.trim()) out += `- **所属任务**：${finding.taskDescription}\n`;
  return `${out}- **发现时间**：${timestamp(finding.createdAt)}\n`;
}

/** Pure rendering from persisted findings; does not claim to perform model generation. */
export function renderTaskReport(input: TaskReportInput): string {
  let out = `# 渗透测试报告 — ${input.title.trim() || '未命名任务'}\n\n- **任务目标**：${input.goal.trim() || '（未指定）'}\n- **生成时间**：${timestamp(input.generatedAt)}\n\n## 摘要\n\n- 确认发现：**${input.findings.length}** 个\n- 资产：`;
  out += Object.keys(input.assetCounts).sort().map(kind => `${kind} ${input.assetCounts[kind]}`).join('、');
  out += '\n\n## 发现\n\n';
  if (!input.findings.length) return `${out}_本次未确认漏洞。_\n\n`;
  [...input.findings].sort((a, b) => rank(a.severity) - rank(b.severity)).forEach((finding, index) => {
    out += `### ${index + 1}. [${(finding.severity || 'info').toUpperCase()}] ${title(finding)}\n\n${finding.summary}\n\n`;
    const evidence = finding.evidence;
    const poc = evidence && typeof evidence === 'object' && 'poc' in evidence && typeof evidence.poc === 'string' ? evidence.poc : evidenceText(evidence);
    if (poc) out += `**PoC / 证据：**\n\n${fenced(poc)}\n\n`;
  });
  return out;
}

export function renderFindingsMarkdown(findings: FindingView[], generatedAt = new Date()): string {
  const items = sorted(findings);
  let out = `# 漏洞发现汇总报告\n\n- **生成时间**：${timestamp(generatedAt)}\n- **发现总数**：${items.length} 个\n\n## 摘要\n\n| 严重等级 | 数量 |\n| --- | --- |\n`;
  ['严重', '高危', '中危', '低危', '信息'].forEach((label, index) => { out += `| ${label} | ${items.filter(f => f.severity === severities[index]).length} |\n`; });
  out += '\n';
  if (!items.length) return `${out}_无匹配的漏洞。_\n`;
  out += '## 漏洞明细\n\n';
  items.forEach((finding, index) => {
    out += `### ${index + 1}. [${(finding.severity || 'info').toUpperCase()}] ${title(finding)}\n\n${metadata(finding)}\n`;
    if (finding.summary.trim()) out += `${finding.summary.trim()}\n\n`;
    const evidence = evidenceText(finding.evidence);
    if (evidence) out += `**证据：**\n\n${fenced(evidence)}\n\n`;
    if (finding.report?.trim()) out += `**详细报告：**\n\n${finding.report.trim()}\n\n`;
    out += `${trafficMarkdown(finding, false)}---\n\n`;
  });
  return out;
}

export function renderSingleFindingMarkdown(finding: FindingView, generatedAt = new Date(), attachments = false): string {
  let out = `# [${(finding.severity || 'info').toUpperCase()}] ${title(finding)}\n\n- **严重等级**：${finding.severity || 'info'}\n${metadata(finding)}- **生成时间**：${timestamp(generatedAt)}\n\n`;
  if (finding.summary.trim()) out += `## 概述\n\n${finding.summary.trim()}\n\n`;
  const evidence = evidenceText(finding.evidence);
  if (evidence) out += `## 证据\n\n${fenced(evidence)}\n\n`;
  if (finding.report?.trim()) out += `## 详细报告\n\n${finding.report.trim()}\n`;
  return out + trafficMarkdown(finding, attachments);
}

export function findingFilename(finding: FindingView): string {
  const safe = `${finding.severity || 'info'}_${title(finding)}_#${finding.id}`.replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^[._]+|[._]+$/g, '');
  let name = '';
  for (const character of safe) { if (Buffer.byteLength(name + character) > 120) break; name += character; }
  return `${name || 'finding'}.md`;
}
export function renderFindingsCSV(findings: FindingView[]): Buffer {
  const rows: string[][] = [['ID', '名称', '类别', '严重等级', '状态', '所属任务', '发现时间', '概述', '流量证据数量', '流量证据ID']];
  for (const finding of sorted(findings)) rows.push([finding.id, title(finding), finding.vulnClass, finding.severity || 'info', finding.status || 'pending', finding.taskDescription ?? '', timestamp(finding.createdAt), finding.summary.trim(), String(finding.trafficBindings?.length ?? 0), finding.trafficBindings?.map(binding => binding.id).join(',') ?? '']);
  const cell = (value: string) => /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  return Buffer.from(`\uFEFF${rows.map(row => row.map(cell).join(',')).join('\n')}\n`);
}

interface ZipEntry { name: string; data: Buffer }
/** ZIP STORE entries with UTF-8 names, CRC32, a central directory and EOCD (APPNOTE 6.3). */
function zip(entries: ZipEntry[], generatedAt: Date): Buffer {
  if (entries.length > 65535) throw new FindingsError('invalid', 'export exceeds ZIP entry limit');
  const locals: Buffer[] = [], directory: Buffer[] = [], used = new Set<string>();
  const year = Math.max(1980, Math.min(2107, generatedAt.getUTCFullYear()));
  const date = ((year - 1980) << 9) | ((generatedAt.getUTCMonth() + 1) << 5) | generatedAt.getUTCDate();
  const time = (generatedAt.getUTCHours() << 11) | (generatedAt.getUTCMinutes() << 5) | Math.floor(generatedAt.getUTCSeconds() / 2);
  let offset = 0;
  for (const entry of entries) {
    if (used.has(entry.name)) throw new FindingsError('invalid', `duplicate ZIP entry: ${entry.name}`);
    used.add(entry.name);
    const name = Buffer.from(entry.name), checksum = crc32(entry.data);
    if (name.length > 65535 || entry.data.length > 0xffffffff || offset + 30 + name.length + entry.data.length > 0xffffffff) throw new FindingsError('invalid', 'export exceeds ZIP32 size limit');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12); local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(entry.data.length, 18); local.writeUInt32LE(entry.data.length, 22); local.writeUInt16LE(name.length, 26);
    locals.push(local, name, entry.data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(time, 12); central.writeUInt16LE(date, 14); central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(entry.data.length, 20); central.writeUInt32LE(entry.data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    directory.push(central, name); offset += local.length + name.length + entry.data.length;
  }
  const centralSize = directory.reduce((length, part) => length + part.length, 0);
  if (offset + centralSize > 0xffffffff) throw new FindingsError('invalid', 'export exceeds ZIP32 size limit');
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...directory, end]);
}

export function exportFindings(findings: FindingView[], format: FindingExportFormat, generatedAt = new Date()): FindingExport {
  let data: Buffer, contentType: string, extension: string;
  switch (format) {
    case 'md-single': data = Buffer.from(renderFindingsMarkdown(findings, generatedAt)); contentType = 'text/markdown; charset=utf-8'; extension = 'md'; break;
    case 'csv': data = renderFindingsCSV(findings); contentType = 'text/csv; charset=utf-8'; extension = 'csv'; break;
    case 'json': {
      // ARTEX strips request/response heads and omits body bytes in the public DTO.
      // Pick the public view explicitly: runtime FindingRecords also hold retest snapshots
      // with original HTTP messages, which must not leak through object spreads.
      const rows = findings.map(finding => ({
        id: finding.id, taskId: finding.taskId, taskDescription: finding.taskDescription,
        name: finding.name, vulnClass: finding.vulnClass, severity: finding.severity,
        summary: finding.summary, status: finding.status, createdAt: finding.createdAt,
        evidence: finding.evidence, report: finding.report,
        evidenceVersion: finding.evidenceVersion, reportEvidenceVersion: finding.reportEvidenceVersion,
        trafficBindings: finding.trafficBindings?.map(binding => ({
          id: binding.id, role: binding.role, note: binding.note, position: binding.position, createdAt: binding.createdAt,
          snapshot: {
            id: binding.snapshot.id, sourceTrafficId: binding.snapshot.sourceTrafficId,
            url: binding.snapshot.url, method: binding.snapshot.method, status: binding.snapshot.status,
            capturedAt: binding.snapshot.capturedAt, createdAt: binding.snapshot.createdAt,
            request: { sha256: binding.snapshot.request.sha256, length: binding.snapshot.request.length },
            response: { sha256: binding.snapshot.response.sha256, length: binding.snapshot.response.length },
          },
        })),
      }));
      data = Buffer.from(`${JSON.stringify(rows, null, 2)}\n`); contentType = 'application/json; charset=utf-8'; extension = 'json'; break;
    }
    case 'md-zip': {
      const entries: ZipEntry[] = [], used = new Set<string>();
      for (const finding of findings) {
        const base = findingFilename(finding); let name = base, suffix = 2;
        while (used.has(name)) name = `${base.slice(0, -3)}-${suffix++}.md`;
        used.add(name); entries.push({ name, data: Buffer.from(renderSingleFindingMarkdown(finding, generatedAt, true)) });
        for (const binding of finding.trafficBindings ?? []) {
          const prefix = evidencePrefix(finding.id, binding.id);
          entries.push({ name: `${prefix}manifest.json`, data: Buffer.from(`${JSON.stringify(binding, null, 2)}\n`) });
          for (const side of ['request', 'response'] as const) {
            const body = verifyBody(binding.snapshot[side]);
            const head = Buffer.from(`${binding.snapshot[side].head.replace(/[\r\n]+$/, '')}\n\n`);
            entries.push({ name: `${prefix}${side}.http`, data: Buffer.concat([head, body]) }, { name: `${prefix}${side}.bin`, data: body });
          }
        }
      }
      data = zip(entries, generatedAt); contentType = 'application/zip'; extension = 'zip'; break;
    }
    default: throw new FindingsError('invalid', `bad export format: ${String(format)}`);
  }
  const stamp = generatedAt.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
  return { filename: `findings-${stamp}.${extension}`, contentType, data, sha256: createHash('sha256').update(data).digest('hex') };
}
