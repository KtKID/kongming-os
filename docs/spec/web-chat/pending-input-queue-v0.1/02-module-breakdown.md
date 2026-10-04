# 模块拆分

## 模块总览

| 模块 | 职责 | 依赖 | 状态 | 备注 |
|------|------|------|------|------|
| Pending Input Runtime Gate | 收口同 thread 普通 run start、入队、启动、drain 和队列操作 | `ThreadManager`、`ThreadCell`、run completion callback | 可进入 x-req | 关键 P0，先做 |
| Pending Input Protocol | 定义 PendingInput DTO、snapshot / changed / started 帧和错误语义 | Python/TS Web protocol | 可进入 x-req | 双侧真源同步 |
| Pending Queue UI | 在输入框上方展示后端队列 snapshot，并提供编辑、删除、排序 | Chat 页、Composer、protocol types | 可进入 x-req | 与 ChoicePanel 同区域排序 |
| Choice/Avatar Submission Bridge | 将 choice.submit 和 Avatar 输入适配到 Runtime Gate | WebSocket routes、AvatarAssistantManager | 可进入 x-req | 消除直接写 current_run_task |
| Verification and Contract Tests | 建立 Manager 并发、协议漂移、UI、多 tab smoke 覆盖 | pytest、Vitest、WebSocket test harness | 可进入 x-req | 测试包作为质量边界 |

图集总览见 `./diagrams.md#总览`。

## 模块详情

### 模块 1：Pending Input Runtime Gate

**边界类**：`ThreadManager`

**职责**：成为 Web generic_chat 普通输入的唯一 run start gate，维护同 thread pending queue，并在当前 run 收尾后按 completion reason drain 下一条。

**包含范围**：
- `submit_user_input(...)`：普通 Web 输入入口，idle 立即启动，running 入队。
- `submit_choice_result(...)`：choice 结果入口，复用格式化后的 user input 文本，设置 `priority=choice_response`。
- `submit_avatar_input(...)`：Avatar 输入入口，保持原 chat accepted 语义并进入同一 gate。
- `cancel_pending_input(...)`：删除尚未启动的队列项。
- `update_pending_input(...)`：编辑尚未启动的队列项内容。
- `promote_pending_input(...)`：调整同优先级队列项顺序。
- `_submit_pending_input(...)`：加锁校验容量、分配 queue id、排序插入和广播。
- `_start_pending_input_run(...)`：设置 `current_run_task` 并创建 run task。
- `_drain_next_run(...)`：run completion 后按 drain policy 取下一条启动。

**不包含范围**：
- WebSocket DTO 定义。
- React 队列面板状态管理。
- LLM provider 或 Runner 内部调度。
- pending queue 长期持久化。

**依赖**：
- `repo:src/hosts/web/threads/manager.py`
- `repo:src/hosts/web/threads/cell.py`
- `repo:src/hosts/web/websocket/routes.py`
- `repo:src/hosts/web/avatar/assistant_manager.py`

**复用/新建**：
- 复用现有 `ThreadCell.current_run_task`。
- 复用首条消息 continuation 的启动语义，但提取为普通 run start 门户。
- 新增 `ThreadCell.pending_inputs`、`ThreadCell.pending_input_lock`、queue id 生成器和 drain guard。

**接口草案**：

```python
class ThreadManager:
    async def submit_user_input(self, thread_id: str, content: str, *, source: str = "web") -> PendingInputSubmitResult:
        """提交普通用户输入；idle 立即启动，running 入队并广播 snapshot。"""

    async def submit_choice_result(self, thread_id: str, choice_text: str, *, request_id: str) -> PendingInputSubmitResult:
        """提交 choice 结果；使用 choice_response 优先级并保持同优先级 FIFO。"""

    async def submit_avatar_input(self, thread_id: str, content: str, *, avatar_id: str | None = None) -> PendingInputSubmitResult:
        """提交 Avatar 输入；作为 adapter 入口保持既有 accepted 语义。"""

    async def cancel_pending_input(self, thread_id: str, pending_input_id: str) -> PendingInputSnapshot:
        """取消尚未启动的队列项并广播变更。"""

    async def update_pending_input(self, thread_id: str, pending_input_id: str, content: str) -> PendingInputSnapshot:
        """编辑尚未启动的队列项内容并广播变更。"""

    async def promote_pending_input(self, thread_id: str, pending_input_id: str, direction: Literal["up", "down"]) -> PendingInputSnapshot:
        """调整队列项顺序，choice_response 与 user_message 各自保持优先级边界。"""
```

**核心不变量**：
- 每个 `ThreadCell` 同一时间最多一个 `current_run_task`。
- 队列容量按 pending 项计数，运行中的当前 run 另算。
- `choice_response` 排在 `user_message` 前；同优先级按 `created_at_ms` / sequence FIFO。
- `runtime_refresh_failed`、`evicted`、`shutdown`、`deleted` 结束态跳过 drain。
- `normal`、`user_interrupt` 结束态触发 drain。

**风险等级**：高

**风险说明**：该模块接管 run start 时机，容易出现重复 drain、Stop 后竞态和 cell 生命周期边界问题。

**task 建议**：`web-chat-pending-input-runtime-gate-v0.1`

### 模块 2：Pending Input Protocol

**边界类 / 真源**：`PendingInputProtocol DTO set`

**职责**：定义后端与前端共享的队列 DTO、WebSocket 帧和机器可读错误。

**包含范围**：
- `PendingInputDTO`
- `PendingInputSnapshotFrame`
- `PendingInputChangedFrame`
- `PendingInputStartedFrame`
- `pending_input_queue_full` 错误语义
- Python Pydantic 模型与 TypeScript interface 同步
- 协议漂移 fixture / contract 测试

**不包含范围**：
- queue 业务排序实现。
- React UI 操作逻辑。
- run task 生命周期管理。

**依赖**：
- `repo:src/hosts/web/protocol/ws_frames.py`
- `repo:web/src/protocol.ts`
- `repo:src/hosts/web/websocket/routes.py`

**DTO 草案**：

```typescript
interface PendingInputDTO {
  id: string;                              // 队列项稳定 ID
  threadId: string;                        // 所属 thread ID
  source: "user_input" | "choice_submit" | "avatar"; // 输入来源
  priority: "choice_response" | "user_message";      // 排序优先级
  content: string;                         // 最终进入 run 的 user input 文本
  preview: string;                         // UI 展示摘要
  status: "queued" | "starting";           // 队列项状态
  createdAtMs: number;                     // 服务端创建时间
  updatedAtMs: number;                     // 服务端最近修改时间
  sequence: number;                        // 同优先级 FIFO 序号
  metadata?: Record<string, unknown>;       // choice request id、avatar id 等来源元数据
}

interface PendingInputSnapshotFrame {
  frame_type: "pending-input.snapshot";    // S2C 全量 snapshot
  thread_id: string;                       // 所属 thread ID
  items: PendingInputDTO[];                // 当前后端真源队列
  max_items: number;                       // 固定 20
  active_run_id?: string | null;           // 当前 active run，可为空
}

interface PendingInputChangedFrame {
  frame_type: "pending-input.changed";     // S2C 增删改重排后的 snapshot
  thread_id: string;
  items: PendingInputDTO[];
  reason: "added" | "updated" | "removed" | "reordered" | "drained" | "cleared";
}

interface PendingInputStartedFrame {
  frame_type: "pending-input.started";     // S2C 某队列项开始成为 run
  thread_id: string;
  pending_input_id: string;
  run_id: string;
}
```

**错误语义**：
- 推荐扩展 ErrorCode：`pending_input_queue_full`。
- 过渡方案：沿用 `ErrorFrame code=internal`，在 `reason` / `details.reason` 写入 `pending_input_queue_full`，前端按机器字段展示明确错误。
- x-req 阶段决定是否扩展 ErrorCode，协议测试覆盖两侧字段。

**风险等级**：中

**风险说明**：协议同时影响后端 WS route、前端 store、多 tab 同步和错误展示，字段漂移会直接破坏 UI。

**task 建议**：`web-chat-pending-input-protocol-ui-v0.1`

### 模块 3：Pending Queue UI

**边界类**：`PendingInputQueueManager.ts` 或 `PendingInputQueueStore.ts`

**职责**：在 Chat 输入框上方展示后端 pending queue snapshot，并将编辑、删除、重排操作发送给后端。

**包含范围**：
- `PendingInputQueuePanel`
- snapshot / added / changed / updated / removed / started 处理
- 20 条计数和满队列错误提示
- 编辑 pending input 内容
- 删除 pending input
- 上移 / 下移 pending input
- running 时允许继续 submit 普通输入
- 与 `ChoicePanel` 在 composer 上方区域明确排序

**不包含范围**：
- 本地持久化队列真源。
- 前端自生成队列项绕过后端确认。
- 长历史消息气泡展示。

**依赖**：
- `repo:web/src/pages/Chat.tsx`
- `repo:web/src/protocol.ts`
- `repo:web/src/components/Composer.tsx`
- 现有 WebSocket send / receive store

**接口草案**：

```typescript
class PendingInputQueueManager {
  applySnapshot(frame: PendingInputSnapshotFrame): PendingInputQueueState;
  applyChanged(frame: PendingInputChangedFrame): PendingInputQueueState;
  applyStarted(frame: PendingInputStartedFrame): PendingInputQueueState;
  buildUpdateFrame(id: string, content: string): PendingInputUpdateFrame;
  buildCancelFrame(id: string): PendingInputCancelFrame;
  buildPromoteFrame(id: string, direction: "up" | "down"): PendingInputPromoteFrame;
}
```

**UI 排序规则**：
- `ChoicePanel` 表达当前 run 请求用户选择的阻塞式交互。
- `PendingInputQueuePanel` 表达当前 thread 后续输入队列。
- Chat 页将两者放在 Composer 上方同一区域，视觉层级保持清晰；推荐 ChoicePanel 在上、队列面板在下、Composer 最后。

**风险等级**：中

**风险说明**：Composer 原 `disabled` 绑定 `isRunning`，需要拆分“允许提交文本”和“禁用工具/模型切换”的状态。

**task 建议**：`web-chat-pending-input-protocol-ui-v0.1`

### 模块 4：Choice/Avatar Submission Bridge

**边界类**：后端以 `ThreadManager` 方法为边界；`AvatarAssistantManager` 变为 adapter。

**职责**：将 choice 和 Avatar 的输入提交接入 Runtime Gate，使所有普通 run start 共享同一并发规则和队列规则。

**包含范围**：
- `choice.submit` route 调用 `format_choice_submit_as_user_input(frame)`。
- choice 文本进入 `ThreadManager.submit_choice_result(...)`。
- active run 时 choice response 入队，使用 `priority=choice_response`。
- 多个 choice response 保持 FIFO。
- Avatar chat 接受输入后调用 `ThreadManager.submit_avatar_input(...)`。
- Avatar accepted 语义保持，即提交被接受后由队列或 run start 承接。

**不包含范围**：
- 改写 choice tool schema。
- 改写 Avatar 展示层。
- Avatar 专属队列。

**依赖**：
- `repo:src/hosts/web/websocket/routes.py`
- `repo:src/hosts/web/avatar/assistant_manager.py`
- `repo:src/hosts/web/threads/manager.py`

**复用/新建**：
- 复用 `format_choice_submit_as_user_input(frame)`。
- 删除 routes / Avatar manager 中直接创建普通 run task 的职责。
- 新增 adapter 层错误转译，确保 `pending_input_queue_full` 能回到前端。

**风险等级**：中

**风险说明**：choice 当前 active run 时拒绝提交，目标语义改为入队并优先；需要测试保证 choice priority 不打乱同优先级 FIFO。

**task 建议**：`web-chat-pending-input-choice-avatar-bridge-v0.1`

### 模块 5：Verification and Contract Tests

**边界类**：`Test Harness`

**职责**：通过可重复测试锁住并发 gate、run done drain、Stop 后 drain、skip drain、choice priority、协议漂移、Chat UI 和多 tab snapshot。

**包含范围**：
- `ThreadManager` 并发 gate 测试。
- run done drain 测试。
- Stop 后 drain 测试。
- evict / shutdown / delete / runtime refresh failed skip drain 测试。
- choice priority 测试。
- Python/TS 协议漂移测试。
- Chat UI queue 操作测试。
- 多 tab snapshot / changed 同步测试。

**不包含范围**：
- 外部 LLM 真实调用。
- 长时压测。
- 浏览器视觉回归。

**依赖**：
- `repo:tests/unit/hosts/web/`
- `repo:web/src/pages/__tests__/`
- `repo:web/src/protocol.ts`
- fake WebSocket / fake ThreadCell / fake run task

**风险等级**：低

**风险说明**：测试包覆盖面广，但实现风险来自生产模块边界。

**task 建议**：`web-chat-pending-input-contract-tests-v0.1`

## 模块一致性要求

- `02-module-breakdown.md` 的 5 个模块必须在 `./diagrams.md#总览` 和 `./90-task-map.md` 同名出现。
- 每个生产模块都有唯一边界类或 DTO set。
- 测试模块覆盖全部 DoD，保证 DoD ↔ 模块追溯闭合。
