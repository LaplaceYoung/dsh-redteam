# REA 原生迁移集成记录

状态：首批8项接口保持兼容；完整会话已连接207个原版工具handler与6个prompt，并接入真实DSH Agent生命周期（2026-10-18）。代表性原生和DSH集成已验证；全部外部引擎验证尚未完成。本记录由REA工作包维护。

**阶段2主入口与安装方式见 [session-integration.md](./session-integration.md)。** 以下首批接口、无新增依赖的bundle构建和30项结果仍有效；它们仅描述首批模块。完整会话采用保留资源布局的嵌套npm包，不能套用首批bundle的“无新增运行时依赖”说明。

本机确认安装 `rea-agents@6.5.0`，入口 `scripts/rea.mjs`，完整可读实现位于安装包 `dist/`；MIT 许可允许保留版权后移植。实测 CLI 153 项（`--llms` 和 `--llms-full` 交叉核对），MCP 207 项（运行中的 `initialize` / `tools/list`），两个口径分别记录于 `catalog/`，含完整输入输出 Schema 与每项来源行号、SHA-256。

第一批实现直接移植上游 application/provider/domain 解析代码并打包到本地模块，在 DSH 进程内调用，不执行 REA CLI、不要求运行时安装 rea-agents。外部反编译器依赖不因移植而消失，尚未迁移的命令不会注册为成功占位。

首批四项解析能力已实现：`inspect_go_binary`、`inspect_rust_binary`、`inspect_pe_resources`、`inspect_electron_fuses`。输入、解析器、provider、Evidence 创建与错误对象均保留上游行为。另外完成四项离线文件能力：`inspect_evidence_bundle`、`compare_evidence_bundle_files`、`validate_evidence_bundle_file`、`export_evidence_bundle_file`。

主代理后续集成需要：将下面构建清单的 `.mjs`、`.d.mts` 与许可文件复制到对应 `lib/rea-native/` 路径；TypeScript 入口由 tsc 编译。生成脚本仅用于维护源代码快照，生产运行不依赖上游安装目录。不需要新增运行时 npm 依赖，原版必要纯 JS 依赖已纳入可审计 bundle。

本模块不直接依赖 DSH rc1 或 rc2 API。主代理通过公开 TypeScript 接口调用，并将完整 Evidence 存入 DSH 持久层；不要将仅有解析成功解读为全部 207 项已迁移。

## 已可集成接口

入口：`src/rea-native/index.ts`，类型：`src/rea-native/types.ts`。

```ts
import { ReaNativeRuntime, nativeOperations, nativeInputSchemas } from './rea-native/index.js';

const runtime = new ReaNativeRuntime();
// 使用 nativeOperations 与 nativeInputSchemas 注册实际支持的四个 DSH 工具。
const result = await runtime.inspectPeResources({ path: absolutePath });
if (!result.ok) throw result.error; // _tag、issues、reason等错误信息原样保留。
// result.value 为完整原版 Evidence；normalized_result 才是具体解析报告。
await storeEvidence(result.value);
await runtime.close(); // 注册进DSH service dispose，回收上游文件资源。
```

统一入口为 `invoke(operation, input: unknown, { signal? })`。`isNativeOperation(string)` 只识别已实现的四项，其他命令不应路由进此入口。四个便捷方法为 `inspectGoBinary`、`inspectRustBinary`、`inspectPeResources`、`inspectElectronFuses`。路径必须是宿主绝对路径，输入严格禁止未知字段；PE 可设置 `max_file_bytes` 与 `max_entries`，默认和上限保持原版。

同一入口也 re-export 离线证据接口：`invokeEvidenceFileCommand`、`evidenceFileCommands`、`evidenceFileInputSchemas` 及四个具名函数，详见 [evidence.md](./evidence.md)。它们是 CLI 文件契约，不能冒充 MCP 会话账本操作；其中 export 会写文件，其他三项只读。`evidence-import` 的原版 CLI 实际只验证文件并返回计数，因此这里命名为 `validate_evidence_bundle_file`。

完整目录单独从 `src/rea-native/catalog/index.ts` 导入 `reaToolContracts`、`getReaToolContract`、`reaUpstreamVersion`。目录模块约0.92 MB，不强制载入主运行时。目录的首批直接对照覆盖为8个CLI命令和4个MCP操作；这一tested标记保留，不能等同于阶段2完整handler分派范围。CLI/MCP相关映射不代表参数等价。主集成应从阶段2真实session.operations与describeTool注册完整工具。

## 构建与归属

- `src/rea-native/vendor/runtime.mjs` 是已打包的实际实现（约817 KB，非压缩可读代码）。运行时仅导入Node标准模块，没有 `rea-agents`、REA CLI、网络或子进程入口。
- `src/rea-native/vendor/provenance.json` 保存 145 个输入源文件 SHA-256、版本、入口文本、依赖版本和生成物 SHA-256。
- `vendor/LICENSE`、`vendor/licenses/` 保留 REA MIT、Zod MIT、canonicalize Apache-2.0 许可；分发时一并复制。
- 维护重建：`node src/rea-native/vendor/build.mjs <本机rea-agents包根目录>`。它严格要求 6.5.0，使用项目已有 esbuild，输出到同目录。不需要主代理改 package.json 运行时依赖。
- tsc 不复制 `.mjs` / `.d.mts`，主构建需复制 `vendor/runtime.mjs`、`vendor/runtime.d.mts`、`vendor/LICENSE`、`vendor/licenses/`、`vendor/provenance.json` 到 `lib/rea-native/vendor/`。
- 同时复制 `evidence/runtime.mjs`、`evidence/runtime.d.mts`、`evidence/LICENSES/`、`evidence/provenance.json` 到 `lib/rea-native/evidence/`。该实现约839 KB，161个输入源记录，已内置 stream-json/stream-chain/canonicalize/zod 依赖及许可。
- 维护脚本、evidence/fixtures 和8.8 MB原始MCP schema证据不需要进入生产包。不要把维护用 build/generate 脚本当运行入口。

## 验证与剩余事项

- API 测试1项、离线解析测试14项、证据文件测试12项、目录契约测试3项。实时上游对照通过 `REA_UPSTREAM_ROOT` 显式启用，直接导入上游Service/Provider，不启动REA子进程。
- 解析样本独立验证Go版本及字节偏移、Rust两包依赖图、三级PE资源与HELLO固定哈希、Electron enabled/disabled/removed状态；四项各比对正例、缺失、截断，共12组上游报告/ID/错误一致。
- 证据文件测试覆盖规范包认证、精确过滤、残余不确定性、ID篡改、重复记录、清单不一致、文件错误、原子导出及覆盖拒绝；实时比对上游摘要、比较、错误投影和导出字节。
- 目录检查覆盖207个工具的完整输入契约、153个CLI的完整参数以及输入输出Schema所有本地引用；`test/rea-native-catalog.test.mjs` 将其纳入项目现有test glob。
- 独立 `tsc --noEmit --strict --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck src/rea-native/index.ts src/rea-native/catalog/index.ts` 验证本工作包；最终运行记录见下文。
- 首次全项目 typecheck 被并行开发中的 `src/planner/runtime.ts` 缺少 `./model.js` 阻塞；未修改该目录，主代理应在合并后完成全项目校验。
- 首批阶段未修改共享入口与构建；后续明确授权后已接入 `src/rea-native-integration.ts`、根package/lock和资源构建。真实Agent加载、工具注册、错误与释放验证见 `dsh-integration-validation.md`；最终安装验证另见 `package-install-validation.md`。共享 `src/rea.ts`、`src/tools.ts` 和store逻辑仍由主任务维护。
- 阶段2已将有状态provider、JavaScript与浏览器/Electron、managed/Android/firmware、网络/信号记录、会话Evidence/unknown账本及比较等handler连接到原应用层。主集成与外部引擎/OS专项验证仍需继续，不以首批八项或207项注册数量替代完整迁移验收。

最终合并验证（Node 24.21.0，2026-10-18）：

```powershell
$env:REA_UPSTREAM_ROOT = Join-Path (Split-Path (Get-Command rea).Source) 'node_modules/rea-agents'
node --test test/rea-native-api.test.mjs test/rea-native-offline.test.mjs test/rea-native-evidence.test.mjs test/rea-native-catalog.test.mjs
# 30 tests / 30 pass / 0 fail / 0 skipped，exit 0

node node_modules/typescript/bin/tsc --noEmit --strict --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck src/rea-native/index.ts src/rea-native/catalog/index.ts
# exit 0
```

默认不设置 `REA_UPSTREAM_ROOT` 时跳过两项可选实时上游对照，其余28项仍直接检验本地模块，不需要REA安装。完整上游实测已在本次交付前执行，不把跳过当成验证通过。
