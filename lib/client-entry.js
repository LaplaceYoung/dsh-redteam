import { AssetGraphTab, SnapshotTab } from './client.js';
import { installFindingDeepLink } from './client-deeplink.js';
import { TaskWorkspaceTab } from './task-workspace/client.js';
import { InterceptionTab } from './interception-ui/client.js';
import { AssetManagementTab } from './asset-management/client.js';
import { SystemRuntimeTab } from './system-runtime/client.js';
import { PlatformManagementTab } from './platform/client.js';
import { HostManagementPage } from './host-management/client.js';
import { ConversationWorkspaceTab } from './conversation-workspace/client.js';
import { ObservabilityTab } from './observability/client.js';
export const inject = ['betterSidebar'];
export function apply(ctx) {
    ctx.effect(() => ctx.betterSidebar.registerTab({ id: 'dsh-redteam:tasks', title: '任务工作台', description: '管理任务、模板、分类、目标与模型配置。', order: 29, single: true, component: TaskWorkspaceTab }));
    ctx.effect(() => ctx.betterSidebar.registerTab({
        id: 'dsh-redteam:assets',
        title: '资产图',
        description: '查看任务资产、探索图、意图和发现。',
        order: 30,
        single: true,
        component: AssetGraphTab
    }));
    ctx.effect(() => ctx.betterSidebar.registerTab({ id: 'dsh-redteam:findings', title: '发现', description: '查看漏洞发现和证据关联。', order: 31, single: true, component: SnapshotTab }));
    ctx.effect(() => ctx.betterSidebar.registerTab({ id: 'dsh-redteam:traffic', title: '流量', description: '查看捕获的请求响应索引。', order: 32, single: true, component: SnapshotTab }));
    ctx.effect(() => ctx.betterSidebar.registerTab({ id: 'dsh-redteam:activity', title: '活动', description: '查看 Planner、Worker 和审批活动。', order: 33, single: true, component: SnapshotTab }));
    ctx.effect(() => ctx.betterSidebar.registerTab({ id: 'dsh-redteam:report', title: '报告', description: '查看任务 Markdown 报告。', order: 34, single: true, component: SnapshotTab }));
    ctx.effect(() => ctx.betterSidebar.registerTab({ id: 'dsh-redteam:approvals', title: '审批', description: '处理待审批调用、查看审计并管理工具规则。', order: 35, single: true, component: InterceptionTab }));
    ctx.effect(() => ctx.betterSidebar.registerTab({ id: 'dsh-redteam:asset-management', title: '资产管理', description: '管理全局资产、公司范围、任务关联和 ScopeSentry 同步。', order: 36, single: true, component: AssetManagementTab }));
    ctx.effect(() => ctx.betterSidebar.registerTab({ id: 'dsh-redteam:system', title: '系统设置', description: '管理搜索、模型池、健康状态和重试策略。', order: 37, single: true, component: SystemRuntimeTab }));
    ctx.effect(() => ctx.betterSidebar.registerTab({ id: 'dsh-redteam:observability', title: '调用记录', description: '查看 LLM 录制、命令记录和 token 用量。', order: 38, single: true, component: ObservabilityTab }));
    ctx.effect(() => ctx.betterSidebar.registerTab({ id: 'dsh-redteam:conversations', title: '会话与文件', description: '管理独立会话、任务主对话、旁路问题和工作区文件。', order: 39, single: true, component: ConversationWorkspaceTab }));
    ctx.effect(() => ctx.betterSidebar.registerTab({ id: 'dsh-redteam:platform', title: '平台资源', description: '管理 Agent、工具、MCP、Skill 与触发器。', order: 40, single: true, component: PlatformManagementTab }));
    ctx.effect(() => ctx.betterSidebar.registerTab({ id: 'dsh-redteam:host', title: '宿主与更新', description: '查看健康、统计、日志并核对插件更新能力。', order: 41, single: true, component: HostManagementPage }));
    ctx.effect(() => installFindingDeepLink(ctx.betterSidebar));
}
