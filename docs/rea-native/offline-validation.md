# REA 原生离线命令验证

验证日期：2026-10-18，Node.js `v24.21.0`。测试入口：`test/rea-native-offline.test.mjs`。直接导入项目的 `src/rea-native/vendor/runtime.mjs`，不调用 REA CLI、子进程或外部分析引擎。

全部样本由测试构造后写入独立系统临时目录，调用真实文件读取与解析逻辑，并在测试结束清理。样本是具有实际字节布局的小型 PE/ELF 文件，并非 Mock Provider；这些文件用于格式解析，不是可执行的完整应用。

| 命令 | 正例样本与独立断言 | 失败与缺失场景 |
| --- | --- | --- |
| `inspect_go_binary` | PE32+ 的 `.data` 中嵌入 Go inline build info；核对 `go1.23.4`、版本 Base64、完整 module 文本、头偏移 512、版本偏移 545 和长度 8 | metadata 缺失、损坏 inline 长度、截断 PE 头 |
| `inspect_rust_binary` | ELF64 的 `.dep-v0` 内嵌真实 zlib JSON；核对两个包、版本、根索引、边 0→1、节偏移 512、压缩/解压字节数及空环索引 | metadata 缺失、非法 zlib、截断 PE 头 |
| `inspect_pe_resources` | PE32+ 三级资源目录；核对类型 10、名称 7、语言 1033、代码页 65001、有效载荷偏移 608、长度 5、`HELLO` 的固定已知 SHA-256 | 目录缺失、非法有效载荷 RVA、截断 PE 头、目录条目预算 2 小于真实 3 时返回完整失败 |
| `inspect_electron_fuses` | PE 中真实 sentinel 与 v1 fuse 字节；核对 sentinel 偏移 512、长度 6、enabled/disabled/removed 状态及 `RunAsNode` 名称 | sentinel 缺失保留 unknown 限制；截断 wire 保留已观察字节但 `complete=false`；截断 PE 头拒绝 |

每项命令还覆盖缺少 path、错误 path 类型、相对路径、未知额外字段以及已取消的 AbortSignal。所有成功结果核对输入文件 SHA-256、操作名和实际文件字节数。

上游的 Electron 容器识别先检查签名，截断且无 PE 签名的文件返回 `AnalysisUnsupportedTargetError`；其余三项返回 `AnalysisInputError`。测试保留该实际错误契约，未统一改写错误类别。部分 Service 没有 `close()` 方法，测试按实际可选生命周期调用。

## 运行结果

普通运行无需本机安装 REA：

```powershell
node --test test/rea-native-offline.test.mjs
```

实际结果：14 项，13 通过、0 失败、1 跳过（可选上游对照），退出码 0。

显式启用本机原版对照：

```powershell
$env:REA_UPSTREAM_ROOT = Join-Path (npm root -g) 'rea-agents'
$env:REA_UPSTREAM_ROOT = node -e "console.log(require('node:fs').realpathSync(process.env.REA_UPSTREAM_ROOT))"
node --test test/rea-native-offline.test.mjs
```

实际结果：14 项，14 通过、0 失败、0 跳过，退出码 0。对照测试先验证包名 `rea-agents` 和版本精确为 `6.5.0`，再直接导入原版 Service 与 Provider；不依赖 CLI 输出，也不从 composition 导入其他分析引擎。四项各比较正例、metadata 缺失两组 `normalized_result` 和 `evidence_id`，并各比较一组截断输入的错误类型、消息及 issues，共 12 组对照结果一致。

本次上游真实路径为 `C:\Users\xiaoz\AppData\Roaming\fnm\node-versions\v24.21.0\installation\node_modules\rea-agents`。上面的命令显式解析 realpath，避免把临时 fnm multishell 别名当成持久位置。

## 验证边界

这批验证针对四个离线解析命令的真实文件路径和代表性格式契约。它不证明其他 REA 命令、全部 PE/ELF/Mach-O 变体、Go pointer 编码、所有资源图标组合、巨型输入或读取过程中外部修改文件等场景已经覆盖；也未在此测试 DSH 宿主的工具注册与会话生命周期。无需额外运行依赖，全部测试只使用 Node 标准库与项目内置 bundle。集成端可直接将该测试纳入现有 `node --test test/*.test.mjs`。
