# 系统运行时：ARTEX → DSH 0.2.1-rc.2

本域实现位于 `src/system-runtime/`。公共模型配置仍由 `TaskProfileRegistry` 管理；本域不复制 provider 密钥，也不重做任务并发、Python、流量代理、profile CRUD 或 LLM 录制。

## 源码依据与能力

| ARTEX 源码 | DSH 实现 | 行为 |
| --- | --- | --- |
| `server/server.go` settingsPayload/putSettings/testWebSearch；`server/manager.go` WebSearch/SetWebSearch | `settings.ts`、`index.ts`、`http.ts` | 搜索默认关闭、DDGS 默认后端；密钥省略/null 保留、空串清除、输出仅 presence；搜索测试空 key 用已存值，空/省略 proxy 直连 |
| `norma/tool/websearch.go` | `web-search.ts` | DDGS HTML DOM 提取、Brave GET token 认证、Tavily POST key 认证、DeepSeek Anthropic server-tool SSE；超时、取消、结果去重和数量上限 |
| `server/llmpool.go`、`llmpool/health.go`、`llmpool/pool.go` | `model-health.ts` | 进程共享 health、rate limiter、Retry-After、1/5/30 分钟熔断、priority/excluded、同优先级轮换、context window 筛选、全不可用尝试 head、立即重置 |
| `server/llmretry.go`、`db/llmretry.go` | `model-health.ts` | connect/empty/stream/breaker/intent 五层策略；profile 可覆盖前三层，持久化与脱敏状态查询 |
| `server/constraints_api.go` | `settings.ts`、`SystemRuntime.constraints` | 默认 planner/worker 都注入；每次读取开关与最新本任务约束，allow 在 deny 前；不改持久约束与作用域 |
| `server/manager.go` NoaCompactionEnabled 与本机 norma/noa 实现 | `compaction.ts`、`compaction-host.ts` | 每 run 固定开关、Compress 工具、消息引用、原文归档、三级摘要、请求投影、保护尾部、完整工具对、压力提示/抑制、usage 下限、老工具结果机械截断、溢出且确有缩减才重试 |

搜索代理使用独立 Undici dispatcher，空值明确直连，不读取全局 dispatcher 或目标流量代理。支持 HTTP、HTTPS、SOCKS5；不会偷偷把搜索流量转入全局目标代理。

DeepSeek 的默认凭据适配器读取真实 DSH provider 目录、`settings.describe({redactSecrets:false})` 和公开 credential 服务。依据本机 `app.asar` 中 `dsh-llm-deepseek-api-key`、`dsh-llm-deepseek` 与 `dsh-llm-pi-ai` 实现，配置字段是 `apiKeyEnv`。官方 provider 使用其默认环境引用与 Anthropic endpoint；Pi AI 按显式引用、`llm-pi-ai/<route>` API-key record、目录声明的 native env 顺序解析。OAuth grant 和 DeepSeek account token 不可作为此协议的 API key，会明确拒绝；不扫描用户凭据文件。

## 宿主装配

```ts
const system = await installSystemRuntime(ctx, store, { profiles: taskProfiles });
const prepareRun = system.wrapPrepareRun(platform.prepareRun);
// Planner、Worker、原生主 Agent 及独立对话均须经过上述 prepareRun。
// Planner 每次真实 completion 前消费 prepared.transformRequest(request)。

const lifecycle = installTaskLifecycle(ctx, store, planner, {
  ...lifecycleOptions,
  profiles: atomicProfileResolver,
  modelHealth: system.models,
  poolSettings: () => system.settings.snapshot(),
});
// Planner/Worker 的 constraints callback 每次请求调用：
// taskId => system.constraints(taskId, 'planner' /* 或 worker */)
```

`TaskProfileRegistry.resolveBindingSelection/resolveGlobalSelection` 在同一次串行读取中返回 `{profileId,route}`。宿主组合平台绑定时必须继续使用原子 selection，不能按 provider/model 反推 profile ID。同一 provider/model 可属于多个 profile，各自健康状态不同。

原生模型回退发生于 `agent/request`，失败通过 `agent/request-error` 申请同一步重试，因此 DSH 的 request/header 和实际调用一致。`llm/stream` 中只执行同路由重试及限流。任务余额耗尽链保持独立：只有当前 task-chain head 的 quota 失败推进任务游标；绑定/全局配置失败不会改任务链。流已交付内容后不重放；ARTEX 对流开始后的错误不新增熔断失败，本实现保持此行为。

`resolveModelCallAttribution(request)` 提供明确的 task/role/profile/session 信息。录制层应将其合并进原有 observation 身份，保留 intent、exploration、runId 和 purpose。Noa 默认原生投影通过同路由嵌套 dispatch 实现，录制层在流结束时检查 `isNoaRedispatchedRequest(request)`，跳过外层，记录真实投影后的内层调用，防止重复统计。

Noa 的 `runId` 仅用于压缩运行与归档标识，不冒充 DSH session。手写 Planner 的请求保持真实 parent session；投影标记是随对象 spread 保留的 symbol，不进入 JSON。原生 Agent attach 才绑定真实 session 并互斥内置 `CompactionEngine`。关闭或初始化失败维持原压缩策略；无法控制内置压缩时明确报错。

DSH 公开 `llm/stream` 的 `next()` 不接受替换 options，且没有公开 getAdapter。默认原生 Noa 嵌套 stream 会重新解析 provider 的 adapter generation；provider/model 不变，但不能声称保留原 `prepareCall()` 捕获的配置代际。已有真实 provider wrapper 的宿主可选 `projectionBoundary:'provider-wrapper'`，在其实际 dispatch 前调用 `system.compaction.projectRequest(request)` 避免再次解析。此模式必须真实接入该调用，不能只设开关。

Noa 解析器可恢复 fenced/stringified 参数、尾逗号及截断尾部之前的完整 range。原生 DSH AgentLoop 会先解析工具调用 JSON；完全非法 JSON 在进入 ToolRuntime 之前已被拒绝，无法抵达本域恢复器。因此不能宣称原生任意损坏工具 JSON 均能恢复，也没有在 provider chunk 层擅自修写模型输出。

全局 intent 重跑策略由 `system.models.retryPolicy().intent` 提供，任务 Worker 消费它才能实现第五层执行行为；0 表示 ARTEX 默认（2 次、3000ms），-1 禁用。该消费入口属于 Worker 域，不能仅凭本域策略保存测试宣称执行已接通。

## HTTP 与持久化

`installSystemRuntimeHttp(ctx,store,{profiles,authenticate,...})` 返回 `{runtime,ready,dispose}`，使用独立 headless runtime，UI-only 启动无需等待 Agent/tool scope。与工具实例共享规范化路径的 settings/health/限流状态。

所有路径以 `/api/redteam/system` 开头，先进行真实 owner 鉴权。修改和探测使用 JSON，拒绝跨 origin、无效类型和超出 64KiB 的 body，响应 `no-store`。

| 路径 | 方法 | 输入 |
| --- | --- | --- |
| `/settings` | GET / PUT | PUT 为部分设置对象 |
| `/model-pool` | GET | 脱敏顺序、policy、health、开关 |
| `/model-policy/:id` | GET / PUT | 完整 profile pool policy |
| `/model-retry` | GET / PUT | 完整五层 retry policy |
| `/model-health/reset` | POST | `{profile_id?}`，省略清除全部 |
| `/model-test/:id` | POST | `{}`；真实 30 秒、16 token completion |
| `/web-search/test` | POST | 搜索表单字段；不保存草稿 |

sidecar 文件为 `system-settings.json`、`model-health.json` 和 `noa/`，默认位于 store 目录。设置文件包含搜索 API key，写入请求权限为 0600；Windows 的实际访问控制由宿主目录 ACL 决定。读接口从不回显 key。写入采用同目录临时文件与 rename，失败不伪装为成功。

## 验证范围

`test/system-runtime-*.test.mjs` 使用小型 esbuild bundle 和真实 SDK，不依赖全仓预编译产物。覆盖四搜索协议、本地 HTTP/HTTP proxy/SOCKS5/SSE、全局代理隔离、取消、响应限制、凭据优先级、真实 DSH Adapter 和 AgentLoop 回退、实际 request/header、跨实例共享 limiter/health、设置与 HTTP 鉴权、Noa 原文归档/工具执行/真实请求投影/原生压缩互斥。

全部服务探测测试均针对本地 fixture，没有访问外部搜索服务或付费模型。全仓类型检查与 build 按内存协调由主会话串行执行；本域测试不能代替主会话的最终装配验证。
