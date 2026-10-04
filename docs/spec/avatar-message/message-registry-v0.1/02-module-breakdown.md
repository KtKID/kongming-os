# 模块拆分

## 模块总览

| 模块 | 职责 | 依赖 | 状态 | 备注 |
|------|------|------|------|------|
| AvatarManager | Avatar 消息业务唯一入口，收口 register/list/ack/stream notifications/chat capability facade | Repository + Producer hooks + AssistantManager | 可进入 x-req | P0 阻塞模块 |
| AvatarMessageRepository | SQLite 消息队列、游标分页、dedupe、ack、ttl/过期清理 | `<kongming_home>/web/avatar_messages.db` | 可进入 x-req | P0 状态真源 |
| AvatarMessageRouter | FastAPI REST/WS 合同、认证/scope、错误码转换 | AvatarManager + xspace_mobile token service + Web cookie auth | 可进入 x-req | P0 API 合同 |
| AvatarMessageProducer | approval/thread/task/system 事件到 AvatarMessageInput 的适配器 | AvatarManager + EventSink/现有 payload | 可进入 x-req | P1 首批 producer 从 approval 做起 |
| AvatarAssistantManager | 第二阶段 AvatarChat/LLM 通道门户，v1 输出 disabled capabilities | AvatarManager + 后续 LLM provider | 方案确认 | P2 预留边界 |

组件依赖和流程图见 [diagrams.md](./diagrams.md)。

## 模块详情

### 模块 1：AvatarManager

**职责**：提供 Avatar 消息业务门户，维护注册、查询、ack、通知和 chat capability 的任务级入口。

**包含范围**：
- `register(input)`：校验并注册 Avatar 消息，返回稳定消息快照。
- `list(query)`：按游标、时间、level、source、threadId 查询活跃或指定状态消息。
- `ack(message_id, request)`：幂等记录 ack/consumed。
- `stream_notifications(subscriber)`：供 Router WS 订阅轻量通知。
- `capabilities()`：聚合 message registry 与 AvatarAssistant capability。
- `chat(request)`：v1 委托 AvatarAssistantManager 返回 disabled capability 语义。

**边界外**：
- FastAPI Request/Response 和 HTTP 错误码。
- SQLite SQL 细节。
- XSpace Avatar 展示策略。
- 真实 LLM 对话。

**依赖**：AvatarMessageRepository、AvatarAssistantManager、可选 notification broadcaster。

**复用/新建**：新建 `src/hosts/web/avatar/manager.py`。装配模式参考 `src/hosts/web/app.py` 中 `xspace_mobile_pairing_manager` 注入方式。

**数据结构/接口**：

```python
class AvatarMessageInput(BaseModel):
    source: str  # 消息来源模块，建议取值 approval/thread/task/system/custom
    title: str  # XSpace 可展示标题，Kongming 只提供文本事实
    body: str | None = None  # XSpace 可展示正文，可为空
    level: Literal["info", "success", "warning", "error"] = "info"  # 严重程度，用于过滤和排序辅助
    priority: int = 50  # 优先级，0-100，数字越大越靠前
    thread_id: str | None = None  # 关联 thread ID，可为空
    run_id: str | None = None  # 关联 run ID，可为空
    request_id: str | None = None  # 关联审批或外部请求 ID，可为空
    action: AvatarMessageAction | None = None  # 建议动作，XSpace 自行决定呈现方式
    dedupe_key: str | None = None  # 同一事实合并键，存在时同 source 下更新原消息
    expires_at: datetime | None = None  # 过期时间，UTC；空值表示按默认 TTL 或长期保留策略
    metadata: dict[str, Any] = Field(default_factory=dict)  # 扩展信息，仅限 JSON 可序列化

class AvatarMessageSnapshot(BaseModel):
    message_id: str  # 稳定消息 ID，dedupe 更新时保持不变
    sequence: int  # Repository 单调递增游标，用于 REST 补齐
    revision: int  # 同一 message_id 的更新版本号
    status: Literal["active", "acked", "consumed", "expired"]  # 消息生命周期状态
    input: AvatarMessageInput  # 归一化后的消息内容
    created_at: datetime  # 创建时间，UTC
    updated_at: datetime  # 最近更新时间，UTC
    acked_at: datetime | None = None  # 首次 ack 时间，UTC
    consumed_at: datetime | None = None  # 首次 consumed 时间，UTC
```

**风险等级**：中
**风险说明**：Manager 是跨模块入口，风险集中在字段归一化、dedupe 不变量和通知副作用。P0 先用纯后端单测锁定状态语义。

**task 建议**：
- 建议 task 名：`avatar-message-backend-core`
- 对应 DoD：DoD#1、DoD#2、DoD#4、DoD#8
- 是否进入 x-req：是
- 原因：边界和数据模型已明确，可独立实现和验证。

### 模块 2：AvatarMessageRepository

**职责**：提供 Avatar 消息持久化边界，隐藏 SQLite schema、游标、dedupe 和清理策略。

**包含范围**：
- 创建或更新消息，`dedupeKey` 命中时保留原 `messageId` 并提升 `revision`。
- `list_messages(query)`：按 cursor/limit/since/level/source/threadId/status 查询。
- `ack_messages(request)`：幂等写入 acked/consumed 状态。
- `mark_expired(now)` 和 `cleanup(retention)`：维护 TTL 与历史保留。
- 单调 `sequence` 游标和索引。

**边界外**：
- 业务字段默认值策略。
- 认证与 HTTP 错误码。
- producer 对事件的业务解释。

**依赖**：SQLite、`<kongming_home>/web/avatar_messages.db`、系统时钟。

**复用/新建**：新建 `src/hosts/web/avatar/repository.py`。可参考 `src/hosts/web/xspace_mobile/repository.py` 的 SQLite 事务、row 映射和测试方式。

**数据结构/接口**：

```python
class AvatarMessageRecord(BaseModel):
    message_id: str  # 主键，am_ 前缀或等价 URL 友好 ID
    sequence: int  # 单调递增序号，REST cursor 使用
    revision: int  # 更新版本，从 1 开始
    source: str  # 消息来源模块
    level: str  # info/success/warning/error
    priority: int  # 0-100 优先级
    thread_id: str | None  # 关联 thread ID
    run_id: str | None  # 关联 run ID
    request_id: str | None  # 关联请求 ID
    action_json: str | None  # AvatarMessageAction 的 JSON 字符串
    dedupe_key: str | None  # 同一 source 下的 dedupe key
    status: str  # active/acked/consumed/expired
    payload_json: str  # title/body/metadata 等完整 payload JSON
    expires_at: datetime | None  # 过期时间，UTC
    acked_at: datetime | None  # 首次 ack 时间，UTC
    consumed_at: datetime | None  # 首次 consumed 时间，UTC
    created_at: datetime  # 创建时间，UTC
    updated_at: datetime  # 更新时间，UTC

class AvatarMessageListQuery(BaseModel):
    cursor: str | None = None  # 上次 list 返回的 nextCursor，空值表示从当前过滤条件第一页开始
    limit: int = 50  # 每页数量，建议 1-100
    since: datetime | None = None  # 更新时间下界，UTC，用于断线补齐
    level: list[str] | None = None  # level 过滤，多值 OR
    source: list[str] | None = None  # source 过滤，多值 OR
    thread_id: str | None = None  # thread ID 过滤
    status: list[str] | None = None  # 状态过滤，默认 active
```

**风险等级**：中
**风险说明**：SQLite 并发写、dedupe 更新和 cursor 补齐需要事务保证。建议 P0 建唯一索引 `(source, dedupe_key)`，`dedupe_key` 为空时走普通插入。

**task 建议**：
- 建议 task 名：`avatar-message-backend-core`
- 对应 DoD：DoD#2、DoD#3、DoD#4
- 是否进入 x-req：是
- 原因：状态真源清晰，单元测试可直接覆盖。

### 模块 3：AvatarMessageRouter

**职责**：暴露 Avatar 消息 REST/WS 合同，处理 device token/Web cookie 鉴权和稳定错误码。

**包含范围**：
- `GET /api/avatar/v1/capabilities`
- `POST /api/avatar/v1/messages`（仅 Web cookie/内部调试；内部模块主要调用 AvatarManager）
- `GET /api/avatar/v1/messages`
- `POST /api/avatar/v1/messages/{messageId}/ack`
- `POST /api/avatar/v1/messages/ack`
- `WS /ws/avatar/v1/messages`
- `POST /api/avatar/v1/chat` v1 disabled response

**边界外**：
- Manager 业务不变量。
- SQLite 查询实现。
- XSpace 展示 UI。

**依赖**：AvatarManager、`MobileDeviceTokenService`、Web cookie auth、FastAPI。

**复用/新建**：新建 `src/hosts/web/routers/avatar.py`，在 `src/hosts/web/app.py` 装配 `app.state.avatar_manager` 并 `include_router`。scope 校验复用 `src/hosts/web/xspace_mobile/token_service.py` 的 device token 验证结果。

**数据结构/接口**：

```typescript
type AvatarMessageListResponse = {
  items: AvatarMessageDto[]; // 本页消息，按 priority desc + updatedAt asc/sequence asc 排序
  nextCursor: string | null; // 下一页 cursor，空值表示本次查询已到尾
  serverTime: string; // 服务端 ISO 时间，客户端可用来计算延迟和 since
};

type AvatarAckRequest = {
  status?: "acked" | "consumed"; // 目标状态，默认 consumed
  consumerId?: string; // 消费方标识，如 xspace-avatar
  at?: string; // 客户端消费时间，ISO；服务端仍以 server time 为准
};

type AvatarMessageErrorCode =
  | "avatar_forbidden" // scope 缺失或 cookie 无效
  | "avatar_message_not_found" // message_id 无记录
  | "avatar_invalid_cursor" // cursor 格式或签名无效
  | "avatar_invalid_filter" // level/source/status 参数非法
  | "avatar_capability_disabled"; // v1 chat capability 默认关闭
```

**风险等级**：中
**风险说明**：API 同时支持 device token 与 Web cookie，scope 矩阵需要合同测试覆盖。WS 连接断开场景以 REST list 补齐为验收真源。

**task 建议**：
- 建议 task 名：`avatar-message-api-contract`
- 对应 DoD：DoD#3、DoD#4、DoD#5、DoD#6、DoD#7
- 是否进入 x-req：是
- 原因：REST/WS 合同和鉴权边界已明确。

### 模块 4：AvatarMessageProducer

**职责**：把 Kongming 内部事件或 payload 适配为 `AvatarMessageInput`，并通过 AvatarManager 注册。

**包含范围**：
- approval inbox payload 到 Avatar 消息的 adapter。
- thread/run/task/system 事件到 Avatar 消息的 adapter。
- source、level、priority、action、dedupeKey、expiresAt 默认策略。
- EventSink 接入形态，避免内部模块直接引用 producer 私有函数。

**边界外**：
- 消息持久化。
- REST/WS API。
- XSpace 点击动作实现。

**依赖**：AvatarManager、approval inbox payload、thread/task/system 事件合同。

**复用/新建**：新建 `src/hosts/web/avatar/producer.py`。approval 首版可复用现有 inbox payload 字段 `requestId/threadId/toolName/toolInput/timeoutMs/isElevated/channel/cwd`。

**数据结构/接口**：

```python
class ApprovalAvatarMessageAdapterInput(BaseModel):
    request_id: str  # approval requestId
    thread_id: str | None  # 关联 thread ID
    tool_name: str  # 工具名
    tool_input: dict[str, Any]  # 工具输入摘要，producer 负责裁剪敏感字段
    timeout_ms: int | None  # 审批超时毫秒数，用于 expires_at
    is_elevated: bool = False  # 是否 elevated approval，影响 priority/level
    channel: str | None = None  # 来源通道，如 claude/codex/generic
    cwd: str | None = None  # 工作目录，用于 metadata

class AvatarMessageProducer:
    def publish_approval_pending(self, payload: ApprovalAvatarMessageAdapterInput) -> AvatarMessageSnapshot:
        """把 pending approval 适配为 Avatar 消息并注册。"""
```

**风险等级**：中
**风险说明**：producer 容易把 UI 策略或敏感 tool input 混入 Kongming 侧。P0 只注册事实和建议 action，tool input 做长度限制和敏感字段裁剪。

**task 建议**：
- 建议 task 名：`avatar-message-producer-adapters`
- 对应 DoD：DoD#1、DoD#8
- 是否进入 x-req：是
- 原因：approval payload 已有字段，首个 adapter 可快速闭合真实价值链路。

### 模块 5：AvatarAssistantManager

**职责**：提供后续 Avatar 反向对话的独立门户，v1 只输出 capabilities 和 disabled chat 响应。

**包含范围**：
- `capabilities()`：返回 `avatarChat.enabled=false`、所需 scope、协议版本。
- `chat(request)`：v1 返回 `avatar_capability_disabled`。
- 保留后续单独 LLM provider/channel 的装配位置。

**边界外**：
- 真实 LLM 调用。
- 语音输入、TTS、Avatar 人格和记忆。
- 与主 chat runner 共用执行链路。

**依赖**：后续 LLM provider、AvatarManager capability 聚合。

**复用/新建**：新建 `src/hosts/web/avatar/assistant_manager.py`。v1 实现为 stub manager，后续 spec 再定义 LLM 通道。

**数据结构/接口**：

```python
class AvatarCapabilities(BaseModel):
    message_registry: bool  # Avatar 消息注册/消费能力是否可用
    rest_list: bool  # REST list 是否可用
    rest_ack: bool  # REST ack 是否可用
    ws_notifications: bool  # WS 通知是否可用
    avatar_chat: bool  # 反向对话是否可用，v1 固定 false
    required_scopes: dict[str, list[str]]  # 每类能力所需 scope 列表

class AvatarChatRequest(BaseModel):
    text: str  # Avatar 侧用户输入文本
    thread_id: str | None = None  # 可选关联 thread
    device_id: str | None = None  # device token 解析出的设备 ID
    capabilities: dict[str, bool] = Field(default_factory=dict)  # XSpace Avatar 客户端能力声明
```

**风险等级**：低
**风险说明**：v1 只输出 disabled capability，主要风险是接口承诺过宽。推荐独立 spec 展开真实 LLM 通道后再进入开发。

**task 建议**：
- 建议 task 名：`avatar-assistant-boundary`
- 对应 DoD：DoD#6、DoD#7
- 是否进入 x-req：否
- 原因：v1 可随 API contract 放置 stub，真实 chat 需要后续 spec。
