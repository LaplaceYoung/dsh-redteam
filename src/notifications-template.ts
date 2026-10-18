import { notificationTitle, notificationSeverityLabel, notificationStatusLabel, PermanentNotificationError, type NotificationMessage } from './notifications-channels.js';

type Node = { text: string } | { expr: string; children?: Node[]; otherwise?: Node[] };
// The ARTEX webhook contract uses Go text/template syntax. Parse its data/range/if/with
// constructs instead of evaluating JavaScript from a saved channel configuration.
export function renderNotificationTemplate(template: string, message: NotificationMessage, now = new Date(), validateOnly = false): string {
  const root: Record<string,unknown> = { Title:notificationTitle(message), Batch:message.batch, Count:message.items.length, HomeURL:message.homeURL, SentAt:now.toISOString(),
    Items:message.items.map(i => ({ FindingID:i.findingId, Name:i.name, VulnClass:i.vulnClass, Severity:i.severity, SeverityLabel:notificationSeverityLabel(i.severity), Summary:i.summary, Assets:i.assets, DetailURL:i.detailURL, FromStatus:i.fromStatus ?? '', ToStatus:i.toStatus ?? '', StatusLabel:i.fromStatus || i.toStatus ? `${notificationStatusLabel(i.fromStatus ?? '')} → ${notificationStatusLabel(i.toStatus ?? '')}` : '' })) };
  const tokens = template.replace(/\s+{{-/g,'{{').replace(/-}}\s+/g,'}}').split(/({{[\s\S]*?}})/g).filter(Boolean); let position = 0;
  function parse(nested = false): {nodes:Node[]; stop?:string} {
    const nodes:Node[] = [];
    while (position < tokens.length) {
      const token = tokens[position++]; if (!token.startsWith('{{')) { if (token.includes('{{') || token.includes('}}')) throw new PermanentNotificationError('模板分隔符未闭合'); nodes.push({text:token}); continue; }
      if (!token.endsWith('}}')) throw new PermanentNotificationError('模板分隔符未闭合');
      const expr = token.slice(2,-2).trim();
      if (expr === 'end' || expr === 'else') { if (!nested) throw new PermanentNotificationError('模板 end / else 没有对应块'); return {nodes,stop:expr}; }
      if (expr.startsWith('/*') && expr.endsWith('*/')) continue;
      if (/^(range|if|with)\s/.test(expr)) { const block = parse(true); const node:Node = {expr,children:block.nodes}; if (block.stop === 'else') { const alternate = parse(true); if (alternate.stop !== 'end') throw new PermanentNotificationError('模板缺少 end'); node.otherwise = alternate.nodes; } else if (block.stop !== 'end') throw new PermanentNotificationError('模板缺少 end'); nodes.push(node); }
      else nodes.push({expr});
    }
    return {nodes};
  }
  const nodes = parse().nodes;
  function checkExpressions(list:Node[]):void {for(const node of list)if('expr' in node){words(node.expr);if(node.children)checkExpressions(node.children);if(node.otherwise)checkExpressions(node.otherwise);}}
  checkExpressions(nodes);
  if (validateOnly) return '';
  const truth = (v:unknown) => Array.isArray(v) ? v.length > 0 : Boolean(v);
  function words(expression:string):string[] {
    const result:string[]=[];let start=0,depth=0,quote='',escape=false;
    for(let i=0;i<expression.length;i++){
      const char=expression[i];
      if(quote){if(escape){escape=false;continue;}if(char==='\\'&&quote==='"'){escape=true;continue;}if(char===quote)quote='';continue;}
      if(char==='"'||char==='`'){quote=char;continue;}
      if(char==='(')depth++;else if(char===')'){depth--;if(depth<0)throw new PermanentNotificationError('模板括号不匹配');}
      if(depth===0&&(char==='|'||/\s/.test(char))){if(i>start)result.push(expression.slice(start,i));if(char==='|')result.push('|');start=i+1;}
    }
    if(quote||depth!==0)throw new PermanentNotificationError('模板字符串或括号未闭合');
    if(start<expression.length)result.push(expression.slice(start));return result;
  }
  function property(value:unknown,path:string):unknown {
    let current=value;for(const key of path.split('.').filter(Boolean)){if(!current||typeof current!=='object'||!Object.hasOwn(current,key))throw new PermanentNotificationError(`模板字段不存在: ${key}`);current=(current as Record<string,unknown>)[key];}return current;
  }
  function evaluate(expr:string, dot:unknown, vars:Record<string,unknown>):unknown {
    const parts = words(expr);
    const pipe=parts.indexOf('|');if(pipe>=0){let value=evaluate(parts.slice(0,pipe).join(' '),dot,vars);let next=pipe+1;while(next<parts.length){const end=parts.indexOf('|',next);const chunk=parts.slice(next,end<0?parts.length:end);if(!chunk.length)throw new PermanentNotificationError('模板管道缺少函数');value=call(chunk[0], [...chunk.slice(1).map(p=>evaluate(p,dot,vars)),value]);if(end<0)break;next=end+1;}return value;}
    if (parts.length > 1) return call(parts[0]!,parts.slice(1).map(p => evaluate(p,dot,vars)));
    const token = parts[0] ?? ''; if (token[0] === '"') return JSON.parse(token); if (token[0] === '`') return token.slice(1,-1);
    if(token.startsWith('(')) {let depth=0,end=-1,quote='',escape=false;for(let i=0;i<token.length;i++){const c=token[i];if(quote){if(escape){escape=false;continue;}if(c==='\\'&&quote==='"'){escape=true;continue;}if(c===quote)quote='';continue;}if(c==='"'||c==='`'){quote=c;continue;}if(c==='(')depth++;if(c===')'&&--depth===0){end=i;break;}}if(end<0)throw new PermanentNotificationError('模板括号未闭合');const suffix=token.slice(end+1);if(suffix&&!/^\.[A-Za-z0-9_.]+$/.test(suffix))throw new PermanentNotificationError('模板字段访问语法错误');return property(evaluate(token.slice(1,end),dot,vars),suffix);}
    if (token === 'true') return true; if (token === 'false') return false; if (/^-?\d+(\.\d+)?$/.test(token)) return Number(token);
    if (token === '.') return dot; if (token === '$') return root;
    if (token.startsWith('.') || token.startsWith('$')) { const path=token.split('.');const value=token.startsWith('.')?dot:path[0]==='$'?root:vars[path[0]];return property(value,path.slice(1).join('.')); }
    throw new PermanentNotificationError(`不支持的模板表达式: ${token}`);
  }
  function call(name:string,args:unknown[]):unknown {
    switch (name) {
      case 'json': return JSON.stringify(args[0]);
      case 'jsons': return JSON.stringify(JSON.stringify(args[0])).slice(1,-1);
      case 'printf': {if(typeof args[0]!=='string')throw new PermanentNotificationError('printf 需要格式字符串');let index=1;return args[0].replace(/%([%dsqv])/g,(_all,spec:string)=>{if(spec==='%')return '%';const value=args[index++];if(value===undefined)throw new PermanentNotificationError('printf 参数不足');if(spec==='q')return JSON.stringify(value);if(spec==='d'){if(!Number.isInteger(value))throw new PermanentNotificationError('printf %d 需要整数');return String(value);}return String(value);});}
      case 'len': return Array.isArray(args[0]) || typeof args[0] === 'string' ? args[0].length : Object.keys(args[0] as object).length;
      case 'eq': return args.slice(1).some(v => v === args[0]); case 'ne': return args[0] !== args[1];
      case 'not': return !truth(args[0]); case 'and': return args.every(truth); case 'or': return args.some(truth);
      case 'index': { let v = args[0]; for (const k of args.slice(1)) v = (v as Record<string,unknown>)[String(k)]; return v; }
      default: throw new PermanentNotificationError(`不支持的模板函数: ${name}`);
    }
  }
  function render(list:Node[],dot:unknown,vars:Record<string,unknown>):string {
    return list.map(node => {
      if ('text' in node) return node.text;
      if (node.children) {
        const op = node.expr.slice(0,node.expr.indexOf(' ')); let expr = node.expr.slice(op.length).trim();
        const bindings:string[] = []; const assign = expr.indexOf(':='); if (assign >= 0) { bindings.push(...expr.slice(0,assign).split(',').map(s=>s.trim())); expr = expr.slice(assign+2).trim(); }
        const value = evaluate(expr,dot,vars);
        if (op === 'range') {
          const entries = Array.isArray(value) ? value.map((v,i)=>[i,v] as const) : value && typeof value === 'object' ? Object.entries(value).sort(([a],[b])=>a.localeCompare(b)) : [];
          if (!entries.length) return render(node.otherwise ?? [],dot,vars);
          return entries.map(([key,item]) => { const scope = {...vars}; if (bindings.length === 1) scope[bindings[0]] = item; else if (bindings.length === 2) { scope[bindings[0]] = key; scope[bindings[1]] = item; } return render(node.children!,item,scope); }).join('');
        }
        return truth(value) ? render(node.children,op === 'with' ? value : dot,vars) : render(node.otherwise ?? [],dot,vars);
      }
      const value = evaluate(node.expr,dot,vars); return typeof value === 'string' ? value : String(value);
    }).join('');
  }
  const result = render(nodes,root,{});
  try { JSON.parse(result); } catch { throw new PermanentNotificationError('请求体模板渲染结果不是合法 JSON'); }
  return result;
}
