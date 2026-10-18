# 目录与 DSH 集成接口

本目录基于本机 `rea-agents@6.5.0`，核验 153 项 CLI 与 207 项 MCP；所有采集仅运行帮助/Schema 和 MCP initialize/tools/list，不执行分析或修改 REA 配置。

- `src/rea-native/catalog/index.ts` 导出 `reaToolContracts`、`getReaToolContract(name)`、`ReaToolContract`、`ReaJsonSchema`、`reaUpstreamVersion`。207 项完整输入 JSON Schema、描述、annotations、effects、来源、CLI 关联均可读取。无第三方运行依赖，无 CLI fallback；这是目录接口，不是执行实现。
- `cli-full-manifest.json` 保存全部 CLI args/options/output Schema。`cli-manifest.json` 是独立 `--llms` 索引结果，用于交叉核对数量和名称。
- `mcp-tools.json` 保存运行中的 MCP 完整 tools/list，包括 207 项输出 Schema 和初始化协商结果；约 8.8 MB，留在文档目录，不随常态运行导入。
- `capability-catalog.json` 是可机器处理的 CLI/MCP 关联和来源目录。`README.md` 为逐项阅读表格。CLI 的路径、选项和短生命周期与 MCP 会话输入不同，关联不能当成参数别名直接转发。
- 生成脚本为 `generate-catalog.mjs`；先运行 `capture-mcp.mjs <REA_PACKAGE_ROOT>` 更新实际 MCP 返回，再重新运行 REA 的 `--llms --format json` 与 `--llms-full --format json` 更新两个 CLI 清单，最后生成目录。不用 npx，不下载升级包。
- DSH 应只注册实际已移植并验证的实现，保留完整 inputSchema 中的 `$defs`、`$ref`、`required`、`additionalProperties` 和 `examples`。不能只复制 properties；effects/annotations 属于注册和执行策略元信息，不应剥掉后宣称能力等价。
- 本目录不依赖 DSH 0.2.0-rc.1 或 0.2.1-rc.2 的 API。父任务应在实际宿主版本验证 JSON Schema 方言和工具错误结果映射；目录本身没有假定宿主兼容性。
- 四项离线解析 MCP 工具和对应 CLI，以及四项 Evidence 文件 CLI，在生成快照中标记 `implemented-native-tested`，合计 8 项 CLI、4 项 MCP。四项 Evidence 文件 CLI 的 `nativeOperation` 分别为 `inspect_evidence_bundle`、`compare_evidence_bundle_files`、`validate_evidence_bundle_file`、`export_evidence_bundle_file`；`compare-bundles` 记录为 `compare` 别名。MCP 会话证据读取、导入、导出和比较仍保持 `pending`，不可由离线文件命令的完成状态推定。其余条目均 `pending`，目录收录数量不表示已迁移数量。

验证命令：`node --test docs/rea-native/catalog/catalog.test.mjs`。测试直接比较采集结果和 TS 导出的完整输入契约，核对 153/207 个唯一名称、关联操作存在性，以及输入/输出 Schema 的全部本地引用可解析。上游 MIT 许可证保存在 `UPSTREAM-LICENSE.txt`。

本次验证：3 项测试全部通过，0 跳过、0 失败；单独对 `src/rea-native/catalog/index.ts` 执行 TypeScript `--noEmit --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext`，退出码 0。所有 CLI 和 MCP 条目均找到发布包内来源文件与行号。无参数 CLI 项保留上游缺省 Schema，不人为补造。`.installed-root.txt` 临时文件已删除；采集脚本显式接收包路径。`cli-full-manifest.json` 实际 176032 字节，包含契约，必须保留。
