import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { TrafficRuntime } from '../traffic.js';

/** Settings affect subsequent worker commands and new upstream connections. */
export function installTrafficControls(ctx: Pick<Context, 'tools' | 'effect'>, traffic: TrafficRuntime): void {
  const output = {schema:{type:'json' as const},render:(_args:unknown,value:unknown)=>[{type:'text' as const,text:JSON.stringify(value)}]};
  ctx.effect(()=>ctx.tools.register(defineTool({
    name:'redteam_traffic_settings', description:'Read capture routing and global egress configuration. Proxy credentials are masked.', parameters:{}, output,
    execute:async()=>{await traffic.load();return traffic.configuration();},
  })));
  ctx.effect(()=>ctx.tools.register(defineTool({
    name:'redteam_traffic_set_proxy', description:'Set the global HTTP, HTTPS or SOCKS5 egress proxy (optional URL credentials); empty restores direct connections. Captured connections use this upstream; workers use it directly when capture is off. Applies without restarting capture.',
    parameters:{url:{type:'string',required:true}},output,
    execute:async(args:{url:string})=>{await traffic.setGlobalProxy(args.url);return traffic.configuration();},
  })));
  ctx.effect(()=>ctx.tools.register(defineTool({
    name:'redteam_traffic_set_binding', description:'Set ARTEX agent_traffic_binding: allow agents to attach verified HTTP exchanges to findings. Defaults off, independently of traffic capture. The finding and graph tools read this setting on every operation.',
    parameters:{enabled:{type:'boolean',required:true}},output,
    execute:async(args:{enabled:boolean})=>{await traffic.setTrafficBindingEnabled(args.enabled);return traffic.configuration();},
  })));
  ctx.effect(()=>ctx.tools.register(defineTool({
    name:'redteam_traffic_set_enabled', description:'Enable or disable capture proxy routing for subsequent worker commands while retaining the running recorder. Disabled workers use the global egress proxy without the capture CA. Starting a recorder explicitly enables capture.',
    parameters:{enabled:{type:'boolean',required:true}},output,
    execute:async(args:{enabled:boolean})=>{await traffic.setCaptureEnabled(args.enabled);return traffic.configuration();},
  })));
}
