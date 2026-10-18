# Findings / reports 迁移接线契约

本模块仅修改 `src/findings-reports/**` 与专属测试；共享 store/types/tools/index/client 由主会话接入。

## 宿主必须接入

1. `Finding` 扩展 `FindingFields`（从 `findings-reports/types` 导入），status 使用 `FindingStatus`。所有新增字段都是可选，旧快照读取不需要补造数据。新增字段：`name,nodeId,intentId,worker,evidence,report,evidenceVersion,reportEvidenceVersion,trafficBindings,retests`。无新增顶层集合。现有 `Report` 集合继续存任务报告。
2. `RedTeamStore.addFinding` 必须在原事务内、插入前调用 `validateFindingInput(state,input)`。插入后为 intentId 添加 `intent -> finding` 的 `yields` 边。发现和通知事件仍使用现有 `recordNotificationEvent` 同事务生成。DSH 原图采用同一个 UUID 表示 Finding 与其图节点，`nodeId` 仅用于导入外部独立节点。
3. `updateFinding` 的 patch 类型扩展为 `FindingPatch`，并在事务内运行 `validateFindingUpdate(state,finding,patch)`（内含 `validateFindingPatch` 和 `assertFindingWritable`）。**更新时不要调用创建专用的 `validateFindingInput`**：任务/资产删除后保留的 finding 仍可处置和复测，旧引用允许保留，只验证此次新传入的引用。状态九种原版值全部支持；为已保存 DSH 数据保留 open/verified/accepted/closed。通知 snapshot 的 name 应读取 `finding.name ?? ''`。
4. 新增 `updateFindingAtomic(id, decide)`：在 `transaction` 内查 finding、保存旧 status、执行 `const patch=decide(state,finding)`、调用 `validateFindingUpdate` 并应用 patch、比较 status 并沿现有路径记录通知，返回 finding。它供复测收尾使用，使复测终态、fixed 状态和通知原子提交；没有此方法时复测明确拒绝启动。
5. 调用 `installFindingsReportTools(ctx,store,options)`；原有同名简单工具可逐步改为委托此模块，新增工具统一 `redteam_finding_*`。`resolveAccess(exec)` 必须从宿主真实 Agent/task 绑定返回 taskId，不能接受工具参数冒充。任务来源 finding 可读，修改拒绝。平台管理会话返回 `{}`。
6. `reportProvider` 可由 `createDshReportProvider` 接 DSH 0.2.1-rc.2 `llm.stream` 与实际 provider/model route。生成失败、取消、截断、空正文不会持久化为报告。绑定版本在生成完成时再次检查。安装器的新 `redteam_finding_record` 在 provider 配置后自动触发报告（`automaticReports:false` 可关闭），失败返回已登记的 finding 与明确 `reportGeneration.status=failed`，不会诱导把登记重试成重复漏洞。旧 `redteam_record_finding` 等旁路写入应迁移到该工具，或由宿主工具完成事件调用 `runtime.generateReport`。
7. 复测 `RetestSessionProvider.run` 由宿主创建独立 retester Agent；先 `onSession(realSessionId)` 绑定，再运行。结果工具必须传 `exec.agent.session.id`，不能从模型参数读取 sessionId。原漏洞证据/报告快照只读，成功完成且 fixed 才变更原状态。DSH 安装器的 `ready` 已调用 `recover()` 封存上次中断的活动复测；手工领域集成需自行等待 recover。
8. 任务删除默认保留发现及嵌入的流量快照、复测历史；任务缺失的发现归入 `__unassigned__`。显式删除关联发现才清理它们。归档必须序列化完整 finding 字段，不能按旧字段白名单截断。

## 真实 DSH 宿主适配

`installDshFindings(ctx, store, lifecycle, profiles.resolver, options?)` 已在 `dsh.ts` 提供，取代手工拼静态 provider。必须安装在真实 tools/llm/agents/subagents scope 中；返回 `{runtime,retests,ready,resolveAccess,dispose}`。宿主须 **await ready** 完成遗留复测恢复，再开放调用；teardown **await dispose()**，取消并等待进行中的报告和复测释放后再卸载事件钩子。

- 每次通过 `reportProviderFor(exec)` / `retestProviderFor(exec)` 捕获准确的 live `exec.agent`；不使用 lastAgent 或 AsyncLocalStorage。
- Reporter 使用 `lifecycle.models.stream(taskId,'reporter',request,parentRoute)`，保留真实 role profile、任务链、额度切换；终态任务不强行挂到 Planner 的执行时钟。孤立 finding 明确按 role/global/parent 路由，不补造 task。
- Retester 使用真实隔离 `spawn`、`delivery:'caller'`，先提交 `onSession(childId)` 再启动，取消发布后的 activation，完成时 dispose/drain。真实 activation result 与 `session/event` 的 `turn/end` 都必须 completed，才允许复测成功收尾。请求与错误事件接入模型链 `retester` 角色，按实际输出是否已提交决定能否 quota 重放。
- `lifecycle.resolveBinding?(agent)` 是建议共享层提供的只读跨 scope 接口：返回 `{taskId,parent}`，保留 owner 当前 parentTasks 映射；不能删除原 taskForAgent 的 owner 限制。已有同 scope taskForAgent 与持久 Worker binding 也受支持。
- Retester 权限绑定到其持久 sessionId，只可读该 finding 并保存本会话 verdict；旧的 redteam 写工具也由真实 tools/pre-execute 拒绝。深入验证经真实 lifecycle.start 准入（terminal→rerun，paused→resume，其余start）。
- 复测运行句柄按规范化存储路径跨 Agent scope 共享（Windows 路径不区分大小写），支持不同 RedTeamStore 对象连接同一后端。管理会话可显式取消所属范围内的活动复测；实例卸载只取消自己启动的复测。创建事务到登记运行句柄与 recover 使用同一路径的串行队列，避免 pending 已落盘、运行句柄尚未登记时被另一 scope 的恢复检查误清理。
- `options.trafficBindingEnabled` 读取真实自动绑定开关；缺省关闭，和 ARTEX/graph hint 契约一致。开启后 `traffic_refs` 接受 `{traffic_id,role,note}`，也兼容模块原先的 camelCase `trafficId`；`evidence_hint_id` 只接受当前任务 hint，按顺序保留其 refs。

## 原始源码证据

- `ARTEX/db/findings.go`：九种 triage 状态、筛选/分页/按任务分组、动态漏洞类目录、任务删除后保留独立 finding、详细报告。
- `ARTEX/db/finding_traffic.go`：四种 role、引用去重、事务写入、证据版本、报告版本、编辑/排序乐观锁、finding 与通知同事务。
- `ARTEX/agent/finding_recorder.go`、`agent/finding_workflow.go`：只接受已核实真实 ID；命令/日志证据不强制 HTTP；继承任务证据只读。
- `ARTEX/db/finding_retests.go` 与 `server/finding_retests.go`：独立会话、并发去重、唯一结论、取消优先、无结果为 failed、fixed 自动处置与通知同事务。
- `ARTEX/report/report.go`、`report/findings.go`、`server/finding_traffic_export.go`：任务汇总、单条/汇总 Markdown、BOM CSV、JSON、ZIP HTTP 正文附件与 hash。
- `ARTEX/server/findings_groups.go`：深入验证生成 priority 10 human intent、血缘边、审计记录并交给任务 admission 恢复/排队。
- `ARTEX/server/orchestration.go:768`：report_finding 工具触发 reporter；宿主需要将该事件路由到报告生成，不能用静态模板宣称已运行模型。

## 存储差异与待统一验收

HTTP 正文以 base64 连同哈希嵌入持久 JSON finding 快照，保持删除源 traffic 后可读取和 hash 校验语义；未照搬 PostgreSQL + 文件 GC 架构。大正文会增加 JSON 写入成本，不能宣称具备原版的磁盘去重/GC 性能。原始 capture 的 blob 从现有 `redteam/traffic/_blobs/sha256` 读取、校验后形成独立快照。

真实 DSH 安装器已包含 reporter、retester session runner 和 deepen admission；旧 `redteam_record_finding` / `redteam_update_finding` 也已注册为委托同一新实现的别名，保持旧参数可调用并统一自动报告与访问范围校验。主入口调用安装器时，须将导出的 `replacedFindingToolNames` 传入通用工具 `omitTools`，避免重复注册。新工具名为 `redteam_finding_record` / `redteam_finding_edit`。前端页面、下载响应与归档统计汇总由共享宿主接入。

验证包括真实 Cordis、ToolRuntime、AgentLoop、Subagents、spawn、Session 和 JSONL 持久化；模型 adapter 使用可控输出，未调用真实外部模型服务或扫描目标。不能将宿主生命周期集成通过表述为外部模型服务已接通。

## 本模块验证

`node --test test/findings-reports-*.test.mjs`：52 项通过，0 失败、0 跳过。覆盖领域事务、保留漏洞更新、hint/traffic 快照与版本锁、筛选与导出、报告异常流、旧工具别名统一行为、并发调用者路由隔离，以及完整原生复测工具调用、跨 scope 取消与卸载释放。保留漏洞回归曾在旧的创建专用验证路径下失败，切换到更新专用验证后通过。不同 RedTeamStore 对象指向同一路径的恢复测试也已验证修复前错误取消活跃复测、修复后保留；另覆盖 pending 落盘窗口和安装器 ready 恢复。

本次全项目 `npx tsc -p tsconfig.json --pretty false` 已通过，退出码 0。后续共享模块改动的最终统一构建结果由主会话复验。
