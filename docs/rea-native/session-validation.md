# 完整原生会话集成验证

验证日期：2026-10-18，Windows x64，Node.js `v24.21.0`。入口为 `src/rea-native/session/runtime.mjs` 的 `createReaSession()`，测试通过真实注册器的 `invoke()` 调用完整上游服务，没有使用 CLI 或 MCP transport。

测试文件：`test/rea-native-session-runtime.test.mjs`。所有输入均为测试在独立系统临时目录内生成的样本；退出前关闭会话并删除样本。未执行所分析的 JavaScript 或 PE 目标程序，未安装引擎，也未连接浏览器、设备或外部网络服务。

## 已验证行为

| 用例 | 实际调用与关键断言 |
| --- | --- |
| 完整注册和输入边界 | 207 个唯一工具、6 个 prompt；未知操作拒绝；PE 输入类型错误投影为上游契约的 `invalid_request` |
| 双会话证据隔离和导入导出 | 左会话检查真实 PE 资源，右会话仍为空；校验完整 PE hash、资源 payload 偏移 608 和 `HELLO` 固定 SHA-256；左会话创建 unknown 并推进至 blocked revision 2，验证 revision digest 链；右会话 unknown 总数仍为 0 |
| 证据完整往返和关闭 | 导出包含 3 条 Evidence 和 2 个 unknown 历史版本；导入返回精确新增数量，完整 bundle 深比较相同；再次导入新增 0；并发重复 close 成功，已关闭会话不能继续调用，另一会话仍可读取其 3 条记录 |
| SQLite 真实隔离 worker | 用 Node `DatabaseSync` 创建实际数据库，再调用 `inspect_sqlite_database`；核对已关闭源库的 SHA-256、选中表结构、列顺序、两条返回记录、不截断标记、整数 `9007199254740993` 的无损字符串表示、中文 `测试` 的 UTF-8 字节及 blob `00ff7f`；结果确实写入会话 Evidence |
| JavaScript 真实分析 worker | 创建 package.json 与一份含 `ipcMain.handle('greeting', ...)` 的 JS 文件，调用目录静态分析；核对解析文件数 1、失败数 0、主进程 IPC handler 1、非空 semantic graph、进度回调以及会话内相同 evidence ID；worker 为原版 `JavaScriptAnalysisWorker` 启动的真实进程，没有 Mock launcher |
| ZIP 原生归档生命周期 | 构造具有正确 CRC32 和中央目录的单文件 ZIP，调用 `open_binary`、`inspect_artifact`、`close_binary`；核对 active path/hash、`note.txt` 成员及其内容 SHA-256，关闭后 `open=false`；不需要反汇编引擎 |
| 引擎缺失错误 | 将 `REA_WABT_BIN_DIRECTORY` 明确设为本次临时目录下不存在的位置，分析有效最小 WASM 文件；得到 `capability_unavailable` 且提示含 WABT，没有生成伪成功或 Evidence |

每次会话都使用真实 composition、provider、原生 registrar 和 Evidence 所有者。临时 SQLite 只执行测试自己的固定建表和插入语句；JS 内容仅静态分析。ZIP 用例只读归档内容，未提取或运行成员。

## 执行证据

```powershell
node --test test/rea-native-session-runtime.test.mjs
```

最终执行结果：**6 项通过，0 失败，0 跳过，退出码 0**，本次总时长约 17.3 秒（包括完整 runtime 模块加载）。SQLite worker 用例约 2.1 秒，JavaScript worker 用例约 2.4 秒，ZIP 生命周期约 0.7 秒；这些是本次环境测量，不是性能承诺。

首轮遇到两处测试预期错误，已经依据原版实现修正：`AnalysisInputError` 的公开投影码为 `invalid_request`；`BinarySessionStatus` 的目标字段在状态顶层。未为通过测试修改运行时或降低对关键行为的断言。最终运行同时新增并通过 unknown 第 2 次修订以及 ZIP 成员内容 hash 验证。

## 使用和验证边界

测试需要私有会话包依赖已经安装，以及支持 `node:sqlite` 的 Node 运行时。默认不依赖全局 REA、网络服务或额外反汇编器。普通 `node --test test/*.test.mjs` 会自动发现本测试。

这些结果证明代表性无外部引擎路径、真实 worker 和会话 Evidence 生命周期可运行；207 个工具全部注册不等于 207 个工具的外部依赖均已部署。Ghidra、JADX/JDK、Hopper、IDA、Cutter、Frida 注入、PTY 捕获、Playwright 浏览器/Electron 运行、ADB、TShark、WABT 实际执行、Python pwntools/pwndbg、macOS 专用能力及外部网络服务未在本文件验证。注册器的遗漏参数、prompt 动态补全、取消和异常分发细节由主代理独立的 dispatch 测试负责。
