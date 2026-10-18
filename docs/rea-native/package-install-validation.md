# REA 主包安装验证

环境：Windows x64，Node 24.21.0，npm 11.19.0。此记录验证 REA 的分发和进程内运行，不代替主插件其他模块的最终全仓构建或宿主验收。

## 安装布局修复

最初的 `file:src/rea-native/session` 目录链接在主包中保留了错误的嵌套依赖路径。空目录安装后，REA 实际解析到根 YAML 2.9.1、ws 8.22.0，偏离其独立包的精确声明。已改为内容摘要命名的 `vendor/dsh-redteam-rea-native-session-6.5.0-dsh.1-18c72de38554.tgz`，主包使用该本地 tarball 依赖并将原生包纳入 `bundleDependencies`。

根生产依赖 YAML 2.9.1 没有降级；REA 独立包现在解析到其声明的 YAML 2.9.0、ws 8.21.0。新增的 `parse5` 直接生产依赖沿用已安装的 8.0.1。维护命令 `npm run package:rea-native` 生成 tarball 并更新依赖/锁文件；内容摘要和锁文件完整性相同时不重复安装。

完成宿主依赖声明后再次执行该维护命令，退出码 0，生成相同的 5,721,994 字节原生 tarball，未触发重复安装。SHA-512 完整性为 `sha512-s94DjPOCaoYzuAZyXwc0at2cJjtzcgqcL+aAjAQhbgd/3VA4CxvC/TrDuyepWCxtrAtbpkF5oRSRpXwk2ey8qw==`。

`scripts/build-resources.mjs` 同时复制 `lib/interception/LICENSE-ARTEX.txt` 与 `lib/interception/source.json`。AGPL 全文与源目录中的原许可证逐字节一致，SHA-256 为 `0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0`；来源记录包括 ARTEX 仓库、修订及原始 `intercept/prompt.go`。REA 的 MIT 及第三方许可证保持各自原文件。

## 空目录安装及首次运行

初始安装目录为 `C:/Users/xiaoz/AppData/Local/Temp/dsh-rea-package-jJWb7S/installed`。实际执行主包 `npm pack` 后，在空目录运行 `npm install --ignore-scripts --omit=dev --no-audit --no-fund <主包.tgz>`，成功添加 365 个包。安装日志保存在其父目录，未使用工作区 node_modules 作为运行时路径。

首次运行验证的固定版本断言暴露上述布局差异。修订验证器后，用根锁文件明确记录的 YAML/ws 版本契约复用该安装执行运行测试；此基线仅用于区分版本布局问题与功能失败，不代表原生依赖版本正确。

基线运行成功：207 个操作、6 个提示词、153 个 CLI 契约，独立安装目录中的真实 SQLite Worker 和 JavaScript Worker 均执行成功；两条 Evidence 进入同一账本，关闭完成。日志为 `runtime-baseline.stdout.log` / `runtime-baseline.stderr.log`。

## 最终修订包验证

本轮最终 tarball 和日志目录：`C:/Users/xiaoz/AppData/Local/Temp/dsh-rea-package-nuYKUc`。包压缩大小 32,555,303 字节，解包 127,013,987 字节，共 8,242 个条目；清单已确认包含 ARTEX 许可、来源及 REA 独立包。

最终包在上述初始安装目录中执行差量安装，成功添加 2 个包、更新 17 个包，耗时约 9 分钟，退出码 0。运行验证从原生包自身 `package.json` 读取精确依赖契约，实际解析为 YAML 2.9.0、ws 8.21.0。

安装后的 207 个操作、6 个提示词、153 个 CLI 契约检查通过；真实 SQLite Worker 返回预期表值，JavaScript Worker 解析 1 个文件并识别 1 个 IPC handler，账本包含对应的 2 条 Evidence，关闭成功。1,944 个安装文件与验证当时的工作区源码逐字节一致，差异为 0；完整验证进程退出码 0。机器可读结果另保存为 [package-install-result.json](./package-install-result.json)。

被验证主包的 SHA-256：`f643f7e78b366f224142c678f5a68170e2c60afe68b0e8a9b1b6aa1b4f85c734`。这是一份明确的 REA 分发验证快照。验证后，系统模块另要求把已安装的 `@deepseek-ai/dsh-credentials`、`@deepseek-ai/dsh-launch-environment`、`@deepseek-ai/dsh-compaction`（均为 0.2.1-rc.2）加入根 peer/dev 声明；该清单变更及其他模块的最终统一构建不属于上面的压缩包摘要。前两项也已在被验证的独立安装目录中确认版本为 0.2.1-rc.2。不要把此快照称为后续整个项目源码的最终发布包。

独立重现整个流程：`npm run verify:rea-package`。复用安装时直接运行 `node scripts/verify-rea-package.mjs <npm-cli.js绝对路径> <已安装目录>`；每轮仍创建独立日志目录并保留压缩包、SHA-256、运行结果和文件差异。

所有安装使用 `--ignore-scripts`；这未编译可选 Frida binding，也没有验证 Ghidra、IDA、Hopper、JADX、TShark 等外部引擎。207/153 是连接与契约数量，不能替代每种外部环境的功能验收。
