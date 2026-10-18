# REA CLI 工作流原生接入

源版本：REA 6.5.0，MIT。此模块复用原版 153 个规范命令的注册代码、参数 schema 和领域工作流，额外保留 `compare-bundles` 别名。150 个领域/诊断工作流具有真实原生调用入口；3 个操作独立 REA 安装的管理命令明确列为不适用，不能计为已迁移执行能力。注册数量不代表所有外部引擎已经实测。

## 接口与输入

入口为 `src/rea-native/session/cli/runtime.mjs`，类型为同目录 `runtime.d.mts`。`createNativeCli({environment, session})` 的 `session` 是宿主持有的原始 `BinarySession`。

- `commands`：153 个规范名称，排序后的只读数组。
- `describe(name)`：返回 `name`、`description`、完整 `argsSchema` / `optionsSchema`、`classification`，不适用项另有 `unavailableReason`。
- `invoke(name, {args, options}, {signal, onProgress})`：直接调用原始 `command.run`，返回 `{isError, value, error?}`。`value` 保留原版完整结果，错误投影保留原始码、分类、细节及恢复建议；未处理的异常继续抛出。

输入是结构化对象，不经过 argv 解析。例如 `inspect-artifact` 输入 `{args:{path:"C:/sample.zip"},options:{integrityPolicy:"fail"}}`；`inspect-sqlite-database` 的行数选项为 `rowLimit`。原终端 `--integrity-policy` 等连字符参数在原注册对象中使用 camelCase；应按 `describe()` 的实际 schema 传参。所有原始必填项、默认值、范围、枚举与自定义验证均执行，额外键被拒绝。`--json`、终端分页、颜色、`--filter-output` 等输出呈现开关不适用于结构化原生结果。

## 会话、资源与副作用

`composition/directAnalysis` 适配器注入同一 BinarySession，保留原版打开目标、路由、快照、组合分析和证据生成行为。一次性工作流的局部 `close()` 只结束借用，不释放宿主聚合；最终关闭由完整会话负责。宿主必须将 CLI 调用与其余改变目标的操作串行执行，并在关闭前取消、等待活动调用。主 `createReaSession()` 已负责此边界。

原版命令注册中有“一次调用后永久关闭”的服务，例如 SQLite。每次调用重新建立轻量注册对象，使各次服务资源彼此独立；目标聚合仍注入同一个宿主 session。调用者不能通过长期复用已关闭的服务收到假的取消结果。

返回边界使用原版 `evidenceSchema` 识别、校验顶层 Evidence，然后调用宿主 `recordEvidence()`；其原版账本验证完整性、拒绝冲突、幂等去重并发出快照变更通知。`instrument-with-frida` 根据其明确输出契约读取 `value.evidence`。不递归搜索任意 JSON，不从普通报告虚构 Evidence。四个 Evidence 文件命令维持文件处理语义，不把文件中的记录隐式导入会话。

通过 AsyncLocalStorage 为每次调用保存 signal、进度与失败状态，替代 CLI 进程级 `SIGINT` / `SIGTERM` 监听和 `process.exitCode`。JavaScript / Web runtime 的 stderr 进度改为宿主回调。原始 `cliLogging` 错误分类仍保留。GDB、Rizin、Frida 的清理失败状态也传到调用结果，不只写全局退出码。

没有启动 REA CLI、解析 REA 命令文本、构建 REA MCP 服务或转发 REA MCP 请求。领域层仍可能按原契约使用 Ghidra、IDA、JADX、Frida、浏览器、调试器等真实外部引擎；这些命令的环境与目标行为必须单独验证。

## 三项安装管理差异

| 原命令 | 原始动作与证据 | DSH 对应方式 | 当前返回 |
| --- | --- | --- | --- |
| `setup` | `upstream/dist/cli/setupCommands.js` 调用 Setup / SetupHost，给外部客户端注册独立 REA CLI/MCP、安装 skill，并可选安装 Hopper | 安装并启用 DSH 原生插件；外部引擎单独按实际需要配置，不写另一套 REA MCP 注册 | `REA_INSTALLATION_COMMAND_NOT_APPLICABLE`，不产生配置写入 |
| `update` | 同文件调用 Update / UpdateRuntime，更新并校验独立 `rea-agents` 安装 | 使用包管理器更新 DSH 插件及其固定版本原生资源包 | 同上，不运行 npm 更新 |
| `uninstall` | 同文件调用 Uninstall，删除独立 REA 注册、skill，可清理 REA 缓存 | 从 DSH 配置移除插件，再按包管理器卸载插件；不自动删除另一个 REA 安装的资源 | 同上，不删除文件 |

`doctor` 保留原版只读诊断工作流，其结果仍按 REA 独立安装/客户端注册与引擎就绪条件解释；注册不匹配不等于 DSH 原生模块不可调用。它不是 DSH 插件安装验收的替代品。

## 验证与限制

测试文件：`test/rea-native-cli-workflows.test.mjs`。包含原 153 名称逐项匹配、全部输入 schema、管理项分类、真实 Evidence 文件导出/验证/别名对比和覆盖失败、SQLite 真 worker 连续调用、输入校验、原始错误语义、进程状态隔离、预取消、JavaScript 进度触发运行中取消、ZIP 共享目标及账本、双聚合隔离，以及 SQLite Evidence 后续被 unknown 引用。

2026-10-18 执行 `node --test test/rea-native-cli-workflows.test.mjs`：7 项通过、0 失败、0 跳过，退出码 0，耗时 19.37 秒。最终 `cli/runtime.mjs` SHA-256 为 `ce460712ee4835a4325e2d3233cef6d4516861806ba8f6d42aad242dc3fa54de`；`direct-analysis.mjs` 为 `4b8352a1d23b000d1ceea31fd589d1bcef09006fc085071d4af3777c41613384`。

未将全部 150 个领域/诊断命令标记为已实测。需要真实外部引擎、目标进程、网络端点、设备或交互环境的路径仍需相应环境验收。实现完整注册与原领域调用、参数契约保留、已验证的离线行为和外部环境未验证项必须分别报告。

`cli/provenance.json` 记录 60 个复制源文件的原始 SHA-256、适配后 SHA-256 及各项边界修改。`cli/generate.mjs` 可从本包固定上游源重建复制层；领域实现直接导入本包 `upstream/dist`。原许可证在 native package 根目录 `LICENSE`。

## 153 项清单

下表由当前真实注册对象生成；“原生入口”只说明直接调用原版 handler，不表示对应外部引擎已经验证。完整结构化参数可通过 `describe(name)` 获得。

<!-- GENERATED WORKFLOW INVENTORY -->

| 命令 | 状态 | 原版说明 |
| --- | --- | --- |
| `address-to-file-offset` | 原生入口 | Resolve an analysis address to its original file byte offset |
| `analyze` | 原生入口 | Get an overview of an app |
| `analyze-javascript-application` | 原生入口 | Statically reconstruct a local JavaScript/Electron application |
| `analyze-web-bundle` | 原生入口 | Capture and statically analyze a page bundle, defaulting to the selected target origin |
| `annotate-native-function` | 原生入口 | Edit function annotations and return refreshed analysis |
| `build-reconstruction-obligation-ledger` | 原生入口 | Generate a deterministic Evidence-backed reconstruction obligation ledger page |
| `capabilities` | 原生入口 | List provider capabilities and side effects |
| `capture-adb-screen` | 原生入口 | Capture one screen frame as a digested PNG |
| `capture-browser-scenario` | 原生入口 | Run one bounded Playwright browser scenario and return Evidence |
| `capture-electron-scenario` | 原生入口 | Run one owned Electron scenario with cancellable actions |
| `capture-native-ui-scenario` | 原生入口 | Run declarative AX actions or waits in one exact native application window |
| `capture-process` | 原生入口 | Capture one caller-selected process scenario |
| `capture-web-screenshot` | 原生入口 | Capture one visible page viewport within the supplied origin scope |
| `collect-adb-bugreport` | 原生入口 | Collect and digest one device-generated bugreport archive |
| `compare` | 原生入口 | Compare two canonical Evidence bundles |
| `compare-application-versions` | 原生入口 | Compare two authenticated JavaScript Application Graph versions |
| `compare-javascript-export-shapes` | 原生入口 | Compare exact static JavaScript export return shapes without execution |
| `compare-managed-members` | 原生入口 | Compare managed PE/CLI member inventories by exact declared type, name, and signature; names alone never form a match |
| `compare-process-captures` | 原生入口 | Compare two process capture Evidence JSON files |
| `compare-source-to-bundle` | 原生入口 | Compare committed historical source with authenticated application Evidence |
| `compare-wasm-interfaces` | 原生入口 | Compare core WASM interfaces from two exact inspection Evidence records |
| `compare-web-captures` | 原生入口 | Compare two normalized passive captures or recorded browser scenarios |
| `compare-web-screenshots` | 原生入口 | Compare two self-verifying PNG artifact JSON values |
| `cutter-command` | 原生入口 | Execute one Rizin command in a selected live Cutter instance |
| `debug-with-gdb` | 原生入口 | Run one unrestricted GDB console command in an ephemeral MI session; provide an inferior TTY so a live target can be safely detached |
| `debug-with-rizin` | 原生入口 | Run one unrestricted Rizin debugger command in an ephemeral session |
| `decode-android-resources` | 原生入口 | Decode one APK's manifest, metadata, and string resources with apktool |
| `decode-interface-builder` | 原生入口 | Decode compiled storyboard and nib archives from an app bundle |
| `decode-signal-recording` | 原生入口 | Decode an existing signal recording with caller-supplied sigrok |
| `decompile` | 原生入口 | Read one part of an app as code |
| `decompile-jeb-item` | 原生入口 | Decompile one JEB type or method to engine pseudo-code |
| `demangle-swift` | 原生入口 | Demangle Swift symbols without Hopper |
| `discover-webmcp-tools` | 原生入口 | Passively discover page-declared WebMCP tools |
| `doctor` | 原生入口 | Check whether REA is ready |
| `evaluate-reconstruction-coverage` | 原生入口 | Evaluate inline fail-closed reconstruction coverage |
| `evidence-export` | 原生入口 | Validate and atomically export canonical Evidence JSON |
| `evidence-import` | 原生入口 | Validate and import a bounded local Evidence bundle |
| `execute-rizin-command` | 原生入口 | Execute one Rizin command against a local artifact |
| `export-web-scripts` | 原生入口 | Export retained website scripts into an absent directory for static JavaScript analysis |
| `extract-artifact` | 原生入口 | Extract all regular artifact contents safely |
| `extract-firmware` | 原生入口 | Extract selected firmware bytes and return verified files and provenance |
| `function` | 原生入口 | Analyze one complete function with evidence |
| `identify-flutter-build` | 原生入口 | Identify a Flutter build's Dart snapshot hash and engine facts by pure APK parsing |
| `import-managed-reconstruction` | 原生入口 | Import decompiler-produced managed reconstruction against exact static member evidence |
| `import-reference-source` | 原生入口 | Import a source tree as historical reference only |
| `inspect` | 原生入口 | Inspect an app overview with evidence |
| `inspect-adb-client` | 原生入口 | Inspect the caller-selected adb client without contacting devices |
| `inspect-adb-device` | 原生入口 | Inspect one device's build identity through a fixed getprop whitelist |
| `inspect-adb-display` | 原生入口 | Report the display's declared size and density |
| `inspect-adb-package` | 原生入口 | Inspect one installed package's version, installer, and flags through dumpsys |
| `inspect-adb-window` | 原生入口 | Report the window manager's current focus declarations |
| `inspect-analysis-view` | 原生入口 | Project a selected view of completed binary-layout, JavaScript application, native function, artifact-inventory, WASM, Mach-O, Interface Builder, EVM, managed, Android package, Dart AOT, web network capture or pcap Evidence JSON |
| `inspect-android-class` | 原生入口 | Inspect one exact APK class's member inventory |
| `inspect-android-method` | 原生入口 | Decompile one APK method with explicit overload selection |
| `inspect-android-package` | 原生入口 | Inspect APK declarations and decoded manifest without executing it |
| `inspect-apktool-client` | 原生入口 | Inspect the caller-selected apktool launcher without decoding anything |
| `inspect-artifact` | 原生入口 | Inspect one artifact and return all available observations and next probes |
| `inspect-asset-catalog` | 原生入口 | Inspect compiled Apple asset catalog metadata |
| `inspect-binary-layout` | 原生入口 | Inspect binary file/linked layout without executing the selected object |
| `inspect-dart-aot` | 原生入口 | Inspect one ABI's Dart AOT snapshot: sections, headers, and the string pool |
| `inspect-electron-fuses` | 原生入口 | Inspect packaged Electron fuse bytes without launching the application |
| `inspect-electron-page` | 原生入口 | Passively inspect one Electron file page |
| `inspect-evidence-bundle` | 原生入口 | Inspect complete or selected discovery metadata from a local Evidence bundle |
| `inspect-evm-interface` | 原生入口 | Infer interface candidates from explicit local EVM bytecode |
| `inspect-firmware-regions` | 原生入口 | Inspect firmware signature candidates without extracting them |
| `inspect-go-binary` | 原生入口 | Inspect embedded Go compiler, modules and build settings without target execution |
| `inspect-jeb-client` | 原生入口 | Inspect the running JEB MCP client without opening a target |
| `inspect-keyed-archive` | 原生入口 | Inspect a Foundation keyed archive as an object-reference graph |
| `inspect-macho` | 原生入口 | Run inspect_macho without launching Hopper |
| `inspect-managed-artifact` | 原生入口 | Inspect PE/CLI identity without loading target code |
| `inspect-managed-members` | 原生入口 | Inspect PE/CLI metadata members, signatures, CIL anchors, and ldstr string literals without loading target code |
| `inspect-managed-native-boundaries` | 原生入口 | Inspect PE/CLI PInvoke and native implementation boundary declarations without loading target code |
| `inspect-native-api` | 原生入口 | Reconstruct one native function API boundary with evidence |
| `inspect-native-data-type` | 原生入口 | Inspect one recovered database type or typed data object |
| `inspect-native-dispatch-metadata` | 原生入口 | Inspect typed Objective-C and Swift dispatch metadata |
| `inspect-native-instruction` | 原生入口 | Inspect one native instruction with decoded operand facts |
| `inspect-native-load-image` | 原生入口 | Verify loaded native bytes, source mappings, relocations and entry |
| `inspect-packet-capture` | 原生入口 | Inspect an existing packet capture with caller-supplied TShark |
| `inspect-packet-fields` | 原生入口 | Search installed TShark protocol and field definitions |
| `inspect-pcap-capture` | 原生入口 | Inspect one pcap/pcapng capture: endpoints, DNS, TLS SNI, and protocol distribution |
| `inspect-pcap-client` | 原生入口 | Inspect the caller-selected tshark and capinfos binaries without reading a capture |
| `inspect-pe-resources` | 原生入口 | Inspect PE resource identities, payload ranges, hashes and icon-group relationships |
| `inspect-plist` | 原生入口 | Parse app plist metadata without launching Hopper |
| `inspect-recorded-crash` | 原生入口 | Inspect supplied core registers/signals and optional debugger mapping evidence |
| `inspect-rust-binary` | 原生入口 | Inspect an embedded cargo-auditable Rust dependency list without target execution |
| `inspect-signal-decoders` | 原生入口 | Search installed sigrok decoders or selected decoder help |
| `inspect-signature` | 原生入口 | Run inspect_signature without launching Hopper |
| `inspect-sqlite-database` | 原生入口 | Inspect SQLite schema and optional ordinary-table rows from a local snapshot |
| `inspect-wasm-artifact` | 原生入口 | Inspect an explicit local WASM artifact with WABT |
| `inspect-web-event-listeners` | 原生入口 | Inspect native listener source locations on the first main-document CSS match |
| `inspect-web-network-capture` | 原生入口 | Inspect retained HAR, native mitmproxy, Fiddler SAZ or aioquic qlog records without fetching recorded URLs |
| `inspect-web-page` | 原生入口 | Passively inspect one page through CDP, defaulting to its current origin |
| `inspect-with-objdump` | 原生入口 | Inspect a local artifact with GNU objdump and retain its raw output as Evidence |
| `install-adb-package` | 原生入口 | Install one local APK; --replace requests reinstall mode to keep existing app data |
| `instructions` | 原生入口 | Read every raw instruction without decompiling |
| `instrument-with-frida` | 原生入口 | Run one Frida script against a selected process and detach |
| `list-adb-devices` | 原生入口 | List attached devices with serial, state, transport, and inferred kind |
| `list-adb-directory` | 原生入口 | List one device directory with kinds, permissions, and sizes |
| `list-adb-features` | 原生入口 | List the device's declared hardware and software features |
| `list-adb-packages` | 原生入口 | List installed packages on one device with base APK device paths |
| `list-adb-processes` | 原生入口 | List running processes exactly as ps -A reports them |
| `list-adb-services` | 原生入口 | List the device's binder services and interfaces |
| `list-architectures` | 原生入口 | Run list_architectures without launching Hopper |
| `list-browser-targets` | 原生入口 | List page targets from a selected loopback CDP browser, optionally filtered by origin |
| `list-cutter-sessions` | 原生入口 | List live Cutter instances connected through the REA Python plugin bridge |
| `list-electron-targets` | 原生入口 | List local file pages exposed by the selected Electron CDP endpoint |
| `list-frida-devices` | 原生入口 | List local Frida devices and an optional remote endpoint |
| `list-frida-processes` | 原生入口 | List processes visible through a Frida device |
| `list-javascript-runtime-targets` | 原生入口 | List Node/Electron V8 Inspector targets |
| `list-jeb-units` | 原生入口 | List JEB project units by path and type with optional filter |
| `list-objdump-architectures` | 原生入口 | List BFD targets advertised by the installed GNU objdump |
| `observe-javascript-runtime` | 原生入口 | Passively observe one exact Node/Electron Inspector target |
| `observe-native-calls` | 原生入口 | Launch a Mach-O under LLDB and record entries into selected functions or Objective-C methods |
| `observe-native-ui` | 原生入口 | Observe one already-running native application window by PID and window ID |
| `observe-web-execution` | 原生入口 | Observe precise page execution; resets counters and temporarily disables optimization |
| `observe-web-session` | 原生入口 | Observe user-driven page navigation during a chosen window |
| `open-jeb-project` | 原生入口 | Open or create a JEB project from an artifact or .jdb2 database |
| `project-android-application-graph` | 原生入口 | Project authenticated APK inventory Evidence into an Android application graph |
| `project-apple-application-graph` | 原生入口 | Project authenticated IPA or macOS app inventory Evidence into an Apple application graph |
| `project-harmony-application-graph` | 原生入口 | Project authenticated HarmonyOS HAP, HSP, or App Pack inventory Evidence into an application graph |
| `project-managed-application-graph` | 原生入口 | Project authenticated managed static Evidence into an application graph |
| `providers` | 原生入口 | List configured analysis providers |
| `pull-adb-file` | 原生入口 | Pull one device file to a local copy with a SHA-256 digest |
| `pull-adb-package` | 原生入口 | Pull one installed package's complete APK set with SHA-256 digests |
| `push-adb-file` | 原生入口 | Push one local file to the device; refuses existing targets without --overwrite |
| `read-adb-logcat` | 原生入口 | Read a bounded dump of the device log for one buffer |
| `read-adb-setting` | 原生入口 | Read one settings value from system, secure, or global |
| `read-bytes` | 原生入口 | Read exact provider memory bytes at one analysis address |
| `reconcile-javascript-runtime` | 原生入口 | Reconcile static application and passive runtime Evidence JSON |
| `recover-javascript-sources` | 原生入口 | Recover readable JavaScript modules with source provenance and verified files |
| `resolve-adb-packages` | 原生入口 | Find installed packages by case-insensitive name substring |
| `resolve-native-call-targets` | 原生入口 | Resolve one static native call site |
| `search` | 原生入口 | Search every analyzed string or procedure name |
| `search-android-classes` | 原生入口 | Search APK class names; empty query inventories all classes |
| `search-bytes` | 原生入口 | Find masked byte patterns in initialized provider memory |
| `setup` | 独立 REA 安装管理，不适用 | Configure agent integrations and optional analysis providers |
| `start-adb-activity` | 原生入口 | Start an intent with am start (action, URI, component, extras) |
| `start-adb-app` | 原生入口 | Start one installed app by resolving and launching its launcher activity |
| `stop-adb-app` | 原生入口 | Force-stop every process of one package |
| `trace` | 原生入口 | Trace a literal feature through analyzed references |
| `trace-android-references` | 原生入口 | Trace incoming APK using nodes for a class or selected method |
| `trace-application-feature` | 原生入口 | Trace a typed seed through authenticated application Evidence JSON |
| `trace-dylib-resolution` | 原生入口 | Trace dyld load-path resolution for a Mach-O or every executable in an app bundle |
| `trace-javascript-semantics` | 原生入口 | Trace bounded static semantic relations through authenticated application Evidence |
| `trace-native-ui-action` | 原生入口 | Trace a compiled UI action selector to its native handler and direct callees |
| `trace-native-values` | 原生入口 | Trace bounded native def-use and call dependencies |
| `trace-web-module-imports` | 原生入口 | Trace one captured script's native imports to URLs and captured source candidates |
| `trace-web-source-location` | 原生入口 | Trace one retained script position through an explicitly selected local source map |
| `uninstall` | 独立 REA 安装管理，不适用 | Remove REA-owned agent configuration and skill files |
| `uninstall-adb-package` | 原生入口 | Uninstall one package and its data from the device |
| `update` | 独立 REA 安装管理，不适用 | Update this REA installation and verify the installed release |
| `verify-managed-native-boundaries` | 原生入口 | Verify managed P/Invoke declarations against authenticated native Evidence |
| `xrefs` | 原生入口 | List bounded references to an analyzed address |
