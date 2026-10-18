# 资产管理迁移与宿主接线

规范来自本机 `ARTEX/server/assets.go`、`server/task_assets.go`、`server/sync_scopesentry.go` 及其 `db` 实现。全局资产复用 `GraphAssetRuntime` 的六种类型、自然键、派生资产、策略校验和元数据合并；任务成员关系复用 `shared-assets.ts`。不为每个任务复制资产，不修改归档和任务删除实现。

## 稳定安装器契约

- `installAssetManagementTools(ctx, store, { authorize, scopeSentryPath?, onTaskMutation? })`：依赖真实 `ctx.tools`。`authorize(exec)` 必须由宿主验证当前调用者的管理权限，返回 boolean 或 Promise<boolean>，不得信任模型传入的 owner/task 身份。返回领域服务、`ready` 和 `dispose()`。
- `installAssetManagementHttp(ctx, store, { authenticate, scopeSentryPath?, onTaskMutation? })`：依赖真实 `ctx.webServer`。`authenticate(request)` 返回 `true | 401 | 403` 或其 Promise，须复用 DSH owner connection admission。自定义路由不会自动继承 DSH API 鉴权。
- 两者均需等待 `ready`，在所属作用域卸载时等待 `dispose()`。安装时不连接远程 ScopeSentry；只有用户请求状态探测、分页查询或同步时才建立连接。
- `onTaskMutation(taskId)` 应唤醒该任务的真实 Planner，用于资产登记、attach/detach 后刷新任务上下文。
- ScopeSentry 配置默认为 `store.storagePath + '.scopesentry.json'`，可显式覆盖。密钥仅通过 owner HTTP 设置，对外配置只返回脱敏状态；模型工具不接收 API key。

## 管理工具

工具统一接收 `action` 和 JSON `input`，不替换既有 Worker 图工具。

| 工具 | action |
| --- | --- |
| `redteam_manage_assets` | list、get、counts、upsert、delete |
| `redteam_manage_companies` | list、get、create、scope、delete、reattribute |
| `redteam_manage_task_assets` | list、attach、detach、refs |
| `redteam_scopesentry` | status、projects、tasks、sync |

资产更新沿用原版自然键 upsert，不把更新解释为更换身份。批量登记返回每项 results/errors；批量删除需要明确 ids。全局列表无条件查询默认 root_domain，limit 默认 50、最大 200，total 不受分页影响。非 DSL 查询 company_id 优先于 task_id；DSL 查询使用 task_id 约束，独立 company_id 参数不参与筛选，和原 server 一致。

## Owner HTTP

统一前缀 `/api/redteam/asset-management`。所有读写都要求 owner；写请求拒绝跨源 Origin，JSON 字节上限公司/资产为 2 MiB、任务资产为 512 KiB。

| 方法与路径 | 输入或用途 |
| --- | --- |
| GET `/assets` | type、dsl、company_id、task_id、limit、offset |
| GET `/assets/counts` | 可选 task_id |
| GET `/assets/:id` | 全局资产详情 |
| POST `/assets` | `{assets, task_id?}`，自然键新增/更新 |
| DELETE `/assets` | `{ids}`，显式批量删除 |
| GET/POST `/companies` | 列表；创建 `{name, logo?, scope?}` |
| GET/DELETE `/companies/:id` | 详情；删除可选 `{delete_assets}` |
| POST `/companies/:id/scope` | `{scope, reset?, reason?}` |
| POST `/companies/reattribute` | 按实际 scope 重新归属 |
| GET `/tasks` | 原生任务资产面板使用的真实任务 id、title、status |
| GET/POST `/tasks/:id/assets` | 列表；关联 `{asset_ids, source_summary}` 或 `{scope}`；手工关联必须填写来源说明 |
| DELETE `/tasks/:id/assets/:assetId` | 仅解除任务关联 |
| GET `/tasks/:id/intent-assets` | 意图资产引用与来源 |
| GET `/tasks/:id/assets/:assetId/refs` | 资产的意图、事实、漏洞引用，含直接来源任务标记 |
| GET `/scopesentry/status` | 脱敏配置和真实可达性 |
| POST `/scopesentry/datasource` | `{url?, api_key?, enabled?}`；空密钥保持已有值 |
| GET `/scopesentry/projects`、`/scopesentry/tasks` | page、size、search |
| POST `/scopesentry/sync` | dimension、targets、asset_types?、create_company?、page_size? |

显式删除资产清理其实时图锚点和任务成员关系；finding 的历史 assetIds、证据与复测快照保留。该行为对应原 schema 的 `exploration_anchors` / `task_asset_links` 外键删除与 finding JSON 证据持久化。共享的普通任务删除与归档仍由其他模块负责。

## 原生组件

`src/asset-management/client.tsx` 导出 `AssetManagementTab(TabComponentProps)`，组件自带 DSH 工作台样式。由 BetterSidebar 的 client-entry 注册“资产管理”标签；保留原有资产图入口。该模块不改宿主入口文件。

- 全局资产：类型/DSL/公司筛选、分页、详情、自然键登记和编辑、勾选批量删除及确认。
- 公司范围：公司创建、详情、追加/替换范围、错误规则和警告、重新归属，以及可选择 `delete_assets` 的删除确认。
- 任务资产：真实任务下拉选择、类型分页、关联资产及来源说明、手工范围登记、解除关联确认、意图/事实/发现引用及继承来源。
- ScopeSentry：真实状态、密钥配置、项目/任务分页与搜索、目标和资产类型选择、同步统计、失败和截断信息、取消请求。已保存 API Key 不回显，脱敏 URL 不写回配置。

所有请求通过 `client-api.ts` 使用 `document.baseURI` 构造地址并携带同源凭据。组件卸载会取消请求，不使用静态资产或模拟远端响应。

## 验证边界

资产、公司、任务关联、ScopeSentry、owner HTTP 和 DSH ToolRuntime 六组测试共 30 项通过。ScopeSentry 测试使用本地真实 MCP Server、HTTP transport 和 SDK Client，并实际写入 GraphAssetRuntime；没有连接外部部署实例。原生组件已通过浏览器目标的内存 esbuild 打包，依赖图只有组件、client API 与样式，没有服务端 Node 模块。

依照主会话内存限制，本模块不运行全仓 TypeScript 检查或打开新浏览器。宿主接入口后仍需在已有浏览器中验证布局、表单和 owner admission。共享 GraphAssetRuntime 的自动公司归属必须写 `metadata.company_source='scope'`，并保留历史未标记的显式归属，才能与公司范围重算契约一致；该共享层修改由主接线负责。
