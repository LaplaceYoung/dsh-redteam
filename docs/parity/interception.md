# ARTEX 工具拦截、审批与 LLM Judge 迁移

依据本机 `C:/Users/xiaoz/ARTEX/intercept/{intercept,prompt,review_context,trace}.go`、`server/intercept.go`、`db/intercept.go` 和已安装 DSH `0.2.1-rc.2` 公开类型/实现。`prompt.ts` 中三个策略常量逐字取自上游 `prompt.go`；输入边界和输出协议由代码追加到自定义策略，保持原设计。

原始 ARTEX 许可全文保存在 `src/interception/LICENSE-ARTEX.txt`，打包时与本模块来源信息一起保留。

## 集成

Agent 注入服务名是 `tools`、`llm`、`approval`。在每个 Agent 的作用域调用：

```ts
const interception = installInterception(agentCtx, store, {
  profiles: profiles.resolver,
  taskForAgent: agent => {
    const found = lifecycle.taskForAgent(agent.id);
    return found ? { taskId: found.binding.taskId, worker: found.role === 'worker' } : undefined;
  },
});
await interception.ready;
```

默认只读取当前未结束 turn 内 source.kind=user 的真实用户原文，不借用之前 turn，也不读取生成通知或 goal continuation。组合层如需更严格来源选择，可用 `humanMessage(agent)` 覆盖；未返回原文时省略。Worker 永远不发送背景/意图/父消息。工作目录读取 DSH `workingDirectory` 服务，完整工具参数不截断。

删除旧 `index.ts` 的 `matchesIntercept` 与整段旧 `tools/pre-execute` hook。删除旧工具 `redteam_add_intercept_rule`、`redteam_request_approval` 的注册，由新 installer 同名接管。其他旧 tools 无重名。新参数沿用 `task_id/name/match_target/match_type/pattern/action/priority/enabled/message`，新增 `timeout_enabled/timeout_seconds/timeout_action`。

`redteam_request_approval` 现在真正等待 DSH 人工回答；结果仅针对这个精确请求，不能被当作未来任意工具的授权。

UI 作用域调用一次 `installInterceptionHttp(uiCtx,store,{authenticate})` 并等待 `.ready`。自注册的 webServer 路由不会继承 DSH `/api` 路由认证；authenticate 必须调用真实 connection.admit，并且只对 owner principal 返回 true，未登录返回 401，已登录非 owner 返回 403。审批决定由该人工 HTTP 入口或 DSH 原生答复器提交，不提供模型自批工具。

归档使用：

```ts
sessions: withInterceptionArchive(new SessionArchiveRuntime(sessionPersistence, subagents), interception.repository)
```

该组合保持既有 session 归档目录和 manifest marker，增加完整 `interception.json`。真实会话恢复失败前不写审计库：先预检审计冲突，再恢复会话，最后原子恢复审计。旧归档缺少该文件仍按旧会话协议恢复。审计像 DSH 会话日志一样保留在本机，归档包含独立副本；不存在移动后丢失的旁文件。活审批/未收到执行结果阻止 capture，调用方先 quiesce 当前 Worker 并等待结果持久化。

## 已实现行为

| 原版契约 | DSH 实现 |
|---|---|
| priority DESC, id ASC；首条命中 | priority DESC, 持久创建序 ASC；allow 跳过后续 ARTEX 规则但继续宿主其他策略 |
| tool_name / tool_input，string / regex | 区分工具名与完整 JSON 输入；string 子串；re2-wasm 保留 RE2 内联 flags、Unicode 类及禁止反向引用/lookbehind |
| enabled_tools 可配置 | 精确名称列表；保留原名并补 DSH bash/pwsh 与文件写入工具角色名；空列表关闭规则入口 |
| allow / deny / ask | DSH tools/pre-execute；ask 调用真实 approval.request，只有 allowed-once 继续执行 |
| 持久 pending / detail / decide / history | 同目录 interception.json 原子替换；同进程全部 Agent 共用规范路径写入队列和 waiter |
| 超时与人工并发竞争 | 持久状态首写成功者决定；timeout 状态保存 effectiveAction，允许超时放行 |
| 人工决定早于 waiter 注册 | 注册 waiter 后重读持久行，不丢决定 |
| 上下文取消与宿主关闭 | 取消精确请求；不执行工具；重启遗留 pending 变 denied，缺结果变 unknown |
| 精确执行关联 | DSH registry token + sessionId/callId/rootCallId；两个同名同参数调用不会共享授权或结果 |
| 任务规则边界 | 只用宿主绑定/真实 Worker childSessionId；不信工具参数里的 task_id 来挑选任务策略 |
| LLM fallback | 仅 enabled tool 没有命中任何规则时，真实 ctx.llm.stream 单次 1024 tokens、temperature 0；模型支持时选关闭 reasoning 的 effort |
| Judge profile / 默认 profile | 真实 profile resolver，默认全局 profile，否则当前 Agent 真实 provider/model；不猜 profileId 为 provider |
| Judge failure policy | 原版 allow/ask/deny 配置和默认 allow；无效输入强制 ask；ask 独立人工超时 |
| 原版 verdict 解析 | 完整 JSON，唯一 decision/comment 字段、无重复键、三段说明；允许完整 Markdown fence 解包；截断/歧义不修补 |
| 审计 | config/input/model-input SHA256、完整原参数、模型失败标记、profileId、实际 usage、完成状态和 64 KiB 结果摘要 |
| Judge 用量账本 | 调度时创建独立调用记录，每次实际 usage 到达即持久化，失败/取消仍保留 token；支持累计和 UTC 每日序列，任务归档包含记录 |

通过 DSH 自己的 approval policy `never` 时请求仍会被拒绝，不把数据库里手动写入的 allowed 当成绕过宿主策略的执行凭据。

## HTTP 接口

路径前缀 `/api/redteam/interception`，响应 JSON，`cache-control: no-store`：

- `GET /pending`、`GET /history`：`task_id/status/decision_source` 可选，`offset` 默认 0，`limit` 默认 100、最大 1000。
- `GET /records/:id`：完整审计；`GET /records/:id/execution`：精确 session/call 和匹配结果。任务已归档/删除返回 410，关联不可用返回 409。
- `POST /records/:id/decide`：JSON `{allowed:boolean,taskId?:string}`；taskId 存在时必须匹配；重复决定返回 409。
- `GET /rules`、`POST /rules`、`PUT /rules/:id`、`DELETE /rules/:id`、`POST /rules/:id/toggle`。
- `GET /settings`、`POST /settings`：`enabledTools` 和完整 `judge` 配置；读回 prompt 包含生效输入边界与输出协议。
- `GET /judge-usage?days=30`：累计 calls/input_tokens/output_tokens/cache_read_tokens/cache_write_tokens 和最近 days 天 UTC daily 序列。days 只限制 daily，不限制累计值。

写入必须使用 `application/json`，上限 1 MiB；浏览器 Origin 与 Host 不同会返回 403。每次请求先调用传入的真实宿主认证函数；本模块不创建另一套登录凭据。

## 验证

`node --test --test-concurrency=1 test/interception-runtime.test.mjs` 运行真实 Cordis、AgentRegistry、AgentLoop、LlmRuntime、ToolRuntime、ApprovalService、WebServer。模型由本地确定性 Adapter 发出真实工具调用和 Judge 响应；不调用外部目标。测试覆盖严格 verdict、RE2、任务边界、并发首写、精确批准/拒绝、never、超时放行、模型失败转人工、宿主销毁、HTTP、归档冲突。

远端 Judge 模型、桌面原生审批卡片点击及最终侧边栏页面仍需产品总验收；本模块测试没有把本地 Adapter 等同于远端模型已接通。


