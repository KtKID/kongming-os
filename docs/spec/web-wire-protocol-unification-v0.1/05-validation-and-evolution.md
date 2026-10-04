# 验证策略与演进

## 验证目标

验证要证明三件事：协议模型覆盖完整，发送与消费路径实际走协议真源，新增局部 wire 类型会被测试拦截。E2E 测试链路见 `./diagrams.md#e2e-测试链路`。

## Python 验证

| 测试层 | 覆盖对象 | 建议落点 | 断言 |
|--------|----------|----------|------|
| adapter round trip | 新增 C2S/S2C union | `repo:tests/unit/test_web_protocol_round_trip.py` | 每个 `frame_type` 能进入正确模型并 dump |
| adapter rejection | 缺字段、错判别值、未知 frame | `repo:tests/unit/test_web_protocol_rejection.py` | 抛出明确 validation error |
| `/ws/thread-status` route | ping/pong、thread-status、approval resolve、usage refresh | WebSocket route/handler tests | route 输出统一 `frame_type`；`thread-status` 含 `threadId`、`phase`、`toolName?`；`pong` 含 `timestamp_ms`、`ts?`；resolve 输入含 `threadId`、`requestId`、`allow`、`message?`、`rememberEntry?`、`rememberScope?` |
| global inbox broadcaster | snapshot/add/remove | `repo:tests/unit/web/approvals/global_inbox/test_broadcaster.py` | add 输出展开 `ApprovalInboxItem` 顶层字段；snapshot 输出 `items: ApprovalInboxItem[]`；remove 输出 `requestId` 和 `reason` |
| Claude/Codex endpoint | command/status/abort/check/session messages | integrations route/service tests | command 输入使用 `command`、`options?`、`attachments?`；status 输出使用 `sessionId`、`isProcessing`；NormalizedMessage outbound base 含 `id`、`sessionId`、`timestamp`、`provider`、`frame_type` |

## Frontend 验证

| 测试层 | 覆盖对象 | 建议落点 | 断言 |
|--------|----------|----------|------|
| hook 分派 | `useThreadStatusWS` unified union | hook test | 只读 `frame.frame_type`，覆盖 `thread-status.phase`、approval、usage、pong |
| approval inbox | `timeoutMs` countdown | approval inbox test | frame 从 `@/protocol` 导入，`timeoutMs` 是 add 顶层字段 |
| Codex socket | command/status imports | codex-ws test 或 type test | `CodexC2SFrame` / `CodexS2CFrame` 来自 `@/protocol`，command 类型使用 `options?` 和 `attachments?` |
| TS 类型边界 | feature/lib 局部 wire type | import-boundary test | 阻止 `ApprovalInbox*Frame`、`Codex*C2SFrame` 局部定义 |

## 漂移检查

首版建议采用轻量检查组合：

1. Python fixture：列出 endpoint、方向、`frame_type`、模型名。
2. TS fixture：从 `repo:web/src/protocol.ts` 的导出类型或维护 fixture 中列出同名集合。
3. pytest 或 node 脚本比较集合和 hash。
4. import-boundary 扫描 feature/lib 文件中 forbidden wire type pattern。

导入边界检查重点 pattern：

| Pattern | 允许位置 | 说明 |
|---------|----------|------|
| `ApprovalInbox*Frame` | `repo:web/src/protocol.ts` | approval inbox wire frame 真源 |
| `Codex*C2SFrame` | `repo:web/src/protocol.ts` | Codex C2S union 真源 |
| `Codex*S2CFrame` | `repo:web/src/protocol.ts` | Codex S2C union 真源 |
| `SessionStatusFrame` | `repo:web/src/protocol.ts` | session status frame 真源 |
| `frame_type: "usage_summary_updated"` | Python protocol 包 + TS protocol | usage refresh 判别值 |
| `ApprovalInboxItem` | Python protocol 包 + TS protocol | approval add/snapshot 共享 item 字段 |

## 阻断 gate

| 阶段 | gate | 继续条件 |
|------|------|----------|
| Models gate | Python/TS `frame_type` 集合一致 | 双侧 fixture、endpoint C2S/S2C union、adapter round trip/rejection 全部通过 |
| Emitters gate | 相关发送端没有裸拼关键 frame dict | thread-status、approval inbox、usage、Codex/Claude route/service tests 断言协议模型输出 |
| Consumers gate | `useThreadStatusWS` 没有 `data.type` 分支；局部文件没有 `ApprovalInbox*Frame` / `Codex*C2SFrame` 等 wire union | hook/type/import tests 全部通过，wire 类型只从 `@/protocol` 导入 |
| Drift gate | 新增/修改 frame 缺 Python/TS 双侧 fixture 会失败 | fixture/hash/import-boundary 检查纳入常规测试命令 |
| Docs gate | Web 模块文档使用 `frame_type` 和双侧真源 | 旧 `kind`、旧帧数、局部类型真源描述完成清理 |

## 回归顺序

1. 先跑 Python protocol round trip/rejection，确认模型和 adapter 稳定。
2. 跑后端 route/service tests，确认发送端已经走协议模型。
3. 跑前端 hook/socket/store tests，确认消费端只按 `frame_type` 分派。
4. 跑漂移/import-boundary 检查，确认局部 wire 类型没有复生。
5. 更新模块文档后跑文档链接/关键词检查，确认旧 `kind` 与旧帧数描述清理。

## 演进策略

### v0.1 手写同步

延续当前维护方式：Python Pydantic 模型与 TS `protocol.ts` 手写同步，通过 fixture/hash 和 import-boundary 测试兜底。这条路径改动最小，适合先把真源边界和发送消费路径收口。

### v0.2 自动生成评估

当协议面继续扩大，可以评估从 Python JSON Schema 生成 TS 类型，或从共享 schema fixture 生成双侧定义。生成方案进入新 spec 前，需要先证明输出可读、diff 稳定、字段别名可控。

### v0.3 Endpoint Registry

在 endpoint 数量继续增长后，可以把 `WebWireProtocolRegistry` 升级为 endpoint registry，集中声明 endpoint、方向、模型、测试 fixture 和文档生成输入。

## 风险验证

| 风险 | 验证方式 | 阻断条件 |
|------|----------|----------|
| `usage_summary_updated` 字段迁移遗漏 | service test + hook test 同时覆盖 | 任一发送端仍输出 `type` |
| approval countdown 语义漂移 | broadcaster test + UI countdown test | `timeoutMs` 缺失、单位变化或被包进旧嵌套字段 |
| approval resolve 语义漂移 | C2S adapter test + route handler test | 使用旧审批结果字段或缺少 `allow` |
| command payload 语义漂移 | endpoint command tests | 使用旧参数字段或丢失 `attachments?` |
| protocol 包引入 sibling 依赖 | import-linter + targeted import test | `repo:src/hosts/web/protocol/` import sibling |
| 局部 wire union 复生 | import-boundary scan | feature/lib 定义 forbidden frame type |
| Python/TS 字段分叉 | fixture/hash drift check | 模型名、判别值、方向集合不一致 |
