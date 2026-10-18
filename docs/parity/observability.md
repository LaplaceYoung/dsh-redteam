# L02 / S01：模型录制、token 与工具用量

核对源：本机 `C:/Users/xiaoz/ARTEX/llmrec/llmrec.go`、`llmrec/capture.go`、`server/commands.go`、`server/tool_usage.go`、`db/commands.go`。宿主接口以本项目安装的 DSH `0.2.1-rc.2` 类型与实现为准。

| 原设计 | DSH 实现与证据 |
| --- | --- |
| 默认关闭 body recording，开关逐次调用生效 | `ObservabilityRepository.setRecording` 持久化；同路径各 Agent/preset/UI 实例共享串行写队列。每次 `llm/stream` 开始读当前开关。 |
| 录制关闭仍计费，失败/取消也记录用量 | 全局 `llm/stream` waterfall；一逻辑调用一行 usage；正常 finish、error、aborted 与消费者提前结束分别处理。DSH usage 是整次调用的互斥计数，保留 input/output/cacheRead/cacheWrite/reasoning；不会把最后完整 usage 再累加。 |
| task、session、worker、profile、model 归属 | 显式 `Attribution` 支持 taskId/explorationId/intentId/role/profileId/agentId/runId/sessionId。调用真实 provider/model 取自实际请求。无 session 的 judge/planner/辅助调用用 `withObservationStream`，每次 next/return 都保持异步归属。 |
| 请求、响应、失败详情 | 保存不含 AbortSignal 的完整 GenerateOptions、按序 adapter chunks、结构化 failure；列表省略大 body，详情返回完整数据。 |
| 原始请求、原始 SSE 与多次 HTTP attempt | 包装宿主已有 undici global dispatcher，不另建代理策略；只在录制调用的 AsyncLocalStorage 内镜像序列化请求迭代器与响应 onResponseData，保存每次 HTTP 状态、完成状态、错误和精确 base64 字节，另带 UTF-8 预览。Node fetch→本地真实 HTTP 429/200 已逐字节核对请求、中文 SSE、CRLF、重试错误体。 |
| transport 不可观察时保留空 raw，不伪造 | 本地 Adapter、发送前失败、使用自己独立 transport 的 Adapter 标记 `wire.available=false` 并说明原因；规范化 chunks 不冒充原始 SSE。 |
| 录制列表、详情、任务筛选、精确任务删除 | repository records/detail/tasks/deleteRecords；删除录制不删除始终计费的 usage。deleteTask 用于任务已停止后的全域清理。 |
| 按 model/profile/day 汇总 | usage 支持完整筛选与 model、profile、UTC day 分组；cache 独立显示，失败调用保留费用。 |
| 工具开始即计入用量；命令历史 | `tools/pre-execute` 先持久化 running 行，`tools/execute` 标记实际进入执行，最终 `tools/result` 更新同一行；拒绝、抛错、超时、取消、非零命令退出均可区分。保存原始输入、完整结果与结构化错误。 |
| 工具数量与错误统计、过滤分页 | commands/toolStats 共享筛选；统计整个筛选结果而非一页。保留 command exitCode、stdout/stderr truncated、durationMs。更早的宿主 gate 若直接结束，无法知道真实开始时刻，durationMs 缺省，不伪造 0ms。 |

## 根接线

```ts
const observability = installObservability(agentCtx, store, {
  resolveCall: request => resolveRequestAttribution(request),
  resolveAgent: agent => resolveAgentAttribution(agent),
  onError: error => reportError(error),
});
await observability.ready;

const stream = withObservationStream(
  { taskId, role: 'planner', profileId, runId },
  () => agentCtx.llm.stream(request),
);

const http = installObservabilityHttp(uiCtx, store, { authenticate });
await http.ready;
```

归属 resolver 只返回本插件作用域内的实际调用；undefined 表示不记录。`authenticate` 必须由根使用真实 DSH connection admission 并限定 owner，保留 401/403。HTTP 与 Agent installer 使用同目录 `observability.json`。

工具 `redteam_observability` 支持 settings/recording/records/record/tasks/delete_records/commands/tool_stats/usage。HTTP 前缀 `/api/redteam/observability`：GET settings、records、records/:id、tasks、commands、tool-stats、usage；PUT settings；DELETE records?taskId=精确任务ID。过滤字段为 taskId/sessionId/agentId/runId/profileId/role/provider/model/status/tool/q/from/until/offset/limit；usage 另有 group=model|profile|day。变更检查 owner、Origin、JSON 输入；读取不经过假登录或公开旁路。

任务删除先停止并排空模型和工具，再 `await observability.flush()`，然后 `repository.deleteTask(taskId)`。录制删除仅用于删除当前已记录的 debug trace，后续运行仍能按开关录制。插件卸载排空已观察的调用，持久化最终结果，最后恢复自己持有的原 dispatcher；不关闭宿主已有连接，也不覆盖随后安装的新 transport。

## 验证范围

`node --test --test-timeout=30000 test/observability.test.mjs`：8 项真实 DSH LlmRuntime/ToolRuntime 与本地 HTTP 回归。覆盖录制关/开、共享配置、缓存计数、失败与提前结束、aux 外部消费归属、最终拒绝/异常/超时/截断/命令非零退出、多个 scope 不重复计数、真实 wire 字节与重试、owner HTTP、在途工具卸载排空、取消保留 partial wire 与已计 token。

定向 TypeScript 检查只包含 `src/observability/index.ts` 及其依赖；根统一执行全项目构建。HTTP 测试使用真实 Node 请求与显式 admission fixture；完整桌面 DSH owner 身份和侧栏展示需根的组合验证。Adapter 自有 transport 不经全局 dispatcher 时不能取得 wire body，界面/调用方必须按 `wire.available` 显示实际情况。
