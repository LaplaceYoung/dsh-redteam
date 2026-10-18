# DSH 原生 REA 集成验证

验证日期：2026-10-18。测试文件：`test/rea-native-integration.test.mjs`。测试加载构建后的 `lib/rea-native-integration.js`，使用实际安装的 DSH rc.2 `ToolRuntime`、`AgentRegistry`、`AgentLoop`、`SessionStore` 和 `SessionProjections`。Agent 由官方 Registry 创建，保持空闲，不调用模型 API，也不使用伪造 Agent。

## 命令与结果

```powershell
node --test test/rea-native-integration.test.mjs
```

追加 CLI 用例后的完整运行：**6 项通过，0 失败、0 取消、0 跳过**，退出码 0，耗时约 23.0 秒。

| 用例 | 实际验证的行为 |
| --- | --- |
| 清单与文件兼容 | DSH 清单返回 211 个不重名操作和 6 个 prompt，每项操作有对象输入 Schema；4 个离线文件命令中的校验与导出可无 Agent 执行，重复导出失败且不写入成功证据；会话操作无 Agent 时返回 `REA_AGENT_REQUIRED`。 |
| 双 Agent 隔离与显式转移 | 手工构造真实 PE 资源，校验整个目标的 SHA-256、资源偏移 608、`HELLO` 载荷的独立已知 SHA-256；调用结果保留旧 `result` Evidence 结构及完整 `toolResult`；同一 Evidence 进入该 Agent 的原版账本，另一 Agent 初始为空；unknown 修订从 1 到 2，保留上一修订摘要，旧版本更新冲突返回真实错误；只有显式 export/import 才将 3 条记录和 2 个 unknown 修订转移到另一 Agent。 |
| 错误与 prompt | `inspect_pe_resources` 非法输入通过 DSH 返回 `isError: true`，无成功 `value`，错误码 `invalid_request`；`meta.rea` 与对同一真实原生会话直接调用的完整结果深比较相等，`content` 同样保留此结果，含目标不可信来源标记；全部 6 个 prompt 逐一渲染并与原生结果深比较；provider 补全返回 `auto`；非法 prompt 参数失败。 |
| 关闭与 Agent 生命周期 | `redteam_rea_native_close` 关闭旧原生会话，再调用创建空账本，另一 Agent 账本仍有 PE Evidence；真实 `AgentHandle.dispose()` 调用原生 `close()`，等待异步清理完成后才返回，Agent 从 Registry 移除，已关闭原生会话拒绝后续调用。 |
| 取消 | 在可控的调用边界取消请求，验证原生调用收到的 `request.signal` 已取消，最终通过真实 handler 返回 DSH 错误，保留明确取消原因，无成功 `value`、无成功存储记录；调用前已取消的请求也不新增证据。 |

## 验证边界

- 取消用例只在真实 session 的 `invoke` 外层设置一个手动释放的 Promise，以确定取消发生的时点；释放后仍调用真实原生方法。该用例验证 DSH 到原生请求的 signal 传递和成功记录抑制，不声称验证每个外部引擎的进程终止。
- 生命周期用例只在真实 session 的 `close` 外层增加异步释放关卡；先执行并等待真实 `close()`，再让真实 Agent 的 `dispose()` 等待此关卡。它验证宿主会等待自己登记的异步清理，不替换原生关闭逻辑。原生 registrar 取消活跃操作并等待资源释放另由 `test/rea-native-session-dispatch.test.mjs` 覆盖。
- 207 项原生操作的发现不等于每项均已执行。这里实际执行 PE、Evidence 账本、unknown、文件命令与全部 prompt；Ghidra、IDA、Hopper、Frida 等外部引擎不在本套测试的验收范围。
- 首轮遇到完整模块冷加载约 64 秒，超过测试最初的 60 秒请求截止时间；请求上限改为 120 秒、单项测试上限 180 秒。另一处按真实 DSH 契约修正：主动 `abort(new Error(...))` 保留错误消息，不能假设普通 Error 带 `HarnessError.info`。这些调整没有放宽数据、隔离或错误语义断言。
- 本文件记录主集成测试，不替代空目录安装验证或完整 153 项 CLI 工作流验收。

随后为测试关卡增加 `try/finally`，保证断言失败时也释放等待；对受影响的两项运行：

```powershell
node --test --test-name-pattern='native close|DSH cancellation' test/rea-native-integration.test.mjs
```

结果：**2 项通过，0 失败、0 取消、0 跳过**，退出码 0，耗时约 27.1 秒。


## CLI 工作流追加验证

同一套测试新增一项真实 DSH 工作流用例，随后完整运行全部 6 项并通过。调用已构建的 `redteam_rea_native_workflow_manifest`，确认 153 个不重名原始命令中，150 项标记为 `native-workflow`；`setup`、`update`、`uninstall` 3 项标记为 `external-installation-management`。逐命令发现接口保留 `inspect-artifact` 的 args/options Schema 及 `integrityPolicy` 默认值 `fail`。

用例生成含 `note.txt` 的真实 ZIP，通过 `redteam_rea_native_workflow` 执行 `inspect-artifact`。随后从同一真实 Agent 的 207 工具入口执行 `get_evidence_bundle`，找到与 CLI 返回完全相同的 Evidence ID；另一 Agent 账本仍为空。继续通过原生 `inspect_artifact` 读取 CLI 打开的目标，校验文件名和载荷 SHA-256，证明 CLI 与原生工具共享目标及原版账本。

非法 `integrityPolicy` 通过 DSH 返回 `isError: true`、`invalid_request`，无成功值、无新成功记录；`meta.reaCli` 以及 `content` 中的完整结果与原生 CLI 方法直接调用深比较一致。此用例没有将 150 个 handler 的发现数量解释为 150 项外部能力均已实测。

## DSH 顶层来源元信息

在原版结果深比较之外，新增断言检查宿主可直接读取的 `DSH.meta.provenance`：PE 成功结果与 `value.toolResult._meta.provenance` 相同；原版非法输入失败与原生错误 `_meta.provenance` 相同；CLI 成功与 `value._meta.provenance` 相同；CLI 失败也保留相同的目标不可信来源标记。

```powershell
node --test --test-name-pattern='real DSH Agents|DSH error path|DSH exposes 153' test/rea-native-integration.test.mjs
```

结果：**3 项通过，0 失败、0 取消、0 跳过**，退出码 0，耗时约 105.6 秒。完整模块冷加载占首项约 99.8 秒。测试保留并通过了所有既有 Evidence、账本隔离、错误内容及 `meta.rea` / `meta.reaCli` 完整结果断言。
