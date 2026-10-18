# ARTEX 流量能力核对

核对来源是本机 `C:/Users/xiaoz/ARTEX`：`traffic/traffic.go` 的记录、Page/Search/Get/BlobRange/Hosts/Count/Tools，`db/nkey.go` 的 TemplatePath，`server/server.go` 的 `/api/traffic*`，以及 `agent/worker.go` 的 proxyEnv。这里区分实际已实现的能力和剩余差异。

## 已实现

- `TrafficRuntime` 启动真实 mitmdump，等待 ready 后返回；停止等待进程 close 和全部已接收流量写入完成。启动、Python blob 写入、解析和 store 写入错误均可诊断，stop 不将失败包装成成功。
- 请求/响应保留起始行、有序重复头 `headerFields`、字节长度、正文原始 base64 或 SHA-256 blob 引用、捕获时间。兼容 UI 的 `headers`/`body` 仍在，但保真读取应使用 `headerFields` 和 `bodyBase64`/分段读取接口。
- 正文不超过 256 KiB 时内联；更大的正文在 Python addon 写入当前捕获专属 `_incoming/<capture UUID>` 临时文件，stdout 仅传 SHA、长度与文件名。Node 校验真实文件长度/SHA 后，在与删除共用的锁内链接为内容寻址文件并提交记录，避免未入库的新正文被 GC 误删。文本预览 8 KiB；二进制预览包含类型、长度和 magic。最终文件位置为 `<dirname(storagePath)>/redteam/traffic/_blobs/sha256/<hash前2位>/<hash>.bin`。
- `traffic_search` 使用原版工具名与查询语义：必填裸 host、host:port 或 URL；显式端口不混入相同 IP 的其他服务；默认 3 条、最多 10 条、0 起始分页；仅返回 id/method/url/status/resp_len；body_contains 至少 3 个 Unicode 字符，搜索头与非二进制正文，正文贡献最多 4 MiB。
- `traffic_get` 提供原始 HTTP 文本预览，分别限制请求 2500 字节和响应 4000 字节；大正文 blob 指针在预览截断后仍保留。`traffic_blob` 按字节偏移读取，最多 8192 字节，额外返回 base64 保留二进制和 UTF-8 跨页边界。
- `redteam_traffic_page` 提供 host 子串、method、路径模板、状态码/状态类别、响应长度、宽泛搜索/正文搜索、排序及分页；返回全局数量、筛选数量。保留原版 Page 对不足 3 字符 body 筛选不生效的行为。
- `redteam_traffic_detail` 提供结构化详情；`redteam_traffic_body` 通过 exchange id/side 分段读取内联或 blob 的精确字节；`redteam_traffic_stats` 提供任务/worker 筛选下的总数、请求/响应字节、方法、状态和按最近活动排序的主机计数。
- start 的可选第三参数 `{ workerSessionId }` 校验该子会话已绑定对应任务，捕获记录保留任务和指定 worker 的关联。一个 runtime 同时只允许一个任务/端口/worker 绑定；不从 URL 猜测归属。
- `redteam_traffic_delete_host` 删除全局 host 子串匹配记录（沿原 SQL LIKE 的 `%`/`_` 语义）；`redteam_traffic_delete_hosts` 按全局精确 host 列表删除，不误删更长后缀；`redteam_traffic_delete_all` 清全部可丢弃流量。三个入口均跨任务，与原版服务接口一致，空 host/空列表拒绝。删除后仅回收没有剩余流量引用的 SHA blob；FindingsRuntime 独立复制的完整证据正文不动。DeleteAll 即使无记录也清孤儿 canonical blob，不清活动 `_incoming` 文件。

## 接线契约

在已注入 `tools` 的 Agent composition 中调用 `installTrafficTools(agentCtx, store, runtime)`。它通过 `ctx.effect` 自动撤销注册，使用十个上述名称，与已有 `redteam_traffic_search/start/stop/status/record` 不冲突。原版三个 Agent 工具 `traffic_search/get/blob` 仅在 captureEnabled 时注册；持久设置变化立即撤销/恢复实际 scoped 注册，下一次模型 schemas 和 dispatch 同步变化。其余四个 `redteam_traffic_*` 查询和三个删除入口保留，用于管理旧记录。真实两个 Agent scope 验证了一边关捕获不影响另一边或其他全局工具；不使用全局 deny/filter。

`TrafficRuntime.workerEnvironment(taskId)` 在当前任务捕获已 ready 时返回原版 worker proxyEnv 同款代理与 CA 变量，其他任务/停止状态返回空对象；该对象仅应合并到匹配 Worker 的 shell 子进程环境，绝不能修改进程全局环境。CA 位于独立 `_ca/mitmproxy-ca-cert.pem`。

`installTrafficEnvironment(agentCtx, store, runtime)` 自行注入 `shell`/`shellEnv`，通过 `ctx.isolate('shell')` 包装实际宿主执行器，并在私有 scope 安装官方 `pwsh`（Windows）或 `bash`。按 `ShellExecSpec.dshEnv.DSH_SESSION_ID` 查找真实 Worker 绑定；只改匹配 Worker 的 `spec.env`，保留命令、sandbox、signal、后台执行句柄和官方工具行为。父会话和非 Worker 不注入。传 `workerSessionId` 的捕获仅路由该 Worker。

`installTrafficControls(agentCtx, runtime)` 注册 `redteam_traffic_settings`、`redteam_traffic_set_proxy`、`redteam_traffic_set_enabled`、`redteam_traffic_set_binding`。`TrafficRuntime.load()` 读取同 store 目录下的 `traffic-settings.json`；设置先原子落盘后发布。默认不开捕获路由，显式 start 打开；关闭开关保留 recorder 监听，但后续 Worker 命令不再收到 recorder 代理及 CA。读取配置会遮盖代理用户名和密码。

`configuration().trafficBindingEnabled` 对应原版 `server/manager.go` 的 `agent_traffic_binding`，默认 false，与 capture 开关独立；`setTrafficBindingEnabled(boolean)` 持久修改，`redteam_traffic_set_binding(enabled)` 是 DSH 入口。发现/图工具安装前应 `await traffic.load()`，然后传回调 `trafficBindingEnabled: () => traffic.configuration().trafficBindingEnabled`，避免复制一次性配置而错过热切换。

配置全局代理后，上述“其他任务/停止状态返回空对象”改为返回全局代理环境，不附加 recorder CA；这是 ARTEX 的 capture-off 全局出口语义。未配置全局代理时行为不变。capturing 的 mitmdump 经固定回环 relay 出口，由 relay 为每条新连接选择当前 http/https/socks5 上游，支持 URL 用户密码和热切换，不重启 recorder，不改已建立连接。HTTPS 上游使用系统 TLS 证书验证。

## 规则关系

原版 `traffic/traffic.go` 没有 HTTP 请求审批/拦截规则。`asset_intercept_rules` / 任务资产规则匹配 domain/ip/url/CIDR；`intercept_rules` 匹配工具名和工具输入。流量模块不把这两类规则转换成未在原版定义的代理 HTTP 阻断行为；相关资产入口、工具执行审批由各自模块负责。

## 已验证与仍有差异

真实本机 mitmdump + 回环 HTTP 服务已验证小文本、中文、700 KB 正文尾部读取/搜索、重复 Set-Cookie、二进制 POST 请求与响应、worker 关联、停止后进程退出及端口释放。查询测试覆盖分页、端口隔离、3 字符规则、状态/方法/模板筛选、大正文全文搜索、blob 字节读取、缺失文件错误与真实 DSH ToolRuntime 路由。

当前索引沿用 DSH JSON store，正文搜索按需有界读取文件并线性过滤；没有声称已实现 ARTEX SQLite/FTS5 的索引性能或 SQLite 专有的增量 VACUUM。JSON 每次删除原子重写即移除对应数据占用；删除返回的 `reclaimed` 明确表示移除的流量 JSON 字节，`blobReclaimed` 表示已删除正文文件字节，不伪报 SQLite 页回收。流量抓取由真实 mitmdump 驱动，未称为 Go 代理的逐行重写。

已新增真实官方 pwsh→代理→回环 HTTP 用例，验证父会话/其他任务隔离、停止后不残留代理、进程全局环境不变；真实 CONNECT→TLS 用例保持证书验证开启，信任 recorder CA 后收到目标响应并捕获 HTTPS 记录。独立 relay 用例核验 HTTP Basic CONNECT、SOCKS5 用户密码握手及请求字节确实穿过上游，再清配置恢复直连；HTTPS 上游用独立子进程的受信任测试 CA 保持证书验证开启，验证 Basic CONNECT 及真实 GET 字节。捕获开关/全局代理持久化和 CA 移除有独立运行测试。

WebSocket 已验证两层：relay 的 HTTP Upgrade 和双向原始字节；真实 mitmdump 链中的 RFC 握手、masked 客户端文本帧、服务端文本/close 帧，及 HTTP 101 升级记录入库。它保留连接能力及 HTTP 握手记录，未新增原版没有定义的 WebSocket 帧内容索引。

MITM 失败沿原版关键字 `head request/http2/http/2/protocol error/protocol_error/malformed` 标记 hostname，后续 TLS ClientHello 对该主机设置透明传递；普通目标不可达错误不触发该切换。透明连接仍经相同全局出口，未经解密的内容不伪造为 HTTP 记录。

该路径已有真实 TLS 服务器验证：第一请求收到畸形 HTTP 响应并由代理返回 502；下一连接的 TLS issuer 从 recorder CA 变成目标原始证书，响应成功且未生成伪捕获记录。测试客户端始终验证证书，信任测试目标证书及 recorder CA；测试用私钥只用于回环服务器。

blob 是共享内容寻址文件，任务归档必须复制引用的 blob，不能移动或删除正在被其他任务引用的文件。归档模块单独负责这一接线和恢复校验。

并发接线使用 `withTrafficMutation(storagePath, operation)`（`traffic-tools/mutation.ts`），按同一 canonical store 路径串行。`RedTeamStore.addTraffic` 的可选 `prepare` 在锁内执行，可返回入库失败时的 rollback；实际捕获使用 `incomingTrafficRecord`，失败清除本次新链接和临时文件，不动之前已有共享 blob。删除的持久记录修改与 GC 在同一锁内；归档应在 quiesce 后持同锁完成 capture/commit/rollback，恢复持同锁完成正文恢复到记录提交。删除专项用实际持久化写入失败和受控事务等待覆盖两种并发顺序，并用真实 FindingsRuntime 证明删除原始流量不会破坏绑定证据。

Windows 停止流程以真实子进程 `close` 和 stdout 排空为完成条件。`taskkill /T` 可能在某个后代提前退出时返回非零，此时继续等待原有 10 秒关闭门限；若仍不关闭，同时保留命令错误和关闭超时。`traffic-process-race.test.mjs` 执行真实进程树终止，仅在命令边界注入早到的非零回调，核验最终进程确实不存在且已接收记录落盘；原即时抛错行为失败，修正后通过。

`traffic-environment.test.mjs` 显式关闭其自有 HTTP 连接后再销毁宿主资源，即使 runtime.stop 重抛先前捕获错误，也继续清理所有 Agent、fiber、HTTP server，最后汇总失败。设置 `DSH_TEST_CLEANUP_TRACE=1` 可输出清理阶段。2026-10-18 收口复现中，可用物理内存约 378 MB 时 mitmdump 曾在原有 15 秒启动门限后才开始监听；没有放宽门限或将该失败当作成功。修正清理后的真实官方 pwsh 用例已完整通过并退出；全仓测试仍由总集成单独核验。
