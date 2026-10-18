# dsh-redteam

`dsh-redteam` 将 ARTEX 的任务、双图、Planner/Worker、流量、证据、发现和报告迁入 DSH，并逐项迁移 REA 的原生实现。插件注册与 PTC、极简等模式同级的 Agent preset `redteam`，使用 DSH `0.2.1-rc.2` 支持的 `native` 工具呈现，同时保留 PTC 动态工作流工具。

## 本地挂载

```powershell
npm ci
npm run build
$dshCli = Join-Path $env:LOCALAPPDATA 'Programs/DeepSeek Harness/resources/runtime/cli/bin/dsh.cmd'
& $dshCli plugin --profile desktop add . 'dsh-better-sidebar@0.28.0'
```

安装后重启 DSH，新的会话可以选择 `redteam` mode。资产图通过 `dsh-better-sidebar` 的 `ctx.betterSidebar` 注册为原生侧边栏 tab。

`redteam` preset 复用了 DSH 的 `subagent` / `subagent_fork` 和 `workflow` 动态工作流；ARTEX 的 Planner/Worker、目标、约束、scope、traffic 索引、intercept 规则、报告、归档和通知渠道都落在 `redteam_*` 工具上。REA 的 153 个命令通过 `redteam_rea_manifest` 发现，再由 `redteam_rea_command` 统一调度。常用的 `redteam_rea_analyze` 是带证据落库的便捷入口。

`redteam_import_snapshot` 接收本插件的 JSON snapshot，已有 id 会保留，重复记录会跳过。ARTEX 的 PostgreSQL 数据和原版归档包需要显式转换，不能直接传给这个入口。

## 当前实现边界

- ARTEX 的核心领域状态存储在 `$DSH_HOME/storages/redteam.json`，未设置 `DSH_HOME` 时使用 `~/.dsh`。任务、资产图、探索图、意图、Worker trace、发现、REA evidence、目标、约束、scope、traffic、报告、归档和通知配置共用核心快照。模型配置、并发设置、工具拦截审计、流量设置及平台资源保存在同目录下各自的持久文件中。
- 原有 `redteam_rea_analyze` / `redteam_rea_command` 保留 CLI 兼容入口；进程内能力通过下述原生入口提供。CLI 调用的原始输出和规范化 evidence 同时保存。
- `redteam_rea_native_manifest` / `redteam_rea_native` 已接入 REA 6.5.0 的 207 个原生操作和 4 个证据文件操作；`redteam_rea_native_prompt` 提供 6 个原版提示工作流。每个调用方 DSH Agent 维护独立 REA 会话、目标与证据账本。命令目录覆盖不代表所有引擎已实机测试，原生二进制与外部运行时依赖须按具体操作安装。
- `redteam_rea_native_workflow_manifest` / `redteam_rea_native_workflow` 提供 153 个原 CLI 命令契约，其中 150 个领域与诊断工作流直接调用进程内原版应用逻辑；`setup`、`update`、`uninstall` 明确返回独立 REA 安装管理不适用。工作流与原生工具共享当前 Agent 的目标、证据账本和取消信号。完整参数差异见 [CLI 工作流清单](docs/rea-native/cli-workflows.md)，集成与验证记录见 [原生会话文档](docs/rea-native/session-integration.md)。
- 流量捕获由本机 `mitmdump` 运行时桥接：`redteam_traffic_start` 写入 addon，捕获的请求/响应逐行进入 traffic index；`redteam_traffic_stop` 会停止整个代理进程树。
- UI 与同一 DSH host 进程中的 Agent 按存储路径共享已提交状态和写入队列；写入成功后才发布新快照，写入失败不会让内存假装已经保存。插件初始化等待存储加载成功。
- Worker 领取意图、写入 `claimed` 绑定、记录领取 trace 在同一次提交完成；原生 `turn/start` 将它切换到 `running`。同一条意图不能被两个并发 Worker 领取。资产、证据、意图和发现自动生成图节点，发现关联的资产和证据生成连线，意图状态变化同步到图。
- `redteam_start_worker` 优先使用 DSH `0.2.1-rc.2` 的 Agent Teams 服务 `agentTeams.spawnTeammate` 创建持久命名 teammate，并把真实 child Session ID、Team 名称和父会话写入同一条 ARTEX intent；没有 Agent Teams 服务的旧 profile/测试 fixture 才回退到 `subagents.startActivation`。`redteam_steer_worker` 对 Team Worker 使用 `agentTeams.sendMessage`，`redteam_kill_worker` 先中断 Team turn 再等待 `drainChildren` 完成。两条路径的工具调用与终态都来自原生 `session/event` 日志；完成、错误、取消分别回写对应状态及本轮输出。原生 Worker 不接受工具伪造完成状态。
- `redteam` preset 同时挂载 DSH 的 `dsh-workflow-ptc`/`dsh-tool-workflow` 动态工作流和实验性的 `dsh-experimental-agent-team`/`dsh-experimental-tool-agent-team`。需要大规模分阶段 fan-out 时直接使用 DSH `workflow`（`agent`、`parallel`、`pipeline`、`phase`、`log`）；ARTEX Planner/Worker 的持久意图、steering、重试和归档则沿用上面的 Team Worker 绑定，不把工作流结果冒充成 intent 完成。
- `plannerConcurrency` 限制同一父会话正在启动和执行的 Worker 数量，默认 3。插件卸载会取消尚未完成的启动并释放自己启动的子会话。依赖通过 Cordis `inject` 声明，服务缺失时不会注册不可运行的 Worker 工具。
- `redteam_start_planner`、`redteam_pause_planner`、`redteam_steer_planner`、`redteam_planner_status` 接入原生 Planner，使用调用方实际选择的 DSH provider/model，事件驱动补充 Worker。停止、预算耗尽、执行受阻分别保存为 `stopped`、`exhausted`、`blocked`。任务 FIFO 准入、持久模型链与额度切换、超时 FINAL 已接入。任务并发限制默认关闭，保存的上限默认 5；热更新不取消已运行任务。
- 任务支持元数据、分类、模板、直接来源上下文及企业资产快照。任务和全局资产规则在资产写入、绑定资产创建意图时检查，遵循 block 优先和 task allow 约束；它们与工具调用拦截规则独立。
- 侧边栏使用实际 DSH `--dsw-alias-*` 设计变量和 tab registry，提供「任务工作台 / 资产图 / 发现 / 流量 / 活动 / 报告 / 审批 / 资产管理 / 系统设置 / 调用记录 / 会话与文件 / 平台资源 / 宿主与更新」13 个原生 tab。工作台操作绑定当前侧栏所属的真实 DSH 会话，支持创建、模板、分类、目标约束和模型配置。任务筛选跨标签保持，图按类型分列且不截断节点，详情展示双向关系；流量支持搜索、分页和完整请求响应，活动支持跳转 Worker 会话，报告可下载。资产管理、系统模型池、observability、会话/文件/旁路、平台 Agent/工具/MCP/Skill/触发器和宿主 health/stats/logs 使用 owner HTTP 与原生组件。同步失败保留最近快照并显示错误。
- 归档运行时生成 `tar.zst`，保存 SHA256、文件移动 journal 和阶段进度；数据库提交失败会恢复文件，恢复冲突会拒绝覆盖。任务关联记录和通知事件/投递一同归档，恢复成功消费归档包。
- 通知事件与发现创建/状态变更原子落库，支持钉钉、飞书、企业微信、Webhook、Telegram 和邮件。实时/摘要投递保存过滤结果、尝试次数及租约，临时失败按 5 秒和 30 秒退避，第三次失败进入失败态；UI surface 每 3 秒处理到期队列。公开快照和工具返回值会遮蔽渠道凭据。

集成测试使用真实 Cordis、AgentLoop、官方 preset registry、Subagent spawn/fork、工具运行时及 JSONL 持久化；子会话首次执行和恢复执行都实际调用红队工具，验证结果回写、持久化和取消，仅外部模型响应使用固定测试适配器。归档使用真实压缩包与临时文件验证；通知使用本地 HTTP/SMTP 服务验证。存储一致性测试覆盖同一进程内的 DSH UI 和 Agent，尚不支持多个独立 DSH host 同时写同一 JSON 文件。最终桌面组合、真实 provider、私有 ScopeSentry/MCP 和第三方通知仍需在部署环境中验收。

实际桌面 CLI 的隔离 profile 已验证插件安装、`redteam` preset 加载、Agent 挂载、145 个红队工具注册（含 DSH Agent Team 的 `spawn_teammate`、`send_message`、`list_agents`、`wait_agent`、`interrupt_agent` 和 `team_task_*`）、13 个侧边栏路由的宿主页面、10 个新增未认证路由均返回 401，认证后的 snapshot/task workspace/probe 返回 200；证据见 [最新宿主报告](docs/host-verification/2026-10-18T02-25-30-716Z-fb5eb5b6/report.json)。Agent Teams 与 workflowEngine 按 DSH delegation isolate realm 提供给 redteam-agent，宿主外层 probe context 不会直接暴露这两个隔离服务。侧边栏浏览器交互已用明确测试数据检查；真实 provider、第三方服务和完整用户操作流程仍需在部署环境中验收。

## Worker 工具调用

先创建任务和意图，再调用 `redteam_start_worker`，参数为 `task_id` 和可选的 `provider`（`spawn` 或 `fork`）。该调用返回已接受初始任务的子会话绑定，不等待模型完成。父 Agent 可随后用 `redteam_snapshot` 查看状态，用 `redteam_steer_worker` 发送后续要求，或用 `redteam_kill_worker` 停止执行。Worker 收到任务目标、意图输入、任务范围和约束，并通过已有 `redteam_*` 工具读写证据和发现。

本项目提交 `package-lock.json` 固定构建依赖。DSH Subagent 适配使用 `0.2.1-rc.2` 的公开接口，不能直接按官网 master 分支的新接口替换方法名。

## 归档与通知

先用 `redteam_set_task_status` 将任务设为 `paused` 或终态，再调用 `redteam_archive_task`。它等待本运行时的 Worker 停止，生成并校验压缩包后移除热数据；其他运行时仍在执行的 Worker 会阻止归档。`redteam_restore_task_archive` 恢复任务，`redteam_delete_task_archive` 删除冷包，`redteam_recover_task_archives` 处理上次中断的 journal。进度和错误保存在快照的 `archives`。

默认归档目录为存储文件旁的 `redteam/archives/tasks`，任务文件目录为 `redteam/tasks/<taskId>`，可通过 `dataDir` 配置。宿主接线通过公开 SessionPersistence API 收集父/子会话日志、后代和 fork 祖先，并保留会话来源及事件边界；大流量正文按 SHA256 归档，工具审批审计一并保存。恢复拒绝内容冲突，不删除仍被其他任务共享的会话或正文。DSH 归档 manifest 有独立版本，不能直接读取 ARTEX PostgreSQL 归档包。压缩依赖 Node.js 原生 Zstandard API，本项目验证环境为 Node.js 24。

通过 `redteam_add_notification_channel` 配置渠道，`redteam_set_notification_channel_enabled` 停启。Webhook 的 `config` 至少包含 `url`，邮件包含 `host`、`port`、`from`、`to` 及实际需要的认证字段。`redteam_dispatch_notifications` 可立即处理到期投递；`redteam_retry_notification` 重试失败或跳过的投递。状态变更通知需在渠道 `filter` 设置 `on_status_change: true`。摘要窗口默认 30 分钟，可通过 `notifications.digestMinutes` 配置。渠道过滤、消息快照和投递结果见 `notificationEvents`、`notificationDeliveries`；成功投递随任务归档恢复后不会再次发送。

Webhook 模板按 ARTEX 的 Go 模板语法迁移，但高级语法兼容和各渠道消息呈现仍需逐项核对；已实现发送不等于全部模板行为完全等价。
