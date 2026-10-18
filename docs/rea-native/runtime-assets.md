# REA 6.5.0 原生运行时资源调查

调查日期：2026-10-18。依据本机已安装的 `rea-agents@6.5.0` 成品代码和实际资源，不依据 GitHub master。源根目录经 realpath 确认为：

```text
C:\Users\xiaoz\AppData\Roaming\fnm\node-versions\v24.21.0\installation\node_modules\rea-agents
```

以下路径均相对此根目录；行号来自本次安装的文件。资源调查不调用 `rea` CLI 或 MCP server，不启动浏览器、调试器或目标程序。

## 推荐交付布局

采用主代理确定的私有嵌套 npm 包，保留上游模块布局。DSH 直接调用进程内 registrar 和 Service/Provider；REA 原设计中的隔离 worker、Java/Python bridge 与调用方提供的外部引擎仍保留。

```text
src/rea-native/session/
  package.json                 # 私有包及精确 dependencies、exports
  package-lock.json
  runtime.mjs                  # 导出 createReaSession
  node_modules/                # npm 安装的依赖，非提交源文件
  upstream/
    package.json               # 保留原版 type:module、imports 和版本
    dist/                      # 保留相对目录；替换 EvidenceMcpServer 为 registrar
    bridge/                    # Python、Java、Swift 及其同目录辅助文件
    scripts/                   # guardian、Electron hooks、Hopper helper
    native/windows/build/      # manifest.json + rea-windows-x64.node
    third_party/               # 外部引擎说明及许可证，不能误当已带引擎
    licenses/
    skills/                    # SetupSkill 的按包相对路径读取契约
    LICENSE
    THIRD_PARTY_NOTICES.md
```

主插件构建可以 bundle 自己的适配器，但私有包保持正常 npm 文件布局；`file:` 依赖安装及产物打包必须包含上述资源。不要把 `upstream/package.json` 替换成 DSH 插件元数据，因为 worker 的 package imports 和 `.js` 的 ESM 类型由最近的包作用域决定。源目录不用复制完整 `node_modules`；私有包依赖由锁文件安装，发布产物需要确实包含这些安装结果或有可执行的安装步骤。

## 已确认的运行时路径契约

| 能力 | 源代码定位 | 必须保留的内容 |
| --- | --- | --- |
| JavaScript 静态分析 worker | `dist/javascript/analysis/JavaScriptAnalysisWorker.js:344` | `import.meta.resolve('#javascript-analysis-worker')`；原版 `package.json` 的 imports 将其映射至 `./dist/composition/javascriptAnalysisWorkerProcess.js` |
| Windows 原生进程/文件权限控制 | `dist/windows/WindowsNativeLoader.js:121–127` | 按 loader 的 `import.meta.url` 读取 `../../native/windows/build/manifest.json` 和 `.node`，再用 `createRequire` 加载 |
| Ghidra | `dist/ghidra/GhidraProviderClient.js:328`，`GhidraLauncher.js:302,391–436` | `bridge/ghidra/ReaGhidraBridge.java` 及整个同目录 Java 文件；launcher 由 bridge 的 dirname 构造其他预处理/分析脚本路径 |
| JADX | `dist/android/JadxProvider.js:18,275–290` | `bridge/android/ReaJadxBridge.java`；先计算 hash 再复制到受控 workspace，不能拿空文件替代 |
| Android workspace guardian | `dist/android/JadxWorkspaceRoot.js:10` | `scripts/rea-android-workspace-guardian.mjs` |
| Hopper | `dist/hopper/HopperProvider.js:186,190` | `bridge/hopper_bridge.py` 和 `scripts/hopper-demo-x11.py` |
| Electron 主动观察 hook | `dist/browser/PlaywrightElectronActiveProvider.js:15` | `scripts/electron-active-hook.cjs` 与其同目录 `electron-active-hook-boundaries.cjs` |
| mitmproxy 原生录制解析 | `dist/browser/history/MitmproxyCaptureAdapter.js:42` | `bridge/mitmproxy/capture.py`，由原版 provider 调用显式配置的 mitmdump |
| pwntools | `dist/native/pwntools/PwntoolsLayoutProvider.js:12`，`PwntoolsRecordedCrashProvider.js:16` | `bridge/pwntools/layout.py`、`recorded_crash.py` 及 `layout_impl.py`、`recorded_crash_impl.py`、`decoder_runtime.py` |
| pwndbg | `dist/native/pwndbg/PwndbgCoreContext.js:101` | `bridge/pwndbg/launch.py` 与 `launch_impl.py`、`core_context.py` |
| macOS native UI / LLDB | `dist/native/NativeUiHelperRuntime.js:20,28`，`NativeUiObservation.js:10`，`LldbCallTracer.js:30` | `bridge/native/ReaNativeUI.swift`、`NativeUIChildren.swift`、`rea_lldb_tracer.py` |
| Darwin 进程身份 | `dist/process/DarwinProcessRunTokenReader.js:44–45` | `bridge/process/ProcessRunTokenReader.swift`、`ProcessRunTokenReaderMain.swift` |
| 包身份/安装技能 | `dist/serverIdentity.js:6`，`dist/application/SetupSkill.js:34` | 保留原模块相对包根及 `skills/reverse-engineer-anything`，使身份路径与技能读取不指向插件外部 |

除 JavaScript worker 外，以下文件也由父模块按 URL 作为独立进程或线程入口定位，必须保留且可解析其各自依赖：

- `dist/hopper/HopperRegexWorker.js`
- `dist/evm/EvmoleInterfaceWorker.js`
- `dist/sqlite/SqliteDatabaseWorker.js`
- `dist/javascript/sourceMaps/SourceMapCodecProcess.js`
- `dist/browser/history/NodeCaptureProcess.js`

JavaScript worker 使用 `process.execPath`，带 heap/stack 参数、私有工作目录、握手和受控进程清理。迁移不能把它改成没有内存约束的同步函数，也不能把启动自己的 worker 等同于继续调用 REA CLI。DSH 实际进程必须提供兼容的 Node 运行时；REA 声明范围为 `^22.19.0 || ^24.11.0 || >=26.0.0`。

## 原生模块和动态依赖

| 包或资产 | 本机版本/路径 | 保留原因 |
| --- | --- | --- |
| REA Windows addon | `native/windows/build/rea-windows-x64.node` | manifest 固定 `win32/x64`、ABI 1、Node-API 8；loader 校验包版本、文件 hash、PE32+ machine，然后执行自检 |
| `frida` | `17.23.2`，`node_modules/frida/build/frida_binding.node`，本机 135,663,104 bytes | `dist/frida/FridaInstrumentationManager.js:39` 动态 import；Frida 的 `build/src/frida.js:6–11` 用 `bindings` 按模块根寻找二进制。保持整个包和它的依赖，不单独搬一份 JS |
| `@lydell/node-pty` | `1.1.0` | `ProcessCaptureCapability.js:47` 动态 import。`requireBinary.js` 动态拼接 `@lydell/node-pty-${platform}-${arch}`，不会由静态打包自动发现全部平台资产 |
| `@lydell/node-pty-win32-x64` | `1.1.0`，`conpty.node` 和 `conpty_console_list.node` | 平台可选依赖在本机确实安装；`windowsPtyAgent.js:121` 还会 fork 包内 `conpty_console_list_agent.js`。不能使用 `npm --omit=optional` 后宣称 PTY 完整 |
| `playwright-core` | `1.58.2` | Electron launcher、browser scenario、native module resolver 动态 import；保留整包 `lib`、`browsers.json` 和 loader 等资源。core 包存在不代表浏览器或 Electron 应用已安装 |
| `evmole` | `0.9.3` | `EvmoleInterfaceWorker.js:29–37` resolve `evmole/no_tla`，读取邻接 package.json 核验版本，并 resolve/read `evmole/evmole_bg.wasm`；必须保留 exports 和真实 WASM 文件 |
| `har-schema`、`ajv`、`ajv-formats` | `2.0.0`、`8.20.0`、`3.0.1` | `dist/browser/history/HarSchema.js:9–15` 用 createRequire 动态读完整 HAR JSON schemas、draft-06 JSON 和 formats 插件 |
| `@xterm/headless`、`@xterm/addon-serialize` | `6.0.0`、`0.14.0` | `dist/process/capture/TerminalRenderer.js:2–6` 用 createRequire 加载 CommonJS 包 |
| `@jridgewell/trace-mapping` | `0.3.31` | `dist/javascript/sourceMaps/TraceSourceMap.js:54` 在运行时读取包的 package.json；仅 bundle JS 会缺少版本证据 |

本机 Windows addon 的 manifest 与实算 SHA-256 一致：

```text
665c57ab90aef0712a6aafc423c7992a88bf608bea63b370cb30c695900f9aed
```

保留 `.node` 文件不等于所有宿主 ABI 均兼容。本调查检查资源和声明，没有在 DSH/Electron 进程中加载 Frida 或 PTY addon。需要在实际插件执行进程中检验加载；Windows REA addon自身为 N-API 8，Frida/PTY 包应继续走原包安装和平台选择。

单 bundle 方案另有两点真实风险，保留布局后不必额外修补：`pino` 的 transport 与 `thread-stream` 会按 `__dirname` 寻找 worker；REA 默认 logger 使用 stderr destination，没有启用 transport。`@zip.js/zip.js@2.15.0` 根入口走 `zip-fs-wasm.js` 和 inline worker/WASM 配置，不能把扫描到的 external-assets 路径误判为默认路径；保留完整包可同时保留其原出口能力。

## 外部引擎仍是原设计的前置条件

- Ghidra 由原配置和 installation 校验选择真实安装及 JDK。`GhidraInstallation.js` 读取应用声明的 Java 版本边界；Java bridge 文件本身不是 Ghidra 引擎。
- JADX 通过 `REA_JADX_MCP_JAR` 指向调用方提供的 `jadx-headless-mcp 0.7.1` JAR；`JAVA_HOME` 或 PATH 必须选择包含 `jdk.compiler` 的完整 JDK。原版 `JadxRelease.js` 固定 JAR SHA-256 为 `6e5eacf500b64292bfb73c49797c1958f6ee44646e43e868039ae7feb573ff75`，迁移应保留校验。
- `REA_PWNTOOLS_PYTHON` 指向原有 Python 环境，原版要求 pwntools `4.15.0`、pyelftools `0.33`、Unicorn `2.1.2`。pwndbg 使用 `REA_PWNDBG_GDB`、`REA_PWNDBG_GDBINIT`、`REA_PWNDBG_VENV_PATH`；第三方说明固定 pwndbg `2026.09.15`。
- mitmproxy 原生录制 provider 要求 Linux 和显式 `REA_MITMDUMP_COMMAND` 指向 `12.2.3`，HAR 不需要此引擎。
- `third_party/` 本机只有说明/许可证，不含 pwntools、pwndbg 或 WABT 安装。复制这些目录不能报告“引擎已接通”。完整迁移应保留原 provider 的可用性错误和支持平台边界。

## 可执行资源审计

新增 `src/rea-native/runtime-assets/audit.mjs`，可对原包或保留相同结构的 staged `upstream` 只读执行：

```powershell
node src/rea-native/runtime-assets/audit.mjs 'C:\Users\xiaoz\AppData\Roaming\fnm\node-versions\v24.21.0\installation\node_modules\rea-agents'
node src/rea-native/runtime-assets/audit.mjs 'C:\Users\xiaoz\OneDrive\文档\ChatGPT\dsh插件\src\rea-native\session\upstream'
```

第二条在私有包及依赖完成安装后运行。脚本验证精确包身份、声明运行资源、6 个 worker、package imports、41 项本机适用的直接/可选/平台依赖及关键包资产、Windows addon hash。输出每项依赖的真实解析根，便于确认 staged 结果使用私有安装，未意外解析到全局 REA。必需项缺失或错版退出码为 1；可选 Frida 不可用单独列入 `optionalUnavailable`，不会假报该能力可用。脚本不加载 addon，不访问网络，不创建 worker，不读取目标文件。

2026-10-18 本机原版实际执行：Node `v24.21.0`，`ok=true`，52 个资源条目存在，41 项依赖版本/关键资产符合要求，`issues=[]`、`optionalUnavailable=[]`，退出码 0。最初用 `createRequire.resolve` 解析三个仅支持 ESM 的依赖失败；采集脚本已改为沿 Node 的真实模块搜索路径读取包元数据，最终通过。该修正仅涉及审计器，不改变上游实现。

此审计证明资源存在、版本和固定摘要匹配，不证明完整 Service 注册、worker 协议及外部引擎实际运行。主代理仍需在安装后的私有包中执行代表性 worker 和宿主生命周期验证。
