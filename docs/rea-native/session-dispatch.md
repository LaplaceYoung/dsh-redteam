# REA 6.5.0 进程内会话与完整工具分发调研

调研日期：2026-10-18。本次只读取安装包源码并编写本文，没有修改运行时代码、启动 MCP 服务、打开分析目标或改动能力目录。

源码根目录为 `C:/Users/xiaoz/AppData/Roaming/fnm/node-versions/v24.21.0/installation/node_modules/rea-agents/`；下文 `dist/...:行号` 均相对此目录，SDK 路径也相对此目录。此前目录工作已经通过实际 stdio `tools/list` 确认 207 个唯一工具，见 `catalog/mcp-tools.json`。本次未执行替换 registrar 后的 207 回调运行验证。

## 结论与最小替换点

**可以保留全部注册函数、应用服务和 BinarySession，将服务工厂里的 EvidenceMcpServer 替换为进程内 registrar（保存工具名、Schema 和回调的注册器），直接调用同一批回调。现有 createServer API 没有 registrar 注入选项。主任务选定在独立私有包内替换本地 EvidenceMcpServer.js，保持同一构造接口，从而让 createServer 与所有 register* 源码原样复用。** 这是源码支持的实现方案，不是已完成的 207 项迁移结论。

决定性依据：

1. `dist/server/createServer.js:148-159` 的 `createMcpServer(...)` 是唯一 `new EvidenceMcpServer(...)` 位置；`:198` 调用它。`:164-330` 完成环境快照、服务组装、全部注册和 close 包装，返回 server，不调用 `connect` 或 `serveStdio`。文件自身注释 `:159-163` 明确构造时不获取子进程资源。
2. `dist/server/EvidenceMcpServer.js:84-93` 的 `registerTool` 只变换面向客户端的输入 Schema 展示，再把原始 callback 交给 SDK；`:95-97` 才在 `connect` 时套上 `ErrorEvidenceTransport`。业务执行不藏在 transport 内。
3. `dist/server/registerOfficialTools.js:18-49` 的 callback 通过 `withAdmittedAnalysis` 执行、建立 Evidence、写入 session，然后调用 `server.delivery` 返回结果；`dist/server/contractToolHandler.js:9-26` 对服务工具做同样的执行、部分证据保留、记账和交付。它们不发送 JSON-RPC 请求。
4. `dist/main.js:51-68` 先建 BinarySession，再在 `dist/main/transport.js:40-66` 用 `dependencies.serve` 启动协议边界。DSH 不应调用 `run`、`runEntrypoint`、`startMcpTransport` 或 `serveStdio`。

当前实施方案为 `src/rea-native/session` 独立私有 npm package，固定原版精确依赖版本，本地保留完整 `dist` 与资产布局；仅把其中 `dist/server/EvidenceMcpServer.js` 替换为自有 native registrar 模块，导出同名类并兼容 `(info, options, recordEvidence, delivery, compactPresentation, omitOutputSchemas)` 构造参数，但不继承 SDK McpServer、不创建 SDK 服务、不连接 transport。`createServer` 和 `register*` 原样复用。注册器模块还须保留被其他模块实际导入的 `currentMcpRequestSignal`（prompt completion取消）等导出，不只提供类名。较大重构可另行增加 registrarFactory，但当前方案不需要修改 createServer。保留 `source: {kind: "session", session}` 路径；固定 analysis 路径缺少 session 生命周期、Evidence、未知项和 managed workflow 注册，不能满足 207 工具完整范围。不要修改 SDK 私有 `_registeredTools`，也不需要启动 MCP 后反向读取回调。

## 注册器与请求上下文的实际依赖

对 `dist/server/**/*.js` 全部文件扫描 `server.*`、`server.server.*`、`context.*`、`context.mcpReq.*`，并读取相应调用点后，最低兼容面如下。

| 成员 | 实际用途与源码 |
|---|---|
| `registerTool(name, config, callback)` | 全部 register 函数。保存 callback、输入/输出 Standard Schema、描述、annotations；例如 `registerOfficialTools.js:18`、`registerGoTools.js`。重复注册必须报错，不能悄悄覆盖。 |
| `delivery` | `ToolResultDelivery` 实例或保持其语义的 DSH 交付器；所有工具通过它返回成功、错误、证据与部分证据。`contractToolHandler.js:19-24`、`toolResult.js:38-140`。 |
| `catalogIdentity` | `registerSessionStatusTool.js:48` 用于 binary_session 的版本、目录摘要和期望身份校验。不能用空字符串替代。 |
| `registerPrompt(name, config, callback)` | `registerPrompts.js:29-35`；返回值应支持 `.update(...)`，因为 `:15-23` 提供更新入口。不要静默丢弃引导工作流。 |
| `close()` | `createServer.js:301-307` 和 `registerSessionTools.js:195-204` 会逐层包装，用于清理 provider、进程捕获资源。应可等待，失败可重试。 |
| `server.onclose` | `createServer.js:294-300` 和 `registerSessionTools.js:205-216` 链式安装关闭观察者。无传输模式可以把它保留为本地生命周期钩子；真正关闭须等待上面的 close promise，不能只调用该钩子。 |
| `server.getClientVersion()`、`getNegotiatedProtocolVersion()`、`getClientCapabilities()` | `mcpClientMetadata.js:10-18`，由 `registerSessionStatusTool.js:14` 调用。DSH 版本、宿主支持能力须如实表达；没有 MCP 协议协商就返回 undefined，不伪造协议版本。 |

请求 callback 实际只依赖一个 `context.mcpReq`：

- `signal: AbortSignal`：所有异步工具的取消信号，应来自 DSH 当前调用，不能每次传一个永不取消的新信号。
- `_meta?.progressToken` 与 `notify(...)`：`mcpProgress.js:4-24`。没有 token 时上游返回 silentProgressReporter。DSH 如需进度，提供本地 token，将 `notifications/progress` 的 sequence/message 映射到 DSH 进度 API，不经过协议传输。进度通知失败不改变分析结果，这是上游明确语义。
- `envelope`：`mcpClientMetadata.js:8-22`。可不提供而走本地 metadata getters。若提供，必须用 SDK 的实际 metadata keys；不猜字段名。

扫描未发现 register 回调需要 roots 请求、sampling 请求、elicitation 请求或资源注册方法。`binary_session` 仍会报告客户端支持能力，不能因为没有这些调用就虚报支持。SDK `completable` 用于 prompt 参数补全，见 `registerPrompts.js:49-60`；若目标是连 SDK 的 helper 依赖也移除，需要把补全元数据与 `promptCompletion.js` 一并适配，不能只删 import。

另外，`promptCompletion.js:3,73-80` 直接从 EvidenceMcpServer 模块导入 `currentMcpRequestSignal`，以它向 `executeIfProviderReady` 传取消信号。原实现通过 `AsyncLocalStorage` 保存当前 completion 请求。替换模块必须保留这个导出；DSH 的 completePrompt 调用要在相应 signal scope 中运行，不能返回永远 undefined 的兼容占位。

## 必须补回的 SDK 边界语义

只把 callback 放进 Map 再调用不完整。当前实际 SDK 是安装包里的 `node_modules/@modelcontextprotocol/server/dist/mcp-DIH4cS6P.mjs`，执行顺序为：

1. `:1775-1788` 查找/启用检查，校验输入，执行 callback，校验输出，投影结果，捕获工具异常。
2. `:1810-1815` 通过 `validateStandardSchema(tool.inputSchema, args ?? {})` 执行输入校验并把解析后的值传入 callback；必须保留默认值、变换和 refine 等 JSON Schema 无法完整表达的行为。
3. `:1820-1826` 仅在非错误结果上验证 `structuredContent`；声明输出 Schema 却没有结构化成功内容应报错。错误投影不是成功输出，不能用成功 Schema 校验。
4. `:1831-1832` 才是直接调用 executor(args, ctx)。因此替换点在 SDK 分发外壳，不在应用服务内部。

注册时保存 `config.inputSchema` 和 `config.outputSchema` 的 `~standard.validate` 方法即可保留真实验证逻辑；目录 JSON Schema 用于 DSH 公开注册，不作为唯一运行时校验器。**不要统一改成 `toolContract(name).inputSchema.parse`**：`dist/server/toolRegistrationOptions.js:3-8` 的 `applicationValidatedInputSchema` 故意透传，把校验错误交给特定应用服务生成有类型的错误；绕过这个注册 Schema 会改变错误契约。

`EvidenceMcpServer` 的边界也不能全删：

- `EvidenceMcpServer.js:84-93` 的 compact Schema 是展示策略，不能拿压缩后的 Schema 替代真实解析器。
- `toolResult.js:38-65` 按 contract.kind 决定会话结果 `{result: ...}` 包装，并检查 Evidence 入账是否成功；不能把记账失败仍包装成成功。
- `toolResult.js:92-105` 的错误 `structuredContent` 是内部诊断载体，MCP transport 在 `EvidenceMcpServer.js:194-211` 做最终错误输出处理。原生 DSH 可明确返回结构化错误，但要制定一致契约，不能误当成功数据。
- `toolResult.js:107-140` 保留超预算成功结果的 evidence reference/continuation；当前方案继续使用原 delivery，因此这部分成功结果交付约束仍存在。`EvidenceMcpServer.js:222-313` 原来负责 MCP frame 超大错误的保留与替换。DSH 没有 MCP frame，当前方案直接完整传递 projected error 的 `structuredContent`，不执行 transport 的删字段与 frame-budget 替换；只要 DSH 层确实完整保存和展示，就无需为了 MCP 边界再生成一份错误 Evidence。这是明确的交付层差异，不能称为 wire-format 完全等价。若 DSH 自身有持久化或展示大小限制，应在其真实边界处理保留和引用，不能静默截断。
- `toolResultEncoding.js` 的 `TARGET_CONTENT_RESULT_META` 与 `toolEffects.js` 的目标内容标记必须传给 DSH；二进制字符串、网页文字、反编译代码等仍是待分析数据。

当前方案保持 `CallToolResult` 形状、现有 ToolResultDelivery 和完整 `structuredContent`，在 DSH dispatch 层读取结构化错误，不额外复制原 MCP 超大错误 transport 保留器。输入校验失败、callback 抛错与输出校验失败也要转为明确工具错误，并补足来源标记；之后若换 DSH 原生结果结构，应作为明确的适配层变化验证。SDK 类实例和 transport 可以完全不存在，但保留一些纯 Schema/结果 helper 依赖不等同于运行 MCP 服务。

## createServer 的完整资源与闭包所有权

`createServer.js:165-195` 固定 environment/providerEnvironment、delivery、服务实例；`:254-273` 把 session recorders、admission、资源 scope 放入共享注册上下文。工具回调闭包持有这些对象，不能每次调用重建它们，否则会丢失会话、Inspector、调试器和证据状态。

| 所有者/构造位置 | 对象和注入点 | 关闭路径 |
|---|---|---|
| BinarySession，工厂之外创建 | `composition/binary.js:15-20`：Hopper/Ghidra/IDA 选择注册表、lazy artifact/native-macOS/managed 辅助 provider；`BinarySessionComposition.js:9`：SessionProviderRouter + InvestigationRecords | **不在 createServer.close 内**。`main/shutdown.js:16-20` 单独 `session.close({retainProviderDocuments:true})`。DSH dispose 必须自己拥有此责任。 |
| `createServer.js:171-180` | evmInterface、sqliteDatabase、binaryLayout、recordedCrash、webSourceLocation、webModuleTrace、goBinary、peResources、webNetworkCapture、javascriptRecovery；除 peResources 外均有对应 options 注入（goBinary 注入存在，见 :177） | `:227-237` 对同一实例 close；javascriptRecovery.close 可选。selectedOptions 把创建后的服务传回下层，避免多建实例。 |
| `:181-183` | ArtifactResourceScope；reverseEngineering(providerEnvironment)；FirmwareAnalysisService(options.firmwareAnalysis 或 factory) | `:237-239` close。反编译/修改等外部命令与临时文件都不能丢失其 owner。 |
| `:199-202` | GdbSessionManager、RizinDebugSessionManager | `:240-241` closeAll；注册回调持有持续调试会话，不能降为一次性 CLI。 |
| `:203-213` | android、pcap、flutter、fridaInstrumentation、wasmArtifact、packetCapture、signalRecording、apktool、jeb、adbDevice；均接受对应 options 或原工厂 | `:217-226` close/closeAll；WASM 通过 module.create 包装指定实现。 |
| `:285-287` | CutterBridgeService(new CutterBridgeClient(providerEnvironment)) | createServer 未建立独立 close owner；不要臆造本地进程所有权。外部 Cutter 会话按该 provider 契约管理。 |
| `:352-370` | 上述服务的 Android/JEB/诊断/Go/WASM/EVM/SQLite/崩溃/固件等工具注册；RustBinaryService(options.rustBinary 或 factory)；WebRuntimeService(options.webRuntime 或 factory)；JavaScriptRecoveryService | Rust 服务 `application/rust/RustBinaryService.js` 没有 close 方法，属于离线读取；WebRuntime 不在当前 closeProviders 列表，若以后加持久连接应独立核对其 owner，不能假设统一关闭已经覆盖。 |
| `registerObservationTools`（createServer.js 后半部） | browserObservation、browserScenarioCapture、electronObservation、electronActiveObservation、javascriptRuntimeObservation 来自 options；Electron fuses 使用 options.electronFuses 或独立离线 factory；WebScript/Electron 使用 artifactResources | 五个可选 provider **不是 createServer 自动加载**。`composition/optionalObservationProviders.js:7-17,28-48` 并行加载并逐项保留失败。`main/transport.js:35-37` 单独关闭 browserScenarioCapture；不能只调用 createServer 并留下全部观察工具 unavailable 后宣称保留能力。 |
| `registerSessionTools.js:145` | ProcessCaptureResourceScope，供 capture_process_scenario 和 close_binary 的 cleanup 使用 | `:195-216` 再包装 server.close/onclose，关闭进程捕获资源；`registerCloseLifecycleTool.js:8-32` 合并 session 和 process cleanup 的失败。 |
| `registerGuidedPrompts` | Prompt completion source、prompt registrations；返回可更新 prompt handle | session 切换会取消 prompt completion；当前 server 不持有额外进程。保留工作流渲染和补全接口。 |

`createServer.js:215-252` 使用 cached `providerClose` promise 聚合所有 provider 关闭，任何 rejection 都产生 AggregateError，失败后重置 promise 允许重试。`:302-307` 等待 server 和 providers；`registerSessionTools.js:196-203` 再聚合进程资源。DSH 不应将 dispose 实现为 fire-and-forget。`server.server.onclose` 只是不可等待的通知路径，不能替代显式关闭。

这张表中的服务和资源均是 createServer 的直接闭包。各 provider 还会按操作加载 Ghidra/IDA/Hopper、ADB/JADX、浏览器、Frida、TShark 等底层工具；原生移植只去掉 REA CLI/MCP 外壳，不会消除原设计要求的外部引擎。保留平台边界、配置检查和缺失依赖错误，不自动下载或换引擎。

## BinarySession 不能省略的语义

`application/binary/BinarySession.js:24-38` 持有 active target、pending cleanup、transition generation、在途调用、prompt completion controllers、provider router 和 runtime availability。对应能力：

- `:380-384` execute 登记调用所属 generation；`:409-423` withAdmittedAnalysis 在整个组合操作及记账完成前保持入场资格。
- `:569-587` 串行化目标切换，并只等待此前入场的调用；后续调用等待切换完成。不得用一个全局 boolean 或无序 Promise 替代。
- `:268-315` close/closeWithSnapshot 在同一生命周期锁内等待在途请求、写 snapshot、关闭 provider、清空会话记录和关闭写入资源。**close_binary 会清空 session records**，若 DSH 希望长期保留结果，需要在关闭前保存规范 Evidence bundle，而不是假定对象关闭后账本还在。
- `:317-339` 保留关闭失败的 client，后续重试 cleanup；`:341-351,616-637` 打开失败时处理原目标恢复。失败不能当作正常空会话返回。
- `:425-504` 按实际 provider/profile 绑定执行，决定快照复用，修改前失效快照，记录真实 Evidence；动态调试与外部修改有单独失效/重绑定入口，见 createServer.js:279-281。
- `BinarySessionRecords.js:25-78` 是 Evidence 记录、查找、规范 bundle 导入导出；`:93-167` 为 snapshot 身份/失效管理；`:190-216` 为 unknown 修订和核验。这些不能用上一阶段离线 JSON 文件函数顶替。

每个 DSH session 建一个 REA BinarySession/runtime，按 DSH session key 隔离，销毁时按所有权关闭。首次恢复使用上游规范 bundle/snapshot 导入 API，不直接反序列化私有字段。宿主被强制终止后的外部资源恢复不由本文源码验证覆盖，需独立宿主集成测试。

## 建议的具体 API

以下是实现建议，尚未创建 runtime 文件。类型可从移植模块推导，不使用 any 或假成功函数。

```ts
interface ReaDispatchContext {
  signal: AbortSignal;
  onProgress?: (event: { sequence: number; message: string }) => Promise<void>;
}

interface ReaSessionRuntime {
  listTools(): readonly ReaRegisteredTool[]; // 原始207契约，不按当前provider删工具
  invoke(name: string, input: unknown, context: ReaDispatchContext): Promise<ReaToolResult>;
  listPrompts(): readonly ReaRegisteredPrompt[];
  renderPrompt(name: string, input: unknown): Promise<ReaPromptResult>;
  completePrompt(name: string, argument: string, partial: string,
                 context: ReaDispatchContext): Promise<readonly string[]>;
  dispose(): Promise<void>; // 等待在途调用、session、provider、optional owner；失败可重试
}

createReaSessionRuntime({
  sessionKey,
  environment, // 一次快照；按原工厂parseConfig，保留实际provider选择
  logger,
  clientIdentity,
  deliveryBudgetBytes,
}): Promise<ReaSessionRuntime>;
```

建议具体调用链：

1. `parseConfig(environment)` → `createBinarySession(config, logger, environment)`，不调用 main.startup 的隐式 initial target。目标通过明确 `open_binary` 参数选择。
2. 调用 `loadOptionalObservationProviders(createOptionalObservationFactories(environment))`，逐项保存 provider 和失败原因，供 availability policy 使用。
3. `createServer({kind:"session", session}, {...options, ...optionalProviders})` 运行原有注册代码，其本地 EvidenceMcpServer import 已指向自有 native registrar。registrar 保存标准解析器、回调和 prompt，返回 tool 数量/名称集合必须与 207 项目录完全一致。
4. `invoke` 查工具 → 注册时的 Standard Schema validate → 构造本地 mcpReq 兼容上下文 → callback → 成功输出 Standard Schema validate → typed error 与完整 structuredContent → DSH 显示投影。只在最外层捕获可投影的工具错误；资源清理错误按原语义保留。
5. `dispose` 首先停止接收新调用，取消并等待自己登记的在途工具调用，再关闭 runtime providers/process resources、optional owner 和 BinarySession。失败对象保留重试入口，不能成功标记销毁。若需要持久化，先按 DSH 会话策略导出规范 bundle/snapshot，再执行会清记录的 close。

`ReaToolResult` 可先保持已有 CallToolResult 数据形状，但名称和文档应表明它是进程内值；没有 JSON-RPC、stdio、HTTP MCP server 或 `rea` 子进程。DSH 工具安全策略根据原有 effects/annotations 和用户授权设置，不用支持目录代替实际 availability 检查。

## 建议验收与目前未证明的部分

第一批必须同时测：全部207工具无重复注册；输入默认值和未知字段错误与上游一致；applicationValidatedInputSchema 特例仍走应用层错误；错误不走成功输出校验；目标内容来源标记；超大 projected error 的完整 structuredContent 能在 DSH 保留，不因 MCP 文本预算被丢失；保留原 delivery 对超预算成功 Evidence 的引用行为；get/import/export Evidence 与 unknown 修订；close/open 与并发调用；取消；cleanup failure 重试；DSH session 间隔离；可选 provider 加载失败不影响健康 provider；全部引导 prompt 可渲染。

动态分析工具还需要各自实际外部引擎和目标环境的集成验证。**注册207个回调成功只能证明组装覆盖，不能证明207项真实服务已接通。** 本文完成的是有源码位置支持的可行性和最小适配面分析；没有构造或运行进程内 registrar，没有证明打包后的 native addon、Python/Java/Swift bridge、worker 入口、动态 import 和工具路径都已正确随插件交付。后续打包工作必须以实际闭包和每种资源解析路径为依据。
