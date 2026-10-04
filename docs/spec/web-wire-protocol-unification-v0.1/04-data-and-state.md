# 数据模型与状态

核心实体、字段语义和状态关系见 `./diagrams.md#协议数据关系`。

## 核心数据模型

### WireFrame

| 字段 | 类型 | 说明 |
|------|------|------|
| `frame_type` | string literal | 所有 wire 帧的统一判别字段 |
| `threadId` | string | Web wire 当前 thread 归属字段，thread-status、approval inbox、usage refresh 共用 |
| `payload` | object | 业务 payload，跨模块复杂对象用 `dict[str, Any]` / `Record<string, unknown>` 承载 |
| `usage` | object | `usage_summary_updated` 的 usage 数据，协议包不依赖 usage manager |

### ThreadStatusFrame Set

| 帧 | 方向 | 关键字段 | 说明 |
|----|------|----------|------|
| `thread-status` | S2C | `frame_type`、`threadId`、`phase`、`toolName?` | thread 当前阶段广播，`phase` 枚举见下表 |
| `ping` | C2S | `frame_type`、`ts?` | 客户端保活请求，可携带客户端时间戳 |
| `pong` | S2C | `frame_type`、`timestamp_ms`、`ts?` | 服务端保活响应，回显可选 `ts` 并提供服务端毫秒时间 |
| `usage_summary_updated` | S2C | `frame_type`、`threadId`、`usage` | usage refresh，字面值保留，判别字段改为 `frame_type` |

`thread-status.phase` 取值：

| phase | 说明 |
|-------|------|
| `idle` | thread 空闲 |
| `responding` | 模型正在生成可见回复 |
| `thinking` | 模型处于推理/思考阶段 |
| `tool_calling` | 正在执行工具调用，`toolName` 可携带当前工具名 |
| `waiting_approval` | 等待用户审批 |
| `complete` | 本轮已完成 |
| `error` | 本轮进入错误态 |

### ApprovalInboxFrame Set

| 帧 | 方向 | 关键字段 | 说明 |
|----|------|----------|------|
| `approval.inbox.add` | S2C | `frame_type` + `ApprovalInboxItem` 顶层字段 | 新增审批项，展开审批项字段，`timeoutMs` 驱动前端倒计时 |
| `approval.inbox.remove` | S2C | `frame_type`、`requestId`、`reason` | 移除审批项，`reason` 取 `user_decided` / `timeout` / `cancelled` |
| `approval.inbox.snapshot` | S2C | `frame_type`、`items: ApprovalInboxItem[]` | 全量审批 inbox 快照 |
| `approval.inbox.resolve` | C2S | `frame_type`、`threadId`、`requestId`、`allow`、`message?`、`rememberEntry?`、`rememberScope?` | 用户在 `/ws/thread-status` 通道解析审批，`rememberScope` 取 `session` / `persistent` |

`ApprovalInboxItem` 顶层字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `requestId` | string | 审批请求 ID |
| `threadId` | string | 所属 thread |
| `toolName` | string | 请求审批的工具名 |
| `toolInput` | Record<string, unknown> | 工具输入 |
| `autoApproveAtMs` | number \| null | 自动通过时间，毫秒 |
| `autoRejectAtMs` | number \| null | 自动拒绝时间，毫秒 |
| `blockedByRule` | string \| null | 触发阻断或审批的规则 |
| `isElevated` | boolean | 是否提权审批 |
| `channel` | string | 宿主通道 |
| `cwd` | string \| null | 审批发生时工作目录 |
| `arrivedAtMs` | number | 到达 inbox 的毫秒时间 |
| `timeoutMs` | number \| null | 前端倒计时窗口 |
| `threadDisplayName?` | string | 可选展示名 |

### LLM Endpoint Frame Set

| 帧/类型 | 方向 | 关键字段 | 说明 |
|---------|------|----------|------|
| `NormalizedMessage` | outbound DTO | `id`、`sessionId`、`timestamp`、`provider`、`frame_type` | Claude Code 与 Codex endpoint outbound 主流消息 base |
| `session-status` | S2C | `sessionId`、`isProcessing` | 会话处理状态 |
| `codex-command` | C2S | `command`、`options?`、`attachments?` | Codex endpoint 命令，`attachments` 按 provider 需要使用 |
| `claude-command` | C2S | `command`、`options?`、`attachments?` | Claude endpoint 命令，`attachments` 按 provider 需要使用 |
| `abort-session` | C2S | `sessionId` | 中止指定 session |
| `check-session-status` | C2S | `sessionId` | 查询指定 session 状态 |

## 状态归属

| 状态 | 真源 | 协议角色 |
|------|------|----------|
| thread 运行状态 | thread/status 业务模块 | protocol 只描述 wire DTO |
| approval inbox item | approval inbox 模块 | protocol 定义 add/remove/snapshot/resolve wire 形状 |
| usage summary | Claude/Codex usage service | protocol 定义 refresh frame 形状 |
| Claude/Codex session status | 各 endpoint service | protocol 定义 command/status DTO |
| wire 类型导出 | Python protocol 包 + TS `protocol.ts` | 双侧同步维护 |

## 状态流转

### 模型生命周期

1. 业务模块生成状态或事件数据。
2. 发送点构造协议模型或调用 endpoint adapter 校验 payload。
3. 协议模型执行字段校验、判别值约束和别名输出。
4. 发送点调用 `model_dump()` 输出 wire dict。
5. 前端 socket 收到 JSON 后按 `frame.frame_type` 进入 unified union 分派。
6. feature store 将 wire frame 转成 UI 状态或业务状态。

### 迁移状态

| 状态 | 进入条件 | 退出条件 |
|------|----------|----------|
| 局部类型存在 | 帧仍定义在 feature/lib 文件 | 类型迁入 `repo:web/src/protocol.ts`，局部文件只保留业务状态 |
| 裸 dict 发送 | 后端发送端直接拼关键 wire 字段 | 发送端通过 Pydantic 模型或 TypeAdapter 输出 |
| 双侧同步完成 | Python 与 TS 均有同名类型 | 漂移测试和导入边界测试通过 |
| 文档对齐完成 | 模块文档仍描述旧 `kind` 或旧帧数 | 文档更新到 `frame_type` 与全协议面 |

## 数据边界

- 协议包字段只描述 wire contract，业务 manager 内部状态保持在各自模块。
- `repo:src/hosts/web/protocol/` 中的模型使用基础类型、枚举、独立 DTO 和 `dict[str, Any]`，保持零 sibling 依赖。
- TS 侧 `Record<string, unknown>` 表达 Python `dict[str, Any]`，避免将 feature store 类型反向提升为 wire 真源。
- 字段命名遵循既有 wire 兼容面；需要统一 snake/camel 时在 x-req 中逐帧决策并用 alias 明确。

## 高风险字段

| 字段 | 风险 | 验证要求 |
|------|------|----------|
| `frame_type` | 全局判别字段，错写会导致前端分派失败 | Python/TS union fixture 覆盖每个字面值 |
| `thread-status.phase` | 运行阶段驱动前端状态展示 | 覆盖 `idle/responding/thinking/tool_calling/waiting_approval/complete/error` |
| `usage_summary_updated` | 字面值保留但字段从 `type` 改为 `frame_type` | 后端 service test 与 `useThreadStatusWS` test 同时覆盖 |
| `timeoutMs` | approval inbox 倒计时依赖 | 前端 countdown test 和 Python broadcaster test 覆盖顶层字段 |
| `rememberScope` | 审批记忆范围影响后续自动审批 | C2S resolve test 覆盖 `session` / `persistent` |
| `attachments` | Codex 当前命令输入依赖附件 | endpoint command tests 覆盖可选字段透传 |
| `NormalizedMessage.frame_type` | endpoint outbound 分派依赖 | endpoint outbound tests 覆盖 base 字段 |
