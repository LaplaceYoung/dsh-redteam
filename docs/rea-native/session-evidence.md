# REA 6.5.0 会话 Evidence 与未知项状态

## 真实上游分层与复用边界

已读取本机 `rea-agents@6.5.0` 的真实发行源码：

- `application/investigation/EvidenceLedger.js`：唯一 Evidence Map、未知项修订 Map、未知项当前版本 Map；校验、去重、原子合并、乐观修订控制、稳定分页、解析验证。
- `application/investigation/InvestigationRecords.js`：组合一个 EvidenceLedger，创建未知项变更 Evidence，并暴露独立于二进制执行的完整记录所有者。
- `application/binary/BinarySessionRecords.js`：通过 `constructor(records = new InvestigationRecords())` 接收记录所有者，同时管理 native analysis snapshot 和变更通知。
- `server/registerSessionRecordTools.js`：get/import/export 与 unknown 工具的实际返回值及调用顺序。
- `server/registerBundleComparisonTool.js`：真实工具名是 `compare_bundles`，接受文件路径和显式 `record_pairs`，保存源 Evidence 与比较 Evidence。

当前原生模块直接打包前两层及其纯 JavaScript 依赖，不重新实现账本算法。`createSessionEvidence` 仅把八个工具的参数校验、文件处理、返回投影与宿主生命周期接到该所有者。不会创建 native provider、启动 REA CLI、创建 MCP server 或转发 MCP 请求。

完整 REA session 若已复用上游聚合，应优先使用聚合自己的注册和 `BinarySessionRecords` 路径。不能再创建第二个独立账本。此模块可以直接提供同一个 `InvestigationRecords` 实例供聚合组合；单纯共享 Map 不能代替外层 snapshot 通知。特别是导入导致 `metadataChanged` 时，上游外层会失效化 snapshot，普通新增和 unknown 更新会通知 snapshot observers；直接通过独立适配器调用纯 records 将绕过这些外层通知。集成时应由完整聚合处理这组操作，或把这些已存在的外层语义接回宿主。

## 调用接口

入口 `src/rea-native/session-evidence/index.ts` 暴露：

- `InvestigationRecords`、`EvidenceLedger`：上游原类，保留完整状态接口。
- `createSessionEvidence({ records?, getTarget? })`：返回 `{ records, invoke, recordEvidence, close }`。省略 records 时每个实例各自创建一个记录所有者；注入时使用调用方已有所有者。
- `sessionEvidenceOperations`：八个真实操作名。
- `sessionEvidenceInputSchemas`：与上游对应工具一致的输入方向 JSON Schema。
- `projectSessionEvidenceError`：原有安全错误投影。
- `types.ts`：记录所有者、Unknown 输入及修订、分页、返回联合和生命周期选项的 TypeScript 契约。

`invoke(operation, input, {signal?})` 返回 `Promise<NativeResult<SessionEvidenceValue>>`。所有预期错误保留上游 Error、`_tag`、`reason`、`issues` 及原因链；没有把失败转换成空结果。`recordEvidence` 同步验证并返回 `added` 或 `duplicate`，可供已有原生分析工具保存完整 Evidence。

```typescript
import { createSessionEvidence } from './rea-native/session-evidence/index.js';

// 在每个 DSH session 的创建回调中创建一次，随该 session 释放。
const evidence = createSessionEvidence();
const imported = await evidence.invoke('import_evidence_bundle', { path: absoluteBundlePath });
const summary = await evidence.invoke('get_evidence_bundle', { detail: 'summary' });
await evidence.close();
```

低层 `InvestigationRecords.recordUnknown` 和 `EvidenceLedger.recordUnknown` 的参数必须已经经过 schema 校验并应用默认值，因此类型使用 `ParsedRecordUnknownInput`，两个 Evidence ID 数组必填。宿主面向用户的入口应调用 `invoke`，该入口负责填充上游默认数组、拒绝未知字段和验证分页范围。

| 操作 | 输入与返回 | 对状态的影响 |
| --- | --- | --- |
| `get_evidence_bundle` | `{detail?, filters?}` → 完整包或摘要 | 只读；complete 返回已封存不可变快照 |
| `import_evidence_bundle` | `{path}` → `{imported, unknowns_added, total}` | 文件完整认证后原子合并所有记录与未知项修订 |
| `export_evidence_bundle` | `{path, overwrite?}` → `{path, bytes, records, unknowns}` | 导出完整修订历史，默认拒绝覆盖 |
| `compare_bundles` | `{left_bundle_path, right_bundle_path, record_pairs?}` → 完整比较 Evidence | 保存两侧源 Evidence 和比较 Evidence；不合并未知项图 |
| `record_unknown` | 上游问题、证据要求和关系输入 → 第 1 版 Unknown | 与 mutation Evidence 一起原子提交 |
| `update_unknown` | `{unknown_id, expected_revision, ...完整状态}` → 新 Unknown 修订 | 旧修订号冲突时拒绝，保留历史和前驱 digest |
| `list_unknowns` | `{status?, severity?, domain?, offset?, limit?}` → `{items,total,offset,next_offset}` | 只读；按稳定 ID 顺序分页 |
| `verify_unknown_resolution` | `{unknown_id}` → `{valid,truthVerified,unknown}` | 只读；撤回或超出范围不声明真值已验证 |

`getTarget` 由宿主提供当前已经绑定的真实分析目标，仅用于未知项 mutation Evidence 的 subject 和问题初始 scope；未提供时生成无 subject 的上游 mutation Evidence，保留其 identity unavailable 限制。更新不改变问题原有 scope。该模块不自行寻找或选择目标。

## 保留的状态约束

Evidence 验证语义 ID，按 ID 去重。对外可变读取是脱离存储的副本，分析借用对象被深度冻结。重导入显示名称或本地路径变化不会改变语义 ID，并返回 `metadataChanged` 供外层处理。

完整 bundle 导入先验证所有 Evidence、规范 manifests、未知项修订链及引用，再提交。重复导入返回新增计数 0；未知项同一修订号出现不同 digest、修订缺口、缺失引用和循环依赖都会拒绝，已有状态保持不变。

未知项身份由问题、domain、scope 等不可变字段决定。变更留下 `rea.residual-unknown-mutation` Evidence，其 authority 为 `analyst-inference`，并明确记录“分析者意图不能证明答案”。verified resolution 要满足实际 Evidence 的 authority/confidence/environment 条件，不能保留冲突 Evidence。withdrawn/out-of-scope 虽可让状态 resolved，`truthVerified` 仍为 false。

比较完整历史可区分 `history_advanced` 和 `history_diverged`。单侧 Evidence 缺少采集完整性的保证，仍作为 unknown，不被改写成确定新增/删除。源 Evidence 被保留，但左右两个可能冲突的未知项图不会合并到比较会话。显式 record_pairs 必须一一对应且两侧引用存在；无效配对在保存源记录前失败。

## 生命周期和宿主职责

`close()` 先停止新调用，等待已接收操作结束，再关闭资源作用域。自身创建的 records 会清空；注入的 records 归外部所有，保留其数据。关闭后调用返回 `AnalysisCapabilityUnavailableError`，reason 为适配器定义的 `session_closed`。清理失败保留真实抛出异常，并允许再次调用 close 重试，不能把异常吞掉后报告成功。

已中止的 signal 在调用前拒绝；文件 import/export 和比较使用上游中止与发布检查。当前适配器没有实现 DSH session 持久化、工具授权或 native analysis admission。宿主需按 DSH session 创建/恢复/释放对象，对写入路径使用现有文件策略；完整聚合的 provider 锁与 snapshot 仍由聚合负责。

该实现不读取当前工作目录中的用户文件作为隐含输入。仅按调用方指定的 bundle 路径读取/写入；测试使用项目固定样本和系统临时目录。

## 构建与许可

生成命令使用项目已有 esbuild，必须显式指定且验证 REA 版本：

```powershell
$upstreamRoot = 'C:\Users\xiaoz\AppData\Roaming\fnm\node-versions\v24.21.0\installation\node_modules\rea-agents'
node src/rea-native/session-evidence/generate.mjs $upstreamRoot
```

`runtime.mjs` 约 870 KB、168 个构建输入；纯 JS 依赖已封装，运行时无需新增 npm 包。REA、canonicalize、stream-chain、stream-json、zod 完整许可均在 `LICENSES/`。`provenance.json` 保存包版本、依赖版本、所有构建输入和运行时输出 SHA-256，并单独记录适配器参考的四个上游注册/聚合文件 SHA-256。

TS 构建之外，生产打包需复制同目录的 `runtime.mjs`、`runtime.d.mts`、`LICENSES/`、`provenance.json` 到 `lib/rea-native/session-evidence/`。`entry.mjs` 和 `generate.mjs` 是维护来源，不是宿主运行入口。

## 验证结果与限制

2026-10-18：`node --test test/rea-native-session-evidence.test.mjs` 在设置 `REA_UPSTREAM_ROOT` 后 **20 tests / 20 pass / 0 fail / 0 skipped**；未设置时运行 19 项独立测试，额外一项才加载本机上游 oracle。单模块 strict TypeScript 检查通过：

```powershell
node node_modules/typescript/bin/tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --skipLibCheck src/rea-native/session-evidence/index.ts
```

测试验证跨会话隔离、注入同一所有者、只读副本与冻结借用、导入计数与元数据变化、未知项完整生命周期、乐观并发冲突、原子失败、依赖环、历史缺口、稳定分页及边界、真值与撤回区别、导出后导入完整历史、显式配对比较、历史推进/分歧、预先中止以及关闭等待进行中的比较。

实时一致性测试直接导入 REA 6.5.0 原始类，对比账本输出、变更 Evidence、完整比较 Evidence（含语义 ID）、错误投影，并逐项比较八个输入 JSON Schema。没有依赖 CLI stdout 或 MCP transport 包装结果。

未验证宿主 DSH 的实际注册、持久化恢复和与 native snapshot observer 的组合；该部分必须在主集成完成后验证。未对磁盘耗尽、句柄关闭失败、系统崩溃进行故障注入。该模块完成的是 Evidence/unknown 状态能力，不声称已完成 REA 全部工具或二进制会话生命周期。
