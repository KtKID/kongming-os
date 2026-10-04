# 验证策略与演进

## 验证策略

### Smoke / E2E 验收入口

- **Smoke 路径**：TestClient 装配 `app.state.avatar_manager` 和临时 SQLite，调用内部注册 helper 写入消息，`GET /api/avatar/v1/messages` 拉取，`POST /api/avatar/v1/messages/{messageId}/ack` 确认，断言 SQLite 状态变成 consumed。
- **E2E 路径**：approval producer 接收 pending approval payload，注册 Avatar 消息；XSpace token 带 `avatar.read/avatar.ack` scope 拉取并 ack；WS 连接收到 notification 后再用 REST list 补齐。
- **进入 x-req 的规则**：x-req README 必须展开 REST 合同、Manager/Repository 状态机、scope 鉴权、producer adapter、WS 断线补齐五类验收。

### 单元测试

- **覆盖模块**：AvatarManager、AvatarMessageRepository、AvatarMessageProducer、AvatarAssistantManager。
- **框架**：pytest。
- **重点场景**：
  - `dedupeKey` 命中时保留 `messageId`、递增 `revision`、更新 `sequence/updatedAt`。
  - 无 `dedupeKey` 时每次注册生成新消息。
  - `ack` 重复调用返回同一终态。
  - `expiresAt` 到期后默认 list 隐藏，指定 status 可查。
  - priority/level/source/threadId/runId/requestId/action 字段完整 round-trip。
  - AvatarAssistant capabilities 默认 `avatarChat=false`。

### 集成测试

- **后端路由合同**：
  - `GET /api/avatar/v1/capabilities` 返回协议版本、scope、chat disabled。
  - `POST /api/avatar/v1/messages` 支持 Web cookie/内部调试注册。
  - `GET /api/avatar/v1/messages` 支持 `cursor/limit/since/level/source/threadId`。
  - `POST /api/avatar/v1/messages/{messageId}/ack` 和 `POST /api/avatar/v1/messages/ack` 幂等。
  - `POST /api/avatar/v1/chat` 返回 capability disabled。
  - scope 缺失返回 `avatar_forbidden`。
  - cursor 格式错误返回 `avatar_invalid_cursor`。
- **认证边界**：
  - device token 带 `avatar.read` 或 `thread.read` 可 list/stream。
  - device token 带 `avatar.ack` 可 ack。
  - `avatar.chat` scope 进入 chat handler 后仍返回 capability disabled。
  - Web cookie 可走桌面调试路径。
- **WS 通知**：
  - 注册消息后在线 WS 收到 `avatar.message.changed`。
  - WS 断线期间注册的消息通过 REST `since` 补齐。
  - WS 推送失败不影响 register/ack 主流程。

### 手动验证

- **必须人工过的场景**：XSpace 侧拿同一 device token 调 REST list/ack，确认展示策略完全由 XSpace 决定。
- **验收人**：Kongming 后端任务 owner + XSpace Avatar 消费方 owner。

## 测试覆盖要求

| 模块 | 最低覆盖 | 重点文件 |
|------|----------|---------|
| AvatarManager | Manager 状态机成功/失败/幂等路径 | `tests/unit/web/test_avatar_manager.py` |
| AvatarMessageRepository | SQLite 事务、dedupe、cursor、TTL | `tests/unit/web/test_avatar_repository.py` |
| AvatarMessageRouter | REST/WS 合同和 scope 鉴权 | `tests/unit/web/test_avatar_router.py` |
| AvatarMessageProducer | approval payload 映射和敏感字段裁剪 | `tests/unit/web/test_avatar_producer.py` |
| AvatarAssistantManager | disabled capabilities 和 chat 错误 | `tests/unit/web/test_avatar_assistant.py` |

## 协议漂移测试

- 后端 DTO fixture：`tests/fixtures/avatar/message_registry_v1/*.json`。
- XSpace 消费端 fixture：字段名使用 camelCase wire 格式，Python 内部 DTO 可使用 snake_case。
- 每次增删字段时同步更新 capabilities 和 fixture，unknown field 处理策略写入 router 合同测试。
- `AvatarMessageAction.type` 新增取值时，保留旧 fixture 并新增 unknown-action 兼容测试。

## 演进路线

### 短期（本轮 task）

- [ ] 建 `hosts.web.avatar` 包、公开 models、AvatarManager、AvatarMessageRepository。
- [ ] 接 REST list/ack/capabilities 和 device token/Web cookie 鉴权。
- [ ] 接 approval producer adapter，首个有价值消息来源为 pending approval。
- [ ] 写 TestClient + SQLite + Manager 单元测试。

### 中期（下 1-2 轮）

- [ ] 接可选 `WS /ws/avatar/v1/messages`，只推通知和轻量消息。
- [ ] 增加 thread/task/system producer adapter。
- [ ] 增加批量 ack、source 级默认 priority/TTL 配置。
- [ ] 增加 dashboard 或 health 可观测指标：pending active 数、expired 清理数、WS subscriber 数。

### 长期（方向性）

- 建 AvatarChat 独立 spec：单独 LLM provider/channel、权限、审计和安全策略。
- 支持多 consumer ack 表和每设备游标。
- 支持云推送或移动系统通知桥接。
- 支持更细 action schema 和 XSpace capability negotiation。
