# ARTEX 图、资产与 Worker 查询迁移

核对日期：2026-10-18。范围是 `src/graph-tools/**`、对应测试和本文；追加授权允许窄改 `src/planner/runtime.ts/integration.ts` 接入 compactor。没有改共享 `types/store/tools/index/client/package/lock` 源码。实现只读本机 ARTEX 源码、读写测试用本地 JSON store；没有执行目标扫描。

## 注册入口与主会话接线

```ts
import { installGraphTools, replacedGraphToolNames } from './graph-tools/index.js';

const disposeGraphTools = installGraphTools(agentCtx, store, {
  notifyHint: (taskId, texts) => planner.notify(taskId, { kind: 'hint', hints: texts }),
  onMutation: (taskId, toolName) => planner.notify(taskId, { kind: 'change', detail: toolName }),
  trafficBindingEnabled: () => /* 读取真实 Agent 自动绑定流量设置 */ false,
  // 有专门绑定到单任务的 Planner 工具会话时返回其任务；普通主会话返回 undefined。
  // 原生 Worker 的 childSessionId -> taskId/intentId 从持久化 execution 自动解析。
  resolveBinding: (exec) => plannerTaskBindings.get(exec.agent?.id ?? ''),
});
```

代码示例中的 `plannerTaskBindings` 和设置读取表达式由宿主现有配置/会话所有权提供，模块不创建虚假绑定。最小可调用入口是 `installGraphTools(agentCtx, store)`；探索图工具的未绑定调用必须传 `task_id`。`insert_assets/list_assets` 则保留原版 Auto/custom 无任务上下文能力，未绑定且省略 task_id 时使用全局资产库；不会创建虚假任务关联或 auto scope，绑定 Worker 无法切换到 global。未连接通知时 hint 已持久化但不唤醒 Planner，带 `traffic_refs` 的 hint 会明确报设置未启用。返回值是注销函数，交给 `ctx.effect` 生命周期即可。

宿主在旧 `registerRedTeamTools` 中跳过下列六个定义，再调用安装入口；可加 `omitTools` 参数，默认保持旧直接注册测试契约，只在宿主传入替换清单，不必立即删除旧实现。不要让两个相同名称同时注册：

- `redteam_record_fact`
- `redteam_add_hint`
- `redteam_graph_overview`
- `redteam_list_worker_traces`
- `redteam_list_assets`
- `redteam_list_findings`

该清单也导出为 `replacedGraphToolNames`。绑定 Worker 即使显式传入别的 `task_id`，包括 orchestration 别名，也会收到 `TaskManagementError('conflict')`。来源查询由当前任务内部读取直接 `sourceTaskIds`，不需要切换 task_id。可选 `resolveBinding` 只能来自宿主可信会话状态，不能从模型参数创建。

总接线可使用 `onMutation(taskId, toolName)` 接收成功 fact/asset 写入，使用 `notifyHint(taskId,texts)` 接收 hint 批次。空批次/全部失败不会触发这些回调。采用这些回调时，应跳过原 `planner/integration.ts` 的同名 `domainMutations` 通知，避免重复唤醒；否则需把 `redteam_insert_assets`、`redteam_add_task_hint` 加入原通知集合，并处理省略 task_id 的绑定调用。`workers.ts` 的每轮最终输出还需按下文持久化，才能保留被下一回合覆盖前的完整正文。

## 工具映射与实际契约

所有下列名称加统一 `redteam_` 前缀注册；使用真实 `@deepseek-ai/dsh-tools@0.2.1-rc.2` 的 `defineTool`、参数校验、JSON 输出 schema 和读并发分类。

| ARTEX 原名 | 本模块入口（省略 redteam_） | 参数、返回与边界 |
|---|---|---|
| graph_overview / get_task_graph | 同名 | 本地 open/running/recent_done、因果 parents/yields、fact/finding 窗口、goals/hints、coverage、直接来源摘要。开放意图优先级降序、同优先级创建顺序，窗口 30、真实总数单列。来源 frontier 不进入当前 frontier。 |
| list_facts | 同名 | limit 默认 20，上限 100；before 用 next_before；q 为大小写不敏感 ILIKE 模式，保留 `%/_`。全局最新优先，total 是过滤后全部记录数而非剩余页数；摘要 160 Unicode 码点后加省略号。 |
| list_findings / list_task_findings | 同名 | 本地后直接来源、每任务最多 500；保留 task_id、finding_id、finding_node_id、vulnclass、severity、state 和可读生产意图。保留旧 severity/status 过滤扩展。 |
| node_detail / get_task_node_detail | 同名 | 完整探索节点 payload；asset ID 明确拒绝。goal/constraint 从权威集合投影，fact/hint/intent/finding/evidence 读取真实记录。来源意图只读且须已结束。 |
| record_fact | 同名 | 单条或 facts[]；批量条目继承顶层 intent_id；事实为 confirmed/priority=5，`intent --yields--> fact`；资产锚点去重。单项失败不写入，批量失败位置 ID=0、errors 索引；磁盘写失败传播。 |
| add_hint / add_task_hint | 同名 | text 或 hints[]，保留旧 summary/data；hint 为 active/human。traffic_refs 按 ID 去重，默认 supporting，只允许 baseline/proof/verification/supporting；真实开关未开启则拒绝。成功批次一次通知。 |
| insert_assets | 同名 | 六种类型、自然键 upsert、衍生 root/subdomain/IP、append 合并、公司范围归属、任务 membership/source provenance、保守 auto scope。`{results:[{index,id,type}],errors:[{index,error}]}`。Worker 成功插入后锚定自己的意图。 |
| list_assets | 同名 | id 优先于 ids、ids 优先于 dsl；无 ID 时禁止空 dsl。type 独立过滤、limit=10、offset=0，按 last_seen/持久化顺序倒序。DSL AND 优先于 OR、括号、比较、字符串与技术数组匹配、ILIKE 通配。查询范围是当前/直接来源 scope 对共享资产的匹配，不是生产 taskId。 |
| list_untested_assets | 同名 | type/page/page_size，默认 1/10；范围资产与图锚点并集，减去当前/直接来源 fact 锚定的资产，hint 不算已测试。 |
| asset_neighbors（原版仅残留文案引用） | 同名 | 本机源码没有该工具定义。提供真实结构邻接查询：同域名/根域名/IP 或已有直接图边；限定可读范围，支持 limit/offset，并标明为补足入口。 |
| get_worker_trace / get_task_worker_trace | 同名 | intent_id，q，step_ids，limit；摘要默认 500、搜索默认 100；详情 ID 去重和过滤后最多 5 个，带 returned_step_ids/omitted_step_ids/notice；实际返回须匹配任务和意图。 |
| search_all_worker_traces / search_task_worker_traces | 同名 | q 必填，默认 100；同时搜索摘要/详情，保留 ILIKE 模式；排除自身意图、无意图的 Planner/Main 行以及 thinking/usage。 |
| list_worker_traces / list_task_worker_traces | 同名 | `{works:[{intent_id,summary,state,...provenance}]}`；默认 50，q 是摘要普通子串。本地允许 running/done/exhausted/blocked/stopped 和兼容 failed；每个来源仅终态。 |
| get_worker_output | 同名 | 优先最后 result，再取最后 text，详情为空回退摘要；没有输出保留原版文案。 |
| expand_digest | 同名 | 展开已持久化 digest 的 covers 成员，支持直接来源和 missing 标记。概览按最新成员排序、限制 15/来源 6 个；仍有活动下游的成员重新出现，superseded 不折叠。 |

来源终态严格为 `done/blocked/exhausted/stopped`。每次查询重新解析活跃 task/source 关系；删除来源关联或让其意图恢复运行，读取资格立即消失。查询返回复制数据，修改返回对象不会修改存储。

资产是原版的全局共享记录；重复自然键可以增加当前任务关联并补充字段。只读来源限制保护其探索节点、意图与历史，不能把共享资产正常 upsert 错判为禁止修改。当前任务 asset source 字段只显示该任务的 provenance，不把来源任务 provenance 冒充本地登记。

## 共享字段与兼容方案

不要求改共享 TypeScript 类型即可使用本模块。现有 JSON 扩展字段约定如下：

| 存储位置 | 约定 |
|---|---|
| `Asset.metadata` | ARTEX 类型字段；`task_ids:string[]` 保存多任务关联；`task_sources:[{task_id,source,summary,node_id?}]` 保存每任务来源；`last_seen` 为排序时间。`Asset.taskId` 保留初始归属以兼容原存储。 |
| `GraphNode.data` | fact: `state,origin,priority,detail,evidence,confidence,asset_ids,intentId,created_at`；旧 `assetIds` 也参与锚点读取。 |
| hint 包装 | 底层暂用既有 `kind:'fact'`，加 `data.kind:'strategic_hint', hint:true`；所有本模块查询投影为 `kind:'hint'`，排除出 facts/已测覆盖率。旧 Planner 的 strategic_hint 表示也识别。 |
| digest 包装 | 底层可用 `kind:'fact',data.kind:'digest',state:'active'|'superseded',body`，成员采用 `relation:'covers'` 边。原生扩展 `GraphNode.kind='digest'` 时投影也会按该种类识别。 |
| `WorkerTrace.data` | `activityKind`（text/tool_use/tool_result/result/thinking/usage）、`detail:string`、`tool:string`、`is_error:boolean`；保留现有 DSH `event/payload/sessionId/seq`。 |

DSH 使用不透明字符串 ID。工具接受已有字符串以及可安全表示的正整数输入并转换成字符串；UUID 分页/排序使用持久化追加顺序，对应 ARTEX 数据库递增 ID，不对随机 UUID 作字典序比较。`before` 必须使用实际返回的节点游标，未知游标明确报错。

旧单条 `record_fact` 和 `add_hint` 保留 `id`，另有 message；原 `summary/data` 调用仍有效。原版单条文本收据改为可结构化读取的 JSON 收据。旧 `graph_overview` 的原始 nodes/edges、旧无条件资产列表与 trace 全字段数组，可继续通过已有 `redteam_snapshot(task_id)` 读取；新 `list_assets` 返回 `{count,assets}` 并要求 DSL/ID，新 `list_worker_traces` 返回 `{works}`，调用者需要按新字段读取，不能悄悄沿用原数组断言。

本模块 `GraphRuntime`、`GraphAssetRuntime`、`GraphTraceRuntime` 也直接导出。运行时的只读方法为同步 snapshot 查询，直接调用前要 `await store.load()`；工具入口自动 load。所有写入使用 `store.transaction`。

## 冷图摘要生成与宿主接线

`installPlanner` 已实际创建并拥有 `GraphCompactor`，不需要根会话重复安装。`PlannerRuntime.round` 在取得上下文 snapshot 前调用 `onPlannerRound(taskId,run.controller.signal)`；pause、park、beginSettling 和任务完成调用 `cancelTask`，插件关闭 await dispose。`PlannerInstallation.compactor` 暴露等待/检查入口，常规轮次不等待后台模型。

摘要复用同一 `modelStream`，传 `role:'planner',purpose:'digest'`，由现有 lifecycle 解析真实 Planner 角色 profile、执行准入/配额切换并维护活跃调用计数。DSH `GenerateOptions` 明确带 `purpose:'compaction',sessionId:parent.id`，使宿主可归属辅助调用且不会再次进入普通 session 的 lifecycle stream hook。没有另开旁路 provider。

以下仅为脱离 Planner 单独使用本模块时的调用方式；生产安装无需重复执行：

```ts
const compactor = new GraphCompactor(store, {
  provider: createDshDigestProvider(llm, resolvePlannerDigestRoute),
  onError: (taskId, error) => logCompactionError(taskId, error),
});
// 在 Planner 每次 round 取得 context snapshot 之前调用，一轮一次。
await compactor.onPlannerRound(taskId);
// 单任务暂停/归档：立即取消，再等待排队提交退出。
await compactor.cancelTask(taskId);
// 插件生命周期关闭时停止后台请求并等待结束。
await compactor.dispose();
```

`resolvePlannerDigestRoute(input)` 返回 `{provider,model,reasoningEffort?}`。`reasoningEffort` 是 DSH adapter 自己定义的 opaque ID，宿主须从真实模型能力选择非思考档位，不能硬编码所有 provider 通用的 `disabled`。请求固定 `maxTokens:1500`，只传原节点摘要、ID、状态、confidence、内部边与上下文锚，不摘要已有 digest 的正文。未完整结束、限额结束、空正文、取消和 provider 错误均为失败，不写假摘要。后台失败保留 compactor error trace；`waitForIdle(taskId)` 可供测试或运维等待并传播失败。

运行中的宿主 compactor 在每次维护、失效和摘要提交事务内检查任务仍 running、未 queued、当前 Planner 仍拥有该任务且未 stopping/settling。显式停止与 dispose 不再写取消 error trace；真正 provider/超时失败在任务仍可运行时保留诊断。直接 `planner.runtime.pause()`（归档使用的入口）也会等待后台退出，不依赖工具层 pause 包装。

共享模型层预算接线待根会话完成：当前 `task-management/runtime-model.ts` 会在选中 profile 后覆盖请求 `maxTokens`。应对原生 `request.purpose==='compaction'` 且请求带 maxTokens 时，保留 `Math.min(request.maxTokens, selected.route.maxTokens ?? request.maxTokens)`；不能把仅 provider 入口的 1500 声明为最终路由已保证。新真实 SDK 接线测试已复现 adapter 收到 4096 而非 1500。usage 经过真实 llm/stream 并保留父 session/实际模型/purpose，未从字符数或未配置价格推算费用。

`task.graphCompaction.round` 保存 Planner 轮次，`majorPending` 保留冷却期间尚未执行的 major 触发；节点 data 保存 `cold_since_round,content_version,content_hash`；digest 另存 `member_ids,anchor_ids,generation,signature,source_fingerprints`。可选扩展类型 `GraphCompactionTaskFields` 已导出，无需修改共享类型即可持久化。

冷却算法对照原 `agent/coldgraph.go`：活跃意图及其全部祖先、活跃意图的直接子节点为热节点，DSH `claimed` 适配为活跃。仅 intent/fact 可折叠，hint/finding/digest 不折叠。结构冷节点连续冷却 6 轮才有资格，第 1 轮开始冷却时第 7 轮可折叠。先按血缘连通分组，再把共享父节点的孤点合组，每块至少 2 个成员；UUID 顺序使用持久化追加顺序。

每轮一次事务更新轮次、内容版本、冷却戳并使已变更摘要失效。未覆盖冷节点达到 20 触发 minor；活动 digest 达到 8 触发 major。每个 storagePath/taskId 同时最多一个后台任务，多个插件实例共享互斥；结束后冷却 60 秒，单次超时 5 分钟，Planner 当前请求结束不取消后台任务。minor 结束若 digest 达到 8 会继续 major。major 重新分组原节点，签名不变复用正文，变化块按重叠旧摘要的最大 generation+1 生成；旧摘要保留，删除 covers 与 superseded 状态同事务提交。

模型返回后在新事务中检查最新热集合；去除变热成员，剩余不足 2 个则放弃，保留原上下文锚。额外检查所有输入节点内容指纹：生成期间证据发生编辑就丢弃旧正文；活跃摘要输入变更后，概览立即恢复原节点，下轮同步删除旧 covers 并标 superseded。这项明确加强了原版仅提交前复查热度的规则；原成员即使已因变热被剔除，其内容变化仍会使整块正文失效。检查针对节点内容，不承诺生成期间所有因果边均未变化。

内容失效摘要保留 `invalidated_by:'content_change'` 和成员缓存用于后续 generation 计算；失效前已达到 8 个活动摘要的 major 触发会被保存，避免提前退休使计数掉到阈值以下或重建时代次归 1。摘要节点与 covers 在同一事务创建，失效事务提交前再次检查取消。单块生成失败继续其他独立块，最后通过等待接口及 trace 报告失败；取消则立即停止。其他来源任务只读，不参与当前任务压缩。

原 Go 构造器注释要求过滤 digest，但实现仅过滤 covers；这里同时排除 digest 和其关联边，防止派生视图改变真实因果可达性。未带指纹的旧 digest 保留原读取兼容规则，major 重新生成后获得新指纹。

## 共享资产归档补丁建议（共享模块由根会话修改）

后续增量：以下建议已在共享资产任务中实现，具体创建、归档、删除、恢复契约及验证见 [shared-assets.md](shared-assets.md)。下面保留原建议作为依据；当前完成范围以该专项文档为准。

已核对原 `db/task_archives.go:528`、`db/task_archives_restore.go:103,433,547`、`db/tasks.go:284,524` 和 `db/task_assets.go:314`。以下是共享 archive/store 所需改动，不是本模块已实现声明：

1. `archives.ts` 将 assets 从通用 owned 行删除中拆出，保留 manifest.assets。快照取当前任务 `metadata.task_ids/task_sources`、本地 fact/intent/finding 资产引用和 anchors 边的并集。允许资产首属 taskId 是其他任务或 global，不收录来源任务整批资产。
2. 压缩提交事务先移除当前任务的 task_ids/task_sources；兼容 `Asset.taskId` 若为当前任务则改为剩余任务或 global，防止 `assetRow()` 又补回已撤销关联。只删除本次快照候选中无 companyId 且无其他活任务关联或图锚点的资产，公司资产留在热数据中。
3. 恢复先用已导出的 `graph-tools/assets.ts:assetKey` 匹配自然键。命中只追加恢复任务关联及该任务来源，保留当前业务字段与其他任务来源。未命中复制原资产，旧 ID 被别的自然键占用才换 ID。建立 oldId→restoredId 映射，更新归档 fact/intent/finding/anchors 引用，记录 warning。不可用普通 upsert 把旧字段合并进当前资产。
4. `store.createManagedTask` 的公司资产关联应更新同一资产的 task_ids/task_sources，source 为 company 并保留公司名称说明；停止复制资产生成新 UUID。
5. 普通任务删除保留全局资产；显式 deleteAssets 的级联删除才按其他任务引用决定删除，且原版此入口没有归档的 companyId 豁免。冷归档包删除保持只删除包和 archive 行。

回归应覆盖 A/B 共用一行的归档恢复、仅图锚点保护、公司资产保留、恢复不回滚 B 的新字段、同自然键新 ID 复用、旧 ID 被别的自然键占用时完整引用重映射，以及企业任务创建不增加资产行数。

## 原始证据

- `C:/Users/xiaoz/ARTEX/agent/tools.go:341-552`：本地概览、frontier 排序和窗口、goals/hints、因果血缘、coverage；`:554-861`：来源摘要预算与上限；`:901-1018`：finding/fact/detail；`:1306-1438`、`:1616-1672`：fact/hint 批量与错误；`:1740-2027`：worker output/trace/search/index。
- `C:/Users/xiaoz/ARTEX/agent/tools_insert.go:79-373`：资产字段、原始输入规则检查、六类 upsert、owner anchor/source/auto scope；`:487-585`：未测列表和 DSL 入口。
- `C:/Users/xiaoz/ARTEX/db/assets.go:163-194`：URL 规范化/解析；`:255-1069`：各类型自然键、公司归属、追加合并与衍生资产；`db/nkey.go:16-41`：域名规范化和公共后缀规则；`db/assets_test.go:883-901`：独立 URL 样例。
- `C:/Users/xiaoz/ARTEX/db/asset_dsl.go`：DSL tokenizer/parser/字段 SQL；`db/task_assets_context.go`：直接 task context、scope/anchors、coverage 比例、hosts；`db/exploration.go:768-800`：fact ILIKE/游标/total；`:1754-1980`：trace 顺序、过滤、详情。
- `C:/Users/xiaoz/ARTEX/db/exploration_sources.go`：直接来源和终态过滤；`db/exploration_sources_test.go:274-290`：transitive/live 历史隔离；`db/finding_traffic.go:42-77`：traffic ref 规范化；`agent/tools_digest.go`、`agent/coldgraph.go:98-138`：digest 展开与热节点复现。
- `C:/Users/xiaoz/ARTEX/server/orchestration.go:350-419`：七个指定任务编排别名。
- `C:/Users/xiaoz/ARTEX/agent/coldgraph.go`、`coldgraph_test.go`、`compaction.go`、`db/digest.go`：冷却、分组、签名、minor/major、generation、提交复查与原子失效。

## 验证与实际限制

测试使用真实 `RedTeamStore` 和临时磁盘目录，覆盖业务结果、磁盘落盘、批量局部失败、独立源样例、来源越权、输入 schema 和真实 defineTool 执行。执行命令：

```powershell
npx tsc -p tsconfig.json
node --test test/graph-tools-*.test.mjs
```

独立模块交付阶段：资产 12、图/注册 9、trace 6、冷图算法 11、压缩器 12，共 50/50 通过，0 跳过，退出码 0；该阶段 TypeScript Compiler API 检查并编译通过。

追加 Planner 接线阶段：以 esbuild 内存 bundle 检查当前源码，避免与其他会话争用 lib。最新压缩器 12/12 通过；新 `graph-tools-planner.test.mjs` 5/6 通过，唯一失败是共享模型路由将 1500 上限覆盖成 4096（断言保留，待共享层修复）。已通过的五项覆盖实际 planner role profile、原生 session/purpose/usage 归属、维护后捕获 Planner snapshot，以及 pause/归档 quiesce/park/settle/dispose 后无延迟落库。

现有四组 Planner 回归 64/66 通过；两项 FINAL 失败定位到平台新增的 `WorkerRuntime.beginTaskTimeout()` 在没有 platform run 时先访问缺失的 `ctx.agents`。Worker 所有者需先取 platformRuns 并确认存在 prepared run，再取 Agent；Planner hook 没有绕过或删除。接线首次类型检查的循环推断错误已通过显式 GraphCompactor/PlannerRuntime 注解修复；按根会话的内存协调要求不再启动编译，最终类型检查及全仓构建由根串行执行。没有用 mock store、源码字符串断言或目标扫描充当验证。

还需总集成负责人接入或由其他模块完成的边界：

1. 根会话已确认安装工具、移除六个重复定义并接真实 Planner hint 通知、traffic 配置与 session binding。compactor 已接入每轮 Planner 和生命周期；最终路由的输出上限仍需共享模型层按上文保留。
2. `workers.ts` 目前每轮只保存 `turn/end` 元数据，正文仅在 `intent.output`；下一回合覆盖后，旧全文不能恢复。应在事件写入时把当轮可见最终内容保存到 `trace.data.detail`，并持久化 text 活动。读取适配器只使用匹配 `output.turn` 的内容，绝不把下一回合正文错配给旧步骤。
3. digest 的读取、冷却、生成、内容签名与失效事务已实现；尚未对真实 LLM 服务进行端到端调用，不将注入 provider 的协议测试表述为服务已连通。
4. 本模块没有提供全局资产管理 UI、删除/重新归属或 ARTEX PostgreSQL 全量迁移器。后续共享资产归档/删除已单独实现并验证，见 [shared-assets.md](shared-assets.md)；这些能力不是本次工具查询测试所证明的结果。
5. 使用当前项目已声明的 `tldts`（7.4.18）实现公共后缀查询；它与 ARTEX 编译所含 PSL 数据版本可能不同。没有联网获取目标资产或调用真实 LLM/Planner。
