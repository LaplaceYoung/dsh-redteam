# 旁路提问（C03）接入与验证

实现位于 `src/conversation-workspace/side-questions.ts` 和 `side-questions-context.ts`。本模块只使用 DSH 公开 `llm/stream`、`LlmRuntime.resolveModelInfo/stream`、`session/event` 与 `Session.deriveMessages()` 接口。

## 原版依据

- `ARTEX/sidequestion/service.go`：旁路只有独立模型补全，没有 Agent harness、工具执行器、主 transcript writer 或模型故障转移链。
- `ARTEX/sidequestion/capture.go`：实际主模型调用前捕获不可变请求；成功响应后追加回答；终轮结束补最后落地的工具结果。
- `ARTEX/server/side_questions.go`：每个父会话单请求、全服务并发上限 4、请求期限 120 秒；问题 1–4000 Unicode 字符；请求 ID 长度 1–128，仅字母数字及 `-_.:`；删除先关闭准入再取消并等待最终写入。
- `ARTEX/db/side_questions.go`：请求 ID 与 generation 内幂等；同 ID 不同问题冲突；更新不能覆盖终态；清空增加 generation；启动将未完成请求标记中断。
- `ARTEX/sidequestion/context.go`：历史摘要游标使用 ordinal、保留近期问答、摘要最多 12 次调用、主上下文摘要、仅在尚无输出时尝试一次上下文溢出恢复。

## 安装约定

```ts
const side = await installSideQuestions(ctx, {
  directory: persistenceDirectory,
  parentForSession: sessionId => conversationRegistry.sideParent(sessionId),
  parentExists: parent => parentRegistry.isActive(parent),
  prepareQuestion: (parent, text) => expandMentions(parent, text),
  modelIdentity: (route, parent) => stableProfileConfigurationIdentity(route, parent),
});
```

每个持久目录安装一个服务实例。准确 Session → 父任务/会话映射由调用方提供；本模块不会任选一个 Agent。`parentForSession` 返回 `undefined` 的原生请求不会被采集。辅助请求（有 `purpose`）与本模块自己的请求（无 `sessionId`）不覆盖主快照。

`SideParent` 为 `{kind:'conversation',id}` 或 `{kind:'task',id,explorationId?,intentId?}`，任务主 Agent 和 Worker 可独立保存快照。主会话实际 provider/model/effort/maxTokens、DSH 模型元信息及可选 profile revision 共同构成配置身份；profile 配置删除或更换时，宿主应在 `modelIdentity` 返回变更身份或明确拒绝。不会保存 provider 凭据。

`ask(parent,{clientRequestId,question})` 返回已持久接纳的记录，后台执行模型请求。`prepareQuestion` 在检查幂等后展开 mentions，记录和冲突比较保留原问题。`wait(id)` 等待收尾；`get`、分页 `list` 与 `subscribe` 可供原生工具/HTTP/SSE 使用。`cancel` 仅中断旁路模型信号，`clear` 等待中断后清除历史并增加 generation。

删除使用 `prepareTaskDelete(taskId)` 或 `prepareParentDelete(parent)` 返回的事务：先阻止新旁路、取消并等待进行中的模型与持久写入，再执行宿主删除事务；成功后 `commit()` 清记录，失败 `rollback()` 解除准入。清理持久化失败时 `commit()` 可重试且门闩继续关闭。已经发出的主模型请求与其迟到 `turn/end` 使用捕获版本隔离，不能重新创建被删除的快照。同 ID 任务恢复后必须有新的真实主模型调用才能重新捕获。

归档公共接口为 `quiesceTask(taskId)`、`exportTaskArchive(taskId)`、`preflightTaskArchive(taskId,data)` 和 `restoreTaskArchive(taskId,data)`。宿主全程持有 `prepareTaskDelete` 门闩，归档或恢复完成后调用 `rollback()` 释放，不能对归档调用删除事务的 `commit()`。`quiesceTask` 只取消并排空旁路请求和最新快照写入，不删除记录；导出内容为 `{version:1,taskId,ordinal,sessions}`，覆盖该任务全部探索和 Worker 的快照、历史、模型身份与摘要游标。归档父任务的普通 `list/get` 隐藏记录，导出从持久状态直接读取。

预检和恢复共用持久数据 validator，校验父任务引用、唯一请求ID、代次、顺序游标、快照、用量和摘要游标。恢复在同一串行锁内重新检查冲突，合并不冲突的记录；相同归档重复导入不产生重复记录，已有清除代次或相同记录的不同内容会拒绝。持久写入成功后才更新内存快照及捕获版本，全局下一 ordinal 不会倒退。接口允许在门闩内、父任务尚未恢复可见时调用，调用方仍需执行归档操作的身份检查。

## 验证范围

`test/conversation-workspace-side.test.mjs` 装载真实 Cordis、AgentLoop、AgentRegistry、SessionStore、LlmRuntime、ToolRuntime、SessionProjections 和 JSONL SessionPersistence。只有供应商传输使用本地测试 Adapter，无外网请求。

验证包含：主模型仍运行时旁路回答且主 Session 事件数不变；真实冻结请求完整捕获；幂等跨重启有效；取消和删除收尾；清空后的 generation；损坏持久数据拒启动；模型配置变化拒用旧快照；服务恢复中断状态；上下文溢出只进行有界摘要和一次重试；模型工具请求无执行路径。

2026-10-18 本模块专项执行 **11/11 通过、无跳过**；仅这两个源码文件的严格 NodeNext TypeScript `--noEmit` 检查通过。归档专项另外覆盖跨探索/Worker 完整保留、归档不可见、门闩内恢复、幂等合并、冲突预检无写入，以及磁盘写入失败不改变内存且允许重试。随后增加 `clear` 在同一准入锁内检查父任务删除门闩的修复及一条断言；因主会话要求暂停新测试，该最后修复尚未重新执行测试。

本模块不创建旁路 Agent/伪 Session，也不将旁路问答追加主历史。这遵循原版语义。工具/HTTP 的身份鉴权、模型 profile revision 接线、归档包通过上述公共接口纳入旁路记录由宿主组合层负责；独立模块测试不能证明这些组合层能力已完成。
