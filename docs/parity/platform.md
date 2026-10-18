# 平台管理 M01–M08

实现位于 `src/platform/`，由插件入口安装到真实 DSH 工具与 Agent 生命周期。管理操作返回持久化结果；运行配置在下一次角色运行或主会话 turn 开始时读取。测试中的模型响应是确定性 fixture，工具分发、会话、文件、进程及本地 MCP 服务使用实际实现。

| 编号 | ARTEX 行为 | DSH 实现与核验位置 |
| --- | --- | --- |
| M01 | 内置角色、Agent 配置、模型配置选择、复制及删除 | `agents.ts` 保留 goals/planner/mainagent/worker/auto/pentest，禁止删除内置角色；自定义角色支持 CRUD/复制。`index.ts` 将角色 prompt、工具、模型、回合与时间预算接入 Agent；`test/platform-agents.test.mjs`、`platform-integration.test.mjs`、`platform-worker.test.mjs`。 |
| M02 | prompt 版本、变量、预览、激活、重置、普通与任务超时收尾 | `agents-seeds.ts` 保留原始提示词；`agents-template.ts` 实现已有模板所需 Go template 语法与校验。run wrapup 和 task_timeout wrapup 分开存储；Planner 结束阶段使用相应配置。`platform-agents`、`platform-planner`、`platform-integration` 测试。 |
| M03 | 自定义 Agent 触发与队列 | `scheduler.ts` 支持 interval、finding、goal_met、task_timeout、tool_call、task_create；serial/parallel、all/by_task/none 合并、每 Agent 容量、持久运行结果。首次安装不回放历史事件，禁用期间消费事件，不在恢复时重复执行崩溃中的副作用。`platform-scheduler.test.mjs`。 |
| M04 | 内置工具描述与参数默认值覆盖、角色绑定 | `agents.ts` 固定 schema 结构，只允许描述/default 等配置；默认值进入真实 execute 和结果展示。`index.ts` 用每次运行的工具声明与 guard 控制可见性，已有局部工具通过宿主分发流水线应用覆盖。`platform-agents`、`platform-integration`、`platform-worker` 测试。 |
| M05 | 自定义 command/script/http/shell、测试执行、Python 配置 | `resources.ts` 实际运行命令/Python、发送 HTTP；shell 类型提供已安装命令说明。模板参数、环境、超时、取消和非零退出保留明确错误。HTTP 可使用任务对应的记录代理。`platform-resources.test.mjs`。 |
| M06 | MCP stdio/HTTP/SSE、发现、缓存、延迟工具、Skill 门控 | 使用官方 MCP SDK 的三种 transport，缓存真实发现结果并保留发现错误；`SearchExtraTools`/`ExecuteExtraTool` 只暴露和调用已解锁工具。每个 run 独立连接并释放；真实本地三 transport 与门控测试位于 `platform-resources`、`platform-integration`。 |
| M07 | Skill 元数据、文件编辑、ZIP 导入导出、使用账本 | `skills.ts` 读写真实目录与 SKILL.md，校验路径、符号链接、CRC 与压缩大小，支持常见 ZIP 编码和压缩格式。成功/缺失使用记录包含任务、会话、Agent，参数只记录长度。`platform-skills.test.mjs` 与 `platform-integration.test.mjs`。 |
| M08 | Agent 与 MCP/Skill 双向绑定、显式 deny | `agents.ts` 保留显式 false，删除资源清理绑定，删除 Agent 清理自定义工具及触发器。运行前按角色绑定筛选，Skill 声明的 MCP 需要成功加载 Skill 后解锁；Worker 从已成功的历史调用恢复解锁，不伪造新的使用记录。`platform-agents`、`platform-integration`、`platform-worker` 测试。 |

## 管理工具

入口为七个真实 DSH 工具，统一参数 `{ action, payload }`。各工具的 description 和 action enum 提供操作参数；查询返回真实 ID，编辑时使用这些 ID。

| 工具 | 操作 |
| --- | --- |
| `redteam_platform_agents` | list/get/create/update/copy/delete/run |
| `redteam_platform_prompts` | versions/variables/preview/save/activate/reset/save_wrapup/reset_wrapup |
| `redteam_platform_tools` | list/update/reset/custom_list/custom_create/custom_update/custom_delete/custom_test/python_get/python_set |
| `redteam_platform_mcp` | list/save/discover/delete |
| `redteam_platform_skills` | list/create/meta/delete/files/read/write/mkdir/delete_path/import_zip/export_zip/usage/missing/stats |
| `redteam_platform_visibility` | agent/set_agent/resource/set_resource |
| `redteam_platform_triggers` | list/save/delete/step |

例如，保存并激活 worker 提示词：

```json
{"action":"save","payload":{"key":"worker","template":"执行任务，worker={{.WorkerName}}，代理={{.ProxyAddr}}。","note":"调整执行说明"}}
```

调用工具为 `redteam_platform_prompts`。如需仅保存草稿，在 payload 中传 `activate:false`，再用 activate 和返回的 version 激活。未知变量会返回错误。

为 worker 绑定指定 Skill（directory 是目录标识，不是展示名称）：

```json
{"action":"set_agent","payload":{"key":"worker","bindings":{"skill":{"api-recon":true}}}}
```

调用工具为 `redteam_platform_visibility`。MCP 绑定键使用服务数字 ID 的字符串形式。显式 false 作为拒绝记录保留。

## 运行接线

`prepareRun` 为一个具体角色生成 prompt、工具定义、模型路由和预算，返回 `attach`、`execute`、`dispose`。根入口把它传给 Planner、目标拆解和 Worker。Planner/目标拆解的工具通过实际 DSH 子 scope 分发，所以宿主 guard 与结果观察器能看到真实工具名，不额外启动模型循环。

主会话用生命周期提供的精确 task/role 绑定，在首步装配 prompt 前准备；turn 结束释放。配置不由最近选中的 UI 任务推断。已有同层局部工具不重复注册；模型声明使用当前配置，隐藏工具的直接调用由 guard 拒绝。子角色拥有独立 prompt、路由、回合预算与连接。

Worker 在原生 spawn/fork 创建后、排队工作释放前附加配置。冷恢复读取最新配置和历史成功 Skill 调用。任务进入超时收尾时，`beginTaskTimeout` 向活动 Worker 注入 task_timeout 提示并切换独立回合预算；重复调用不重置预算，普通暂停不触发它。失败、取消、正常结束均释放准备资源；session 日志仍由 DSH 保存。可见 assistant 文本和每轮最终输出写入轨迹详情，早期轮次的详情不依赖之后会被覆盖的 intent.output。

Agent 选定模型配置由入口的 profile resolver 解析，优先于任务/全局默认；没有可用路由会报错。自定义触发运行使用真实 Agent，队列记录实际 sessionId。

Planner 与 Worker 的 `constraints(taskId)` 在每次模型请求组装时读取，只注入当前任务的非空约束；未配置开关依赖时默认启用。Worker 初始用户指令不保存注入约束，边界变化会开始新的 DSH 请求序列，使支持历史系统提示更新的 provider 也替换旧注入内容；冷恢复重新读取当前值。Planner 同时刷新本轮输入、Overview 模板和已返回的 graph_overview 约束部分。原始任务文本及模型自己生成的内容不作任意删改。

`resolveAgentProfileSelection` 同时返回真实绑定的 profileId 和解析出的 route，两个配置指向相同模型时仍保留各自身份。每个 `prepareRun` 有独立内部 runId，与 DSH sessionId 分开；Planner 和目标拆解在实际模型调用前执行可组合的 `transformRequest`，供运行级上下文投影使用，不为内部账本伪造会话。

## 持久化与验证

默认目录为任务 store 文件旁的 `platform/`，可由安装选项 `root` 指定：

- `agents.json`：Agent、prompt 版本、工具配置和资源绑定。
- `platform-resources.json`：自定义工具、Python 路径及 MCP 配置/发现缓存。
- `triggers.json`：触发条件、消费水位、队列及结果。
- `skills/`：Skill 文件；`skill-usage.json`：使用及缺失账本。

同进程安装到相同路径的多个 DSH scope 共享提交状态和写队列，避免互相覆盖；调度器共享事件消费与容量。状态文件使用临时文件替换提交。它们不是跨进程协调数据库，不能让多个独立宿主进程同时写同一个目录。

相关检查使用 `node --test test/platform-*.test.mjs`；依赖 `lib/` 的单元测试先运行项目 build。集成测试从当前 TypeScript 源码打包到内存，使用真实 Cordis/DSH、本地 HTTP/MCP 服务和临时持久目录。`test/planner-integration.test.mjs` 另覆盖真实 graph 写入只唤醒 Planner 一次。

验证不包含付费远程模型、用户私有 MCP 或真实目标扫描。Go template 实现覆盖现有 ARTEX 模板及已测试常用控制语法；不是任意 Go 程序运行时。此模块提供 DSH 工具与会话运行能力，ARTEX 原 Web 管理界面不在本模块内重建。
