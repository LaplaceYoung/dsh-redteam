# ARTEX → DSH 能力契约核对

核对日期：2026-10-18。原始源码：`C:/Users/xiaoz/ARTEX`；目标源码：`C:/Users/xiaoz/OneDrive/文档/ChatGPT/dsh插件`。`ARTEX:` / `DSH:` 路径分别相对于这两个目录。下表保留原始路由/处理器证据，当前覆盖列已按最新领域代码、主入口和各域交付记录更新，不再保留首次审计中已过时的“无实现”。

状态分开判断：**已接线**表示当前 `src/index.ts` 或其已安装模块实际调用；**模块已实现**表示有领域实现/安装器，但主入口未安装；**专项通过**仅表示记录中列出的受控验证；**宿主待验**表示尚无最终桌面 preset、真实用户会话或远程服务结果。文件存在、专项通过和完整宿主可用不是同一个结论。本次快照中资产管理、会话/文件/旁路、observability、system-runtime、platform HTTP、host management 已由 `src/index.ts` 安装；各自 UI 入口已注册，但新增标签尚未完成最终桌面浏览器验收。

已接线模块包括任务/profile/准入、Planner/Worker、平台 Agent/资源、流量、图工具/冷图、漏洞报告、通知、审批、任务工作台。领域详情和验证限制以相应链接为准；本文没有把任一整域标为“全量迁移完成”。

## 领域能力矩阵

| ID / 能力域 | ARTEX 证据（文件:行）与公开契约 | 当前 DSH 覆盖证据 | 缺口 / 验收条件 |
|---|---|---|---|
| T01 任务创建与元数据 | `server/server.go:673`、`server/task_metadata.go:20`、`db/schema.sql:505`；description、goal、name、category、pinned、company、parent_ref、timeout、heartbeat、coverage、模型链、source_task_ids；PATCH 省略字段不得清空原值 | 已接线：`store.createManagedTask`、`task-management/index.ts`、`runtime-profiles.ts`、工作台 API/原生 UI；高级字段与 PATCH 保留语义见 [integration.md](integration.md)。 | 任务领域及工作台专项通过；完整桌面 preset、真实远端模型验收另计。 |
| T02 分类 | `server/task_categories.go:18`、`:127`、`:181`；分类 CRUD、单任务与批量分类，null 清空，逐项结果；`db/schema.sql:493` nkey 唯一 | 已接线：分类 CRUD、批量分类领域操作、管理工具与工作台分类页。 | 领域/API/浏览器覆盖分类编辑与应用；批量所有入口的混合失败需集成验收。 |
| T03 模板 | `server/task_templates.go:22`、`:31`、`:59`、`:110`、`:142`；name/description/goal/category_id/intercept_rules；`db/schema.sql:613` | 已接线：模板 CRUD、分类及任务拦截规则快照，工作台创建任务可选择模板。 | 专项验证模板修改不回写任务；完整宿主回归另计。 |
| T04 来源任务上下文继承 | `db/schema.sql:634`、`server/orchestration.go:241`；task_relations 是**直接、只读、非递归的上下文继承**，source_task_ids 与 parent_ref 分别保存 | 已接线：直接来源任务只读查询、任务创建字段、图查询与提示词来源；`shared-assets.ts` 删除来源链接。 | 不递归继承、不作前置依赖调度；来源隔离专项通过，真实多会话权限组合仍需宿主验收。 |
| T05 生命周期与批量控制 | `server/task_control.go:92`、`:166`、`:246`，`server/server_mgmt.go:133`；pause/resume/cancel、最多 100 个批量 ID、逐项结果、删除等待在途工作静止 | 已接线：`task-management/integration.ts` 驱动真实 Planner/Worker，普通删除等待 FINAL/pause/drain 并调用会话 prepare/commit 协议；工作台与 `redteam_delete_task`。 | 删除领域 12、生命周期 12、API 12；新删除 UI 单项 1/1 通过。会话清理 hook 的主入口组合、批量控制/批量删除用户路径仍需接线验收。 |
| T06 并发准入与重启 | `server/server.go:289`、`:3454`；持久 queued/queued_at/queue_mode，FIFO 准入、调高上限补位、关闭限制放行、恢复全部已准入任务 | 已接线：持久 `runtime-settings.ts`、共享 store FIFO、任务准入热更新与启动恢复；独立于 Worker 并发。 | 生命周期专项验证并发/FIFO/恢复；真实桌面多 scope 重启最终验收待主集成。 |
| T07 截止与收尾 | `server/engine_timeout.go:70`、`:96`、`:131`、`:184`、`:232`；first_run_at/deadline_at、独立 deadline 协调器、收尾 Worker、最后 Planner 判定、timeout 状态 | 已接线：firstRun/deadline 持久化、独立期限协调、Worker timeout 收尾、Planner FINAL 与 done/timeout。 | 专项覆盖暂停/恢复不重置期限及终态释放；组合后的 FINAL 和真实模型收尾需最终回归。 |
| T08 任务模型链 | `server/server.go:729`、`server/task_llm.go`、`server/task_resolution.go`、`db/schema.sql:696`；有序 profiles、active profile、chain revision、故障状态、resolution 诊断 | 已接线：`runtime-profiles.ts` 持久 profile CRUD、`llm-chain.ts` 链状态/修订、真实 DSH 路由、reporter/retester 绑定；原生 UI 可编辑。 | profile/链及输出前重放专项通过；全局共享健康池另见 L01，真实 provider 网络未据此验证。 |
| T09 冷归档 | `server/server.go:694`、`server/task_archives.go`、`server/task_archive_package.go`、`db/schema.sql:571`；持久 FIFO、单项/批量归档还原删除、版本化 tar.zst、共享资源保留 | 已接线：`ArchiveRuntime`、恢复/删除/中断恢复工具、Session/traffic/interception 适配、checksum/journal；共享资产解绑与恢复重映射见 [shared-assets.md](shared-assets.md)。 | 归档原回归 13/13 通过；批量 FIFO 冷归档管理 UI、主/旁路会话及新增外置存储归档完整性和自动恢复入口须继续核验。 |
| A01 资产库存 | `server/assets.go:319`、`:396`、`:420`、`:449`，`db/schema.sql:40`；按类型筛选/分页/计数、类型化插入归一化去重、批量删除 | 已接线：图工具六类型归一化、自然键 upsert、DSL、派生资产；`asset-management` 全局列表/计数/批量删除工具、owner HTTP 与“资产管理”标签均已安装。 | ScopeSentry 私有服务、真实远端凭据和最终桌面验收仍待验证。 |
| A02 公司与范围归属 | `server/assets.go:77`、`:95`、`:149`、`:181`、`:247`、`:297`；company_scope、增加/重置范围、删除公司可选删除资产、reattribute | 已接线：企业创建/范围与任务关联；`asset-management` 公司详情、删除、reset scope、reattribute 的工具、owner HTTP 与 UI 均已安装。 | 企业任务共享原资产已验证；真实多用户权限组合和桌面验收仍待验证。 |
| A03 任务资产关联与来源 | `server/task_assets.go:24`、`:70`、`:95`、`db/schema.sql:648`；attach/detach、asset-refs、intent-assets、source_summary/source_node_id | 已接线：`shared-assets.ts` 保存 task_ids/task_sources，创建/删除/归档共享关系；`asset-management/task-assets.ts` attach/detach/refs，owner HTTP 已安装。 | 共享生命周期 12/12；恢复自然键只补关系，不覆盖热业务字段。新增资产管理标签的最终桌面验收待补。 |
| A04 范围、覆盖率、未测资产 | `server/server.go:702`、`:717`、`db/schema.sql:738`、`agent/tools.go:193`；覆盖开关、scope 行、分母/已测/百分比、按类型统计和 coverage graph | 已接线：`graph-tools` scope、coverage、untested、图覆盖统计、coverageEnabled 工具可见性与提示词语义。 | 领域专项见 [graph-tools.md](graph-tools.md)；可视化覆盖图/完整管理 UI 与真实宿主回归仍待验收。 |
| A05 ScopeSentry 同步 | `server/sync_scopesentry.go:74`、`:118`、`:166`、`:209`、`:258`、`:390`、`:424`；数据源配置、项目/任务选择、MCP 分页同步、归一化入库 | 已接线：`asset-management/scopesentry.ts` 及 owner HTTP/工具提供数据源、状态、项目/任务查询与分页同步，资产管理标签可操作。 | 真实私有 ScopeSentry 服务、凭据与端到端分页同步未验证；外部服务错误必须保持可见。 |
| G01 探索图与 frontier | `server/server.go:755`、`:770`、`db/schema.sql:153`、`:170`、`:248`、`:276`；intent/fact/digest/goal 等节点、typed edges、锚点、分页节点/引用 | 已接线：`graph-tools/index.ts` 安装 graph_overview/frontier/node_detail/facts/digest/source 查询，类型与边/锚点扩展已进入 store。 | 领域算法专项已报告通过；图 UI 仍是现有资产/探索视图，完整交互及全宿主另验。 |
| G02 Goals 与 constraints | `server/goals_api.go`、`server/constraints_api.go`、`server/server.go:720`；目标人工增改复活任务、硬删除不复活；约束 CRUD 不通知 planner | 已接线：目标/约束 CRUD、目标证明与人工编辑通知，工作台详情；Planner/Worker 每次请求读取真实约束。 | 工作台和图专项覆盖主要行为；独立注入开关依赖 system-runtime 主入口接线，见 P02。 |
| G03 自动 Planner | `agent/planner.go:106`、`:146`、`:355`，`server/engine.go`；启动规划、增量事件 debounce、heartbeat、持久 todos、goal 判定、意图生成、Worker 调度 | 已接线：`src/index.ts` 调用 `installPlanner`，传真实 DSH 模型路由和 platform prepareRun；Worker 事件/图变更通知与 lifecycle 恢复。 | 自动规划、heartbeat、FINAL 专项已有覆盖；真实付费 provider/目标网络与最终全部组合回归未据此证明。 |
| G04 Worker 控制与回读 | `server/server.go:731`、`server/intent_intervention.go:38`、`agent/worker.go`；pause/resume/cancel、运行中消息、blocked/exhausted/stopped 重跑、批量 blocked 重跑 | 已接线：`WorkerRuntime` 真子会话、精确绑定、停止/消息/历史 trace；platform prepareRun/timeout 收尾和可见文本落盘。 | 领域及原生子会话测试见各域记录；运行中重跑/批量重跑的完整 UI 仍缺，最终后代排空组合需验。 |
| G05 历史、主会话、审计、GC | `server/server.go:773`—`:785`，`db/schema.sql:298`、`:346`；活动分页/游标/详情/SSE、主会话分段新建、audit、gc | 已接线部分：持久 WorkerTrace/活动页；`conversation-workspace` HTTP/UI 提供 Session 映射、主对话消息、旁路 SSE、文件和删除 drain。 | ARTEX activity history 的全量审计/GC 语义仍未完全等价；新增会话标签的宿主浏览器验收待补。 |
| G06 冷图压缩、上下文压缩 | `agent/coldgraph.go:45`、`:105`、`:183`、`:210`、`agent/compaction.go`、`agent/noa.go`；按轮次冷热/邻域折叠 digest、内容版本签名、noa 开关 | 已接线：`planner/integration.ts` 创建 GraphCompactor 并接每轮生命周期，digest 生成/签名/失效与展开工具；NOA 模块见 system-runtime。 | 冷图算法/压缩器有专项；接线文档记录过输出 token 上限失败，最终修复/回归由主集成确认。NOA 安装与真实模型压缩未全验。 |
| F01 漏洞记录与生命周期 | `db/schema.sql:1081`，`server/server.go:762`—`:769`，`agent/finding_recorder.go`；结构化 evidence、独立 findings、状态/名称/等级/类型编辑、删除 | 已接线：`installDshFindings`、结构化证据、九状态编辑、独立 finding、事件同事务；默认任务删除保留 finding/证据。 | 领域测试见 [findings-reports.md](findings-reports.md)，共享删除额外回归通过；完整编辑 UI/宿主行为待验。 |
| F02 漏洞分组、血缘与导出 | `server/findings_groups.go:30`、`:45`、`:58`、`:92`，`server/server.go:2109`—`:2179`；asset tree、group、stats、lineage/deepen；filtered/all/selected × md-single/md-zip/csv/json | 已接线：findings 分组/统计/asset tree/血缘、深入任务创建、多格式选择/筛选导出领域及工具。 | 独立域报告 52 项通过；HTTP 下载与可视化管理页面仍需总集成，旧 snapshot 发现页不代表全部操作可用。 |
| F03 漏洞复测 | `server/finding_retests.go:21`、`:61`、`:144`、`:194`，`db/schema.sql:1112`；active/history、独立 retester、结果记录与收尾 | 已接线：独立 retester 原生子会话、活动去重/历史/取消、实际 session/caller 绑定与判定结果。 | 本地模型 Adapter 专项通过；没有调用真实供应商，不能标记真实复测服务端到端通过。 |
| F04 漏洞流量证据 | `server/finding_traffic.go:82`、`evidence/store.go:182`、`:197`、`:247`、`:347`，`db/schema.sql:1146`、`:1163`；绑定角色/说明/排序/删除、乐观版本、body 分段读取、不可变哈希快照 | 已接线：不可变 body/hash 快照、角色/顺序/说明绑定、乐观版本、分段 body 与导出。 | 绑定冲突和原 traffic 删除后证据保留已有测试；存储采用 JSON/base64，不等价 PostgreSQL/文件去重 GC 性能。 |
| F05 报告 | `server/server.go:813`、`report/report.go`、`report/findings.go`、`server/orchestration.go:426`；任务报告、漏洞报告更新 evidence_version、自动 reporter 触发 | 已接线：任务报告、finding evidenceVersion 更新、自动 reporter 与平台模型绑定。 | 结构/版本及原生会话边界专项；真实模型报告质量、完整下载入口需另验。 |
| H01 流量捕获 | `traffic/traffic.go:176`、`:317`、`:354`、`:359`；录制代理、CA、上游代理、Agent 环境绑定；`server/server.go:3293`/`:3507` | 已接线：TrafficRuntime、真实 mitmdump bridge、CA、上游/全局代理、Agent shell/MCP/脚本环境及录制开关。 | 本地真实 HTTP/TLS/二进制/大 body/WebSocket 回归见 [traffic.md](traffic.md)；外网目标与用户代理未调用。 |
| H02 流量检索与清理 | `server/server.go:786`—`:792`，`traffic/traffic.go:134`、`:950`、`:999`、`:1030`、`:1083`、`:1897`；host+端口、分页索引、body 全文子串、exchange/blob、按主机/全量删除 | 已接线：traffic hosts/search/get/body/delete 工具、持久索引/blob、端口/正文搜索和 SHA 清理；证据快照独立保留。 | 领域本地服务回归通过；归档/删除共享锁已进入源码，最终并发组合回归由主集成确认；无 SQLite/FTS 性能等价声明。 |
| C01 任务主对话 | `server/server.go:814`—`:818`、`server/chat_mentions.go`、`server/chatupload.go`；后台 run 不随 HTTP 断开取消、每任务串行、附件上传、@ mentions、状态和停止 | 已接线：`conversation-workspace/conversations.ts` 任务主对话映射、串行后台 run、停止/历史/附件/mentions；HTTP/工具安装器与“会话与文件”标签已注册。 | 真实桌面 task-main 绑定、路由鉴权和完整前端路径尚未完成浏览器验收。 |
| C02 独立会话 | `server/conversations.go`、`server/server.go:824`—`:833`、`db/schema.sql:954`、`:970`；创建/重命名/批量删除、Agent/profile pin、消息详情、停止 | 已接线：ConversationRuntime 独立实体与真实 DSH session、Agent/profile pin、重命名、删除前 drain、历史与停止；owner HTTP 和会话标签已注册。 | 独立模块测试不能替代真实用户已有会话映射/迁移与 UI 验收。 |
| C03 旁路提问 | `server/side_questions.go:273`、`:288`、`:421`、`:510`、`:528`，`sidequestion/service.go`，`db/schema.sql:1189`/`:1207`；conversation/main/worker 三类父会话、GET/POST/DELETE、事件流、取消、请求幂等、快照/记忆 | 已接线：`side-questions.ts` 三类父上下文、真实请求冻结、后台旁路模型、幂等/取消/清空/删除事务；工具/HTTP/SSE 与会话标签。 | [side-questions.md](side-questions.md) 记录 8/8 专项；profile revision、归档持久数据和新 UI 的桌面组合尚待核验。 |
| M01 Agent 管理 | `server/server_mgmt.go:222`—`:469`、`db/schema.sql:766`；内置/自定义角色、enabled、model、max_turns/run_seconds、search/shell、trigger 策略 | 已接线：`installPlatform` 的 Agent CRUD、角色/开关/预算/模型、Planner/Worker/reporter/retester/custom 真实运行装配；平台资源标签通过 owner HTTP 提供管理 UI。 | 源码与本地宿主专项见 [platform.md](platform.md)；真实远程模型和桌面组合仍待验收。 |
| M02 提示词版本与收尾 | `server/server_mgmt.go:512`—`:682`、`db/schema.sql:804`/`:820`；prompt 保存/重置/版本列表/变量目录/预览；wrapup 与 task-timeout wrapup 分开配置 | 已接线：platform prompt 版本/变量/预览/reset，普通 wrapup 与任务超时 prompt/预算分别应用。 | 模板与实际 run 装配有专项；Go template 仅承诺已覆盖原模板语法，不承诺任意 Go 程序。 |
| M03 自定义触发器与调度 | `server/triggers.go:11`、`server/scheduler.go:117`—`:284`、`db/schema.sql:993`/`:1025`；interval/finding/goal_met/task_timeout/task_create/tool_call；serial/parallel、merge all/by_task/none、max_parallel、水位 | 已接线：platform triggers 持久水位、事件/interval、合并、串并行容量、自定义原生 Agent 调度。 | 本地事件/调度回归；真实桌面跨重启和远程模型依最终集成结果。 |
| M04 内置工具定制 | `server/server_mgmt.go:743`、`:773`、`:809`、`server/assembly.go:212`、`agent/toolcatalog.go:113`/`:142`，`db/schema.sql:935`；描述/schema 默认值覆盖、reset、按 Agent 绑定 | 已接线：工具 schema/描述/default 覆盖与 reset、按 role/Agent 显隐及真实执行 guard；平台资源标签提供 owner 管理路径。 | 本地真实工具定义/调用专项已通过；真实宿主跨 scope 组合仍待验收。 |
| M05 自定义脚本工具 | `server/customtool.go`、`server/platform_tools.go:197`/`:223`、`server/server.go:859`—`:864`；创建/编辑/删除/test、Python 解释器检测、Agent 绑定 | 已接线：自定义脚本工具 CRUD/test、Python detect/config、真实进程输出/退出/超时与角色绑定。 | 本地脚本运行已按域测试；用户解释器和目标网络未验证。 |
| M06 MCP 与动态装配 | `server/server_mgmt.go:847`—`:941`、`server/mcpdiscover.go`、`server/assembly.go:25`、`agent/deferred.go:18`，`db/schema.sql:833`/`:864` | 已接线：MCP CRUD/discover/cache/stdio/http/sse，按 Agent/Skill 门控、deferred 解锁和历史重放；平台资源标签提供列表、发现、配置及执行反馈。 | 本地 MCP 服务专项；用户私有 MCP 和真实凭据未访问。 |
| M07 Skill 管理与使用追踪 | `server/server_mgmt.go:975`—`:1678`、`server/skill_zip.go`、`server/skill_usage.go`、`db/schema.sql:900`；CRUD、ZIP 上传、meta、目录/文件编辑、missing/usage | 已接线：Skill CRUD/ZIP/目录文件/usage/missing，与真实 run 的使用追踪；平台资源标签提供 Skill 创建、列表和用量查询。 | 领域路径与运行行为专项；真实桌面上传/下载仍待验收。 |
| M08 资源可见性 | `server/server_mgmt.go:704`/`:717`/`:1703`—`:1753`，`db/schema.sql:877`/`:888`；Agent→资源和资源→Agent 双向查看/切换 | 已接线：双向资源可见性、deny/default/关联 Skill 门控、复制/删除绑定；平台资源标签提供 owner 操作入口。 | 真实装配 guard 有专项；最终跨 scope 权限组合与桌面验收仍待验。 |
| L01 模型配置与健康池 | `server/server.go:737`—`:739`、`server/server_mgmt.go:1777`—`:1979`、`server/llmpool.go`、`server/llmretry.go`，`db/schema.sql:362`/`:479` | 已接线：profile CRUD/active/任务链与 system-runtime/model-health 共享健康池、熔断/限流/重试策略、连通测试；系统设置标签已注册。 | 真实 provider 测试待用户实际配置；健康策略 UI 尚未完成最终桌面验收。 |
| L02 LLM 录制与 token 统计 | `server/server.go:779`—`:782`、`:795`—`:799`，`llmrec/llmrec.go`、`llmrec/capture.go`；开关、列表/详情/原始请求响应/删除、按任务/模型/日期/会话汇总 | 已接线：`observability` 保存规范化请求/chunks/错误/token/归属，工具及 owner HTTP 查询/开关/删除/usage；`wire.ts` 包装宿主全局 undici dispatcher，采集实际请求/响应字节、SSE 与重试；调用记录标签已注册。 | 经过该 dispatcher 的传输可录原始 body；本地 Adapter、传输前失败及自有 transport明确 unavailable。新增传输专项存在，本轮未重跑，不推定所有 provider兼容。 |
| S01 命令记录与工具用量 | `server/commands.go`、`server/tool_usage.go`、`server/server.go:793`/`:794`，`db/schema.sql:919` | 已接线：observability 真实工具 pre/execute/result 记录参数、结果、失败/拒绝、耗时与用量统计；调用记录标签提供查询。 | 不是只读取 WorkerTrace；完整宿主组合及复杂筛选待验。 |
| S02 全局工具拦截与审批 | `server/intercept.go:98`—`:534`、`db/schema.sql:1033`/`:1053`；tool_name/tool_input × string/regex，allow/deny/ask，priority、超时决策、pending/detail/decide/history/execution | 已接线：`installInterception`、真实 DSH approval、owner HTTP pending/decide/history、规则优先级/隔离/超时/执行关联；原生审批标签。 | 领域验证及 UI 证据见 [interception.md](interception.md)；最终真实桌面卡片和全部角色组合另验。 |
| S03 资产拦截规则 | `server/asset_intercept.go`、`server/task_intercept.go`、`db/schema.sql:1241`/`:1267`；全局黑名单 domain/IP/URL/CIDR，任务 allow/block，CRUD/toggle，模板规则快照 | 已接线：全局与任务资产策略、类型化 domain/IP/URL/CIDR 匹配、模板快照和图插入检查。 | 规则/归一化领域回归；完整管理 UI 待验，不能用工具 regex 替代资产策略。 |
| S04 审批 LLM judge | `server/intercept.go:35`、`:418`—`:450`；未命中规则时模型审查、专用配置、token 用量、降级到人工路径 | 已接线：独立 judge 路由、结构化判定/用量、错误及 timeout 降级策略与原生审批衔接。 | 本地模型边界专项；真实 judge 供应商尚未调用。 |
| N01 通知配置与投递 | `server/notify_api.go:114`—`:491`、`server/notifier.go`、`notify/`，`db/schema.sql:1303`—`:1359`；飞书/钉钉/企微/Telegram/Email/Webhook，realtime/digest、filter/template/rate、test/history/retry、租约重试 | 已接线：多渠道、签名/SMTP、template/filter/rate/digest/租约重试；持久设置和渠道 list/create/update/delete 工具。 | 现有投递/渠道专项；完整管理 UI、原版所有 meta/test/history/retry 用户入口以及真实第三方发送待验。 |
| P01 工作区文件 | `server/workspace.go`、`server/server.go:710`—`:716`；list/read/write/mkdir/delete/download/upload、任务工作根目录 | 已接线：`conversation-workspace/files.ts` 任务/session 根、list/read/write/mkdir/delete/upload/download、附件、路径边界与删除暂存；会话与文件标签可操作。 | 归档路径、Agent cwd、真实桌面上传/下载端到端待组合。 |
| P02 系统设置 | `server/server.go:3285`/`:3361`，前端 `web/src/app/(main)/system/settings/page.tsx:21` | 已接线：任务准入、profile、流量、通知、Python 配置已持久；`system-runtime` 提供搜索/密钥/模型池/约束/NOA，系统设置标签可操作。 | 各键的真实作用时机仍按下一节逐项验收，不能只凭页面保存成功证明运行时已生效。 |
| P03 认证、健康与仪表盘 | `server/auth.go`、`server/server.go:655`—`:664`、`:947`/`:951`；初始化/login/change-password/JWT/CORS、health、stats、server logs | 认证已接线：`src/index.ts` 用真实 `connection.admit(request)`，拒绝非 owner，并保护 snapshot、任务工作台、资产/会话/观测性/系统/平台/宿主 HTTP。宿主 HTTP 提供 health、stats、logs、history、SSE。 | ARTEX 的 JWT/login/change-password 仍由 DSH 宿主负责；统计字段按 DSH store 可用数据投影，真实桌面组合仍待验收。详见 [host-management.md](host-management.md)。 |
| P04 应用更新 | `server/update.go`、`server/server.go:668`—`:671`；check/apply/rollback/stream | `host-management/versions.ts` 提供显式 `HostVersionManager`：只调用 DSH rc2 `dsh plugin --profile <name> ...`，保留 exitCode/diagnostics，local 包要求 runtime compatibility manifest；UI 在注入 manager 时提供 check/apply/rollback/stream。 | DSH 没有成功版本历史 rollback API，rollback 明确是旧 spec 的显式安装且返回 `rollback:false`；未注入 manager 时端点保持 404。真实 profile、包源和迁移仍需由部署者提供。 |

## 设置键逐项核对

以下写入键来自 `ARTEX:server/server.go:3362-3392`，读取字段来自 `:3292-3320`。密钥仅读出 `brave_key_set` / `tavily_key_set`，不得回显原值。

| 设置 | 原作用时机/边界 | DSH 核对结果与验收 |
|---|---|---|
| traffic_capture | 重建 Agent 代理、流量工具和提示词 | 已安装 TrafficRuntime/controls/environment，持久开关及真实代理环境；具体行为验证见 traffic.md |
| agent_traffic_binding | 新工具执行读取 Agent/流量绑定 | 已接线持久 trafficBindingEnabled，图工具和 finding 读取真实开关，环境关联实际 task/session |
| llm_record | 每次调用读开关，即时生效 | observability 持久 recording 设置与工具/HTTP 已安装，调用记录标签可读取真实记录 |
| web_search_enabled / web_search_backend | ddgs、brave-free、tavily、deepseek；改变工具与 provider 装配 | system-runtime 实现后端选择、搜索工具和 test；主入口及 DeepSeek 实际凭据 resolver 待组合 |
| brave_search_api_key / tavily_search_api_key | 省略/null 不变，空串清空，test 空输入可用已存值 | system-runtime/settings 与 testSearch 实现存储/脱敏/测试取值；真实密钥未使用，主入口待安装 |
| web_search_proxy / global_proxy | http/https/socks5，独立搜索出口与全局目标出口分开 | global_proxy 已在 traffic 接线；搜索独立 proxy 已有 system-runtime 实现，尚待接入 |
| python_interpreter | 指定路径或自动 detect；用于自定义脚本工具 | platform-resources 持久配置、检测及真实脚本工具执行已接线 |
| workers | 正整数，对之后启动任务生效 | plannerConcurrency 已传 Planner/Worker；尚未发现与原 workers 等价的公开持久热设置入口 |
| task_concurrency_enabled / task_concurrency_limit | 持久上限，改动立即协调 FIFO | runtime-settings 已安装，工作台与管理工具可读写，生命周期专项覆盖 FIFO/热更新 |
| llm_pool_enabled / llm_pool_bind_fallback | 重建 provider 链，保留健康 registry | system-runtime/model-health 已安装并由系统设置 UI 提供开关、策略、健康重置与测试；真实 provider 作用时机待实机验收 |
| constraints_inject_planner / constraints_inject_worker | 每轮读取，分别开关，默认开 | Planner/Worker 每轮读取约束，system-runtime 设置持久化开关已接入；最终提示词效果仍需实际 run 验收 |
| noa_compaction | 每 run 读取，默认关 | compaction.ts / compaction-host.ts 已接入系统运行时；run 投影、schema 压缩与宿主 compaction 互斥，真实 Noa provider 组合仍待验收 |
| notify_enabled / notify_public_base_url / notify_digest_interval_min | 投递每轮读取；base_url 验证 http(s)，周期 1—1440 分钟 | NotificationSettingsRuntime 与管理工具已安装，dispatcher 每轮读持久设置；完整设置 UI/真实渠道发送另验 |

前端专有设置也属于用户能力：`web/src/lib/chat-send-mode.ts`（发送键方式）、`web/src/lib/sort-preference.ts`（排序）、`web/src/lib/preferences/`（主题/布局）。可映射 DSH 宿主设置，但应逐项确认效果和迁移路径；并非 HTTP settings 表中不存在就可以忽略。

## 前端页面覆盖

原页面总清单在下方自动库存中。当前 `DSH:src/client-entry.ts` 注册 **13 个标签**：任务工作台、资产图、发现、流量、活动、报告、审批、资产管理、系统设置、调用记录、会话与文件、平台资源、宿主与更新。任务工作台包含任务/模板/分类、详情、目标/约束、profile/模型链、运行/暂停/恢复、队列设置及二次确认删除；新增页面通过实际 owner HTTP 操作资源。snapshot 标签仍只提供对应查询视图，不能替代完整资源管理页。

[task-workspace.md](task-workspace.md) 记录已有 3 项原生浏览器专项；本轮另执行新增删除单项 1/1，通过首次确认、取消、确认后删除及共享资产保留。二者分次执行，没有声称当前完整 4 项套件重新跑过。新增页面的 HTTP 接口和错误态已接入，但当前尚未重跑新增标签的桌面浏览器验收。真实 Dashboard、独立 Chat/文件/旁路、全局 Assets/ScopeSentry、Commands/LLM Records、Agent/Tools/MCP/Skills、全局模型池/Notify/Settings/Logs 用户路径仍须在最终宿主中验收。

UI 验收应从用户操作验证：真实创建任务并选择模板/分类→运行/暂停/恢复→查看 Worker 及图中增量→处理审批→记录漏洞和绑定流量→导出报告→归档/还原；另验证各系统资源 CRUD 和设置生效。只渲染 snapshot JSON 或成功构建客户端 bundle 不足以通过。

## 服务域与工具装配补充

HTTP 路由不能穷尽 Agent 可用能力。`ARTEX:agent/tools.go:2033` 的 PlannerTools、`agent/tools_insert.go:644` 的 WorkerTools、`:664` 的 MainAgentTools、`:688` 的 AllDomainTools，以及 `server/assembly.go:25` 的动态装配共同决定真实工具集。需要保留或明确映射资产归一化、graph_overview/node_detail/list_facts、意图创建与控制、Worker 回读、目标证明、范围/未测资产、finding 记录/报告/流量绑定、跨任务 orchestration、Skill/MCP 创建编辑、网页检索、交互 shell、todo、context compression 等能力。

`server/orchestration.go:176-456` 额外公开 list_tasks、list_llm_profiles、spawn_task、pause_task、get_task_graph、list_task_findings、add_task_hint、get_task_worker_trace、list_task_worker_traces、search_task_worker_traces、get_task_node_detail、update_finding_report。`server/platform_tools.go:18` 增加资产按 host 删除、Skill 创建/文件更新、自定义工具及 MCP 创建/更新。DSH 的统一前缀工具可以重命名，但其参数、权限、状态变化与读取范围必须可对照，不能仅凭名称近似判定保留。

持久化也有 HTTP 之外的契约：PostgreSQL 领域表、探索节点及索引、traffic 独立索引/正文、内容寻址 evidence 文件、transcript、工作目录、归档 journal/package、通知 delivery leases。当前 JSON store 实现必须证明跨会话串行写入、崩溃恢复和多资源操作一致性，不能只替换字段容器。

## 验证边界与交付门槛

本次矩阵更新读取最新源码及各领域交付记录。亲自运行的共享资产/删除相关结果：shared-assets 12、archives 13、task-management-integration 9、task-lifecycle-runtime 12、task-workspace-api 12 均通过；新增删除浏览器单项 1/1，退出码 0，14.43 秒。最终真实 DSH rc2 隔离 profile 探针通过：安装包、composed config、redteam preset、145 个 redteam 工具（含 Agent Team 原生工具）、10 个未认证路由均核验为 401，认证 snapshot/task workspace/probe 均为 200；证据见 [宿主报告](../host-verification/2026-10-18T02-25-30-716Z-fb5eb5b6/report.json)。Agent Teams 与 workflowEngine 的 service 实例按 delegation isolate realm 提供给 redteam-agent，外层 Agent context 不直接显示服务对象是 DSH 设计。详见 [shared-assets.md](shared-assets.md)。其他域结果按文档引用，未为更新矩阵重跑。源码存在但没有当前退出状态的测试只视为已编写。

本轮未启动 ARTEX、未执行真实第三方发送、未更新或降级 DSH/插件、未改用户 profile。最终 `tsc --noEmit` 与 `npm run build` 已由主集成会话串行通过；新增 observability/conversation/archive 组合测试有 20/22 通过，两个失败分别是测试夹具未加载 AgentLoop factory 与 fixture-only Planner 文本模型超过 12 轮，未作为完整宿主通过。平台 47/47 通过，系统 runtime 65/65、REA 原生包专项和其他域结果按各文档引用。旧领域测试与当前组合层并不自动等价；仍需要最终桌面浏览器和真实 provider 结果。

宣布“完整迁移”前，每行须补：已接入的领域操作、DSH 工具/宿主/API 入口、可用 UI/等价用户路径、迁移已有数据的路径、目标测试及结果。采用 DSH 承接原认证、会话、模型、MCP、Skill、文件或更新能力时，记录实际安装版本和真实接口证据。不能把待宿主核对直接改为已完成。

## P03 / P04 宿主只读核对

安装包为 `C:/Users/xiaoz/AppData/Local/Programs/DeepSeek Harness/resources/app.asar`，桌面及内置 `@deepseek-ai/dsh` / `dsh-plugin-manager` 均为 **0.2.1-rc.2**。以下 ASAR 成员位置按本机包读取，不由线上最新版推断。仅解析 header 并提取指定 JS，没有执行包安装/更新/回滚。REA doctor 本次返回非零且没有有效报告，因此以下是直接静态源码证据，不称为 REA 分析成功。

### 认证、健康、统计和日志

`src/index.ts` 的 UI 注入依赖真实 `connection`：`connection.admit(request)` 的 rejection 原样转为 401/403，成功后仍要求 `peer.principal.kind === 'owner'`。该函数传入任务工作台、拦截 HTTP、资产/会话/可观测性/系统/平台/宿主 HTTP，并直接保护 snapshot。API 专项可验证拒绝行为，真实桌面 admission 组合由主集成测试验证。

原 `ARTEX:server/server.go:947-949` health 返回 ok/service/version；`:951-1030` stats 返回全局流量/资产类型计数及指定任务的模型可用性、exploration、engine_mode、in_flight、llm_in_flight、last_activity、stalled、目标完成数。`:2879-2969` 提供环形日志游标、数据库历史分页和 SSE 重放/实时追加。当前插件已由 `host-management/http.ts` 提供 owner 保护的 health、stats、logs、logs/history、logs/stream；stats 以 DSH store、TrafficRuntime 和宿主 LLM 配置投影可用字段，日志由 Cordis logger exporter 写入独立 journal。ARTEX 的 JWT/login/change-password 仍由 DSH 宿主承担，不能把 owner admission 说成 ARTEX 认证数据库的迁移。

### 插件检查、升级、恢复与输出流

| ARTEX 能力 | 已安装 DSH 的实际证据 | 等价边界 |
|---|---|---|
| check | ASAR `dsh/node_modules/@deepseek-ai/dsh-plugin-manager/lib/index.js:1814-1820` 的 `inspect(spec, options, signal)` 检查待装 spec；`lib/types/operations.js:637` 的 `viewProfilePackage()` 执行 `pnpm view <spec> name version description dsh --json` | 可读 registry 包版本/元数据，但没有“比较当前插件并判断是否应升级”的专用 API；inspect 也会拒绝已经安装的 registry 包，不能直接充当 update check |
| apply | ASAR `dsh/node_modules/@deepseek-ai/dsh/lib/bin.js:115-126` 注册 `dsh plugin --profile <name> <pnpm-args...>`；`lib/plugin-BiveYA7h.js:63-98` 转发至 `runProfilePnpm/runPluginCommand`；PluginManager `installBundle` 接收明确 spec | `host-management/versions.ts` 通过显式 `HostVersionManager` 转发包安装，保留 exitCode/diagnostics；本轮未对真实 profile 执行安装 |
| rollback | plugin-manager `lib/types/operations.js:299` 起备份 manifest/lock，失败或兼容拒绝恢复；`lib/index.js:2114-2130` 的 cancelInstall 等待安装退出并恢复文件 | 版本适配器要求显式旧 spec 和 compatibility manifest；返回 `rollback:false`，因为 DSH 没有成功版本历史回滚 API |
| stream | PluginManager `lib/index.js:1980` / `:2123` 发 install-state，`:2221` / `:2234` / `:2252` 发 install-log；CLI `onOutput` 透传 stdout/stderr；插件 `/api/redteam/host/update/stream` 在注入 manager 时转成 SSE | 事件只在版本管理器存在且 owner 已认证时暴露；没有 manager 时保持 404，不伪造更新能力 |

DSH CLI 对 desktop profile 有额外限制：`parseDshArgs(..., manageDesktopProfile=false)` 默认拒绝该保留 profile；安装载体显式允许才可管理。`requireDesktopProfile()` 要求先由桌面初始化，并提示完全退出桌面后运行。当前 PATH 中未找到 `dsh`，仅确认 ASAR 内 `@deepseek-ai/dsh/package.json` 声明 `bin: {dsh:'lib/bin.js'}`；因此本文不提供未经确认的本机可执行命令。不能直接把 ASAR 内路径当普通 Node 可执行脚本，也未为此写入 PATH/profile。

插件管理器的已装包行为还受 HMR 影响：`lib/index.js:1991` 在 hmr 存在且包已安装时抛出 `already-installed`；`lib/types/tools.js:12` 提示先 remove 再 install。不得把普通 `installBundle` 当作在所有运行模式都能原位升级。当前剩余产品缺口是部署者提供真实 profile、包源与兼容性清单后的版本实际操作验证，以及成功版本历史回退和数据迁移策略（DSH rc2 本身没有成功版本历史 rollback API）。

## 原始库存（由本机源码生成）

以下库存用于防漏：包含全部字面注册路由、动态路由展开、schema 表、页面。对应领域的覆盖与验收要求见上表。

### HTTP 字面路由

| Method / path | Handler | ARTEX 位置 |
|---|---|---|
| `GET /api/auth/status` | `authStatus` | `server/server.go:655` |
| `POST /api/auth/init` | `authInit` | `server/server.go:656` |
| `POST /api/auth/login` | `authLogin` | `server/server.go:657` |
| `POST /api/auth/change-password` | `authChangePassword` | `server/server.go:658` |
| `GET /api/health` | `health` | `server/server.go:660` |
| `GET /api/stats` | `stats` | `server/server.go:661` |
| `GET /api/logs` | `getLogs` | `server/server.go:662` |
| `GET /api/logs/history` | `getLogsHistory` | `server/server.go:663` |
| `GET /api/logs/stream` | `streamLogs` | `server/server.go:664` |
| `GET /api/update/check` | `updateCheck` | `server/server.go:668` |
| `POST /api/update/apply` | `updateApply` | `server/server.go:669` |
| `POST /api/update/rollback` | `updateRollback` | `server/server.go:670` |
| `GET /api/update/stream` | `updateStream` | `server/server.go:671` |
| `GET /api/tasks` | `listTasks` | `server/server.go:673` |
| `POST /api/tasks` | `createTask` | `server/server.go:674` |
| `GET /api/task-categories` | `pgListTaskCategories` | `server/server.go:675` |
| `POST /api/task-categories` | `pgCreateTaskCategory` | `server/server.go:676` |
| `PATCH /api/task-categories/{id}` | `pgRenameTaskCategory` | `server/server.go:677` |
| `DELETE /api/task-categories/{id}` | `pgDeleteTaskCategory` | `server/server.go:678` |
| `POST /api/tasks/category/batch` | `updateTasksCategoryBatch` | `server/server.go:679` |
| `GET /api/task-templates` | `pgListTaskTemplates` | `server/server.go:680` |
| `POST /api/task-templates` | `pgCreateTaskTemplate` | `server/server.go:681` |
| `PATCH /api/task-templates/{id}` | `pgUpdateTaskTemplate` | `server/server.go:682` |
| `DELETE /api/task-templates/{id}` | `pgDeleteTaskTemplate` | `server/server.go:683` |
| `GET /api/tasks/{id}` | `getTask` | `server/server.go:684` |
| `PATCH /api/tasks/{id}` | `updateTaskMetadata` | `server/server.go:685` |
| `PATCH /api/tasks/{id}/category` | `updateTaskCategory` | `server/server.go:686` |
| `GET /api/tasks/{id}/intercept-rules` | `taskInterceptListRules` | `server/server.go:688` |
| `POST /api/tasks/{id}/intercept-rules` | `taskInterceptCreateRule` | `server/server.go:689` |
| `PUT /api/tasks/{id}/intercept-rules/{rid}` | `taskInterceptUpdateRule` | `server/server.go:690` |
| `DELETE /api/tasks/{id}/intercept-rules/{rid}` | `taskInterceptDeleteRule` | `server/server.go:691` |
| `POST /api/tasks/{id}/intercept-rules/{rid}/toggle` | `taskInterceptToggleRule` | `server/server.go:692` |
| `POST /api/tasks/control/batch` | `controlTasksBatch` | `server/server.go:693` |
| `GET /api/task-archives` | `listTaskArchives` | `server/server.go:694` |
| `GET /api/task-archives/{id}` | `getTaskArchive` | `server/server.go:695` |
| `POST /api/tasks/{id}/archive` | `queueTaskArchive` | `server/server.go:696` |
| `POST /api/tasks/archive/batch` | `queueTaskArchivesBatch` | `server/server.go:697` |
| `POST /api/task-archives/{id}/restore` | `queueTaskArchiveRestore` | `server/server.go:698` |
| `POST /api/task-archives/restore/batch` | `restoreTaskArchivesBatch` | `server/server.go:699` |
| `DELETE /api/task-archives/{id}` | `queueTaskArchiveDelete` | `server/server.go:700` |
| `POST /api/task-archives/delete/batch` | `deleteTaskArchivesBatch` | `server/server.go:701` |
| `GET /api/tasks/{id}/coverage` | `taskCoverage` | `server/server.go:702` |
| `GET /api/tasks/{id}/coverage-graph` | `taskCoverageGraph` | `server/server.go:703` |
| `GET /api/tasks/{id}/asset-refs` | `taskAssetRefs` | `server/server.go:704` |
| `POST /api/tasks/{id}/assets` | `attachTaskAssets` | `server/server.go:705` |
| `DELETE /api/tasks/{id}/assets/{assetID}` | `detachTaskAsset` | `server/server.go:706` |
| `GET /api/tasks/{id}/intent-assets` | `taskIntentAssets` | `server/server.go:707` |
| `GET /api/workspace/list` | `wsList` | `server/server.go:710` |
| `GET /api/workspace/read` | `wsRead` | `server/server.go:711` |
| `POST /api/workspace/write` | `wsWrite` | `server/server.go:712` |
| `POST /api/workspace/mkdir` | `wsMkdir` | `server/server.go:713` |
| `DELETE /api/workspace/delete` | `wsDelete` | `server/server.go:714` |
| `GET /api/workspace/download` | `wsDownload` | `server/server.go:715` |
| `POST /api/workspace/upload` | `wsUpload` | `server/server.go:716` |
| `GET /api/tasks/{id}/scope` | `taskScopeList` | `server/server.go:717` |
| `POST /api/tasks/{id}/scope` | `taskScopeAdd` | `server/server.go:718` |
| `DELETE /api/tasks/{id}/scope/{sid}` | `taskScopeDelete` | `server/server.go:719` |
| `GET /api/tasks/{id}/goals` | `listGoals` | `server/server.go:720` |
| `POST /api/tasks/{id}/goals` | `addGoal` | `server/server.go:721` |
| `PATCH /api/tasks/{id}/goals/{gid}` | `editGoal` | `server/server.go:722` |
| `DELETE /api/tasks/{id}/goals/{gid}` | `deleteGoal` | `server/server.go:723` |
| `GET /api/tasks/{id}/constraints` | `listConstraints` | `server/server.go:724` |
| `POST /api/tasks/{id}/constraints` | `addConstraint` | `server/server.go:725` |
| `PATCH /api/tasks/{id}/constraints/{cid}` | `editConstraint` | `server/server.go:726` |
| `DELETE /api/tasks/{id}/constraints/{cid}` | `deleteConstraint` | `server/server.go:727` |
| `POST /api/tasks/{id}/control` | `control` | `server/server.go:728` |
| `PUT /api/tasks/{id}/llm` | `updateTaskLLMProfiles` | `server/server.go:729` |
| `GET /api/tasks/{id}/llm/resolution` | `taskLLMResolutionHandler` | `server/server.go:730` |
| `POST /api/tasks/{id}/intents/{iid}/control` | `controlIntent` | `server/server.go:731` |
| `POST /api/tasks/{id}/intents/{iid}/messages` | `sendWorkerMessage` | `server/server.go:732` |
| `POST /api/tasks/{id}/intents/{iid}/rerun` | `rerunIntent` | `server/server.go:733` |
| `POST /api/tasks/{id}/intents/rerun-blocked` | `rerunBlocked` | `server/server.go:734` |
| `POST /api/active` | `setActive` | `server/server.go:735` |
| `GET /api/llm` | `getLLM` | `server/server.go:737` |
| `POST /api/llm` | `setLLM` | `server/server.go:738` |
| `POST /api/llm/test` | `testLLM` | `server/server.go:739` |
| `GET /api/assets` | `listAssets` | `server/server.go:742` |
| `GET /api/assets/counts` | `assetCounts` | `server/server.go:743` |
| `POST /api/assets` | `insertAssets` | `server/server.go:744` |
| `DELETE /api/assets` | `deleteAssets` | `server/server.go:745` |
| `GET /api/companies` | `listCompanies` | `server/server.go:748` |
| `POST /api/companies` | `createCompany` | `server/server.go:749` |
| `GET /api/companies/{id}` | `getCompany` | `server/server.go:750` |
| `DELETE /api/companies/{id}` | `deleteCompany` | `server/server.go:751` |
| `POST /api/companies/{id}/scope` | `addCompanyScope` | `server/server.go:752` |
| `POST /api/companies/reattribute` | `reattribute` | `server/server.go:753` |
| `GET /api/exploration/frontier` | `frontier` | `server/server.go:755` |
| `GET /api/exploration/findings` | `findings` | `server/server.go:756` |
| `GET /api/exploration/findings/groups` | `findingGroups` | `server/server.go:757` |
| `GET /api/exploration/findings/asset-tree` | `findingAssetTree` | `server/server.go:758` |
| `GET /api/exploration/findings/stats` | `findingStats` | `server/server.go:759` |
| `GET /api/exploration/findings/export` | `findingsExport` | `server/server.go:760` |
| `GET /api/exploration/findings/{id}` | `getFinding` | `server/server.go:762` |
| `GET /api/exploration/findings/{id}/lineage` | `findingLineage` | `server/server.go:763` |
| `POST /api/exploration/findings/{id}/deepen` | `deepenFinding` | `server/server.go:764` |
| `GET /api/exploration/findings/{id}/retests` | `listFindingRetests` | `server/server.go:765` |
| `GET /api/exploration/findings/retests/active` | `listActiveFindingRetests` | `server/server.go:766` |
| `POST /api/exploration/findings/{id}/retests` | `startFindingRetest` | `server/server.go:767` |
| `PATCH /api/exploration/findings/{id}` | `patchFinding` | `server/server.go:768` |
| `DELETE /api/exploration/findings/{id}` | `deleteFinding` | `server/server.go:769` |
| `GET /api/exploration/intents` | `intents` | `server/server.go:770` |
| `GET /api/exploration/graph` | `explorationGraph` | `server/server.go:771` |
| `GET /api/exploration/nodes` | `explorationNodes` | `server/server.go:772` |
| `GET /api/exploration/activity` | `activity` | `server/server.go:773` |
| `GET /api/exploration/activity/history` | `activityHistory` | `server/server.go:774` |
| `GET /api/exploration/main-sessions` | `mainSessions` | `server/server.go:775` |
| `POST /api/exploration/main-session/new` | `newMainSession` | `server/server.go:776` |
| `GET /api/exploration/activity/stream` | `streamActivity` | `server/server.go:777` |
| `GET /api/exploration/activity/{seq}` | `activityDetail` | `server/server.go:778` |
| `GET /api/exploration/tokens` | `tokenStats` | `server/server.go:779` |
| `GET /api/tokens/daily` | `tokenDailyStats` | `server/server.go:780` |
| `GET /api/tokens/conversations` | `conversationTokens` | `server/server.go:781` |
| `GET /api/tokens/usage` | `pgUsageStats` | `server/server.go:782` |
| `GET /api/audit` | `getAudit` | `server/server.go:784` |
| `POST /api/gc` | `gc` | `server/server.go:785` |
| `GET /api/traffic` | `getTraffic` | `server/server.go:786` |
| `GET /api/traffic/hosts` | `getTrafficHosts` | `server/server.go:787` |
| `DELETE /api/traffic` | `deleteTraffic` | `server/server.go:788` |
| `DELETE /api/traffic/hosts` | `deleteTrafficHosts` | `server/server.go:789` |
| `DELETE /api/traffic/all` | `deleteAllTraffic` | `server/server.go:790` |
| `GET /api/traffic/exchange` | `getTrafficExchange` | `server/server.go:791` |
| `GET /api/traffic/blob` | `getTrafficBlob` | `server/server.go:792` |
| `GET /api/commands` | `pgListCommands` | `server/server.go:793` |
| `GET /api/commands/stats` | `pgToolStats` | `server/server.go:794` |
| `GET /api/llm/records` | `pgListLLMRecords` | `server/server.go:795` |
| `DELETE /api/llm/records` | `pgDeleteLLMRecords` | `server/server.go:796` |
| `GET /api/llm/records/tasks` | `pgLLMTasks` | `server/server.go:797` |
| `GET /api/llm/records/by-model` | `pgTokenByModel` | `server/server.go:798` |
| `GET /api/llm/records/{id}` | `pgGetLLMRecord` | `server/server.go:799` |
| `GET /api/settings` | `getSettings` | `server/server.go:800` |
| `PUT /api/settings` | `putSettings` | `server/server.go:801` |
| `GET /api/notify/meta` | `notifyMeta` | `server/server.go:804` |
| `GET /api/notify/channels` | `notifyListChannels` | `server/server.go:805` |
| `POST /api/notify/channels` | `notifyCreateChannel` | `server/server.go:806` |
| `PATCH /api/notify/channels/{id}` | `notifyUpdateChannel` | `server/server.go:807` |
| `DELETE /api/notify/channels/{id}` | `notifyDeleteChannel` | `server/server.go:808` |
| `POST /api/notify/channels/{id}/test` | `notifyTestChannel` | `server/server.go:809` |
| `GET /api/notify/deliveries` | `notifyListDeliveries` | `server/server.go:810` |
| `POST /api/notify/deliveries/{id}/retry` | `notifyRetryDelivery` | `server/server.go:811` |
| `POST /api/settings/web-search/test` | `testWebSearch` | `server/server.go:812` |
| `GET /api/report` | `getReport` | `server/server.go:813` |
| `GET /api/chat/mentions` | `searchChatMentions` | `server/server.go:814` |
| `POST /api/chat` | `chat` | `server/server.go:815` |
| `POST /api/chat/upload` | `chatUpload` | `server/server.go:816` |
| `GET /api/tasks/{id}/chat/status` | `taskChatStatus` | `server/server.go:817` |
| `POST /api/tasks/{id}/chat/stop` | `stopChat` | `server/server.go:818` |
| `DELETE /api/tasks/{id}` | `pgDeleteTask` | `server/server.go:821` |
| `GET /api/conversations` | `pgListConversations` | `server/server.go:824` |
| `POST /api/conversations` | `pgCreateConversation` | `server/server.go:825` |
| `POST /api/conversations/delete/batch` | `pgDeleteConversationsBatch` | `server/server.go:826` |
| `PATCH /api/conversations/{id}` | `pgRenameConversation` | `server/server.go:827` |
| `PATCH /api/conversations/{id}/profile` | `pgUpdateConversation` | `server/server.go:828` |
| `DELETE /api/conversations/{id}` | `pgDeleteConversation` | `server/server.go:829` |
| `GET /api/conversations/{id}/messages` | `pgConversationMessages` | `server/server.go:830` |
| `POST /api/conversations/{id}/messages` | `pgSendConversationMessage` | `server/server.go:831` |
| `POST /api/conversations/{id}/stop` | `pgStopConversation` | `server/server.go:832` |
| `GET /api/conversations/{id}/messages/{seq}` | `pgConversationMsgDetail` | `server/server.go:833` |
| `GET /api/agents` | `pgListAgents` | `server/server.go:835` |
| `POST /api/agents` | `pgCreateAgent` | `server/server.go:836` |
| `GET /api/agents/{key}` | `pgGetAgent` | `server/server.go:837` |
| `PATCH /api/agents/{key}` | `pgUpdateAgent` | `server/server.go:838` |
| `DELETE /api/agents/{key}` | `pgDeleteAgent` | `server/server.go:839` |
| `PUT /api/agents/{key}/config` | `pgSaveAgentConfig` | `server/server.go:840` |
| `PUT /api/agents/{key}/prompt` | `pgSavePrompt` | `server/server.go:841` |
| `POST /api/agents/{key}/prompt/reset` | `pgResetPrompt` | `server/server.go:842` |
| `PUT /api/agents/{key}/wrapup` | `pgSaveWrapup` | `server/server.go:843` |
| `POST /api/agents/{key}/wrapup/reset` | `pgResetWrapup` | `server/server.go:844` |
| `PUT /api/agents/{key}/wrapup/task-timeout` | `pgSaveTaskTimeoutWrapup` | `server/server.go:845` |
| `POST /api/agents/{key}/wrapup/task-timeout/reset` | `pgResetTaskTimeoutWrapup` | `server/server.go:846` |
| `GET /api/agents/{key}/triggers` | `pgListTriggers` | `server/server.go:847` |
| `POST /api/agents/{key}/triggers` | `pgCreateTrigger` | `server/server.go:848` |
| `PATCH /api/triggers/{id}` | `pgUpdateTrigger` | `server/server.go:849` |
| `DELETE /api/triggers/{id}` | `pgDeleteTrigger` | `server/server.go:850` |
| `GET /api/agents/{key}/prompts` | `pgListPromptVersions` | `server/server.go:851` |
| `GET /api/agents/{key}/variables` | `pgPromptVars` | `server/server.go:852` |
| `POST /api/agents/{key}/prompt/preview` | `pgPreviewPrompt` | `server/server.go:853` |
| `GET /api/agents/{key}/visibility` | `pgGetAgentVisibility` | `server/server.go:854` |
| `PUT /api/agents/{key}/visibility` | `pgSetAgentVisibility` | `server/server.go:855` |
| `GET /api/tools` | `pgListTools` | `server/server.go:857` |
| `PUT /api/tools/{key}` | `pgUpdateTool` | `server/server.go:858` |
| `POST /api/tools/custom` | `pgCreateCustomTool` | `server/server.go:859` |
| `POST /api/tools/custom/test` | `pgTestCustomTool` | `server/server.go:860` |
| `PUT /api/tools/custom/{key}` | `pgUpdateCustomTool` | `server/server.go:861` |
| `DELETE /api/tools/custom/{key}` | `pgDeleteCustomTool` | `server/server.go:862` |
| `POST /api/settings/python/detect` | `pgDetectPython` | `server/server.go:863` |
| `POST /api/tools/{key}/reset` | `pgResetTool` | `server/server.go:864` |
| `GET /api/mcp` | `pgListMCP` | `server/server.go:866` |
| `POST /api/mcp` | `pgSaveMCP` | `server/server.go:867` |
| `DELETE /api/mcp/{id}` | `pgDeleteMCP` | `server/server.go:868` |
| `GET /api/mcp/{id}/tools` | `pgMCPTools` | `server/server.go:869` |
| `POST /api/mcp/{id}/refresh` | `pgRefreshMCP` | `server/server.go:870` |
| `GET /api/sync/scopesentry/status` | `syncSSStatus` | `server/server.go:872` |
| `POST /api/sync/scopesentry/datasource` | `syncSSDatasource` | `server/server.go:873` |
| `GET /api/sync/scopesentry/projects` | `syncSSProjects` | `server/server.go:874` |
| `GET /api/sync/scopesentry/tasks` | `syncSSTasks` | `server/server.go:875` |
| `POST /api/sync/scopesentry/sync` | `syncSSRun` | `server/server.go:876` |
| `GET /api/skills` | `fsListSkills` | `server/server.go:878` |
| `POST /api/skills` | `fsCreateSkill` | `server/server.go:879` |
| `POST /api/skills/upload` | `fsUploadSkill` | `server/server.go:880` |
| `DELETE /api/skills/{name}` | `fsDeleteSkill` | `server/server.go:881` |
| `GET /api/skills/missing` | `fsMissingSkills` | `server/server.go:882` |
| `GET /api/skills/{name}/usage` | `fsSkillUsage` | `server/server.go:883` |
| `PUT /api/skills/{name}/meta` | `fsUpdateSkillMeta` | `server/server.go:884` |
| `POST /api/skills/{name}/dirs` | `fsCreateDir` | `server/server.go:885` |
| `GET /api/skills/{name}/files` | `fsListFiles` | `server/server.go:886` |
| `GET /api/skills/{name}/files/{file...}` | `fsReadFile` | `server/server.go:888` |
| `PUT /api/skills/{name}/files/{file...}` | `fsWriteFile` | `server/server.go:889` |
| `DELETE /api/skills/{name}/files/{file...}` | `fsDeletePath` | `server/server.go:890` |
| `GET /api/visibility/{kind}/{id}` | `pgResourceVisibility` | `server/server.go:892` |
| `POST /api/visibility/toggle` | `pgToggleVisibility` | `server/server.go:893` |
| `GET /api/visibility/skill/{name}` | `pgSkillVisibility` | `server/server.go:895` |
| `POST /api/visibility/skill/toggle` | `pgToggleSkillVisibility` | `server/server.go:896` |
| `GET /api/llm/profiles` | `pgListProfiles` | `server/server.go:898` |
| `POST /api/llm/profiles` | `pgSaveProfile` | `server/server.go:899` |
| `DELETE /api/llm/profiles/{id}` | `pgDeleteProfile` | `server/server.go:900` |
| `POST /api/llm/profiles/active` | `pgActivateProfile` | `server/server.go:901` |
| `GET /api/llm/retry-policy` | `pgGetLLMRetryPolicy` | `server/server.go:902` |
| `POST /api/llm/retry-policy` | `pgSaveLLMRetryPolicy` | `server/server.go:903` |
| `GET /api/llm/pool` | `pgLLMPoolStatus` | `server/server.go:904` |
| `POST /api/llm/pool/reset` | `pgLLMPoolReset` | `server/server.go:905` |
| `POST /api/llm/models` | `pgListModels` | `server/server.go:906` |
| `GET /api/intercept/rules` | `interceptListRules` | `server/server.go:909` |
| `POST /api/intercept/rules` | `interceptCreateRule` | `server/server.go:910` |
| `PUT /api/intercept/rules/{id}` | `interceptUpdateRule` | `server/server.go:911` |
| `DELETE /api/intercept/rules/{id}` | `interceptDeleteRule` | `server/server.go:912` |
| `POST /api/intercept/rules/{id}/toggle` | `interceptToggleRule` | `server/server.go:913` |
| `GET /api/asset-intercept/rules` | `assetInterceptListRules` | `server/server.go:916` |
| `POST /api/asset-intercept/rules` | `assetInterceptCreateRule` | `server/server.go:917` |
| `PUT /api/asset-intercept/rules/{id}` | `assetInterceptUpdateRule` | `server/server.go:918` |
| `DELETE /api/asset-intercept/rules/{id}` | `assetInterceptDeleteRule` | `server/server.go:919` |
| `POST /api/asset-intercept/rules/{id}/toggle` | `assetInterceptToggleRule` | `server/server.go:920` |
| `GET /api/intercept/pending` | `interceptListPending` | `server/server.go:922` |
| `GET /api/intercept/pending/{id}` | `interceptGetOne` | `server/server.go:923` |
| `POST /api/intercept/pending/{id}/decide` | `interceptDecide` | `server/server.go:924` |
| `GET /api/intercept/history` | `interceptHistory` | `server/server.go:925` |
| `GET /api/intercept/history/{id}` | `interceptDetail` | `server/server.go:926` |
| `GET /api/intercept/history/{id}/execution` | `interceptExecution` | `server/server.go:927` |
| `GET /api/intercept/task/{taskID}` | `interceptListTaskItems` | `server/server.go:928` |
| `GET /api/intercept/tool-config` | `interceptGetToolConfig` | `server/server.go:929` |
| `PUT /api/intercept/tool-config` | `interceptSetToolConfig` | `server/server.go:930` |
| `GET /api/intercept/judge` | `interceptGetJudgeConfig` | `server/server.go:931` |
| `PUT /api/intercept/judge` | `interceptSetJudgeConfig` | `server/server.go:932` |
| `GET /api/intercept/judge/usage` | `interceptJudgeUsage` | `server/server.go:933` |

共 243 条字面路由。另有以下 18 条动态注册路由，不能因拼接字符串而遗漏。

| Method / path | ARTEX 位置 |
|---|---|
| `GET /api/conversations/{id}/side-questions` | `server/side_questions.go:273` |
| `POST /api/conversations/{id}/side-questions` | `server/side_questions.go:273` |
| `DELETE /api/conversations/{id}/side-questions` | `server/side_questions.go:273` |
| `GET /api/tasks/{id}/chat/side-questions` | `server/side_questions.go:273` |
| `POST /api/tasks/{id}/chat/side-questions` | `server/side_questions.go:273` |
| `DELETE /api/tasks/{id}/chat/side-questions` | `server/side_questions.go:273` |
| `GET /api/tasks/{id}/intents/{iid}/side-questions` | `server/side_questions.go:273` |
| `POST /api/tasks/{id}/intents/{iid}/side-questions` | `server/side_questions.go:273` |
| `DELETE /api/tasks/{id}/intents/{iid}/side-questions` | `server/side_questions.go:273` |
| `GET /api/side-questions/{requestID}/events` | `server/side_questions.go:284` |
| `POST /api/side-questions/{requestID}/cancel` | `server/side_questions.go:285` |
| `GET /api/exploration/findings/{id}/traffic` | `server/finding_traffic.go:82` |
| `POST /api/exploration/findings/{id}/traffic` | `server/finding_traffic.go:82` |
| `PATCH /api/exploration/findings/{id}/traffic/{binding_id}` | `server/finding_traffic.go:82` |
| `DELETE /api/exploration/findings/{id}/traffic/{binding_id}` | `server/finding_traffic.go:82` |
| `PUT /api/exploration/findings/{id}/traffic/order` | `server/finding_traffic.go:82` |
| `GET /api/exploration/findings/{id}/traffic/{binding_id}` | `server/finding_traffic.go:82` |
| `GET /api/exploration/findings/{id}/traffic/{binding_id}/body` | `server/finding_traffic.go:82` |

### 数据表

| 表 | ARTEX 位置 |
|---|---|
| `companies` | `db/schema.sql:27` |
| `assets` | `db/schema.sql:40` |
| `company_scope` | `db/schema.sql:115` |
| `explorations` | `db/schema.sql:153` |
| `exploration_nodes` | `db/schema.sql:170` |
| `exploration_edges` | `db/schema.sql:248` |
| `exploration_anchors` | `db/schema.sql:276` |
| `task_constraints` | `db/schema.sql:287` |
| `activity` | `db/schema.sql:298` |
| `main_sessions` | `db/schema.sql:346` |
| `settings` | `db/schema.sql:356` |
| `llm_profiles` | `db/schema.sql:362` |
| `llm_profile_health` | `db/schema.sql:479` |
| `task_categories` | `db/schema.sql:493` |
| `tasks` | `db/schema.sql:505` |
| `task_archives` | `db/schema.sql:571` |
| `task_templates` | `db/schema.sql:613` |
| `task_relations` | `db/schema.sql:636` |
| `task_asset_links` | `db/schema.sql:648` |
| `task_llm_profiles` | `db/schema.sql:696` |
| `task_scope` | `db/schema.sql:738` |
| `agents` | `db/schema.sql:766` |
| `agent_prompts` | `db/schema.sql:804` |
| `agent_prompt_vars` | `db/schema.sql:820` |
| `mcp_servers` | `db/schema.sql:833` |
| `mcp_tools_cache` | `db/schema.sql:864` |
| `agent_visibility` | `db/schema.sql:877` |
| `agent_skill_visibility` | `db/schema.sql:888` |
| `skill_usage` | `db/schema.sql:900` |
| `tool_usage` | `db/schema.sql:919` |
| `tools` | `db/schema.sql:935` |
| `conversations` | `db/schema.sql:954` |
| `conversation_activities` | `db/schema.sql:970` |
| `agent_triggers` | `db/schema.sql:993` |
| `scheduler_state` | `db/schema.sql:1025` |
| `intercept_rules` | `db/schema.sql:1033` |
| `intercept_pending` | `db/schema.sql:1053` |
| `findings` | `db/schema.sql:1081` |
| `finding_retests` | `db/schema.sql:1112` |
| `traffic_evidence_snapshots` | `db/schema.sql:1146` |
| `finding_traffic_bindings` | `db/schema.sql:1163` |
| `server_logs` | `db/schema.sql:1179` |
| `side_question_sessions` | `db/schema.sql:1189` |
| `side_question_requests` | `db/schema.sql:1207` |
| `asset_intercept_rules` | `db/schema.sql:1241` |
| `task_intercept_rules` | `db/schema.sql:1267` |
| `notification_channels` | `db/schema.sql:1303` |
| `notification_events` | `db/schema.sql:1341` |
| `notification_deliveries` | `db/schema.sql:1359` |

共 49 张 schema.sql 表；不包含 traffic 独立 SQLite 索引及运行时文件。

### 页面

| 页面源码（ARTEX 相对路径） |
|---|
| `web/src/app/(external)/page.tsx:1` |
| `web/src/app/(main)/dashboard/page.tsx:1` |
| `web/src/app/(main)/chat/page.tsx:1` |
| `web/src/app/(auth)/login/page.tsx:1` |
| `web/src/app/(auth)/setup/page.tsx:1` |
| `web/src/app/(main)/system/tools/page.tsx:1` |
| `web/src/app/(main)/function/workspace/page.tsx:1` |
| `web/src/app/(main)/system/skills/page.tsx:1` |
| `web/src/app/(main)/system/mcp/page.tsx:1` |
| `web/src/app/(main)/system/intercept/page.tsx:1` |
| `web/src/app/(main)/function/traffic/page.tsx:1` |
| `web/src/app/(main)/function/llm-records/page.tsx:1` |
| `web/src/app/(main)/system/settings/page.tsx:1` |
| `web/src/app/(main)/function/commands/page.tsx:1` |
| `web/src/app/(main)/function/sync/page.tsx:1` |
| `web/src/app/(main)/function/tasks/page.tsx:1` |
| `web/src/app/(main)/system/intercept/approvals/page.tsx:1` |
| `web/src/app/(main)/function/findings/page.tsx:1` |
| `web/src/app/(main)/system/logs/page.tsx:1` |
| `web/src/app/(main)/system/intercept/assets/page.tsx:1` |
| `web/src/app/(main)/system/agents/page.tsx:1` |
| `web/src/app/(main)/function/assets/page.tsx:1` |
| `web/src/app/(main)/system/notify/page.tsx:1` |
| `web/src/app/(main)/system/llm/page.tsx:1` |
| `web/src/app/(main)/function/tasks/detail/page.tsx:1` |
| `web/src/app/(main)/system/agents/detail/page.tsx:1` |
| `web/src/app/(main)/function/findings/detail/page.tsx:1` |

共 27 个 page.tsx；页面内部组件和全局 layout/preferences 还需随对应领域验收。
