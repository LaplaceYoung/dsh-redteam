# 宿主管理（P03 / P04）

插件提供 `/api/redteam/host` 管理面，所有请求都通过注入的 `connection.admit(request)` 且只接受 owner principal。健康检查返回 `ok/service/version`；统计返回全局资产、流量、任务数量，以及按任务查询的 `engine_mode`、in_flight、llm_in_flight、last_activity、stalled 和目标计数。流量和模型配置由宿主注入，缺失时按未启用返回，避免伪造服务状态。

服务日志使用 DSH Cordis 的 `ctx.logger.exporter()` 接收结构化消息，写入插件自己的有界 JSON journal。`GET /logs` 以单调 `seq` 游标读取内存环和持久记录，`GET /logs/history` 读取保留窗口内的旧记录，`GET /logs/stream` 先重放 `since` 之后的记录，再发送实时 SSE；journal 损坏或写入失败会保留错误，不会返回空成功。

版本路由只承接注入的 `HostVersionManager`。DSH rc2 宿主公共能力是 `dsh plugin --profile <name> <pnpm args...>` 及 PluginManager 的 inspect/install/log/state/cancel；安装失败恢复文件不被宣称为成功版本回滚。实际版本源、兼容性清单、成功版本历史和可选降级由版本管理器明确返回；没有管理器时版本路由返回 404。任何真实 profile 的安装、升级、降级或发布都不在插件初始化时自动执行。

UI 组件 `HostManagementPage` 使用 DSH 管理页面原语，展示健康、统计、版本检查/提交和服务日志。组件本身不保存密码或模型凭证；包规格由 owner 显式输入并交给宿主版本管理器校验。
