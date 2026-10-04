# 目标与完成标准

## 需求要点

1. Web wire 协议真源收敛到 Python `repo:src/hosts/web/protocol/` 与 TS `repo:web/src/protocol.ts` 双侧同步维护，前端功能目录停止维护局部 wire 类型。
2. `/ws/thread-status` 通道下的 `thread-status`、`approval.inbox.add/remove/snapshot/resolve`、`usage_summary_updated`、`ping/pong` 具备统一 Pydantic 模型、TS 类型和判别规则。
3. Claude Code 与 Codex endpoint 的 `NormalizedMessage`、`session-status`、`codex-command`、`claude-command`、`abort-session`、`check-session-status` 等帧纳入协议包，职责从 `repo:src/hosts/web/app_support/llm_protocol.py`、`repo:web/src/lib/codex-ws.ts` 等局部位置迁出。
4. 所有 wire 帧统一使用 `frame_type` 判别；`usage_summary_updated` 保留字面值，字段名改为 `frame_type`，前端 hook 只按 `frame.frame_type` 分派。
5. 后端发送端通过协议模型构造或校验后 `model_dump()`，避免直接拼 dict 导致字段漂移。
6. 前端业务代码只能从 `repo:web/src/protocol.ts` 导入 wire 类型；`repo:web/src/features/approval-inbox/types.ts`、`repo:web/src/lib/codex-ws.ts` 等文件只保留业务状态或 socket 实现。
7. 验证覆盖 Python adapter、TS 类型导入边界、真实 WebSocket route/handler、前端 hook 分派，以及 Python/TS 协议漂移检查。

## 系统目标

建立 Web wire 协议的双侧真源和执行约束，让每个帧的字段、判别值、方向、endpoint 范围和测试证据都能在协议包中追踪。目标是减少后端裸 dict、前端局部 union、TypedDict 运行时弱约束和文档漂移带来的线上协议错配。

## 范围边界

**包含**：
- Python protocol 包中的 thread-status、approval inbox、usage refresh、Claude Code、Codex endpoint 帧模型或 TypedAdapter。
- TS `repo:web/src/protocol.ts` 中与 Python 模型同名的 wire 类型、方向 union 和 `frame_type` 判别。
- 后端发送端模型化：thread status WS、global inbox broadcaster、Claude/Codex usage service、Codex route。
- 前端消费边界：`useThreadStatusWS`、approval inbox、Codex socket、Claude/Codex providers。
- Python adapter/route tests、前端 hook tests、TS import-boundary tests、Python/TS 漂移检查。
- `repo:docs/modules/Web前端/README.md` 的协议层描述对齐。

**不包含**：
- 重写 WebSocket 传输层、连接重试或认证机制。
- 改写 thread manager、approval manager、usage manager 的业务状态机。
- 引入自动代码生成作为首版必选路径。
- 统一 CLI/TUI 协议。
- 改变 `usage_summary_updated` 字面值。

## 关键约束

- 协议模型不能 import usage manager、approval manager、thread manager 等 sibling；`.importlinter` Contract 5 要求 `repo:src/hosts/web/protocol/` 零 sibling 依赖。
- 跨模块 payload 使用 `dict[str, Any]`、独立 DTO 或协议包内基础类型描述。
- Python `dict[str, Any]` 对应 TS `Record<string, unknown>`。
- 新增或修改前后端共享协议字段必须同时修改 Python protocol 包与 TS `protocol.ts`。
- 包内图源统一在 `./diagrams.md`，本文只保留文字说明。

## 修复原则

- wire 判别字段统一为 `frame_type`。
- 新增/迁移帧必须 Python `repo:src/hosts/web/protocol/` 与 TS `repo:web/src/protocol.ts` 同步。
- 后端发送端必须经过协议模型或 adapter，再输出 `model_dump()` 结果。
- 前端业务文件不得定义 C2S/S2C wire union。
- 开发期直接迁移到统一字段，避免新增 `type` 与 `frame_type` 双读分支。
- Python protocol 包保持零 sibling 依赖。

## 现有资源调研与复用

- `repo:web/src/protocol.ts` 文件头承诺它是 Python protocol 的 TS 1:1 复刻，维护方式是手写同步；它提到 `frame_type` 是 wire discriminated union 判别字段。当前注释路径写法与目标真源 `repo:src/hosts/web/protocol/` 存在漂移，需要在实现任务中修正。
- `repo:src/hosts/web/protocol/__init__.py` 和 `repo:src/hosts/web/protocol/ws_frames.py` 当前只导出 generic thread WS union 及 pending-input 新增帧，未覆盖 thread-status、approval inbox、usage refresh、Codex/Claude endpoint 全部帧。
- `repo:src/hosts/web/app_support/llm_protocol.py` 以 TypedDict 维护 `NormalizedMessage`、`ClaudeCommand`、`CodexCommand`、`AbortSession`、`CheckSessionStatus`，运行时 schema 约束较弱。
- `repo:src/hosts/web/websocket/thread_status.py` 直接拼 `thread-status`、`pong` dict，并在同一 `/ws/thread-status` 端点处理 `approval.inbox.resolve`。
- `repo:src/hosts/web/approvals/global_inbox/broadcaster.py` 直接拼 `approval.inbox.snapshot/add/remove` dict，snapshot 存的是 add payload dict。
- `repo:src/hosts/web/integrations/claude_code/service.py` 与 `repo:src/hosts/web/integrations/codex/service.py` 直接广播 `{ "type": "usage_summary_updated", "threadId": ..., "usage": ... }`。
- `repo:web/src/hooks/useThreadStatusWS.ts` 同时判断 `data.frame_type` 与 `data.type`，并把 `approval.inbox.*` 直接交给局部 store。
- `repo:web/src/features/approval-inbox/types.ts` 维护 `ApprovalInboxItem`、`ApprovalInboxAddFrame`、`ApprovalInboxRemoveFrame`、`ApprovalInboxSnapshotFrame`、`ApprovalInboxResolveFrame`，其中 `timeoutMs` 是高风险字段。
- `repo:web/src/lib/codex-ws.ts` 局部定义 `CodexC2SFrame` / `CodexS2CFrame` / `SessionStatusFrame`。
- `repo:tests/unit/test_web_protocol_round_trip.py` 和 `repo:tests/unit/test_web_protocol_rejection.py` 覆盖 `WSFrameC2SAdapter/WSFrameS2CAdapter`，可扩展为新增帧 dispatch/rejection 的主测试入口。
- `repo:tests/unit/web/approvals/global_inbox/test_broadcaster.py`、`repo:tests/unit/web/integrations/codex/test_route.py`、`repo:tests/unit/web/integrations/codex/test_service_usage_wiring.py` 直接断言局部 dict 形状，测试也需要迁移到协议模型期望。
- `repo:docs/modules/Web前端/README.md` 中协议层描述已有漂移：仍写 `ws_frames.py` 17 帧、union by `kind`，当前代码已经用 `frame_type` 且帧数更多。

## 完成目标（DoD）

- [ ] DoD#1 `thread-status`、`approval.inbox.*`、`usage_summary_updated`、Codex/Claude endpoint 帧都能在 Python protocol 包中找到模型或 TypedAdapter，并在 TS `protocol.ts` 有同名类型。
- [ ] DoD#2 后端涉及这些帧的发送路径不再裸拼关键 wire dict；发送前经过协议模型构造或 TypeAdapter 校验。
- [ ] DoD#3 前端 wire 类型导入来自 `@/protocol`；`approval-inbox/types.ts` 和 `codex-ws.ts` 不再定义 C2S/S2C wire frame union。
- [ ] DoD#4 `usage_summary_updated` 改为 `frame_type: "usage_summary_updated"`；`useThreadStatusWS.ts` 的入口分派不再读 `data.type`。
- [ ] DoD#5 Python tests 覆盖新增 adapter dispatch/rejection、真实 `/ws/thread-status` inbox/usage 路由、Codex/Claude command/status 帧。
- [ ] DoD#6 前端 tests 覆盖 `useThreadStatusWS` 对 unified union 的分派、approval inbox countdown 的 `timeoutMs` 字段、Codex socket 的 protocol imports。
- [ ] DoD#7 新增一个 drift/import-boundary 检查，能阻止新增 `ApprovalInbox*Frame`、`Codex*C2SFrame` 等 wire 类型在 feature/lib 局部定义。
- [ ] DoD#8 `repo:docs/modules/Web前端/README.md` 的协议层和前端表述更新到当前 `frame_type` + 全协议面。

## DoD ↔ 模块追溯矩阵

| DoD 条目 | 需要哪些模块 | 需要哪些 task | 状态 |
|---------|------------|-------------|------|
| DoD#1 Python/TS 全协议面 | Web Protocol Models + Protocol Drift Tests | `web-wire-protocol-models-v0.1`、`web-wire-protocol-drift-tests-v0.1` | 待实现 |
| DoD#2 后端发送端模型化 | Protocol Frame Emission + Web Protocol Models | `web-wire-protocol-emitters-v0.1` | 待实现 |
| DoD#3 前端导入边界 | Frontend Wire Consumers + Protocol Drift Tests | `web-wire-protocol-consumers-v0.1`、`web-wire-protocol-drift-tests-v0.1` | 待实现 |
| DoD#4 usage frame_type 统一 | Web Protocol Models + Protocol Frame Emission + Frontend Wire Consumers | `web-wire-protocol-models-v0.1`、`web-wire-protocol-emitters-v0.1`、`web-wire-protocol-consumers-v0.1` | 待实现 |
| DoD#5 Python route/adapter 覆盖 | Protocol Drift Tests + Protocol Frame Emission | `web-wire-protocol-drift-tests-v0.1` | 待实现 |
| DoD#6 前端 hook/socket 覆盖 | Protocol Drift Tests + Frontend Wire Consumers | `web-wire-protocol-consumers-v0.1`、`web-wire-protocol-drift-tests-v0.1` | 待实现 |
| DoD#7 漂移与局部类型拦截 | Protocol Drift Tests | `web-wire-protocol-drift-tests-v0.1` | 待实现 |
| DoD#8 文档对齐 | Protocol Docs Alignment | `web-wire-protocol-docs-v0.1` | 待实现 |

## 风险边界

- 高风险：协议模型需要跨 thread-status、approval inbox、usage、Claude/Codex endpoint 多个现有路径收口，首个 task 必须先稳定模型命名、方向 union 和判别规则。
- 高风险：`timeoutMs` 字段已在 approval inbox 局部类型中承担倒计时语义，迁移时需要保持字段含义和前端 countdown 行为。
- 中风险：`usage_summary_updated` 从 `type` 改为 `frame_type` 会影响后端广播、前端 hook、测试 fixture 和可能的旧快照断言。
- 中风险：protocol 包零 sibling 依赖会限制模型字段直接复用业务类，需要用独立 DTO 或 `dict[str, Any]` 控制边界。

相关图见 `./diagrams.md#总览` 和 `./diagrams.md#e2e-测试链路`。
