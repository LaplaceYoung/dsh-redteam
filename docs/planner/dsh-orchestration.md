# DSH 原生多智能体接线

`redteam` preset 同时提供两种 DSH 原生编排面：普通 DSH `workflow` 用于模型编写的批量 fan-out；ARTEX Planner/Worker 通过 DSH Agent Teams 创建可持久恢复的命名 Worker。两者共享 DSH 的 Session、取消和子会话 provider，但职责不同。

## Agent Teams Worker

`cordis.patch.yml` 在 delegation group 中挂载：

```yaml
- name: '@deepseek-ai/dsh-experimental-agent-team'
- name: '@deepseek-ai/dsh-experimental-tool-agent-team'
  config:
    freshProvider: spawn
    forkProvider: fork
```

DSH rc2 的真实服务名是 `agentTeams`，WorkerRuntime 使用以下宿主 API：

- `spawnTeammate(parent, { name, description, prompt, context, provider, signal })`
- `sendMessage(parent, { target, content, signal })`
- `interrupt(parent, target)`（工具层对应 `interrupt_agent`）

启动时先由 ARTEX store 原子领取 intent，保留并发闸门；Agent Teams 随后分配真实 child Session ID，插件用 `setWorkerExecution` 替换临时绑定并持久化 `teamName`。这样 Team 创建失败仍会把 intent 写成 `blocked`，不会留下开放 intent。Team 服务不存在时，WorkerRuntime 才使用原有 `subagents.startActivation` 路径，兼容旧 profile 和最小测试组合。

Steering 使用 Team 的 durable name 定位目标，Team Worker 的模型故障重试也通过 `sendMessage` 重新唤醒同一 Session；停止先调用 service 的 `interrupt`（模型侧工具名为 `interrupt_agent`），随后通过 DSH `drainChildren` 等待子会话清理。Worker 的状态、输出、trace 和归档仍只由原生 `session/event` 与 Session persistence 驱动。

## 动态工作流

同一 preset 继续挂载 `@deepseek-ai/dsh-workflow-ptc` 和 `@deepseek-ai/dsh-tool-workflow`。DSH 的 workflow guest 提供 `agent()`、`parallel()`、`pipeline()`、`phase()` 和 `log()`；工作流引擎是 `ctx.workflowEngine.start()`，每个 `agent()` 通过配置的 DSH subagent provider 创建子会话。适合一次性的大量独立检查、分阶段验证或跨文件 fan-out。

ARTEX 的 `redteam_start_worker` 不把动态工作流返回值当成 Worker 完成结果：Planner/Worker 必须保留 intent ID、child Session、steering、失败重试、归档和终态事件。因此工作流用于模型选择的批量编排，Team Worker 用于 ARTEX durable intent 执行。

## 契约验证

`test/workers-agent-team.test.mjs` 使用真实 `RedTeamStore` 和 Session 事件，只替换宿主 `agentTeams` 边界，验证：

- Worker 优先调用 `spawnTeammate`，不会调用 legacy `startActivation`；
- Team 分配的 child Session ID 和 `teamName` 写入 intent；
- steering 通过 Team target 返回真实消息收据；
- turn/end 仍把 intent 写入 `done`；
- stop 先中断 Team，再等待 `drainChildren`。

同一构建中的 `test/workers.test.mjs`、`test/platform-worker.test.mjs` 保持 legacy fixture 通过，证明缺少 Agent Teams 的组合仍沿用原生 subagent 路径。
