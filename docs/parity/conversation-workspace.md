# 会话与工作区接入

本模块对应 ARTEX 的 `server/conversations.go`、`server/side_questions.go`、`sidequestion/service.go`、`server/workspace.go`、`server/chatupload.go`、`server/chat_mentions.go` 和 `db/chat_mentions.go`。实现使用 DSH 原生 Agent、SessionPersistence、SessionQuery、LLM 和工具注册服务，不复制一份聊天 transcript，也不伪造模型执行。

## 安装与生命周期

宿主在真实注入 `agents/tools/llm/sessionPersistence/sessionQuery` 的 Context 中仅创建一次 `await createConversationWorkspace(ctx, store, options)`。每个 Agent preset 使用 `installConversationWorkspaceTools(agentCtx, runtime)` 引用同一实例；UI 使用 `installConversationWorkspaceHttp(uiCtx, runtime, { authenticate })`，认证回调必须调用真实 DSH connection admission 并检查 owner。

options 的 `prepareRun` 和 `resolveAgent` 必须接真实平台；`resolveAgentProfile` 返回显式 Agent 配置绑定，不能用 prepareRun 最终路由推测绑定，因为最终路由可能已应用全局默认值。会话路由顺序为显式 Agent 绑定、会话 profile pin、全局配置、prepared fallback。`setupAgent` 在原生 factory setup 中安装该 Agent 的真实 preset 能力；`bindTask` 应通过 `TaskLifecycleRuntime.attachConversation` 添加纯任务归属，不能让多个会话段逐个调用 `bindParent` 抢占唯一 Planner 执行所有者。无 Planner 所有者时主聊天仍可使用任务模型链，不伪造 parent，也不启动任务时钟。普通会话不伪造父 Session lineage。

`parentForSession` 关联已存在的任务主会话；本模块创建的会话、任务段及 store 中的 worker execution 会自动关联。`modelIdentity(route,parent)` 可以加入无凭证的 profile/config revision，使配置变化后的旧旁路快照不可继续使用。旁路服务必须每个持久目录只安装一次，保持单父会话准入和全局四请求限制。

任务删除调用 `prepareTaskDelete(taskId, { deleteFiles })`，准备阶段阻止新上传、等上传租约释放、取消并等待会话和旁路结束，然后返回 `commit/rollback`。任务存储删除成功后 commit；存储删除失败时 rollback。提交失败保留事务，下一次同 task ID 的 prepare 返回原事务可重试。成功提交释放门闩；已删除任务由真实 store 存在性检查拒绝，同 ID 恢复后可创建新会话。默认保留任务文件；显式 deleteFiles 仅将 `tasks/<id>` 暂存，提交后清除，失败可恢复。

## 可用入口

工具：`redteam_conversation`、`redteam_side_question`、`redteam_workspace_file`、`redteam_search_chat_mentions`。文件上传下载通过 HTTP 流处理。

所有 HTTP 路由均在 `/api/redteam/conversation-workspace` 下，写入校验 Origin，JSON 接口要求 application/json：

| 方法与路径 | 功能 |
| --- | --- |
| GET /conversations?query=&task_id= | 列表、标题及原生历史搜索 |
| POST /conversations | 创建；body 为 agent_key/title/profile_id/task_id |
| GET /conversations/:id | 详情及运行状态 |
| PATCH /conversations/:id | title、pinned、profile_id；null 清除 profile pin |
| DELETE /conversations/:id | 取消、等待、删除业务会话入口 |
| POST /conversations/batch-delete | ids 数组，最多100，逐项结果 |
| POST /conversations/:id/send | message、attachments；接受后异步执行 |
| POST /conversations/:id/stop | 仅取消当前会话并等待 idle |
| GET /conversations/:id/messages?cursor=&limit= | 原生事件分页；cursor 为下一个 seq，初始0，上限1000 |
| GET /tasks/:id/segments | 真实主会话段列表 |
| POST /tasks/:id/main-session | 原子创建或复用真实段0 |
| POST /tasks/:id/segments | 确保段0存在后新增一段 |
| GET/POST/DELETE /side-questions | 用 parent_kind/parent_id 及可选 exploration_id/intent_id 定位；查询、提问、清空 |
| GET /side-requests/:id | 请求状态 |
| POST /side-requests/:id/cancel | 仅取消旁路 |
| GET /side-requests/:id/events | SSE exchange 事件，包括序号和终态 |
| GET /mentions?query=&scope=&cursor=&task_id= | 类型引用搜索，20条游标分页 |
| GET /files/list、/files/read、/files/download | path 查询参数，下载流 |
| POST /files/write、/files/mkdir | JSON path/content |
| DELETE /files/delete?path= | 删除工作区文件或目录 |
| POST /files/upload?path= | multipart 重复 file 字段 |
| POST /files/chat-upload?scope=&id= | scope 为 task/session/staging，multipart 重复 file 字段 |

普通会话附件目录为 `sessions/<conversation id>/uploads`，任务段共享 `tasks/<task id>/uploads`。上传返回的 path 可直接作为发送 attachments 的 path；后端重新校验所属目录、大小及真实文件，忽略客户端绝对路径和大小。显示原文与附件元数据保存为原生 UserMessage.source；模型内容使用解析后的上下文和附件绝对路径。

引用保留原数字 ID 语法并支持目标 store 的 UUID。标签不参与身份匹配；记录缺失、类型不符、超过10条去重引用或拼接超过384KiB时拒绝发送，不写入用户消息。字段16000码点、数组100项的截断有可见提示。搜索对 %/_ 等使用字面匹配，游标绑定查询和类型；数字 ID 按数值排序，UUID 按稳定字符串排序。

## 验证与明确差异

测试位于 `test/conversation-workspace-conversations.test.mjs`、`test/conversation-workspace-side.test.mjs`、`test/conversation-workspace-files.test.mjs`、`test/conversation-mentions.test.mjs` 和 `test/conversation-workspace-integration.test.mjs`。真实本地 Adapter、AgentLoop、JSONL 持久化、SQLite query、文件系统、multipart HTTP 与 SSE 用于验证。组合测试的任务 store 是内存快照边界；任务生命周期最终入口应由主组合测试验证。未调用真实外部模型供应商。

DSH 当前公开持久化 API 不提供物理 Session 删除；会话删除持久化 tombstone 并移除入口，底层审计历史保留。可选任务文件删除不猜测或直接清理原生 transcript 路径。

当前交付入口是工具与认证 HTTP，未新增聊天 UI 面板。消息历史返回原生事件和 seq cursor，不假装与 ARTEX 的整数 DB 消息行完全同构。未创建任何会话的任务 GET segments 返回空，POST main-session 才创建真实段0。

会话与旁路提供 `exportTaskArchive/preflightTaskArchive/restoreTaskArchive/quiesceTask` 公开接口，由 `archive.ts` 的 `withConversationArchive` 组合至宿主归档。归档全程持有任务准入门闩并最终 rollback 释放；metadata 与原生日志先预检再恢复。会话导出包含 tombstone，恢复拒绝冲突，不能复活已删除段；旁路包含所有 exploration/intent、快照、问答、摘要及 ordinal。宿主必须实际安装此适配器，不能直接覆盖运行中的 JSON 文件。

工作区文本预览上限2MiB，普通上传512MiB，聊天上传128MiB（包括 multipart 开销）。本实现新增 JSON 文件写入请求16MiB上限，且拒绝跨根目录路径、符号链接/junction、Windows ADS；这些限制比原版单纯词法路径检查更严格。
