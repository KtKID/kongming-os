# 修复主流程

本文件定义执行顺序和每阶段交付门槛。流程图见 `./diagrams.md#修复主流程`。

## Phase 0：锁定 wire inventory 和判别规则

目标：把本次统一覆盖的 endpoint、方向、帧名、字段和迁移来源先冻结成 inventory，作为 Models task 的输入。

主要动作：
- 盘点 `/ws/thread-status` C2S/S2C：`thread-status`、`ping`、`pong`、`approval.inbox.add/remove/snapshot/resolve`、`usage_summary_updated`。
- 盘点 Claude Code 与 Codex endpoint C2S/S2C：`NormalizedMessage`、`session-status`、`codex-command`、`claude-command`、`abort-session`、`check-session-status`。
- 确认统一判别字段为 `frame_type`，`usage_summary_updated` 保留字面值。
- 确认当前局部来源：`repo:src/hosts/web/app_support/llm_protocol.py`、`repo:web/src/lib/codex-ws.ts`、`repo:web/src/features/approval-inbox/types.ts`。
- 明确迁移规则：开发期直接迁移到统一字段，前端 hook 只按 `frame.frame_type` 分派。

验收 gate：
- inventory 列出 endpoint、方向、`frame_type`、Python 目标模型名、TS 目标类型名。
- `thread-status.phase`、`ApprovalInboxItem`、`usage_summary_updated`、command/status 字段与 `./04-data-and-state.md` 一致。
- 后续 task 只能引用 inventory 中的目标字段。

## Phase 1：Protocol Models 先落地

目标：先把双侧协议真源建成，给后端发送端和前端消费者提供统一依赖。

主要文件改动：
- `repo:src/hosts/web/protocol/`
- `repo:src/hosts/web/protocol/__init__.py`
- `repo:src/hosts/web/protocol/ws_frames.py`
- `repo:web/src/protocol.ts`

主要动作：
- 在 Python protocol 包新增 `/ws/thread-status` C2S/S2C union 与 endpoint adapter。
- 在 Python protocol 包新增 Codex/Claude endpoint C2S/S2C union 或 TypedAdapter。
- 在 TS `protocol.ts` 同步同名 wire 类型、方向 union 和 endpoint union。
- 导出统一入口：`ThreadStatusC2SFrame`、`ThreadStatusS2CFrame`、`CodexC2SFrame`、`CodexS2CFrame`、`ClaudeC2SFrame`、`ClaudeS2CFrame`。
- 保持 Python protocol 包零 sibling 依赖，跨模块复杂 payload 使用 `dict[str, Any]` / `Record<string, unknown>`。

验收 gate：
- Python/TS `frame_type` 集合一致。
- Python adapter round trip/rejection 覆盖新增 union。
- TS 类型编译通过，业务文件能从 `@/protocol` 导入目标类型。

## Phase 2：后端发送端替换裸 dict

目标：后端相关发送路径全部从协议模型构造或 adapter 校验后输出 wire dict。

执行关系：Models gate 通过后即可启动，可与 Phase 3 并行。

主要文件改动：
- `repo:src/hosts/web/websocket/thread_status.py`
- `repo:src/hosts/web/approvals/global_inbox/broadcaster.py`
- `repo:src/hosts/web/integrations/claude_code/service.py`
- `repo:src/hosts/web/integrations/codex/service.py`
- Codex/Claude route/service 相关文件

主要动作：
- `thread_status.py` 使用 `ThreadStatusFrame`、`PongFrame`、`ApprovalInboxResolveFrame` 对应 adapter。
- `global_inbox/broadcaster.py` 使用 `ApprovalInboxAddFrame`、`ApprovalInboxRemoveFrame`、`ApprovalInboxSnapshotFrame`，add 展开 `ApprovalInboxItem` 顶层字段。
- Claude/Codex usage service 使用 `UsageSummaryUpdatedFrame(frame_type, threadId, usage)`。
- Codex/Claude route/service 使用 command/status/abort/check/session 模型或 adapter。
- 发送前统一 `model_dump()` 或 adapter dump。

验收 gate：
- 相关发送端没有裸拼关键 frame dict。
- usage service test 断言 `frame_type: "usage_summary_updated"`。
- broadcaster test 断言 add 顶层字段、snapshot items、remove reason。
- thread-status route test 覆盖 ping/pong、thread-status phase、approval resolve。

## Phase 3：前端消费者收口

目标：前端业务文件只消费 `@/protocol` 的 wire 类型，局部文件只保留 view/store 类型和 socket 实现。

执行关系：Models gate 通过后即可启动，可与 Phase 2 并行。

主要文件改动：
- `repo:web/src/hooks/useThreadStatusWS.ts`
- `repo:web/src/features/approval-inbox/types.ts`
- `repo:web/src/lib/codex-ws.ts`
- Claude/Codex providers 相关文件

主要动作：
- `useThreadStatusWS.ts` 只按 `frame.frame_type` 分派。
- `approval-inbox/types.ts` 保留 view model、store state、UI action 类型，wire frame 类型迁到 `@/protocol`。
- `codex-ws.ts` 保留 socket 连接、发送、重连实现，C2S/S2C union 从 `@/protocol` 导入。
- providers 使用 `CodexC2SFrame`、`CodexS2CFrame`、`ClaudeC2SFrame`、`ClaudeS2CFrame`。
- 移除 `type` 与 `frame_type` 双读分支。

验收 gate：
- `useThreadStatusWS.ts` 没有 `data.type` 分支。
- feature/lib 局部文件没有 `ApprovalInbox*Frame`、`Codex*C2SFrame`、`Codex*S2CFrame` 等 wire union。
- frontend hook/type tests 覆盖 usage、approval、pong、Codex socket imports。

## Phase 4：漂移测试和 import-boundary

目标：把统一协议变成 CI 可阻断规则，防止新增局部 wire 类型和 Python/TS 字段分叉。

执行关系：Models 初版完成后即可先建 fixture；Phase 2 与 Phase 3 改完后作为合流 gate 阻断回归。

主要文件改动：
- `repo:tests/unit/test_web_protocol_round_trip.py`
- `repo:tests/unit/test_web_protocol_rejection.py`
- `repo:tests/unit/web/approvals/global_inbox/test_broadcaster.py`
- `repo:tests/unit/web/integrations/codex/test_route.py`
- `repo:tests/unit/web/integrations/codex/test_service_usage_wiring.py`
- 前端 hook/type/import-boundary 测试文件

主要动作：
- 扩展 Python adapter round trip/rejection fixture。
- 增加 Python/TS `frame_type` 集合漂移 fixture。
- 增加 import-boundary 扫描，禁止 feature/lib 局部 wire union。
- 前端 tests 覆盖 hook 分派、approval countdown、Codex socket protocol imports。

验收 gate：
- 新增/修改 frame 缺 Python/TS 双侧 fixture 时测试失败。
- feature/lib 新增局部 C2S/S2C wire union 时测试失败。
- adapter、route、hook、type tests 全部通过。

## Phase 5：文档清理

目标：把实现后的协议真源、字段和边界写回模块文档，清理旧描述。

主要文件改动：
- `repo:docs/modules/Web前端/README.md`
- 相关旧 spec/task 引用

主要动作：
- 更新 Web 模块 README：协议层使用 `frame_type`，真源为 `repo:src/hosts/web/protocol/` + `repo:web/src/protocol.ts`。
- 清理旧 `kind`、旧帧数、局部类型真源描述。
- 补充导入边界规则：前端业务 wire 类型只能从 `@/protocol` 导入。

验收 gate：
- Web 模块 README 与实现字段一致。
- 文档搜索中旧 `kind` union 和旧帧数描述完成清理。
- task 报告引用最终字段和 gate 结果。
