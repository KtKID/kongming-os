> spec_version: 3
> adversarial_risk_version: 3
> complexity: 2
> importance: 3
> risk_average: 2.5
> review_budget: standard
> adversarial_review: skipped-standard

# fork-thread-lineage-navigation-v0.1

## 任务目标

- 每个由完整对话 fork 创建的 Web 通用聊天 thread，在复制的最后一条终态 assistant 气泡下方显示一条居中的血缘分隔线：两侧横线、中间分叉图标和可点击文字“续接自任务”。后续新增消息位于分隔线之后。
- 点击“续接自任务”后，浏览器路由切换到该 thread 的直接父任务 `/chat/<forked_from_id>`。
- 页面重载后，fork thread 继续根据持久化 metadata 显示同一入口；连续 fork 的子任务跳转到其直接父任务。

## 非目标

- 不为缺少复制终点的旧 metadata 猜测位置；旧 fork thread 保持无分隔线，避免入口落到错误气泡之后。
- 不提供祖先树、父任务标题、跨多级跳转、侧栏 lineage 展示或来源任务删除后的专用提示。
- 不改变 Claude Code、Codex 和 scheduled task thread 的现有展示。

## 风险评分依据

- 复杂度：2。fork metadata 新增一个沿既有 metadata/DTO/store 路径直通的终点字段，`MessageList` 依据已有历史索引在精确气泡后插入链接。
- 重要性：3。该入口面向所有 Web fork 对话用户，影响任务上下文回溯体验，且保持在非核心展示链路。
- 预算升级：无；平均分 2.5 对应 `standard`。

## 影响边界与不变量

| 模块 | 角色 | 本次影响 | 主要风险 | 必须保持的不变量 | 依据 |
|---|---|---|---|---|---|
| `src/hosts/web/threads/manager.py`、`metadata.py` | 目标 | fork 时将复制历史终点持久化为 `forked_from_history_index` | 用源任务坐标或推测坐标定位 target 气泡 → 分隔线错位 | 坐标始终是目标 fork Session.history() 的零基索引；只有终态 assistant 才有值 | `J1`、`J6` |
| `src/hosts/web/protocol/`、`web/src/protocol.ts`、`web/src/stores/threads.ts` | 上游 | 提供并缓存直接父 ID 与复制终点 | 一侧 DTO 漏字段或缓存丢失终点 → 重载后入口消失或错位 | 两侧字段同步；store 以 API 返回的父 ID 与终点作为 UI 真源 | `J1`、`J2`、`J6` |
| `web/src/pages/Chat.tsx`、`web/src/components/MessageList.tsx` | 目标 | 将 lineage 数据传给时间线，并在匹配 assistant 气泡后内联渲染 | 页面静态块落在顶部或分隔线进入错误气泡之后 | 仅当父 ID 和终点均存在且命中 assistant 的 `forkHistoryIndex` 时渲染 | `J3`、`J6` |
| `react-router-dom` | 下游 | 处理“续接自任务”的 `/chat/:thread_id` 路由切换 | 使用错误 ID 或普通文本元素 → 点击无法到达来源任务 | 可访问的交互元素具有父任务 route 目标，点击后当前 `thread_id` 更新为直接父 ID | `J3`、`J4` |
| `web/tests/e2e/thread-fork.spec.ts`、`tests/support/web_thread_fork_e2e_server.py` | 相关 | 用真实 Web fork 的持久化 lineage 验证显示与回跳 | 仅 mock 路由 → 真实 fork 返回 metadata 后入口缺失未被发现 | smoke 覆盖 UI fork → 目标页 lineage 入口 → 父任务 route 的完整链路 | `J5` |

## 判断依据

| J-ID | 判断 | 来源 | 证据或推断 | 状态 |
|---|---|---|---|---|
| J1 | `ThreadMetadataDTO.forked_from_id` 表示完整对话 fork 的直接父 thread ID，普通 thread 为 `null` | 仓库事实 | `web/src/protocol.ts` 的 `ThreadMetadataDTO` 注释与 Python `ThreadMetadata` schema 同步定义该字段 | 已确认 |
| J2 | threads store 会在缓存归一化和 fork 成功 DTO 写入时保留 `forked_from_id` | 仓库事实 | `web/src/stores/threads.ts::normalizeCachedThreads` 与 `forkThread` 均处理该字段 | 已确认 |
| J3 | `ChatPage` 已从 threads store 用当前 URL 的 `thread_id` 获取完整 metadata，并以 `navigate` 处理当前页面内的 fork 成功跳转 | 仓库事实 | `web/src/pages/Chat.tsx` 的 `thread` selector、`useNavigate` 与 `onForkAssistant` | 已确认 |
| J4 | 当前聊天路由接受 `/chat/:thread_id`，可由 React Router 的链接语义切换到指定任务 | 仓库事实 | `Chat.test.tsx::renderChat` 和应用路由均使用该参数化路径 | 已确认 |
| J5 | 现有 Playwright fork smoke 使用真实 FastAPI、ThreadManager、FileSession 和 fork 返回 DTO，适合扩展 lineage 回跳断言 | 仓库事实 | `web/tests/e2e/thread-fork.spec.ts` 与 `tests/support/web_thread_fork_e2e_server.py` | 已确认 |
| J6 | 通用聊天历史回放和实时终态 assistant 都携带 Session 的 `historyIndex`，可与 fork 复制前缀的终点一一匹配 | 仓库事实 | `ChatTimelineStore`、`ChatRenderAdapter` 与 `ThreadManager.fork_thread` | 已确认 |

## 建模覆盖声明

| 维度 | 覆盖位置或具体不适用理由 |
|---|---|
| 数据流 | `fork history prefix → forked_from_history_index → ThreadMetadataDTO → threads store → ChatPage → MessageList → /chat/:thread_id`，见 `SC_01`、`SC_02`、`SC_03` |
| 状态 | 普通 thread 的 `null`、新 fork 的直接父 ID 与终点、旧 fork 的终点 `null`、嵌套 fork 的直接父 ID，见 `SC_01`、`SC_02` |
| 时序 | fork REST 成功导航、metadata 重新加载后展示、用户点击跳转，见 `SC_03` |
| 资源 | 不适用：本次只消费已存在的 metadata 和前端路由，不创建或释放运行时资源 |
| 不变量 | `影响边界与不变量`、`SC_01`、`SC_02` |
| 故障 | 错误父 ID 或非交互文本会破坏跳转；测试断言精确 route 和可访问交互语义，见 `SC_02`、`SC_03` |

## 验收清单

### 单元测试

- [ ] 普通 thread 与缺少复制终点的旧 fork thread 不渲染 lineage 分隔线（`SC_01`）。
- [ ] fork thread 将分隔线插在复制终点 assistant 气泡和后续消息之间；链接目标精确等于直接父 ID（`SC_02`）。

### Smoke 测试

- [ ] 运行现有前端 fork Playwright 链路，断言真实 fork 目标在重载后显示 lineage 入口，点击后回到预置源 thread（`SC_03`）。

### E2E 测试

决策：省略

依据：已有 `test:e2e:thread-fork` 已覆盖浏览器、Vite 代理、FastAPI、ThreadManager、FileSession 和 metadata 持久化，作为本次变更的跨进程 smoke 链路。

## 测试驱动开发

1. `SC_01`、`SC_02` → 先在 `MessageList` 测试写出复制终点、lineage 分隔线和后续消息的相邻顺序断言。
2. `SC_03` → 扩展真实 fork smoke，断言 REST 返回的终点、重载后的入口和回跳 route。
3. 实现 metadata/DTO/store/`MessageList` 的完整链路，重构后复跑单元与 smoke。

## 对抗性审查记录

| Review | 预算 | 风险来源 | 查询 | 召回 ID | 复用 Scenario | 新增 Scenario | CLI |
|---|---|---|---|---|---|---|---|
| ARV-1 | standard | no-corpus | `forked_from_id forked_from_history_index lineage navigation Risk` | 无 | 无 | 无 | `skipped:no-corpus; user requested RAG skip` |

## Scenarios

### Scenario SC_01: 普通任务保持无血缘入口

- **GIVEN** 当前 `/chat/:thread_id` 对应的 metadata 中 `forked_from_id=null`，或旧 fork metadata 的 `forked_from_history_index=null`
- **WHEN** ChatPage 渲染消息区
- **THEN** 页面不包含“续接自任务”入口或 lineage 分隔线
- 测试层：unit
- 依据：`J1`、`J3`
- 来源：initial-spec

### Scenario SC_02: fork 边界后内联显示并跳转到直接父任务

- **GIVEN** 当前任务的 `forked_from_id` 为 `thread-parent1234`，`forked_from_history_index=3`，且历史索引 3 对应复制的最后一条终态 assistant
- **WHEN** 用户点击居中“续接自任务”文字按钮
- **THEN** 血缘分隔线位于该 assistant 气泡之后、后续消息之前，带分叉图标和两侧横线；浏览器切换到 `/chat/thread-parent1234`
- 测试层：unit
- 依据：用户任务、`J1`、`J3`、`J4`
- 来源：initial-spec

### Scenario SC_03: 真实 fork 元数据在重载后仍可回跳

- **GIVEN** 浏览器通过现有 fork 接口创建了目标任务，响应的 `forked_from_id` 指向预置源任务且 `forked_from_history_index` 指向复制终点
- **WHEN** 用户重载目标页面并点击“续接自任务”
- **THEN** 页面继续显示 lineage 入口，点击后 URL 变为源任务 `/chat/<source_thread_id>` 且源对话历史可见
- 测试层：smoke
- 依据：`J2`、`J5`
- 来源：initial-spec
