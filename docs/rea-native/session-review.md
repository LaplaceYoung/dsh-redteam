# Stage 2 原生注册器独立审查

审查日期：2026-10-18。范围为 `src/rea-native/session/native-registrar.mjs`、`runtime.mjs`、`vendor.mjs`、私有包元数据及上游 SDK/服务组装代码。本次只新增此审查文档；未修改 src、目录或测试文件，未打开分析目标、启动 REA CLI/MCP 或外部分析引擎。

**审查中发现并复现 4 处问题，主任务修复后均已独立复核通过。最终审查快照中没有仍未修复的阻断发现。** 该结论限于注册、解析、工具错误边界、prompt 与生命周期适配，不代表 207 项外部服务实际调用已验证。

本次独立审查时的文件快照 SHA-256（后续集成变更见表后说明）：

| 文件 | SHA-256 |
|---|---|
| `native-registrar.mjs` | `87fbc7dac00ec4011d6cc216063934187352a3fce704734ff3e4d2e389f45526` |
| `runtime.mjs` | `0654dc4cd037b8fe3b9a1e451b3a8537f0a7406a59b492b306c89817d49540ed` |

后续主插件接入新增了原生CLI共享队列和 `runNative` / `drain`：207工具与CLI目标操作串行，关闭先中止并等待操作再释放provider。上述哈希保留为独立审查证据，不冒充当前源码哈希。变更后的11项原生会话/分派回归全部通过；真实DSH验证见 `dsh-integration-validation.md`。

## 已发现并修复的问题

| 优先级 | 原缺陷及触发条件 | 实测证据 | 最终状态 |
|---|---|---|---|
| P2 | `invoke` 直接对 undefined/null 执行 input Schema，未采用 SDK 的 `args ?? {}`。零参数调用被拒绝，根对象默认语义丢失。 | 实际 `createReaSession().invoke('get_evidence_bundle', undefined)` 返回 invalid_request，而 `{}` 正常返回空规范证据包。SDK `mcp-DIH4cS6P.mjs:1813` 明确补 `{}`。 | `native-registrar.mjs:69` 已补 `input ?? {}`；同一真实调用复测成功。 |
| P2 | 注册器自行产生的输入/输出校验错误传 `targetContent=false`，丢失工具的目标内容来源标记。 | 实际 `inspect_go_binary({path:42})` 返回错误且无 `_meta`。上游 `EvidenceMcpServer.js:201-208` 对这类 SDK 错误按 `toolReturnsTargetContent(name)` 补标记。 | `native-registrar.mjs:66,72,81` 已使用真实 contract 标记；复测得到 `_meta.provenance.untrusted_content=true`。 |
| P2 | 标准解析器或 callback 抛异常直接导致 invoke Promise 拒绝，越过上游 tools/call 的工具错误结果边界。 | 注册真实 `inspect_go_binary` 输入/输出配置，注入仅抛 `Error('controlled-handler-failure')` 的 callback。修复前 invoke reject；SDK `:1785-1788` 原会返回 isError。 | `native-registrar.mjs:85-88` 已捕获并返回 isError；复测返回原错误文字并保留 provenance。该形状对应 SDK 的意外错误边界，未伪装成功。 |
| P2 | 启动失败后的清理顺序执行；session.close 抛错会遮盖启动错误并跳过 optional provider 清理。 | 独立 Node 进程故障注入：registerTool 抛 startup error，BinarySession.close 抛 cleanup error；修复前仅抛 cleanup error，browserScenarioCapture.close 次数为 0。 | `runtime.mjs:22-29` 改为 Promise.allSettled，并 AggregateError 保留原 cause 与所有清理失败。复测三个错误全部存在，optional close 调用 1 次。 |

所有故障注入仅修改测试进程内的 prototype，finally 恢复；未写源码，也未在共享主进程或其他会话里更换实现。callback 故障注入只隔离 handler 边界，保留真实 Standard Schema、原 delivery 和 native invoke 路径。启动故障注入保留真实 createReaSession 组装与 catch/cleanup 逻辑。

## 输入和输出契约核验

最新实现用 `registered.config.inputSchema['~standard'].validate(...)` 的解析结果 `parsed.value` 调用回调，没有把 JSON Schema 转换结果当作解析器，也没有丢掉真实 Zod 默认值/转换入口。所有 207 项工具均通过 `describeTool` 输出实际注册的输入与输出 Schema。

最终小改动已核对：`native-registrar.mjs:59` 对可选 `outputSchema` 作条件投影，注册配置没有该字段时不访问其 `~standard`；当前完整 207 项工具仍全部包含输出 Schema。runtime 文件未再变化，最终哈希见上表。主任务报告现有 `test/rea-native-session-dispatch.test.mjs` 的 5 项分发测试全部通过，包含全部 207 项描述和 6 项 prompt；本次按要求复用该结果，仅核对修改和哈希，没有重复测试或扩大外部验证。

这保留了 `upstream/dist/server/toolRegistrationOptions.js:3-8` 的 `applicationValidatedInputSchema` 特例：它故意透传原始值，由应用层产生其专用输入错误。比如 `registerAnalysisViewTool.js:10-13` 使用该注册配置，原生 dispatcher 没有统一改成 canonical inputSchema.parse 而破坏该边界。

SDK 对照来自本地实际安装的 `node_modules/@modelcontextprotocol/server/dist/mcp-DIH4cS6P.mjs:1775-1832`：查工具、输入 Standard Schema 验证、executor、仅对非错误输出验证。当前原生实现遵循该顺序。错误对象仍保留完整 structuredContent；没有运行 MCP transport，因此不执行 transport 将错误 structuredContent 移除的步骤，这属于已明确选择的 DSH 交付差异。

输入校验失败现在投影为 REA 的 `AnalysisInputError`，其 issue reason 当前统一是 `invalid_value`；上游 SDK 对同类失败返回文本型 validation error。两者并非字节一致的错误输出。此次将“返回明确工具错误且保留目标来源”作为适配验收；不能把该适配描述为 SDK wire-format 完全一致。应用层自己产生的类型化错误继续保留原契约。

## Prompt 与取消复核

完整创建返回 207 个工具和 6 个 prompt：

- `investigate_feature`
- `compare_application_versions`
- `verify_reconstruction`
- `trace_crash`
- `audit_residual_unknowns`
- `prepare_bounded_process_capture`

依据真实 `PROMPT_CONTRACTS` 为每个必填字段提供普通测试字符串，6 项均成功生成 messages 文本；此操作只渲染 prompt，不执行其推荐工具或分析目标。

`completePrompt('investigate_feature', 'provider_id', '')` 实测返回：

```json
{"completion":{"values":["auto","ghidra","hopper","ida"],"total":4,"hasMore":false}}
```

这只是配置候选项，不证明 Ghidra/Hopper/IDA 可用。提前 abort 的 completion 请求实际抛 `AbortError`。实现通过 `#run` 的 AsyncLocalStorage signal scope 传给 `currentMcpRequestSignal`，没有把该导出做成返回 undefined 的占位。所有 invoke/getPrompt/completePrompt 当前均进入同一 active 集合，close 会取消并等待；getPrompt 自身未公开调用者 signal 参数，但本次真实 prompt 仅做校验和文本渲染，没有依赖外部资源。

补全使用 `Symbol.for('mcp.completable')`，并处理上游 optional wrapper，与实际 SDK `mcp-DIH4cS6P.mjs:5,38,56` 定义一致。100 项截断、total 和 hasMore 形状对应 SDK `:2300-2307`。本次未对超过 100 个真实目标符号的补全做运行测试。

## 关闭、重试和所有权复核

实际创建空会话后，在独立进程内将 browserScenarioCapture.close 设置为第一次拒绝、第二次调用原关闭方法：

```json
{"probe":"concurrent-close","samePromise":true}
{"probe":"close-failure","aggregate":true,"messages":["controlled-close-failure"]}
{"probe":"retry-close","closeCalls":2}
```

说明并发 close 使用同一个进行中的 Promise；失败返回 AggregateError，不宣称关闭成功；清除失败的 closing promise 后能够重试完成。注册器会停止接受新请求并 abort 自己的信号，等待 active 工作。运行时明确关闭 dispatcher、optional browser scenario owner 和 BinarySession；没有遗漏上一轮调研指出的“createServer.close 不负责 BinarySession”边界。

启动故障及两个 cleanup 同时失败的最终复测结果：

```json
{
  "probe":"startup-after-fix",
  "aggregate":true,
  "messages":[
    "controlled-startup-failure",
    "controlled-session-cleanup-failure",
    "controlled-optional-cleanup-failure"
  ],
  "optionalCloseCalls":1
}
```

当前上游 createServer 的 close 包装会并行调用基础注册器 close 和各 provider close；runtime 也并行关闭 BinarySession。此次没有将这种上游已有的关闭顺序列为缺陷，也没有证明活动 GDB/Frida/浏览器场景在关闭竞态下全部正确。相关真实引擎必须做目标明确的集成测试，尤其是远程 session、调试器 detach 与挂起 worker。

createServer 中途抛错时，它内部已经构造的局部服务没有经返回值交给 runtime；源码将这些工厂定义为不获取子进程资源，目前本次故障注入未打开资源，所以没有观察到泄漏。若未来任一 constructor 开始获取资源，则需要可回滚的组装 owner，不能以本次空启动验证证明未来行为。

## 资料包完整性

按 `provenance.json.sources` 对本地上游副本逐文件读取并计算 SHA-256：

```json
{
  "provenanceFiles":1644,
  "missing":[],
  "changed":["dist/server/EvidenceMcpServer.js"],
  "missingLiteralUrlAssets":[]
}
```

唯一变化是已声明的注册器转接文件。资料包保留 dist、bridge、native、scripts、third_party、licenses、skills 与许可声明。内部 package.json 保留 `#javascript-analysis-worker` imports 映射；父私有包固定上游精确 dependencies 和 optionalDependencies。

另扫描 dist 的 `new URL('字面量相对路径', import.meta.url)` 引用，全部对应本地存在文件。该检查不涵盖运行时拼接路径、系统可执行文件、远端服务、原生 addon ABI、实际 Python/Java/Swift 运行条件或安装后 npm 发布包过滤行为。未执行 npm pack/install 的第二环境验证，因此结论仅为工作区资料副本完整，不能写成发布包已全面验证。

## 审查边界

没有重新运行全部 207 个工具，没有访问用户个人目标或加载外部引擎。验证包括实际会话构造/空证据包读取、207 项契约描述、6 项 prompt 渲染、provider 补全与取消，以及针对错误边界和资源清理的受控故障注入。没有新增文件测试；独立探针都通过 Node stdin 执行，输出已由审查会话保存。

因此可以交付“207 个完整 handler 已接入原生分发，所审查的适配边界通过上述验证”。不能交付“207 项实际外部能力与上游 live parity 已全部验证”。后者仍取决于实际 DSH 集成、发布包和每种分析引擎的有界验收。
