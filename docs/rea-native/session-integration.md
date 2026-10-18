# REA 全会话原生模块与 DSH 集成

新的运行包位于 `src/rea-native/session`，独立包名 `@dsh-redteam/rea-native-session@6.5.0-dsh.1`。采用私有本地npm包而非单文件bundle：真实源代码中的worker、native addon、Java/Python/Swift桥、WASM和动态require都依赖包布局，简单打包会破坏这些契约。

维护 `vendor.mjs` 从已确认的本机REA6.5.0复制完整dist与资源并保存SHA256清单。只替换 `upstream/dist/server/EvidenceMcpServer.js` 到自己的 `native-registrar.mjs`。后者是函数Map，既不构造McpServer也不连接transport；`createServer`和207个工具的注册回调继续直接使用原应用层。

包入口为 `runtime.mjs` / `runtime.d.mts`，已公开并验证：

```ts
const session = await createReaSession({ environment: { /* 原版provider环境配置 */ } });
session.operations; // 实际注册的可分派handler，能力仍受原版provider/OS约束。
session.describeTool('inspect_go_binary'); // 实际注册的输入/输出JSON Schema。
await session.invoke('inspect_go_binary', { path: absolutePath }, { signal });
await session.getPrompt('investigate_feature', { feature: 'resource loading' });
await session.completePrompt('investigate_feature', 'provider_id', 'a');
await session.close();
```

每个DSH会话应拥有独立 `createReaSession()`，其中provider router、active target、EvidenceLedger、unknown状态和调试器resources全部归该实例。入口保留上游tool result的content/structuredContent/isError和target-content元信息，不能只取text而丢失完整证据。

主集成使用 `npm run package:rea-native` 把此包生成带内容摘要的 `vendor/*.tgz`，再更新根依赖及锁文件；主包同时将该依赖纳入 `bundleDependencies`。不能使用 `file:src/rea-native/session` 的目录链接作为最终分发形式：实际空目录安装发现嵌套依赖会被放到源码路径下，运行时错误地解析到根依赖版本。DSH 直接从包名导入，完整 upstream、worker、native-registrar 和许可证均随包分发。不要把 node_modules 提交到仓库。

## 安装与验证

根锁文件记录主插件与原生包的完整依赖；嵌套目录仍保留独立开发的锁文件。独立开发安装：

```powershell
npm ci --prefix src/rea-native/session --ignore-scripts --no-audit --no-fund
node --test test/rea-native-session-runtime.test.mjs test/rea-native-session-dispatch.test.mjs
```

这里使用 `--ignore-scripts` 的验证环境没有构建 Frida 原生 binding；不能据此声称 Frida 已可用。发布安装应按实际宿主部署所需可选引擎及 native binding。上游现有 SDK 依赖用于标准schema、prompt completion等帮助函数及IDA原设计的外部adapter，REA自身没有MCP服务、transport或CLI转发。

当前 Windows x64 / Node 24.21.0 验证：

- 完整运行时集成 6 项通过，0失败/0跳过：真实 SQLite 与 JavaScript worker、PE Evidence、unknown修订、双会话隔离、完整导入导出、ZIP目标生命周期、缺失WABT错误。详见 [session-validation.md](./session-validation.md)。
- 分派边界 5 项通过，0失败/0跳过：输入与输出错误、目标来源标记、抛错转工具错误、进行中调用取消和close等待、progress传递、207项schema、6项prompt与动态补全。
- 独立审查发现并修复4处边界缺陷，逐项复测；启动与清理的多个错误均保留，失败后可重试关闭。详见 [session-review.md](./session-review.md)。
- 定向TypeScript严格检查通过，入口与声明可解析。
- 资源审计52项和41项依赖通过；1644个来源文件无缺失，仅约定替换的注册器模块hash不同。`npm pack --dry-run` 列出1653项、解包约25.8 MB、压缩约5.7 MB，所检验worker、Windows addon、bridge与许可均包含，未包含node_modules。机器可读记录见 [session-package-dry-run.json](./session-package-dry-run.json)。这只验证包清单，未验证新机器安装或主插件最终发布包。

207项是已直接连接原应用层handler的数量，尚未证明207项在当前Windows宿主全部可用。外部Ghidra/IDA/Hopper/JADX/TShark等保留原设计依赖；缺失会给明确错误，不把可分派handler数当作外部engine实测覆盖数。首批8项接口继续保留。

## DSH主集成

`src/rea-native-integration.ts` 的 `installNativeRea(ctx, store)` 已接入完整原生会话。`src/rea-native/dsh-sessions.ts` 按真实 `exec.agent.id` 延迟创建一个aggregate，并在 `agent.ctx.effect` 登记异步释放；插件卸载也等待所有会话关闭。主动close只关闭当前Agent，再次调用创建新空会话。首批四个解析接口使用这个aggregate，四个离线文件命令继续独立，不产生第二份会话账本。

宿主工具：

- `redteam_rea_native_manifest`：211项操作输入契约、6项prompt，包含CLI工作流清单入口。
- `redteam_rea_native`：207个原版操作及4个文件接口；原版成功结果完整保留在 `value.toolResult`，旧解析接口的 `value.result` 仍为Evidence。完整成功结果写入DSH证据存储。
- `redteam_rea_native_prompt`：生成全部原版prompt或补全参数。
- `redteam_rea_native_close`：取消并等待当前会话操作，释放provider和账本。
- `redteam_rea_native_workflow_manifest` / `redteam_rea_native_workflow`：发现和执行原CLI领域工作流，保留原args/options契约。领域工作流与207项工具按同一会话队列执行，避免目标修改交错。

原版工具失败通过DSH `isError: true` 返回，无成功value；完整原始结果保留在 `meta.rea` 和JSON文本中，包含structuredContent、isError及target-content元信息。CLI失败对应 `meta.reaCli`。失败和取消不会写入成功证据。DSH原生策略中间件仍在工具执行前后生效。

真实ToolRuntime、AgentRegistry和AgentLoop验证见 [dsh-integration-validation.md](./dsh-integration-validation.md)。这验证真实Agent隔离、原版错误、prompt、异步关闭和取消，不代表全部外部引擎已经部署。发布安装证据单独见 [package-install-validation.md](./package-install-validation.md)。

原CLI的153项参数与生命周期是另一份契约，差异表见 [cli-workflows.md](./cli-workflows.md)。原始CLI/MCP目录保留审计用途，首批tested状态未被批量改成全量外部引擎实测通过。
