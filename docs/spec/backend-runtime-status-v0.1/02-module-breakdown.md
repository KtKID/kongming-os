# 模块拆分

## 模块总览

| 模块 | 职责 | 依赖 | 状态 | 备注 |
|------|------|------|------|------|
| A. Snapshot Semantics | 统一术语、计数口径、快照字段 | 无 | 可进入 x-req | 所有后续模块的契约基础 |
| B. Runtime Collectors | 从现有 runtime 对象取数 | A | 可进入 x-req | 尽量复用已有对象属性 |
| C. Aggregation API | 聚合快照并暴露 REST | A + B | 可进入 x-req | server 侧唯一真值出口 |
| D. CLI Surface | 输出 runtime snapshot | C | 可进入 x-req | 可读表格 + JSON |
| E. Web Status Page | 在 `/manage` 展示状态快照 | C | 方案确认 | 首版继续轮询，不加新 WS |

## 模块详情

### 模块 A: Snapshot Semantics

**职责**：统一定义 runtime status 的术语、字段、去重语义和统计边界。

**包含范围**：

- 定义 `connection`、`cell`、`session`、`tab` 的术语
- 定义 server 侧统计字段
- 明确“同一 thread 两个 tab = 1 cell + 2 chat ws”
- 明确哪些指标是原始计数，哪些只是推导值

**不包含范围**：

- 不负责从代码对象取数
- 不负责页面展示
- 不负责 CLI 格式化

**依赖**：无

**风险与讨论点**：

- `tab_count` 不是稳定原始字段，只能从多个全局 WS 粗略推导
- HTTP 轮询请求不应该混入“链接总数”
- `workspace-shell` 当前没有全局 registry，首版无法直接给出全局连接数

**task 建议**：

- 建议 task 名：`backend-runtime-status-domain`
- 是否进入 x-req：是
- 原因：字段与边界已经明确

---

### 模块 B: Runtime Collectors

**职责**：从当前运行态对象中提取统一快照所需的原始字段。

**包含范围**：

- `ThreadManager._cells` → 活跃 cell 列表
- `ThreadCell.adapter._ws` 的 `WebSocketFanout.client_count` → per-cell chat ws 数
- `ThreadStatusBroadcaster.connection_count`
- `CronWSBroker.connection_count`
- `ApprovalInboxBroadcaster.subscriber_count`
- `ApprovalInboxBroadcaster.pending_count`
- `SessionManager.list_active()` → Claude/Codex active session ids

**不包含范围**：

- 不扫描浏览器本地状态
- 不解析 provider 内部 socket
- 不引入新的持久化

**依赖**：模块 A

**风险与讨论点**：

- `workspace-shell` 当前只有路由和进程对象，没有全局连接 registry
- `SessionManager` 目前只有 `list_active()`，如果要暴露更多元信息，需补只读快照接口
- 多 worker 模式下这些计数天然是单进程视角；当前 Web 架构默认单进程

**task 建议**：

- 建议 task 名：`backend-runtime-status-collectors`
- 是否进入 x-req：是
- 原因：主要是只读取数与字段映射

---

### 模块 C: Aggregation API

**职责**：把 collector 的原始字段聚合为一份统一 runtime snapshot，并通过 REST 提供给 Web/CLI。

**包含范围**：

- `RuntimeStatusService`
- `GET /api/manage/runtime-status`
- 可选 `GET /api/manage/runtime-links` 细分链路表
- 聚合字段计算：
  - `cells_total`
  - `chat_ws_connections_total`
  - `global_ws.thread_status`
  - `global_ws.cron`
  - `approvals.pending_total`
  - `provider_sessions.claude_active`
  - `provider_sessions.codex_active`

**不包含范围**：

- 不在 v0.1 增加 `WS /ws/manage-status`
- 不负责页面布局
- 不负责 CLI 文案渲染

**依赖**：模块 A + B

**风险与讨论点**：

- `workspace-shell` 全局统计若未补 registry，只能先省略或标记 `unsupported`
- `web.ctl status` 当前只做进程层探活，接入完整快照时要处理 server down 的降级路径

**task 建议**：

- 建议 task 名：`backend-runtime-status-api`
- 是否进入 x-req：是
- 原因：是整个系统的单点真值

---

### 模块 D: CLI Surface

**职责**：用统一快照输出 CLI 可读状态。

**包含范围**：

- 扩展 `src/web/ctl.py`
- 表格视图
- JSON 视图
- server 未启动时的退化输出

**不包含范围**：

- 不重复实现 collector
- 不通过 CLI 直接读内部对象绕开 API

**依赖**：模块 C

**风险与讨论点**：

- 建议 CLI 调 REST，而不是各自直读 runtime 对象；这样口径统一
- 进程存在但端口未 ready 时，只能输出 `starting` 状态

**task 建议**：

- 建议 task 名：`backend-runtime-status-cli`
- 是否进入 x-req：是
- 原因：接口消费层清晰

---

### 模块 E: Web Status Page

**职责**：在现有 `/manage` 页展示统一 runtime snapshot。

**包含范围**：

- 顶部 summary cards
- 全局链接计数区
- 活跃 cell 表格
- 链接定义说明区
- 同 thread 多 tab 行为解释

**不包含范围**：

- 不新开独立状态 WS
- 不做拖拽拓扑图编辑
- 不做自动告警

**依赖**：模块 C

**风险与讨论点**：

- 现有 `/manage` 已有 cell 轮询，首版最稳的做法是扩展现有页面
- 若后续改成推送，应优先复用 `/ws/thread-status` 而不是增加新端点

**task 建议**：

- 建议 task 名：`backend-runtime-status-web`
- 是否进入 x-req：是
- 原因：依赖 API 字段冻结后即可直接落地
