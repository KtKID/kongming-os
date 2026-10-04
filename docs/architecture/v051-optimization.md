# v0.5.1 优化设计诊断报告

## 结论

v0.5.1 最值得优先处理的设计问题集中在 5 条主线：

1. Web thread/session 层绕过运行时门户，直接读写 runtime 私有状态。
2. Agent Workflow 的 Manager 和 Tool 文件承担过多职责，策略、协议归一化、产物写入、进度投影混在一起。
3. 前后端协议依赖手工同步，`web/src/protocol.ts` 已经成为漂移风险点。
4. Scheduler Store 聚合了数据库、迁移、锁、查询、状态推进和审计，模块边界过宽。
5. 发布同步脚本混合路径配置、patch 应用、格式化、提交、推送和 PR 流程，平台耦合明显。

`uv run lint-imports` 在 UTF-8 环境下通过，说明当前问题主要存在于门户粒度、对象职责和工程流程层面，现有 import-linter 合同覆盖不到这些内部私有状态访问和大文件职责膨胀。

## 验证范围

- 代码库索引：xcodeatlas 已重新索引当前工作区，识别到 1136 个文件。
- 架构边界检查：`PYTHONUTF8=1`、`PYTHONIOENCODING=utf-8` 环境下执行 `uv run lint-imports`，结果为 11 个 contract 保持，0 个 broken。
- 代码证据：结合 xcodeatlas 结构检索与 `rg` 行号定位，重点查看 Web runtime/session、workflow、scheduler、协议、发布脚本和前端大组件。

## P0：Web Thread 与 Runtime/Session 边界模糊

### 证据

- `src/hosts/web/websocket/routes.py:794` 的 `_send_history_frame` 直接读取 `runtime._session_factory`。
- `src/hosts/web/websocket/routes.py:799`、`src/hosts/web/websocket/routes.py:802`、`src/hosts/web/websocket/routes.py:815`、`src/hosts/web/websocket/routes.py:829` 继续在 WebSocket 路由层兜底读取 `runtime._sessions`。
- `src/hosts/web/threads/manager.py:640` 的 `_session_for_first_message` 通过 `getattr(runtime, "_sessions", None)` 取得运行时内部 session map，并在 `src/hosts/web/threads/manager.py:650` 写入。
- `src/hosts/web/integrations/claude_code/service.py:313` 注释说明 abort 查找依赖 `self._sessions._sessions`，`src/hosts/web/integrations/claude_code/service.py:325` 直接读取内部字典。
- `src/runtime_assembly/session_engine.py:172` 定义 `self._sessions`，`src/runtime_assembly/session_engine.py:555`、`src/runtime_assembly/session_engine.py:559` 管理其内部生命周期。

### 影响

Web 层绕过 `SessionEngine` 和 session 门户后，运行时状态所有权分散到 WebSocket route、thread manager、Claude Code integration。后续 session 缓存策略、恢复策略、并发控制、跨宿主复用都会受这些私有字段访问牵制。

### 建议

- 在 `SessionEngine` 提供显式 session 门户：
  - `get_session(session_id: str) -> Session | None`
  - `get_or_create_session(session_id: str, bootstrap: SessionBootstrap | None = None) -> Session`
  - `load_history(session_id: str) -> list[Message]`
- 在 Web thread 层提供 `ThreadSessionManager`，统一处理 thread id、record session id、runtime session id 的映射。
- 在 `SessionBridge` 或 Web thread cell 暴露 frame 广播方法，例如 `ThreadCell.broadcast(frame)`，避免外部模块直接访问 adapter 的私有 WebSocket 对象。
- 把 direct private access 加入测试或静态检查，例如针对 `runtime._sessions`、`_session_factory`、`._sessions._sessions` 的 repo grep 守卫。

## P0：Agent Workflow Manager 形成上帝对象

### 证据

- `src/application/agent_workflows/manager.py:188` 定义 `AgentWorkflowManager`。
- 同一文件包含 `run_parallel`、`run_parallel_specs`、`run_workflow_payload`、`_run_one`、`_write_workflow_manifest`、`_write_subagent_report`、`_record_assigned_task_progress`、`_sync_task_progress_state`、`_write_json`。
- 文件同时包含 `AgentWorkflowAuditWriter`、workflow 编排、子任务运行、产物写入、任务进度同步和 JSON 持久化。

### 影响

Workflow 运行语义、文件产物协议、任务状态投影、审计写入耦合在一个 Manager 内，任何新增 workflow strategy 都容易扩大这个文件。测试也会被迫以大入口为中心，细粒度失败难定位。

### 建议

- 拆分为 4 个明确模块：
  - `WorkflowRunCoordinator`：负责运行生命周期、并发调度、取消和错误收敛。
  - `WorkflowArtifactStore`：负责 manifest、subagent report、inline map-reduce 文件和 JSON 原子写入。
  - `WorkflowProgressProjector`：负责 assigned task progress 与 workflow 状态投影。
  - `WorkflowAuditWriter`：保留审计写入职责，成为独立依赖。
- `AgentWorkflowManager` 保留为门户，公开任务级方法，内部只编排上述服务。
- 为每个服务补单元测试，并保留 Manager 层的集成测试覆盖完整路径。

## P0：Agent Workflow Tool 混合协议解析、提示修复和执行分派

### 证据

- `src/tools/agent_workflow_tool.py:266` 定义 `RunParallelSubagentsTool`。
- `src/tools/agent_workflow_tool.py:386` 定义 `RunAgentWorkflowTool`。
- 同一文件包含 `input_schema`、`_format_failure_content_for_mode`、`_normalize_workflow_payload`、`_normalize_map_reduce_payload`、`_normalize_roundtable_review_payload`、`_normalize_deep_research_payload`、`_write_inline_map_reduce_files`、`_result_data`。

### 影响

Tool 文件同时承担工具协议、策略 payload 归一化、错误提示文案、inline 文件产物和结果包装。新增 workflow 模式会继续扩张这个文件，策略之间的协议边界也会变弱。

### 建议

- 每个 workflow strategy 拥有自己的 parser/schema/hint：
  - `application/agent_workflows/strategies/map_reduce.py`
  - `application/agent_workflows/strategies/roundtable_review.py`
  - `application/agent_workflows/strategies/deep_research.py`
- Tool 层只做三件事：
  - 读取 schema。
  - 调用 strategy parser。
  - 调用 `AgentWorkflowManager` 并包装 `ToolResult`。
- 把失败修复提示移动到 strategy 模块，和该 strategy 的 payload schema 放在一起。

## P1：Scheduler Store 职责过宽

### 证据

- `src/scheduler/store.py:344` 起有 task/run 序列化逻辑。
- `src/scheduler/store.py:516` 定义 `Store`。
- 同一类附近包含 `_migrate_schema_if_needed`、`_scheduler_lock`、`create_task`、`append_run`、`list_runs`、`reserve_due_tasks`、`recover_stale_runs`、`cancel_run`、`append_audit`。

### 影响

Scheduler 的持久化、迁移、锁、到期任务抢占、运行记录、审计记录集中在一个 Store 中。并发语义和数据访问语义耦合后，后续加入重试、分布式 runner、多队列或更细审计都会放大修改面。

### 建议

- 拆成 5 个服务：
  - `SchedulerMigration`：schema 版本和迁移。
  - `TaskStore`：task CRUD。
  - `RunLogStore`：run append/list/cancel。
  - `DueReservationService`：锁、reserve、recover stale runs。
  - `SchedulerAuditStore`：audit append/query。
- `SchedulerStoreManager` 作为门户，保持现有外部调用点稳定。
- 并发相关测试集中覆盖 `DueReservationService`，避免所有 Store 测试都通过大类入口。

## P1：前后端协议手工同步，漂移风险高

### 证据

- `web/src/protocol.ts:6` 到 `web/src/protocol.ts:10` 的文件头说明它是 Python 协议的 TypeScript 1:1 复制，并提到 REST DTO 数量。
- `web/src/protocol.ts:17` 明确说明协议当前手工维护。
- `web/src/protocol.ts:26` 要求更新 Python 和 TypeScript 两侧。
- 文件后部已经包含大量 REST DTO、WS frame、枚举和 shared type，例如 `web/src/protocol.ts:1178` 的 `CronMessageAppendedFrame`。

### 影响

协议文件越大，手工同步越容易遗漏字段、默认值和错误码。WebSocket frame、REST DTO、枚举和前端 client 类型变化会形成双端漂移。

### 建议

- 以 Python Pydantic DTO / FastAPI OpenAPI 为协议真源，生成 TypeScript 类型。
- 保留手写 runtime guard 和转换器，生成文件只承载类型。
- 加入协议漂移测试：
  - 后端导出 schema fixture。
  - 前端 `protocol.generated.ts` 与 schema hash 对齐。
  - 关键 WS frame 用双侧 fixture 固定字段。

## P1：Workflow Viewer 前端页面过大

### 证据

- `web/src/modules/agent-workflow-viewer/WorkflowRunViewerPage.tsx` 超过 1200 行。
- 同一文件内包含 `WorkflowRunViewerPage`、`WorkflowListPanel`、`WorkflowHeader`、`FlowGraph`、`ModePanels`、`ReviewBoardPanel`、`ConversationPanel`、`ActivityTimelinePanel`、`GenericTable`、`JsonBlock`、`displayValue`。

### 影响

页面容器、数据展示、图形渲染、review board、conversation、timeline、JSON/table fallback 全部在一个文件内，局部修改容易触发跨区域回归。组件测试和可视状态测试也会变重。

### 建议

- 目录拆分：
  - `components/WorkflowListPanel.tsx`
  - `components/WorkflowHeader.tsx`
  - `components/FlowGraph.tsx`
  - `components/ReviewBoardPanel.tsx`
  - `components/ConversationPanel.tsx`
  - `components/ActivityTimelinePanel.tsx`
  - `components/JsonBlock.tsx`
  - `utils/displayValue.ts`
- 页面文件只保留数据加载、路由参数、布局组合。
- 先做纯移动拆分，行为保持不变，再补组件级测试。

## P1：Workspace Shell Router 带运行时 fallback 实现

### 证据

- `src/hosts/web/routers/workspace_shell.py:21` 到 `src/hosts/web/routers/workspace_shell.py:29` 导入 `hosts.web.workspace.shell` 并捕获 `ModuleNotFoundError`。
- 同一 router 文件在 `src/hosts/web/routers/workspace_shell.py:33`、`src/hosts/web/routers/workspace_shell.py:39`、`src/hosts/web/routers/workspace_shell.py:43`、`src/hosts/web/routers/workspace_shell.py:56`、`src/hosts/web/routers/workspace_shell.py:68` 重定义 fallback 类和函数。
- `src/hosts/web/workspace/shell.py:51`、`src/hosts/web/workspace/shell.py:59`、`src/hosts/web/workspace/shell.py:65`、`src/hosts/web/workspace/shell.py:123`、`src/hosts/web/workspace/shell.py:153` 已经存在真实实现。

### 影响

Router 同时承担 HTTP 路由和平台能力降级实现。平台依赖缺失时的行为散落在路由层，后续增加 shell 后端或错误语义时会出现重复修改点。

### 建议

- 新建 `src/hosts/web/workspace/shell_platform.py`：
  - `PtyShellRuntime`
  - `UnavailableShellRuntime`
  - `get_shell_runtime()`
- Router 只依赖 `ShellRuntime` 协议和 FastAPI DTO。
- 缺依赖场景通过 `UnavailableShellRuntime` 返回统一错误码与 message。

## P2：发布同步脚本职责混乱且平台耦合

### 证据

- `scripts/sync-feature.py:33`、`scripts/sync-feature.py:34` 写死 `/Volumes/xgt/...` 路径。
- `scripts/sync-feature.py:162` 直接执行 `git apply --3way`。
- `scripts/sync-feature.py:221`、`scripts/sync-feature.py:242` 管理 hook 跳过和提交。
- `scripts/sync-group.py:29`、`scripts/sync-group.py:30` 同样写死 `/Volumes/xgt/...` 路径。
- `scripts/sync-group.py:293` 到 `scripts/sync-group.py:296` 直接处理 commit 和 push。

### 影响

脚本把本机路径、公开仓库位置、patch 应用、格式化、提交、推送、PR 前置流程放在一起，迁移到 Windows、CI 或其他开发机时容易失败。失败恢复也受脚本内隐式步骤影响。

### 建议

- 新增 `.publish/config.yaml`：
  - private repo path
  - public worktree path
  - include whitelist
  - remotes
  - default branch
- 把流程拆成三个命令：
  - `sync-feature plan`：输出 commit 范围、白名单命中、跳过文件。
  - `sync-feature apply`：只同步文件和 patch。
  - `sync-feature publish`：提交、推送、创建 PR。
- 默认 `plan` 和 `apply` 支持 dry-run，`publish` 要求明确参数。

## P2：测试 fixture 重复

### 证据

- `FakeInner` 在多个 scheduler 测试中重复出现：
  - `tests/e2e/test_cron_trust_mode_e2e.py:48`
  - `tests/e2e/test_cron_hard_block_in_trust_e2e.py:38`
  - `tests/unit/scheduler/test_execution_bridge_audit_writer.py:42`
  - `tests/unit/scheduler/test_scheduler_safety_wrapper_modes.py:30`
  - `tests/unit/scheduler/test_scheduler_safety_wrapper.py:17`
- `RecordingSink` 在 `tests/unit/scheduler/test_execution_bridge_audit_writer.py:272` 和 `tests/unit/scheduler/test_scheduler_safety_wrapper_modes.py:53` 重复。

### 影响

重复 fake 会让安全包装、执行桥接和 cron e2e 测试在语义调整时出现多点修改。fake 行为不一致时，测试结果会掩盖真实边界。

### 建议

- 新增 `tests/fakes/scheduler.py`：
  - `FakeSchedulerInner`
  - `RecordingSchedulerSink`
  - `FakeSchedulerApproval`
- 单测和 e2e 都引用同一组 fake，测试内只保留场景差异。

## P2：XSpace Mobile Repository 后续需要拆分

### 证据

- `src/hosts/web/xspace_mobile/repository.py:227` 定义 `MobilePairingRepository`。
- 同一文件包含 schema 创建、pairing code、exchange token、device list、state cleanup 等逻辑。
- `src/hosts/web/xspace_mobile/repository.py:274`、`src/hosts/web/xspace_mobile/repository.py:288`、`src/hosts/web/xspace_mobile/repository.py:301`、`src/hosts/web/xspace_mobile/repository.py:313` 创建多张表。
- `src/hosts/web/xspace_mobile/repository.py:582` 处理 exchange complete，`src/hosts/web/xspace_mobile/repository.py:739` 处理 device list。

### 影响

该模块目前还能阅读，但 pairing、exchange、device、cleanup 持续增加后会形成第二个大 Store。

### 建议

- 后续新增能力前拆出：
  - `PairingCodeStore`
  - `ExchangeTokenStore`
  - `DeviceStore`
  - `MobilePairingRepository` 作为组合门户。

## v0.5.1 推荐执行顺序

1. 收敛 Web runtime/session 边界：增加 `SessionEngine` session 门户，替换 Web 层私有字段访问，补 grep 守卫。
2. 拆 Agent Workflow：先拆 `WorkflowArtifactStore` 和 strategy parser，再收敛 `AgentWorkflowManager`。
3. 建协议生成链路：从 Python DTO 生成 `web/src/protocol.generated.ts`，保留现有 `protocol.ts` 作为 facade。
4. 拆 Scheduler Store：先拆 migration 与 reservation，降低并发语义风险。
5. 拆 Workflow Viewer：纯移动拆分前端组件，保持 UI 行为一致。
6. 改发布脚本：加入 `.publish/config.yaml` 和 dry-run plan，让公开同步流程可审计、可迁移。

## 验收标准

- 全仓 `rg "runtime\._sessions|_session_factory|_sessions\._sessions" src/hosts src/application src/tools` 没有业务代码命中，允许测试守卫命中。
- `AgentWorkflowManager` 文件只保留门户编排职责，产物写入和进度投影有独立测试。
- `RunAgentWorkflowTool` 不再包含 strategy payload 细节，strategy parser 有单元测试。
- `web/src/protocol.generated.ts` 由命令生成，协议 hash 测试能检测 Python/TS 漂移。
- `SchedulerStoreManager` 对外 API 稳定，migration/reservation/run log/audit 有独立模块。
- `WorkflowRunViewerPage.tsx` 降到页面组合职责，主要 panel 组件可单独测试。
- 发布脚本在 Windows 和 POSIX 路径下通过 dry-run plan，输出白名单命中、跳过文件和待发布 commit 范围。
