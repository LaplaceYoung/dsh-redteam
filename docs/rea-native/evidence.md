# REA 6.5.0 离线 Evidence 原生模块

## 已交付范围

本模块从本机已安装 `rea-agents@6.5.0` 的 `dist` 源码构建为项目内的独立 JavaScript 模块。运行时直接执行原有解析、认证、摘要、比较及原子写入算法，不启动 REA CLI、MCP server 或其它进程，不读取全局 REA 安装目录。

| DSH 原生操作标识 | 6.5.0 CLI 命令 | 输入 | 输出 |
| --- | --- | --- | --- |
| `inspect_evidence_bundle` | `inspect-evidence-bundle` | `{path, detail?, filters?}` | 完整规范证据包或摘要 |
| `compare_evidence_bundle_files` | `compare`，别名 `compare-bundles` | `{left, right}` | 两个已认证证据包的分类差异 |
| `validate_evidence_bundle_file` | `evidence-import` | `{path}` | `{imported, unknowns_added, total}` |
| `export_evidence_bundle_file` | `evidence-export` | `{source, output, overwrite?}` | `{path, bytes, records}` |

所有调用返回上游 `Result` 联合：`{ok: true, value}` 或 `{ok: false, error}`。错误保留上游 Error 实例、`_tag`、`operation`、`reason`、`issues`、原因链和资源清理信息。预期失败不被转换为空结果；极少数上游保留为抛出的资源清理异常也仍然传播。`projectEvidenceFileError` 提供上游面向外部的安全错误投影。

## 集成接口与构建

入口为 `src/rea-native/evidence/index.ts`，提供：

- `inspectEvidenceBundleFile(input)`、`compareEvidenceBundleFiles(input)`、`validateEvidenceBundleFile(input)`、`exportEvidenceBundleFile(input)`。
- `invokeEvidenceFileCommand(operation, input)` 用于按操作标识分发。
- `evidenceFileCommands` 提供标识、CLI 名称、别名和调用函数。
- `evidenceFileInputSchemas` 提供输入方向的 JSON Schema，默认字段不标为必填；实际调用仍使用上游 Zod 校验，包含 JSON Schema 无法表达的绝对路径检查。
- `types.ts` 提供 `InspectEvidenceBundleInput`、`EvidenceRecordFilters`、`CompareEvidenceBundleFilesInput`、`ExportEvidenceBundleFileInput`、`EvidenceBundle` 和 `EvidenceBundleSummary`。

已有 TypeScript 构建会编译 `index.ts`、`types.ts`，但不会自动复制 `.mjs`。主构建须把以下文件复制到对应发布目录：

```text
src/rea-native/evidence/runtime.mjs      -> lib/rea-native/evidence/runtime.mjs
src/rea-native/evidence/runtime.d.mts    -> lib/rea-native/evidence/runtime.d.mts
src/rea-native/evidence/LICENSES/        -> lib/rea-native/evidence/LICENSES/
src/rea-native/evidence/provenance.json  -> lib/rea-native/evidence/provenance.json
```

没有新增运行时依赖。约 839 KB 的 `runtime.mjs` 已包含 REA 闭包及实际使用的 canonicalize 3.0.0、stream-chain 4.2.6、stream-json 3.7.0、zod 4.4.3。各自完整许可位于 `LICENSES/`；`provenance.json` 记录 161 个实际构建输入以及运行时产物的 SHA-256。生成步骤使用项目已有的 esbuild，不需要修改依赖或安装包：

```powershell
$upstreamRoot = 'C:\Users\xiaoz\AppData\Roaming\fnm\node-versions\v24.21.0\installation\node_modules\rea-agents'
node src/rea-native/evidence/generate.mjs $upstreamRoot
```

生成脚本要求显式指定包目录并验证包名及版本。安装位置仅用于可重复生成和上游比对；交付运行时没有该路径依赖。

## 契约细节

`inspect-evidence-bundle` 默认 `detail: complete`，并要求绝对路径。`summary` 支持 `evidence_id`、`operation`、`target_sha256`、`analysis_profile_digest`、`procedure_address` 精确筛选，多个筛选取交集。地址不会被规范化。完整模式传入任何 `filters` 都返回上游 `get_evidence_bundle` 输入错误，保留其历史操作名。

6.5.0 此命令没有分页。`offset`、`limit` 属于未知参数并被拒绝，不能添加参数后静默截断。摘要仍先读取和验证完整文件，因此不消除文件大小、内存预算或完整性验证的约束。摘要的 `retention: complete-record` 指完整记录已被保留，不表示记录中的分析已经完整；截断值流、未记录值流、不可用值流和不兼容元数据分别保留。

文件读取会验证 JSON、规范清单、语义证据 ID、重复 ID、残余未知项的引用及修订链，以及进程捕获记录的额外契约。单个 Evidence 记录不是 Evidence bundle，会给出 `wrong-kind` 错误。缺失文件、非法 JSON、目录和完整性错误保持各自的错误分类。

CLI `compare` 比较已认证的证据包成员。单侧成员缺少完整采集保证，分类保持 `unknown`/`unresolved_branch`，不得转换成确定的新增或删除。显式记录配对属于上游另一个 MCP/应用接口，离线 CLI 命令不接收该参数。

离线 `evidence-import` 只读取、验证并计数，不写入 DSH session。其结果中的 `imported` 是上游 CLI 现有字段。为避免误导，DSH 操作命名为 `validate_evidence_bundle_file`。离线导出从显式 source 文件读取规范快照，并按上游原子发布流程写 output；默认拒绝覆盖，显式 `overwrite: true` 才替换。宿主应把导出登记为文件写操作，其它三个登记为只读文件操作。

## 验证证据

`test/rea-native-evidence.test.mjs` 包含 11 项独立运行测试，以及指定上游目录后增加的 1 项实时一致性测试。测试真实创建和读取临时 JSON 文件，不模拟文件系统。

样本为 `fixtures/bundle.json` 的五条规范 Evidence 和单条子集：包含截断、不可用、未记录、不兼容四种值流元数据，以及一个普通字符串观察。`generate-fixtures.mjs` 使用上游公开 Evidence 工厂和算法生成样本及摘要/比较预期文件。测试还独立断言记录数量、缺失/截断语义、精确过滤、默认参数、未知分页拒绝、篡改 ID、重复 ID、清单不一致、不同文件错误、覆盖控制和失败时不发布文件。

2026-10-18 执行结果：

```powershell
$env:REA_UPSTREAM_ROOT = $upstreamRoot
node --test test/rea-native-evidence.test.mjs
# 12 tests, 12 pass, 0 fail, 0 skipped

node node_modules/typescript/bin/tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --skipLibCheck src/rea-native/evidence/index.ts
# exit 0
```

实时一致性测试直接导入安装包模块，对照摘要、比较结果、错误投影和原子导出后的完整字节。正常测试无需 REA 安装，使用已保存的上游预期结果。生成样本时不会读取个人文件，也不会启动目标程序。`fixtures/`、`generate-fixtures.mjs` 和 `entry.mjs` 仅用于开发验证及重建，不需要复制进生产发布目录。

## 边界与剩余集成

本模块只完成上述四个离线文件命令，不声称完成全部 REA 原生迁移。会话证据账本的 `get_evidence_bundle`、`import_evidence_bundle`、`export_evidence_bundle`、带显式配对的会话比较及残余未知项状态管理，需要与 DSH session store 分别集成，不能把此文件模块登记成同名会话工具。原生检查产生的 Evidence 如需导出，仍须通过账本的规范 bundle 构造流程。

没有调用 DSH API，因此本模块不依赖 0.2.0-rc.1 或 0.2.1-rc.2 的内部差异；实际工具注册、文件策略和发布文件复制由主集成负责。验证范围涵盖正常原子写入与覆盖控制，未通过故障注入验证磁盘耗尽、句柄关闭失败或硬链接发布期间的宿主崩溃。
