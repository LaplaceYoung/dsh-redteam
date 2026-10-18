# 原生任务工作台

`src/task-workspace/client.tsx` 导出 `TaskWorkspaceTab`，作为 BetterSidebar 的 `TabDescriptor.component` 使用。界面通过同源 HTTP 访问持久任务服务；执行请求使用侧栏 `scope.sessionId` 对应的真实 Agent，不创建替代 Agent，也不从其他会话挑选模型。

## 已实现能力

|区域|操作与实际数据来源|
|---|---|
|任务列表|搜索、状态/分类筛选、置顶、运行/排队状态；来自 `RedTeamStore`|
|任务创建|描述、目标、模板、分类、来源任务、超时、Planner 心跳、覆盖率与首个 Intent；调用 `TaskProfileRegistry.createManagedTask`|
|任务操作|启动、暂停、恢复、重跑；调用所选 Agent 对应的 `TaskLifecycleRuntime`|
|任务删除|二次确认；可选择删除无其他任务引用的资产及此任务 findings；真实生命周期先停止执行后提交删除|
|元数据|标题、置顶、分类；通过既有 store 方法持久化|
|模板与分类|创建、修改、删除；模板编辑保留已有拦截规则|
|目标与约束|添加、修改、删除，显示目标达成状态与已有作用域；不伪造达成证据|
|模型配置|从 DSH 实际 provider/model catalog 创建、编辑、删除 profile|
|任务模型链|加入、移除、排序、选择起始配置、保存/重置，显示不可用或额度耗尽原因|
|队列|显示实际队列状态和并发上限，暂停排队任务走生命周期服务|

模板拦截规则在工作台中保留并应用，规则编辑由专门的拦截界面负责。provider 凭证由 DSH 管理，工作台不接收或返回 API key。

## 宿主接线

在 UI surface 安装一次 API，等待 `webServer`、`connection`、`agents`、`llm` 服务就绪：

```ts
installTaskWorkspaceApi(uiCtx, store, {
  profiles: new TaskProfileRegistry(store, uiCtx.llm),
  authenticate(request) {
    const admission = uiCtx.connection.admit(request);
    return 'rejection' in admission
      ? admission.rejection
      : admission.peer.principal.kind === 'owner' ? true : 403;
  },
  lifecycleForAgent,
  admission: () => admissionRegistry.get(),
  notify: taskId => notifyPlanner(taskId),
});
```

`admission` 支持同步值或 Promise；即使没有可执行 Agent，也读取最新持久队列设置。示例中的 registry 与通知函数由宿主接线层提供。`lifecycleForAgent` 使用 `src/task-management/runtime-scope.ts` 的公开查询，精确解析 Agent 所属 scope/preset。缺少 Agent、provider/model 或生命周期运行时会返回可诊断错误。

路由为 `GET /api/redteam/task-workspace?sessionId=...` 和同路径 `POST`。动作定义在 `contracts.ts` 的 `TaskWorkspaceAction`，POST 返回 `{ workspace, taskId? }`。接口限制 JSON 请求体为 1 MiB，拒绝未知动作/字段，目标和约束写入校验所属任务。错误保留 HTTP 状态及 `{ error, code }`；401/403 来自宿主认证结果。

**exact route 必须自行鉴权。** 已检查本机 `app.asar` 中 `dsh-client-connection` 实现：其 `/api` prefix handler 在进入 bridge 前调用 `connection.admit`，自注册 exact route 不继承该 handler。`admit` 校验 Host/Origin、cookie 和 live peer；工作台额外要求 owner principal，与宿主共享 fetch route 一致。桌面 `dsh-app://` 转发由宿主注入 cookie，使用同一入口。

客户端构建将 `@deepseek-ai/dsh-client-ui-primitives` 和 `react/jsx-runtime` 与 React 一起保留为宿主 external。按钮、输入、复选框、Tag 和 SegmentedTabs 使用实际 native primitives；布局使用 DSH `--dsw-alias-*`、圆角和字体 token。自定义 textarea/select 仅补原生包没有提供的控件。

HTTP URL 以 `document.baseURI` 构造，遵循 BetterSidebar 的 base path 规则，支持反向代理前缀及桌面协议。客户端不使用跨源 transport stream URL。

## 状态与并发

- 每个 `sessionId` 使用独立组件实例；旧实例的异步响应不能写回新会话。
- 启动等待首轮模型时继续轮询，可对已进入运行态的任务发出暂停。API 没有阻挡暂停的全局串行锁。
- mutation 序号阻止迟到的启动响应覆盖较新的暂停结果；GET 序号阻止旧快照覆盖新操作。
- 模型链编辑器按任务 ID 保持实例。轮询和额度切换不会卸载正在填写的 profile 表单；链有未保存修改时保留草稿，保存成功后再同步服务端状态。
- 操作失败与正常空结果分开展示，普通轮询成功不会抹掉操作错误。

## 验证与边界

运行 HTTP 验证：

```powershell
node --test test/task-workspace-api.test.mjs
```

12 项 HTTP 测试通过，0 失败、取消或跳过。覆盖鉴权拒绝、DTO 脱敏、模板创建与元数据持久化、精确 Agent 委派、启动阻塞期间暂停、跨任务目标/约束保护、profile 与链顺序持久化、输入与请求体边界、无活 Agent 时异步读取最新队列配置，以及路由释放。测试使用真实 HTTP、store 和 profile 服务；认证回调及生命周期调用边界受控。

运行浏览器验证：

```powershell
node --test test/task-workspace-browser.test.mjs
```

3 项浏览器测试通过，0 失败、取消或跳过，最终完整运行耗时 141.46 秒。覆盖模板/分类与任务创建、元数据、目标/约束、模型 profile 和链、真实 Agent 启动/暂停/恢复、FIFO 排队、原生键盘导航、360px 窄栏、无 Agent/无 scope、API 错误保留输入、运行时 revision 更新保留草稿、代理前缀、首轮模型取消，以及迟到响应不覆盖暂停结果。通知跳转的独立 `test/client-deeplink.browser.mjs` 已更新为当前 13 个标签；新增管理标签尚未重新运行该浏览器用例。

随后新增删除单项单独执行 `node --test --test-name-pattern="native workspace confirms task deletion" test/task-workspace-browser.test.mjs`，1/1 通过，退出码 0，14.43 秒。覆盖首次确认、取消无请求、显式删除独占资产与保留另一任务共享资产。没有重跑完整四项套件；全部测试均使用受控本地服务。

`task-workspace-fixtures.mjs` 只读提取本机 DSH 0.2.1-rc.2 官方 web frontend 的 static module seed 与主题。浏览器加载实际 React、原生控件及 CSS；没有重写 native primitive。fixture 使用真实 API、持久 store、DSH AgentRegistry、Planner 和 TaskLifecycleRuntime。外部 LLM 输出固定，Worker admission 在边界受控，因此不会访问外部测试目标，也不能据此声称真实远端模型或 Worker 网络调用已验证。

依赖本机安装的 DeepSeek Harness、Playwright 及 Chromium headless shell。可用 `DSH_VERIFY_ASAR`、`DSH_VERIFY_PLAYWRIGHT` 和 `DSH_VERIFY_CHROMIUM` 覆盖默认路径。官方 bundle bootstrap 变化时 fixture 明确失败，需要重新检查 seed，不回退到仿制控件。

浏览器截图保存于 `task-workspace-fixtures/`：模型链运行态、窄栏目标编辑、窄栏队列。它们是上述受控浏览器环境的证据；真实桌面 preset 安装、HTTP 接线与真实会话验收由集成验证单独记录。
