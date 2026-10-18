# ARTEX 任务管理集成契约

本文件记录任务管理领域与 DSH 宿主接入契约。领域操作在 `src/task-management/index.ts` 和 `llm-chain.ts`；实际队列、模型路由与超时收尾在 `integration.ts`、`runtime-model.ts`，持久模型配置及原生工具在 `runtime-profiles.ts`。所有任务数据修改须在现有 `RedTeamStore.transaction` 内执行，禁止拿 `snapshot()` 修改后整份覆盖。这些模块的完成不等于 ARTEX 全量功能完成。

## 共享文件需要主会话接入

1. `types.ts`：`TaskStatus` 增加 `timeout`；`RedTeamTask` 继承 `TaskManagementFields`；`RedTeamSnapshot` 继承 `TaskManagementCollections`。新增集合是 `taskCategories`、`taskTemplates`、`taskAssetRules`。`taskAssetRules` 是资产测试允许/拦截策略，不是 HTTP 请求拦截规则，不能与现有 `interceptRules` 混用。
2. `store.ts`：空状态合并 `emptyTaskManagement()`；读旧文件后调用 `initializeTaskManagement(state)`。后者只为旧记录补原始默认值（来源任务/企业为空、超时 0、心跳 600、覆盖度 true），保留已有数据。导入导出及归档清理需纳入新集合和新任务字段。
3. 创建任务：在一次事务里 `createManagedTask(state, input, now, state.companies.map(c => c.id))`，然后创建任务起点事实、目标和可选种子意图；`seedFirstIntent` 默认 false。关联企业的范围与资产快照必须同事务创建（此模块只校验并保存企业 ID，主会话需接资产模型）。模板会复制 description、goal、categoryId 和规则快照；后续改模板不改变已创建任务。
4. 工具/API/UI：接分类 CRUD、单/批移动、模板 CRUD、名称/置顶、任务创建高级选项。使用 `TaskManagementError.code` 将 invalid/not_found/conflict 转成客户端可辨识错误。批分类移动返回实际移动 ID；已消失任务需显示逐项结果。
5. 调度：`admitManagedTask` 负责排队/槽位与显式 start/resume/rerun，`promoteQueuedTasks` 返回本次获准的任务和 bootstrap/resume 模式。`reconcileTaskAdmission` 在模型失效且无活动调用时释放运行槽、重新排队，并返回 parked/started 供宿主协调。持久化提交后才启动实际 worker/planner。排队任务不能领取 intent，暂停/终止后取消当前宿主调用。`ready(task)` 和 `hasActiveCalls(task)` 必须接真实模型及运行状态，不能以保存字段冒充 provider 已接通。
   `AdmissionOptions.hasGoals(task)` 接当前任务是否已分解出目标：已有目标但尚无首次调用时间的任务恢复时走 resume，避免再次 bootstrap。已保存的 queueMode 优先保留；只有完全新任务走 bootstrap。
6. 时钟：真正发起首次模型调用前，在事务内 `stampTaskFirstRun`；排队期间不计时。`expiredTaskIds` 仅报告到期，不能代替 ARTEX 的最终 planner 收尾。宿主需要取消/限制新普通调用，安排 FINAL planner 收尾后用 `finishManagedTask(...,'timeout')` 首写终态保护提交。普通 pause/resume 不重置截止时间；timeout 的显式 rerun 重置；done/failed rerun 保留原时钟，与当前 ARTEX 实现一致。
7. 来源任务：`directSourceTasks` 每次读取当前直接来源，不递归；`recordsWithDirectSources` 返回深复制并标记 inherited/sourceTaskId，仅继承终态 intent（done/blocked/exhausted/stopped）。`requireOwnedRecord` 拒绝编辑其他任务的记录。给独立 intent 数组提供 `kind:'intent'` 后再调用该读视图；图节点可直接使用。来源被删除时立即停止返回。Planner/MainAgent 的无节点私有会话不可继承，worker trace 必须限制为来源终态 intent。
8. 删除/归档：删除任务时清理其 taskAssetRules；从其他任务 sourceTaskIds 中移除该 ID（读函数已排除不存在来源）。分类删除会将活动任务与模板分类置空。归档包需保留或恢复分类/模板引用，不能将未同步的引用直接作为存在的分类。
9. LLM 链：`TaskManagementFields.llmChain` 持久化链状态，初始化为空链。创建时传 `input.llmProfileIds` 及第 5 参数 `availableProfileIds: ReadonlySet<string>`（真实注册表）；未传注册表时非空链会报配置不存在，不会伪造成功。`replaceTaskLLMProfiles` 返回新 state；同一事务内读取最新链、调用并写回。调用模型前记录 `resolveTaskRoleLLM` 返回的 revision/failoverProfileId；`markTaskLLMProfileQuotaExhausted(state, profileId, reason, now, capturedRevision)` 返回 state/transition，保存返回状态。failoverProfileId=null 的角色绑定/全局路径不能推进链。仅 advanced && !stale 发切换活动；`taskLLMReplayDecision` 根据是否已向调用方提交输出决定是否允许重放。`isQuotaExhaustedMessage` 不把普通限流、认证失败、5xx 当额度耗尽。宿主负责 profile 存在性、凭据及 provider 构建验证，将结果交给 `TaskLLMProfileAvailability`；读取错误应传播，不能转换为不可用。非空链耗尽不得回退全局。

## 已核验原始契约

- `C:/Users/xiaoz/ARTEX/db/tasks.go`：MaxTaskSourceCount=8、MaxTaskCompanyCount=32，企业 ID 去重，MinPlanHeartbeatSeconds=600（早期注释 300 已过时）；StampFirstRun、SetTerminalStatusGuarded。
- `server/server.go:1444`：创建任务高级字段与默认值；来源仅直接只读继承；未填描述使用“未命名任务”。
- `db/task_categories.go`：名称折叠空白、大小写不敏感唯一、80 字符；批移动 100；删除 SET NULL。
- `db/task_templates.go` / `server/task_templates.go`：名称 120 字符、description/goal 各 16000 字符，均必填；PATCH 合并指定字段，null category 清空，规则快照可清空。
- `server/task_metadata.go`：名称 200 字符；重复置顶保留初次 pinned_at。
- `server/goals.go:110` / `server/manager.go:1155`：统一准入、FIFO、bootstrap 保留、仅 timeout 重跑重置时钟。
- `db/exploration_sources.go:74`：只有 done/blocked/exhausted/stopped intent 可继承；来源任务运行不阻挡当前任务。
- `server/asset_intercept.go:136`、`server/task_intercept.go`：7 种资产匹配规则，任务级 block/allow。

## 宿主版本边界

领域操作只使用 Node 标准库与结构化数据；宿主安装器使用真实 DSH 0.2.1-rc.2 的 Cordis、AgentLoop、LlmRuntime 与 ToolRuntime。任务 profile 是独立配置 ID，引用 DSH provider/model；DSH 凭据由原 provider 持有，不复制到任务 profile。

## 实际宿主安装

在已注入 `llm` 与 `tools` 的作用域安装，Planner 与生命周期互相引用如下：

```ts
const profiles = installTaskProfiles(ctx, store);
let lifecycle: TaskLifecycleRuntime;
const planner = installPlanner(ctx, store, workers, {
  concurrency,
  modelStream: call => lifecycle.modelStream(call),
});
lifecycle = installTaskLifecycle(ctx, store, planner, {
  concurrency,
  profiles: profiles.resolver,
});
const admission = await installTaskAdmissionSettings(ctx, store, lifecycle, lifecycle.admission());
```

`installTaskLifecycle` 接管该 Planner 安装的 `start/pause` 方法，已有原生 Planner 工具随之走实际 FIFO 准入。普通 Planner、bootstrap 与 FINAL 请求经过 `modelStream`；原生主聊天和 Worker 经 `agent/request` 选择路线，`agent/request-error` 决定是否可重放，`llm/stream` 在真实派发前计时。不会修改 AgentLoop 冻结的请求。

UI 的单一 HTTP 路由通过 `runtime-scope.ts` 的 `lifecycleForAgent(agent)` 查找所选 Agent 的生命周期实例。先从真实 `ctx.agents.get(SessionId(id))` 取 live Agent，再调用 lookup；没有安装或尚未就绪时返回 undefined，不能猜任意首个实例。此查询不依赖已有任务或 `bindParent`。安装器按 `scopeOf(ctx)` 自动登记，查询使用公开 `agentCarrier`、`carrierKeyOf`、`scopeChainOf`，沿 Agent 对象到当前 preset generation 的链选择最近实例；精确 Agent 安装优先于 preset 安装。无 scope 的全局安装可直接调用，但不会作为所有 Agent 的隐式回退。重复注册同一 scope 会报错，disposed runtime 与非 live Agent 不返回。Lookup 仅确认生命周期已安装；宿主仍须等待异步设置初始化完成后开放操作。

源码依据：rc2 `dsh-agent-loop/lib/index.js:778` 用 Agent 对象建立 scope；`dsh-agent-preset-registry/lib/index.js:655-670` 将 Agent scope 连接到 preset generation，并支持空会话重选后的重新连接。真实 `Loader + AgentPresetRegistry + AgentLoop` 测试 `task-lifecycle-scope.test.mjs` 共 2/2 通过，验证首个任务前查询、同 preset 共享、不同 preset 隔离、重新选择、精确覆盖及销毁。该接线不修改任何角色模型绑定。

主聊天不启动任务时钟。普通 Planner/Worker 调用在到期或排队时被阻止；到期先 `beginSettling` 冻结补位，再调用真实 Planner 的独立 FINAL，最终以首写终态保护提交 done/timeout 并 `park` 释放 owner。FINAL 内可有多次工具循环请求，但同次收尾不会重复启动。暂停不停止绝对截止时间；模型不可用时等待后续可用轮询。重启恢复用 `lifecycle.recover(resolveParent)` 传真实 Agent 句柄，返回无法关联父会话的任务 ID，不伪造父 Agent。`installTaskAdmissionSettings` 是异步初始化；宿主须等待完成再发布相关工具可用状态。

`task-admission.json` 保存任务并发设置，原始默认 `enabled=false, limit=5`。安装器第 4 参数可传宿主显式配置作为文件不存在时的 fallback；已有持久设置始终优先。`redteam_get_task_concurrency` 读取设置，`redteam_set_task_concurrency` 合并指定字段、原子保存并向同目录各活动 scope 广播。调高上限立即 FIFO 补位；降低上限不取消已运行任务；关闭限制放行等待任务。若保存成功但运行时协调失败，会明确报错，不能宣称全部应用成功。

模型解析顺序为可用角色绑定、非空任务链、全局 profile、父 Agent 路线。非空任务链耗尽阻止默认回退。额度失败只在任务链路径推进；已提交文本、推理或工具内容后不重放，切换对下一次请求生效。

`installTaskProfiles` 将配置保存至任务存储同目录的 `task-model-profiles.json`，返回 `resolver/registry/dispose`。原生工具如下：

| 工具 | 行为 |
|---|---|
| `redteam_list_model_profiles` | 配置、可用性、角色绑定、全局默认和真实 DSH 模型目录 |
| `redteam_upsert_model_profile` | 创建或完整替换 profile，校验 provider/model 与推理等级 |
| `redteam_delete_model_profile` | 删除非全局活动项，清角色绑定，按原始规则迁移任务游标 |
| `redteam_bind_role_model` | 设置或清除 mainagent/planner/worker/goals/reporter/retester 角色绑定 |
| `redteam_set_active_model_profile` | 设置全局默认，省略 ID 则清除 |
| `redteam_set_task_model_chain` | 替换并重置任务链，空数组恢复默认路线 |

删除使用 `pendingDeletion` 日志协调配置文件和任务事务，访问时恢复未完成删除。配置、任务链设置和 `registry.createManagedTask(input)` 共用进程内写锁；创建任务通过该方法传入真实注册 ID，避免读注册表后与删除竞态。多进程同时写同一配置文件尚无跨进程锁。Reporter/retester 可调用 `lifecycle.models.stream(taskId, role, request, parentRoute)`，使用独立角色绑定及同一任务 failover 逻辑；旁路报告的存活期由其所属运行时管理，不伪装成普通 Planner 调用。

## 验证方式

任务管理测试通过 esbuild 在内存编译源文件后运行，不写共享 lib，也不因其他会话尚未编译而测试旧代码。运行 `node --test test/task-management-*.test.mjs`。核心测试包含真实 RedTeamStore 临时文件写入和两个 store 实例的事务并发；LLM 测试覆盖 revision、起点/耗尽、优先级、回放边界。

2026-10-18 任务专项复验：`node --test test/task-management-*.test.mjs test/task-lifecycle-*.test.mjs` 实际执行 91 项、91 通过、0 跳过，退出码 0。之后新增真实 bootstrap/goals 绑定回归，单独运行 `node --test test/task-lifecycle-host.test.mjs` 为 4/4 通过。覆盖纯领域、真实文件持久化、共享数据接入、模型路由、配置 CRUD/删除恢复、原子创建、并发设置热更新、队列与截止时间，以及真实 rc2 AgentLoop 重试和 Planner FINAL 证明提交。模型在准入后、派发前失效不会启动任务时钟。

模型传输边界使用本地测试 Adapter，未调用外部供应商网络；这证明宿主路线/重放/工具调用接线，不能证明某个供应商凭据可用。UI、完整插件启动和真实 Worker 进程生命周期由主会话的其他测试验证；上述专项测试不替代全项目验收。共享项目仍在并发修改，完整 TypeScript/构建结论应以主会话最终集成为准。
