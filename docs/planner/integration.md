# Planner 集成契约

本模块提供真实 DSH 工具注册、目标初始化模型循环、事件驱动 Planner 和原生 Worker 调度。共享任务队列、模型链、时钟和原生会话恢复由各自运行时负责。

## 安装与事件

```ts
import { installPlanner } from './planner/integration.js';
// 在注入 tools、subagents、llm 的 Agent context 内安装。
const planner = installPlanner(agentCtx, store, workers, {
  concurrency: config.plannerConcurrency ?? 4,
  // modelStream: call => lifecycle.modelStream(call),
  // beforeModelCall: async call => policy.check(call),
});
agentCtx.root.on('session/event', async (session, event) => {
  await workers.observe(session, event);
  planner.notifyWorkerEvent(session, event);
});
```

必须监听根作用域：Worker 是兄弟 Agent，父 Agent 局部监听器看不到其事件。notifyWorkerEvent 只接受已由 WorkerRuntime.observe 持久化的最新 turn/end，按会话序号去重。不要在 Worker turn/start 回调内 await runtime.flush()，否则会等待当前 admission 自身结束。

安装函数注册四个工具，不要重复注册：

| 工具 | 行为 |
| --- | --- |
| redteam_start_planner(task_id) | 等待 bootstrap、首轮规划和 Worker 槽位填充 |
| redteam_pause_planner(task_id) | 暂停任务、取消普通规划、drain Worker |
| redteam_steer_planner(task_id,message) | 持久化战略提示 fact 并唤醒 Planner，返回 hintId |
| redteam_planner_status(task_id) | 返回归属、活动状态、各意图状态计数和最近 Planner 记录 |

相关领域工具成功后通过根作用域 tools/result 通知；失败和只读工具不触发。API 等直接 store 写入后调用 planner.notify(taskId,trigger)。Planner 自身 trace 不触发通知，避免循环。

## 模型与 Bootstrap

默认每轮读取父 Agent 的 provider/model/maxTokens/reasoningEffort，校验 provider 已注册，经 ctx.llm.stream 和真实 BlockAssembler 消费流。缺少 finish、provider error、取消、token 耗尽不会伪装成功。原始消息可通过 onMessage 接入宿主日志。

beforeModelCall 在每次请求前运行，可拒绝请求。默认直连路径在 hook 通过后 stampTaskFirstRun；传入以下桥接时，首次运行时间由桥接层在模型真正就绪后登记，Planner 不重复登记：

```ts
modelStream?: (call: {
  taskId: string; parent: Agent; request: GenerateOptions;
  signal: AbortSignal; final?: boolean;
}) => AsyncIterable<StreamChunk>;
```

有 goal 或 description、但从未保存任何 Goal 时，先运行 bootstrapTaskGoals，真实调用 set_constraints、add_task_scope、set_goals。存在 Goal（包括 deleted）就跳过；不会把 task.goal 无条件复制为已分解目标。工具批量逐条处理，合法项保留，失败项返回对应错误。

保留原版降级：实际尝试模型后失败或耗尽轮数，有合法暂存目标则保留；没有目标且原始 goal 非空才回退单个原始目标，并写 warning trace。取消、暂停或初始化期间目标/描述/约束/范围变化不提交过期结果。只有 description 的任务可由模型明确 set_goals({goals:[]}) 表示无目标。

scope 支持原版七种类型和公司约束。根域使用 tldts 的 ICANN 与 private 公共后缀规则，覆盖 co.uk、blogspot.com、github.io 和未知后缀；IP、纯后缀及不可提取根域的值遵循原版回退规则。

## 调度与工具协议

- 已有 open/claimed/running 种子时跳过初轮普通规划，直接填充 Worker 槽位；空前沿才调用 Planner。
- 通知默认合并 800ms；无活动心跳默认/最短 600 秒。模型轮串行，期间新事件留给下一轮。
- 同一存储任务只有一个 owner；同一父会话的任务共享并发计数。共享 Worker/store 原子领取是最终并发边界。
- 普通提示词建议每轮一次 add_intent、最多四个有价值方向；API 按原版允许多次、超过四条和相同 summary，不把提示词变成硬限制。批量逐条返回成功 ID 或 0 与错误；预分配成功 ID，入库保持一致。
- 意图入库前执行共享 assertIntentAssetsAllowed，遵守全局 block、任务 block 和任务 allow，不绕过资产规则。
- parent_ids 和 prove_goal.evidence_id 只接受本任务或直接来源任务的 fact/finding 图节点。不递归继承，不接受原始 Evidence ID，不要求 finding 为 verified。理由可省略，已 met 目标可再次附证明。
- 普通 goal_met 默认不绑定，可通过 enableGoalMet:true 启用。它只表达整体完成，不伪造每个 Goal 的 met 状态。
- 后续模型失败通过 PlannerExecutionError.partialPlan 保留先前成功工具效果，运行时提交有效部分并记录错误；取消不提交。非法 proof/intent 不撤销同轮合法条目。
- 目标、描述、来源任务、约束或范围在规划期间改变时，不提交旧计划，通知下一轮重算。
- TodoWrite 的列表保存在 trace.data.todos，跨轮恢复，包括部分提交的 trace。

正常目标达成通过 finishManagedTask 写完成元数据和终态首写保护，再停止 Worker。无目标且无需 bootstrap 的直投任务等已有队列抽干后结束，不提前杀掉种子。Planner kill/收官使用 stopped；blocked/exhausted/paused 由共享 WorkerRuntime 按原生结果分流。

## 生命周期接口

生命周期协调器应包装安装对象 start/pause 工具入口，统一 FIFO、就绪判断和时钟。

| 方法 | 精确语义 |
| --- | --- |
| beginSettling(taskId,parent) | 立即冻结新通知、普通规划和补位；不写任务状态，不立即取消正在运行的 Worker |
| finalize(taskId,parent,signal) | 等初始化/规划/Worker 最多 90 秒，随后硬停止仍在跑工作；独立 signal 做一次 FINAL，返回 {met:boolean} |
| park(taskId,parent) | 取消普通循环并 drain；保留持久 task.status/queued，只把本次打断的 Worker 回 open，原先单独 paused 不动 |

FINAL 实际请求只提供读取工具、prove_goal、goal_met，禁止新增意图、steer、kill 和 TodoWrite；未达成目标可直接结束，不要求补位。它提交有效证明但不写 task.done/timeout。协调器收到结果后用 finishManagedTask 首写保护落终态，再 park 释放 settling owner。重复 finalize 复用同一结果；任务实际重新 start 时清除上一轮 FINAL 缓存。

FINAL 信号来自调用者和安装生命周期，不继承普通 Planner 取消信号。模型就绪等待/模型链切换交给生命周期 readiness/modelStream，不无限重试未分类错误，也不能用已到期任务 signal 代替宿主 signal。宿主关闭终止等待。关闭次序：生命周期协调器、Planner、Worker。

普通 pause 写 paused；只把本次打断的意图回 open，保留确认的 messageId/childSessionId；恢复通过原会话 steering 继续。未保存 receipt 的取消 admission 在确认 drain 后移除绑定。park 用于队列停驻，不能用普通 pause 替代。

## 冷恢复边界

PlannerWorkers.recover(intent,parent,signal) 用于持久 claimed/running：读取原 childSessionId 的会话/inbox、重建 Worker 观察归属、按 seq 回放未消费事件并接管，不能盲目再 spawn。共享 WorkerRuntime 已提供该方法，直接传入即可。缺少接口时 Planner 明确拒绝启动并保留现场。本模块测试验证恢复协议和不重复派发；共享 Worker 的真实恢复测试由其负责人执行，不把注入回调称为真实冷恢复验证。

## 原始证据与验证

原始 ARTEX 文件：agent/planner.go（提示/触发/FINAL）、agent/tools.go:1028–1218（批量部分成功/证明/整体完成）、agent/toolcatalog.go:51–59（goal_met默认未绑定）、db/exploration_sources.go（直接来源）、db/exploration.go（插入无summary去重）、server/goals.go（bootstrap）、server/engine.go（种子/事件/暂停）、server/engine_timeout.go（90秒drain/独立FINAL/终态保护）、agent/wrapup.go（任务收尾词）。

2026-10-18，在已安装 DSH 0.2.1-rc.2 下执行：

```text
node --test --test-timeout=15000 test/planner-runtime.test.mjs test/planner-model.test.mjs test/planner-bootstrap.test.mjs test/planner-integration.test.mjs
```

66 项全部通过：runtime 24、model 15、bootstrap 13、integration 14；无跳过或取消。npx tsc --noEmit -p tsconfig.json 通过。内存编译当前源码，不依赖或覆盖共享 lib。包含真实 Cordis/LlmRuntime/ToolRuntime、原生 spawn→AgentLoop→JSONL→Worker.observe→Planner.notify，以及兄弟 Agent 工具写入的根作用域唤醒。FINAL 用模拟时钟核验 90 秒边界；外部 LLM 响应固定。真实远端模型调用和整个桌面产品验收由主集成完成。
