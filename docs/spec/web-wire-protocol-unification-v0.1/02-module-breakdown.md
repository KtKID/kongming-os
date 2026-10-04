# 模块拆分

## 模块总览

| 模块 | 职责 | 依赖 | 状态 | 备注 |
|------|------|------|------|------|
| Web Protocol Models | 定义 Python/TS 双侧 wire DTO、endpoint union、导出入口和 `frame_type` 判别规则 | Python protocol 包、TS protocol 文件、现有 TypedDict/局部 union | 可进入 x-req | 高风险，前置 |
| Protocol Frame Emission | 替换后端发送端裸 dict，统一模型构造、TypeAdapter 校验和 `model_dump()` 输出 | thread_status、global_inbox、Claude/Codex service、Codex route | 可进入 x-req | 依赖 Models |
| Frontend Wire Consumers | 前端 hook/socket/store 只消费 `@/protocol` 类型，局部文件退为业务状态 | useThreadStatusWS、approval inbox、codex-ws、providers | 可进入 x-req | 依赖 Models |
| Protocol Drift Tests | 建立 Python adapter、route contract、TS import-boundary/type tests、fixture/hash 漂移检查 | pytest、Vitest/tsc、协议 fixture | 可进入 x-req | 可随实现并行 |
| Protocol Docs Alignment | 更新 Web 模块文档和旧 spec/task 引用，让文档表达匹配 `frame_type` 全协议面 | 模块 README、相关 spec/task 文档 | 方案确认 | 跟随实现收尾 |

图集总览见 `./diagrams.md#总览`。

## 模块 1：Web Protocol Models

**边界类/入口**：`WebWireProtocolRegistry`

**代码落点**：
- `repo:src/hosts/web/protocol/`
- `repo:web/src/protocol.ts`

**职责**：统一定义 Web wire 帧模型、方向 union、endpoint union、导出入口和 `frame_type` 判别值。Python 侧提供 Pydantic BaseModel / TypeAdapter，TS 侧提供同名 interface/type 和 discriminated union。

**包含范围**：
- `/ws/thread-status` S2C：`thread-status`、`approval.inbox.add`、`approval.inbox.remove`、`approval.inbox.snapshot`、`usage_summary_updated`、`pong`。
- `/ws/thread-status` C2S：`ping`、`approval.inbox.resolve`。
- Claude/Codex endpoint C2S/S2C：`NormalizedMessage`、`session-status`、`codex-command`、`claude-command`、`abort-session`、`check-session-status`。
- `usage_summary_updated` 字面值保留，字段名统一为 `frame_type`。
- `thread-status` S2C 字段固定为 `frame_type`、`threadId`、`phase`、`toolName?`，`phase` 枚举为 `idle/responding/thinking/tool_calling/waiting_approval/complete/error`。
- `approval.inbox.add` 展开 `ApprovalInboxItem` 顶层字段；`approval.inbox.snapshot` 使用 `items: ApprovalInboxItem[]`；`approval.inbox.remove` 使用 `requestId`、`reason`；`approval.inbox.resolve` 使用 `threadId`、`requestId`、`allow`、`message?`、`rememberEntry?`、`rememberScope?`。
- `NormalizedMessage` 保留 endpoint outbound base 字段 `id`、`sessionId`、`timestamp`、`provider`、`frame_type`；`session-status` 使用 `sessionId`、`isProcessing`；`codex-command` / `claude-command` 使用 `command`、`options?`、`attachments?`。
- `dict[str, Any]` / `Record<string, unknown>` 的跨模块 payload 边界。
- `repo:src/hosts/web/protocol/__init__.py` 显式导出新模型和 adapter。

**不包含范围**：
- 业务 manager 状态计算。
- WebSocket 连接生命周期。
- 自动代码生成。

**依赖**：
- `repo:src/hosts/web/protocol/ws_frames.py`
- `repo:src/hosts/web/protocol/__init__.py`
- `repo:src/hosts/web/app_support/llm_protocol.py`
- `repo:web/src/protocol.ts`
- `repo:web/src/lib/codex-ws.ts`

**接口草案**：

```python
class WebWireProtocolRegistry:
    thread_status_s2c_adapter: TypeAdapter[ThreadStatusS2CFrame]
    thread_status_c2s_adapter: TypeAdapter[ThreadStatusC2SFrame]
    codex_s2c_adapter: TypeAdapter[CodexS2CFrame]
    codex_c2s_adapter: TypeAdapter[CodexC2SFrame]
    claude_s2c_adapter: TypeAdapter[ClaudeS2CFrame]
    claude_c2s_adapter: TypeAdapter[ClaudeC2SFrame]

    @classmethod
    def validate_s2c(cls, endpoint: str, payload: object) -> BaseModel:
        """按 endpoint 校验 S2C wire payload 并返回协议模型。"""
```

**核心不变量**：
- 每个 wire frame 都有 `frame_type`。
- 每个 endpoint 都有 C2S/S2C union。
- Python 模型名与 TS 类型名语义一致。
- protocol 包保持零 sibling 依赖。

**复用/新建**：
- 复用现有 `WSFrameC2SAdapter/WSFrameS2CAdapter` 模式。
- 迁移 `repo:src/hosts/web/app_support/llm_protocol.py` 的 TypedDict 语义到 protocol 包模型或 adapter。
- 迁移 `repo:web/src/lib/codex-ws.ts` 的 frame union 到 `repo:web/src/protocol.ts`。

**风险等级**：高

**task 建议**：`web-wire-protocol-models-v0.1`

## 模块 2：Protocol Frame Emission

**边界类/入口**：`WebFrameEmitter`

**职责**：让后端所有相关发送路径通过协议模型构造或 TypeAdapter 校验后 `model_dump()`，避免裸 dict 和字段名漂移。

**包含范围**：
- `repo:src/hosts/web/websocket/thread_status.py` 的 `thread-status(frame_type, threadId, phase, toolName?)`、`pong(frame_type, timestamp_ms, ts?)`、`approval.inbox.resolve(threadId, requestId, allow, message?, rememberEntry?, rememberScope?)`。
- `repo:src/hosts/web/approvals/global_inbox/broadcaster.py` 的 snapshot/add/remove。
- `repo:src/hosts/web/integrations/claude_code/service.py` 的 usage refresh。
- `repo:src/hosts/web/integrations/codex/service.py` 的 usage refresh。
- `repo:src/hosts/web/integrations/codex/test_route.py` 覆盖的 route/handler 输出。

**不包含范围**：
- approval inbox 业务聚合策略。
- usage manager 数据来源。
- Claude/Codex 执行协议的业务命令处理。

**接口草案**：

```python
class WebFrameEmitter:
    def dump_thread_status(self, frame: ThreadStatusS2CFrameModel) -> dict[str, Any]:
        """校验并输出 /ws/thread-status S2C frame。"""

    def dump_codex(self, frame: CodexS2CFrameModel) -> dict[str, Any]:
        """校验并输出 Codex endpoint S2C frame。"""

    def dump_claude(self, frame: ClaudeS2CFrameModel) -> dict[str, Any]:
        """校验并输出 Claude endpoint S2C frame。"""
```

**复用/新建**：
- 简单路径可直接在发送点构造协议模型并 `model_dump()`。
- 复杂路径可抽出 `WebFrameEmitter` 收口，减少各模块重复 adapter 选择。

**风险等级**：中

**task 建议**：`web-wire-protocol-emitters-v0.1`

## 模块 3：Frontend Wire Consumers

**边界类/入口**：`WebProtocolClientTypes`

**职责**：前端 hook/socket/store 只从 `@/protocol` 导入 wire 类型；局部 `types.ts` 文件保留 UI 状态、view model 和 store action，不再定义 wire frame union。

**包含范围**：
- `repo:web/src/hooks/useThreadStatusWS.ts` 按 `frame.frame_type` 分派。
- `repo:web/src/features/approval-inbox/types.ts` 移除 `ApprovalInbox*Frame` wire 定义，保留业务状态类型。
- `repo:web/src/lib/codex-ws.ts` 移除 `CodexC2SFrame` / `CodexS2CFrame` / `SessionStatusFrame` 局部定义。
- Claude/Codex providers 从 `@/protocol` 导入 command/status frame 类型。
- approval inbox countdown 明确消费 `timeoutMs` 字段。

**不包含范围**：
- 改写 store 架构。
- 改写 socket 重连策略。
- 改写 UI 样式。

**接口草案**：

```typescript
import type {
  ThreadStatusS2CFrame,
  ThreadStatusC2SFrame,
  ApprovalInboxAddFrame,
  CodexC2SFrame,
  CodexS2CFrame,
} from "@/protocol";

export class WebProtocolClientTypes {
  static dispatchThreadStatus(frame: ThreadStatusS2CFrame): void;
}
```

**风险等级**：中

**task 建议**：`web-wire-protocol-consumers-v0.1`

## 模块 4：Protocol Drift Tests

**边界类/入口**：`ProtocolDriftTestSuite`

**职责**：用可重复测试阻止协议字段、判别值和导入边界继续分叉。

**包含范围**：
- Python adapter dispatch/rejection 扩展，覆盖 `phase`、`reason`、`rememberScope`、`options?`、`attachments?`。
- 真实 `/ws/thread-status` route/handler 覆盖 inbox resolve、snapshot/add/remove、usage refresh、ping/pong。
- Codex/Claude command/status frame 覆盖 `command`、`options?`、`attachments?` 和 `session-status.isProcessing`。
- 前端 `useThreadStatusWS` unified union 分派测试。
- approval inbox countdown `timeoutMs` 测试。
- Codex socket protocol imports 测试。
- 导入边界扫描：阻止 `ApprovalInbox*Frame`、`Codex*C2SFrame`、`Codex*S2CFrame` 等局部 wire 类型复生。
- Python/TS fixture 或 hash 漂移检查。

**不包含范围**：
- 大规模浏览器 e2e。
- 外部 Claude/Codex 真实服务调用。

**复用/新建**：
- 复用 `repo:tests/unit/test_web_protocol_round_trip.py`。
- 复用 `repo:tests/unit/test_web_protocol_rejection.py`。
- 迁移 `repo:tests/unit/web/approvals/global_inbox/test_broadcaster.py` 的断言到协议模型输出。
- 迁移 `repo:tests/unit/web/integrations/codex/test_route.py`、`repo:tests/unit/web/integrations/codex/test_service_usage_wiring.py` 到 `frame_type` 断言。

**风险等级**：中

**task 建议**：`web-wire-protocol-drift-tests-v0.1`

## 模块 5：Protocol Docs Alignment

**边界类/入口**：`WebProtocolDocsOwner`

**职责**：更新 Web 模块文档和旧 spec/task 引用，让架构说明、协议层描述和实现保持一致。

**包含范围**：
- `repo:docs/modules/Web前端/README.md` 中协议层表述更新到 `frame_type`、全协议面和双侧真源。
- 相关 spec/task 引用检查。
- 文档中旧 `kind`、旧帧数、局部类型真源说法清理。

**不包含范围**：
- 新增文档站构建规则。
- 重写无关 Web 前端章节。

**风险等级**：低

**task 建议**：`web-wire-protocol-docs-v0.1`

## 模块一致性要求

- Web Protocol Models 支撑所有生产模块与测试模块。
- Protocol Frame Emission 与 Frontend Wire Consumers 共同完成运行时迁移。
- Protocol Drift Tests 对所有生产模块形成回归网。
- Protocol Docs Alignment 跟随实现收尾，保持方案层状态。
