import { createHmac } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import type { NotificationSnapshot } from './notifications.js';
import { sendSMTP } from './notifications-smtp.js';
import { renderNotificationTemplate } from './notifications-template.js';
export class PermanentNotificationError extends Error {}
export interface NotificationMessage { items: Array<NotificationSnapshot & { detailURL: string }>; batch: boolean; windowMinutes: number; homeURL: string }
export interface NotificationSendOptions { signal?: AbortSignal; allowLocalTargets?: boolean; now?: Date }
export const notificationKinds = ['dingtalk', 'email', 'feishu', 'telegram', 'webhook', 'wecom'] as const;
const secrets: Record<string, string[]> = { dingtalk: ['webhook','secret'], feishu: ['webhook','secret'], wecom: ['webhook'], webhook: ['url','headers'], telegram: ['bot_token'], email: ['password'] };
const destinations: Record<string, string[]> = { dingtalk: ['webhook'], feishu: ['webhook'], wecom: ['webhook'], webhook: ['url'], telegram: ['base_url'], email: ['host','port','tls'] };
export function notificationSecretKeys(kind:string):string[] { return [...(secrets[kind] ?? [])]; }
const str = (c: Record<string,unknown>, k: string) => typeof c[k] === 'string' ? c[k].trim() : '';
export function maskNotificationConfig(kind: string, config: Record<string,unknown>): Record<string,unknown> {
  if (!secrets[kind]) return {};
  return Object.fromEntries(Object.entries(config).map(([k,v]) => [k, secrets[kind].includes(k) ? typeof v === 'string' && v.length > 6 ? `__masked__:…${v.slice(-6)}` : '__masked__' : structuredClone(v)]));
}
export function prepareNotificationConfigUpdate(kind: string, stored: Record<string,unknown>, patch: Record<string,unknown>) {
  if (!secrets[kind]) throw new Error(`渠道类型未注册: ${kind}`);
  const masked = (v: unknown) => typeof v === 'string' && v.startsWith('__masked__');
  for (const k of secrets[kind]) if (typeof patch[k] === 'object' && JSON.stringify(patch[k]).includes('__masked__')) throw new Error(`${k} 不支持嵌套掩码`);
  const changed = destinations[kind].some(k => k in patch && !masked(patch[k]) && String(patch[k] ?? '') !== String(stored[k] ?? ''));
  if (changed) for (const k of secrets[kind]) if (!(k in patch) || masked(patch[k])) throw new Error(`目标地址已变更，请重新填写凭据字段 ${k}`);
  const result = structuredClone(stored);
  for (const [k,v] of Object.entries(patch)) if (!masked(v)) result[k] = v;
  return result;
}
export function localNotificationTargetsAllowed(options: NotificationSendOptions) { return options.allowLocalTargets ?? /^(1|true)$/i.test(process.env.ARTEX_NOTIFY_ALLOW_LOCAL?.trim() ?? ''); }
export function blockedNotificationIP(address: string): boolean {
  let ip = address.toLowerCase();
  if (ip.startsWith('::ffff:')) { const tail = ip.slice(7); if (tail.includes('.')) ip = tail; else { const words = tail.split(':').map(s => parseInt(s,16)); if (words.length === 2) ip = `${words[0] >> 8}.${words[0] & 255}.${words[1] >> 8}.${words[1] & 255}`; } }
  if (isIP(ip) === 4) { const [a,b] = ip.split('.').map(Number); return a === 127 || (a === 169 && b === 254) || a === 0 || a >= 224; }
  if (isIP(ip) === 6) return ip === '::' || ip === '::1' || /^fe[89ab]/.test(ip) || ip.startsWith('ff');
  return true;
}
export async function resolveNotificationHost(host: string, options: NotificationSendOptions): Promise<{ address: string; family: number }> {
  const clean = host.replace(/^\[|\]$/g, '');
  const resolved = isIP(clean) ? { address: clean, family: isIP(clean) } : await lookup(clean);
  if (!localNotificationTargetsAllowed(options) && blockedNotificationIP(resolved.address)) throw new PermanentNotificationError('拒绝投递到本机/链路本地地址；需要时设置 ARTEX_NOTIFY_ALLOW_LOCAL=1');
  return resolved;
}
function targetURL(raw: string): URL {
  let url: URL; try { url = new URL(raw); } catch { throw new PermanentNotificationError('通知地址无法解析'); }
  if (!['http:','https:'].includes(url.protocol)) throw new PermanentNotificationError('通知地址只支持 http/https');
  return url;
}
export function validateNotificationChannel(kind: string, config: Record<string,unknown>): void {
  if (!(kind in secrets)) throw new PermanentNotificationError(`渠道类型未注册: ${kind}`);
  const requireKeys = kind === 'email' ? ['host','from'] : kind === 'telegram' ? ['bot_token','chat_id'] : kind === 'webhook' ? ['url'] : ['webhook'];
  for (const k of requireKeys) if (!str(config,k)) throw new PermanentNotificationError(`缺少 ${k}`);
  if (kind === 'email') {
    const port = Number(config.port); if (!Number.isInteger(port) || port < 1 || port > 65535) throw new PermanentNotificationError('SMTP 端口应为 1-65535');
    if (!(Array.isArray(config.to) ? config.to.some(v => typeof v === 'string' && v.trim()) : str(config,'to'))) throw new PermanentNotificationError('至少需要一个收件人');
  } else targetURL(kind === 'telegram' ? str(config,'base_url') || 'https://api.telegram.org' : str(config, kind === 'webhook' ? 'url' : 'webhook'));
  if (kind === 'webhook' && str(config,'method') && !['GET','POST','PUT','PATCH'].includes(str(config,'method').toUpperCase())) throw new PermanentNotificationError('Webhook 方法应为 GET/POST/PUT/PATCH');
  if (kind === 'webhook' && str(config,'body_template')) renderNotificationTemplate(str(config,'body_template'),{items:[],batch:false,windowMinutes:30,homeURL:''},new Date(0),true);
}
const oneLine = (value: string, limit = 0) => { const text = value.replace(/\s+/g,' ').trim(); const chars = [...text]; return limit > 0 && chars.length > limit ? chars.slice(0,limit-1).join('') + '…' : text; };
const md = (s: string) => oneLine(s).replace(/[\\`*_\[\]()!#>|~]/g,'\\$&');
const html = (s: string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
export const notificationSeverityLabel = (s: string) => ({ critical:'🔴 严重', high:'🟠 高危', medium:'🟡 中危', low:'🔵 低危' }[s] ?? s);
const severity = notificationSeverityLabel;
export const notificationStatusLabel = (s: string) => ({pending:'待处理',in_progress:'处理中',confirmed:'已确认',resolved:'已处理',fixed:'已修复',false_positive:'误报',ignored:'忽略',duplicate:'重复',risk_accepted:'风险接受'}[s] ?? s);
const titleItem = (i: NotificationMessage['items'][number]) => i.name || i.vulnClass || '(未命名漏洞)';
export const notificationTitle = (m: NotificationMessage) => m.batch ? `漏洞汇总 · 共 ${m.items.length} 条` : m.items.length ? `[${severity(m.items[0].severity)}] ${oneLine(titleItem(m.items[0]))}` : '漏洞通知';
function truncate(text: string, max: number, chars = false) {
  const size = (s: string) => chars ? [...s].length : Buffer.byteLength(s);
  if (size(text) <= max) return text;
  let out = ''; for (const c of text) { if (size(out + c + '…') > max) break; out += c; } return out + '…';
}
function assets(i: NotificationMessage['items'][number]) { return i.assets.slice(0,3).join('、') + (i.assets.length > 3 ? ` 等 ${i.assets.length} 个` : ''); }
export function renderNotificationMarkdown(m: NotificationMessage, maxBytes: number): { text: string; kept: number } {
  if (!m.items.length) return { text:'', kept:0 };
  const lines = m.items.map((it,index) => {
    let line = `${m.batch ? `${index+1}. ` : ''}**${severity(it.severity)} · ${md(titleItem(it))}**`;
    if (m.batch) { const extras = [assets(it) ? md(assets(it)) : '',it.summary ? md(oneLine(it.summary,60)) : ''].filter(Boolean); return line + (extras.length ? ` — ${extras.join(' · ')}` : '') + '\n'; }
    if (it.fromStatus || it.toStatus) line += `\n**状态变更**：${md(notificationStatusLabel(it.fromStatus ?? ''))} → ${md(notificationStatusLabel(it.toStatus ?? ''))}`;
    if (it.vulnClass && it.vulnClass !== titleItem(it)) line += `\n**类型**：${md(it.vulnClass)}`;
    if (assets(it)) line += `\n**资产**：${md(assets(it))}`;
    if (it.summary) line += `\n**摘要**：${md(oneLine(it.summary,120))}`;
    if (it.detailURL) line += `\n[查看详情](${it.detailURL})`; return line + '\n';
  });
  if (!m.batch) return { text:truncate(lines[0],maxBytes), kept:1 };
  const footer = m.homeURL ? `\n[在平台中查看全部](${m.homeURL})` : '';
  let used = 0, kept = 0;
  for (const line of lines) { used += Buffer.byteLength(line); if (used > maxBytes-320-Buffer.byteLength(footer) && kept > 0) break; kept++; }
  const distribution = ['critical','high','medium','low'].map(s=>{const count=m.items.slice(0,kept).filter(i=>i.severity===s).length;return count ? `${severity(s)} ${count}` : '';}).filter(Boolean).join(' · ');
  const intro = `**${m.windowMinutes > 0 ? `近 ${m.windowMinutes} 分钟` : ''}新增 ${m.items.length} 个漏洞**${kept < lines.length ? `（本条显示前 ${kept} 条，其余 ${lines.length-kept} 条将在下一条消息继续）` : ''}${distribution ? `\n${distribution}` : ''}\n\n`;
  return { text:truncate(intro + lines.slice(0,kept).join('') + footer,maxBytes), kept };
}
export function renderNotificationTelegram(m:NotificationMessage):{text:string;kept:number} {
  if (!m.items.length) return {text:'',kept:0};
  const htmlCut = (text:string) => { let value=truncate(text,4096,true); const lt=value.lastIndexOf('<');if(lt>=0&&!value.slice(lt).includes('>'))value=value.slice(0,lt);const amp=value.lastIndexOf('&');if(amp>=0&&!value.slice(amp).includes(';'))value=value.slice(0,amp);return value; };
  if (m.batch) {
    const footer=m.homeURL?`\n\n<a href="${html(m.homeURL)}">在平台中查看全部</a>`:'';
    const lines=m.items.map((it,i)=>`${i+1}. ${severity(it.severity)} · ${titleItem(it)}${assets(it)?` — ${assets(it)}`:''}`);
    let used=0,kept=0;for(const line of lines){used += [...line].length;if(used>4096-160-[...footer].length&&kept>0)break;kept++;}
    let title=`漏洞汇总 · 共 ${m.items.length} 条${kept<m.items.length?`（显示前 ${kept} 条，其余 ${m.items.length-kept} 条下一条继续）`:''}`;
    if(m.windowMinutes>0)title=`近 ${m.windowMinutes} 分钟 · ${title}`;
    return {text:htmlCut(`<b>${html(title)}</b>`+lines.slice(0,kept).map(line=>'\n'+html(line)).join('')+footer),kept};
  }
  const it=m.items[0];let text=`<b>${html(notificationTitle(m))}</b>\n`;
  if(it.fromStatus||it.toStatus)text+=`\n<b>状态变更</b>：${html(notificationStatusLabel(it.fromStatus??''))} → ${html(notificationStatusLabel(it.toStatus??''))}`;
  if(it.vulnClass&&it.vulnClass!==titleItem(it))text+=`\n<b>类型</b>：${html(it.vulnClass)}`;
  if(assets(it))text+=`\n<b>资产</b>：${html(assets(it))}`;
  if(it.summary)text+=`\n<b>摘要</b>：${html(oneLine(it.summary,120))}`;
  if(it.detailURL)text+=`\n\n<a href="${html(it.detailURL)}">查看详情</a>`;
  return {text:htmlCut(text),kept:1};
}
function batchIntro(m:NotificationMessage,kept:number):string {
  const distribution=['critical','high','medium','low'].map(s=>{const count=m.items.slice(0,kept).filter(i=>i.severity===s).length;return count?`${severity(s)} ${count}`:'';}).filter(Boolean).join(' · ');
  return `**${m.windowMinutes>0?`近 ${m.windowMinutes} 分钟`:''}新增 ${m.items.length} 个漏洞**${kept<m.items.length?`（本条显示前 ${kept} 条，其余 ${m.items.length-kept} 条将在下一条消息继续）`:''}${distribution?`\n${distribution}`:''}\n\n`;
}
export function renderNotificationFeishu(m:NotificationMessage):{card:Record<string,unknown>;kept:number} {
  const elements:unknown[]=[];let kept=0;
  const div=(content:string)=>({tag:'div',text:{tag:'lark_md',content}});
  const button=(label:string,url:string)=>({tag:'action',actions:[{tag:'button',text:{tag:'lark_md',content:label},url,type:'primary'}]});
  if(m.batch){
    const lines=m.items.map((it,i)=>`**${i+1}. ${severity(it.severity)} · ${md(titleItem(it))}**${assets(it)?` — ${md(assets(it))}`:''}`);
    let used=0;for(const line of lines){used+=Buffer.byteLength(line);if(used>24000-320&&kept>0)break;kept++;}
    elements.push(div(batchIntro(m,kept)),...lines.slice(0,kept).map(div));if(m.homeURL)elements.push(button('在平台中查看全部',m.homeURL));
  }else if(m.items.length){
    kept=1;const it=m.items[0];let text=`**${severity(it.severity)} · ${md(titleItem(it))}**`;
    if(it.fromStatus||it.toStatus)text+=`\n**状态变更**：${md(notificationStatusLabel(it.fromStatus??''))} → ${md(notificationStatusLabel(it.toStatus??''))}`;
    if(it.vulnClass&&it.vulnClass!==titleItem(it))text+=`\n**类型**：${md(it.vulnClass)}`;
    if(assets(it))text+=`\n**资产**：${md(assets(it))}`;
    if(it.summary)text+=`\n**摘要**：${md(oneLine(it.summary,120))}`;
    elements.push(div(text));if(it.detailURL)elements.push(button('查看详情',it.detailURL));
  }
  const header:Record<string,unknown>={title:{tag:'plain_text',content:notificationTitle(m)}};
  if(m.items.length)header.template=({critical:'red',high:'orange',medium:'yellow',low:'blue'}[m.items[0].severity]??'grey');
  return {card:{config:{wide_screen_mode:true},header,elements},kept};
}
export function renderNotificationEmail(m:NotificationMessage):string {
  const color=(s:string)=>({critical:'#d32029',high:'#e8830c',medium:'#d4b106',low:'#1677ff'}[s]??'#8c8c8c');
  let body=`<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;font-size:14px;color:#262626;line-height:1.6;">`;
  if(m.batch){body+=`<h2 style="font-size:16px;margin:0 0 4px;">${m.windowMinutes>0?`近 ${m.windowMinutes} 分钟`:''}新增 ${m.items.length} 个漏洞</h2>`;
    const counts=['critical','high','medium','low'].map(s=>{const n=m.items.filter(i=>i.severity===s).length;return n?`<span style="color:${color(s)};font-weight:600;">${html(severity(s))} ${n}</span>`:'';}).filter(Boolean);
    if(counts.length)body+=`<p style="margin:0 0 12px;">${counts.join(' &middot; ')}</p>`;
  }
  for(const it of m.batch?m.items:m.items.slice(0,1)){
    body+=m.batch?`<div style="border-left:3px solid ${color(it.severity)};padding:4px 0 4px 10px;margin-bottom:8px;">`:`<div style="border-left:4px solid ${color(it.severity)};padding:8px 0 8px 12px;margin-bottom:12px;">`;
    body+=`<div style="font-weight:600;">${html(severity(it.severity))} &middot; ${html(titleItem(it))}</div>`;
    if(m.batch){const extras=[assets(it)?html(assets(it)):'',it.summary?html(oneLine(it.summary,60)):''].filter(Boolean);if(extras.length)body+=`<div style="color:#595959;font-size:13px;">${extras.join(' &middot; ')}</div>`;}
    else {
      if(it.fromStatus||it.toStatus)body+=`<div><b>状态变更</b>：${html(notificationStatusLabel(it.fromStatus??''))} → ${html(notificationStatusLabel(it.toStatus??''))}</div>`;
      if(it.vulnClass&&it.vulnClass!==titleItem(it))body+=`<div><b>类型</b>：${html(it.vulnClass)}</div>`;
      if(assets(it))body+=`<div><b>资产</b>：${html(assets(it))}</div>`;
      if(it.summary)body+=`<div><b>摘要</b>：${html(oneLine(it.summary,120))}</div>`;
      if(it.detailURL)body+=`<div style="margin-top:6px;"><a href="${html(it.detailURL)}" style="color:#1677ff;">查看详情</a></div>`;
    }
    body+='</div>';
  }
  if(m.homeURL)body+=`<p style="margin:16px 0 0;"><a href="${html(m.homeURL)}" style="color:#1677ff;">在平台中查看全部</a></p>`;
  return body+'</div>';
}
async function requestJSON(rawURL: string, method: string, payload: unknown, headers: Record<string,string>, options: NotificationSendOptions, redirects = 0, firstHost?: string): Promise<string> {
  const url = targetURL(rawURL); if (firstHost && url.host !== firstHost) throw new PermanentNotificationError('拒绝跨主机重定向');
  const address = await resolveNotificationHost(url.hostname, options);
  const body = payload === undefined ? undefined : JSON.stringify(payload);
  const signal = AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(15_000)]);
  const result = await new Promise<{status:number; location?:string; body:string}>((resolve,reject) => {
    const req = (url.protocol === 'https:' ? https : http).request(url, { method, headers: { ...(body === undefined ? {} : {'Content-Type':'application/json; charset=utf-8'}), ...headers }, signal,
      lookup: (_name, opts, cb) => { if (typeof opts === 'object' && opts.all) cb(null,[address]); else cb(null,address.address,address.family); } }, response => {
      const chunks: Buffer[] = []; let size = 0;
      response.on('data', (chunk:Buffer) => { if (size < 8192) { const part = chunk.subarray(0,8192-size); chunks.push(part); size += part.length; } });
      response.on('end', () => resolve({ status:response.statusCode ?? 0, location:response.headers.location, body:Buffer.concat(chunks).toString('utf8') }));
      response.on('error',reject);
    });
    req.on('error', e => reject(new Error(`通知请求失败 (${url.host}): ${e.name}`))); if (body !== undefined) req.write(body); req.end();
  });
  if ([301,302,303,307,308].includes(result.status) && result.location) {
    if (redirects >= 4) throw new PermanentNotificationError('重定向次数过多');
    const next = new URL(result.location,url); const asGet = [301,302,303].includes(result.status) && method !== 'GET';
    return requestJSON(next.toString(), asGet ? 'GET' : method, asGet ? undefined : payload,headers,options,redirects+1,firstHost ?? url.host);
  }
  if (result.status >= 200 && result.status < 300) return result.body;
  const message = `通知接收端 HTTP ${result.status}: ${oneLine(result.body,200).replace(/https?:\/\/[^\s"']+/g,'[URL]')}`;
  if (result.status === 408 || result.status === 429 || result.status >= 500) throw new Error(message);
  throw new PermanentNotificationError(message);
}
export async function sendNotification(kind: string, cfg: Record<string,unknown>, m: NotificationMessage, options: NotificationSendOptions = {}): Promise<number> {
  validateNotificationChannel(kind,cfg); if (!m.items.length) throw new PermanentNotificationError('通知消息至少需要一条漏洞');
  if (kind === 'email') return sendSMTP(cfg,m,options);
  const now = options.now ?? new Date(); let url = str(cfg,kind === 'webhook' ? 'url' : 'webhook'); let payload: unknown; let kept = m.items.length;
  let method = 'POST'; const headers: Record<string,string> = {};
  if (kind === 'webhook') {
    method = str(cfg,'method').toUpperCase() || 'POST';
    if (cfg.headers && typeof cfg.headers === 'object' && !Array.isArray(cfg.headers)) for (const [k,v] of Object.entries(cfg.headers)) if (typeof v === 'string') headers[k] = v;
    if (str(cfg,'content_type')) headers['Content-Type'] = str(cfg,'content_type');
    if (method !== 'GET') payload = str(cfg,'body_template') ? JSON.parse(renderNotificationTemplate(str(cfg,'body_template'),m,now)) : { title:notificationTitle(m), batch:m.batch, count:m.items.length, items:m.items.map(i => ({ finding_id:i.findingId,name:i.name,vulnclass:i.vulnClass,severity:i.severity,summary:i.summary,assets:i.assets,detail_url:i.detailURL })) };
  } else if (kind === 'telegram') {
    url = `${(str(cfg,'base_url') || 'https://api.telegram.org').replace(/\/$/,'')}/bot${str(cfg,'bot_token')}/sendMessage`;
    const {text,kept:telegramKept} = renderNotificationTelegram(m); kept=telegramKept;
    payload = { chat_id:str(cfg,'chat_id'), text, parse_mode:'HTML', disable_web_page_preview:false };
  } else {
    const rendered = renderNotificationMarkdown(m,kind === 'wecom' ? 4096 : kind === 'feishu' ? 20000 : 20000); kept = rendered.kept;
    if (kind === 'wecom') payload = {msgtype:'markdown',markdown:{content:rendered.text}};
    else if (kind === 'dingtalk') {
      const secret = str(cfg,'secret'); if (secret) { const endpoint = new URL(url); const timestamp = String(now.getTime()); endpoint.searchParams.set('timestamp',timestamp); endpoint.searchParams.set('sign',createHmac('sha256',secret).update(`${timestamp}\n${secret}`).digest('base64')); url = endpoint.toString(); }
      payload = !m.batch && m.items[0].detailURL ? {msgtype:'actionCard',actionCard:{title:notificationTitle(m),text:rendered.text,btnOrientation:'0',singleTitle:'查看详情',singleURL:m.items[0].detailURL}} : {msgtype:'markdown',markdown:{title:notificationTitle(m),text:rendered.text}};
    } else {
      const timestamp = String(Math.floor(now.getTime()/1000)); const secret = str(cfg,'secret');
      const renderedCard=renderNotificationFeishu(m);kept=renderedCard.kept;
      payload = {msg_type:'interactive',card:renderedCard.card,...(secret ? {timestamp,sign:createHmac('sha256',`${timestamp}\n${secret}`).digest('base64')} : {})};
    }
  }
  const raw = await requestJSON(url,method,payload,headers,options);
  if (kind === 'webhook') return kept;
  let response: Record<string,unknown>; try { response = JSON.parse(raw); } catch { throw new Error(`解析 ${kind} 响应失败`); }
  const code = Number(kind === 'telegram' ? response.error_code ?? 0 : kind === 'feishu' ? response.code || response.StatusCode || 0 : response.errcode ?? 0);
  if (kind === 'telegram' ? response.ok !== true : code !== 0) {
    const error = `通知渠道 ${kind} 返回错误 ${code}`;
    if ((kind === 'wecom' && code === 45009) || (kind === 'telegram' && code === 429)) throw new Error(error);
    throw new PermanentNotificationError(error);
  }
  return kept;
}
