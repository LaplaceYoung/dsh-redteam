# 共享资产创建、归档、删除与恢复

核对日期：2026-10-18。直接读取本机 `C:/Users/xiaoz/ARTEX` 源码；本轮不运行目标扫描。

## 契约与源码依据

- `db/tasks.go:284`：创建企业任务时更新同一资产的 `task_ids`，随后写入 company 来源及企业名称，不复制资产。
- `db/task_archives.go:528`：归档资产是任务关联、来源关系、任务自己的图锚点与 finding 引用的并集；不因来源任务可读而整批归档其资产。
- `db/task_archives_restore.go:103`：压缩热数据先解绑当前任务，仅删除没有其他活任务关联/图锚点的候选资产，公司资产保留。
- `db/task_archives_restore.go:433,547`：恢复先匹配自然键，命中则只补任务关系；ID 冲突生成新 ID，并重映射资产引用，不用旧快照覆盖热数据字段。
- `db/tasks.go:524`：普通任务删除保留全局资产；显式 `deleteAssets` 才删除无其他活任务引用的候选资产，该路径没有公司豁免。

DSH 将全局资产保存在 `snapshot.assets`。`Asset.taskId` 兼容首次归属，`metadata.task_ids` 和 `metadata.task_sources` 保存多任务关联与来源。`src/shared-assets.ts` 统一处理三种关系，解绑后会改写首次归属，防止查询投影把已解除的任务重新加回。

## 实现

`store.createManagedTask()` 对选中企业的已有资产追加当前任务与 company provenance，保留资产 ID、业务字段和其他任务来源。企业 scope 仍复制为任务自己的范围记录。

`ArchiveRuntime` 将资产从通用任务私有表删除路径中拆出。快照包含本任务的 fact、intent input、finding 及图边对资产的引用。资产图节点由热资产行重新投影，避免共享节点在恢复时触发错误的行 ID 冲突。归档压缩在现有 traffic mutation 锁中执行，已有锁和文件回滚流程保持不变。

恢复用既有 `assetKey()` 统一自然键。命中热资产时保留其最新名称、字段、公司归属及其他任务来源，只补恢复任务的关系。缺失资产复制归档业务字段，只恢复当前任务的历史关联；旧 ID 被另一自然键占用时生成 UUID。fact 的 `asset_ids/assetIds`、intent input/output、finding `assetIds` 以及边的两个端点按映射更新。`ArchiveRuntime.restore()` 返回 `string[]` warnings，包含自然键复用与 ID 冲突信息；旧的仅 await 调用兼容。

无任务的全局资产不会被任务删除全库清理。只有当前任务确实关联或引用的资产才进入显式删除/压缩候选；其他活任务仅有图引用也足以保护资产。普通删除解绑后保留无主资产；冷归档包删除只移除包和 archive 行。

## 普通任务删除接线

```ts
const result = await lifecycle.deleteTask(taskId, actualParentAgent, {
  deleteAssets: false,
  deleteFindings: false,
});
// { taskId, deleted, assetsDeleted, assetsDetached, findingsDeleted }
```

任务已绑定其他 parent 时明确拒绝，已有归属其他 lifecycle 的任务委派给其真实 owner。删除与同 store 的 admission 操作串行，等待独立 FINAL 完成，使用真实 Planner pause 停止执行并排空 Worker，随后提交任务及探索数据删除，释放绑定并推进 FIFO。默认保留独立 finding 与其证据、全局资产及流量；删除 findings 是独立显式选项，流量使用既有流量管理入口。失败的归档记录可随普通删除清除，活跃归档/发送中的通知禁止直接删除。

会话模块通过 `TaskLifecycleOptions.prepareTaskDelete(taskId)` 提供 `{ commit(), rollback() }`。prepare 阻止新写入并排空已有写入；任务事务成功后 commit 清理关联；提交前失败调用 rollback。提交后的会话清理失败明确报出“task deleted; conversation cleanup failed”，保留 commit 回调供下一次删除请求重试，不重复数据删除或声称已回滚。会话实现及宿主注入由其负责模块提供。

原子数据函数 `deleteManagedTaskData()` 位于 `src/task-management/deletion.ts`，只有停止执行后才可调用。它检查任务/Worker 状态、归档与通知写入边界，再解绑/删除共享资产、删除任务数据并清理其他任务的来源引用。

工作台 `task.delete` HTTP 动作与详情页“删除任务”已接入真实 lifecycle；两项可选复选框分别控制无共享引用资产和 findings。UI 采用二次确认，成功后回到任务列表。通用 Agent 工具 `redteam_delete_task` 由主集成入口接线。

## 验证

- `test/shared-assets.test.mjs`：12 项通过；真实文件 store、真实 tar.zst 归档/恢复，覆盖两个任务共享、company 创建不克隆、仅图/仅来源保护、全局无主资产、恢复保留新字段、自然键复用、ID 冲突全引用映射、普通/显式删除、finding 证据保留、删除写入失败回滚及提交后会话清理重试。
- `test/archives.test.mjs`：13 项原有回归通过，包含 checksum、文件回滚、中断恢复和并发变更拒绝。
- `test/task-management-integration.test.mjs`：9 项通过；原“复制企业资产”断言改为真实共享契约。
- `test/task-lifecycle-runtime.test.mjs`：12 项通过；验证新删除方法未破坏 admission、deadline、模型路由及 FINAL 行为。
- `test/task-workspace-api.test.mjs`：12 项通过；新增删除 flag 类型、精确 Agent 委派、无模型时删除与删除后不唤醒 Planner。

新增测试直接以 esbuild 加载当前源码；两个原有 lib 导入测试通过临时源码 bundle 验证，临时文件已清理。未并行启动全仓 TypeScript 检查，最终编译由主集成任务串行执行。

删除 UI 单项运行 `node --test --test-name-pattern="native workspace confirms task deletion" test/task-workspace-browser.test.mjs`：1/1 通过，0 失败/取消/跳过，退出码 0，14.43 秒。使用单个 Chromium 和真实原生控件/API/AgentRegistry/Planner/lifecycle：首次点击仅打开确认、取消不发删除请求；选中删除资产并确认后移除 A 及独占资产，保留 B 共享资产并回到任务列表。供应商边界受控；没有把该测试当完整桌面宿主验收。
