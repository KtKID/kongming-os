# 验证策略与演进

## 验证策略

### 单元测试

- **覆盖模块**：`ChatProvider`、`ChatManager`、`ChatTimelineStore`、`ChatRenderAdapter`
- **框架**：`vitest`
- **重点场景**：
  - `SendRequest(common + provider)` 的字段校验与分发
  - Claude / Codex / Generic 各自原始帧到 `ChatEvent` 的翻译
  - 历史批量 + 实时 delta 合并后的时间线顺序
  - 首次发送时创建 thread，后续发送复用已有 thread
  - 工具调用 running / completed / failed 的状态归并

### 集成测试

- **端到端链路**：
  - Generic 频道发送一条消息并收到流式回复
  - Claude 频道刷新后历史和新流式消息共同显示
  - Codex 频道 pending 新会话在首次发送时创建真实 thread
- **环境要求**：本地 web + 现有后端 route / service
- **触发方式**：本地定向测试 + `x-verify` 复跑

### 手动验证

- **必须人工过的场景**：
  - 多端切换后继续在原线程发送消息
  - 刷新页面后用户消息、assistant 流式消息、工具消息顺序稳定
  - 长文本流式输出时当前 UI 与后续 `Streamdown` 边界字段齐全
- **验收人**：当前仓库维护者

## 测试覆盖要求

| 模块 | 最低覆盖率 | 重点文件 |
|------|-----------|---------|
| `chat/providers` | 80% | `ClaudeChatProvider.ts` `CodexChatProvider.ts` `GenericChatProvider.ts` |
| `chat/ChatManager.ts` | 75% | 首发创建、发送失败、重试、打断 |
| `chat/ChatTimelineStore.ts` | 80% | delta 合并、tool 聚合、历史去重 |
| `chat/ChatRenderAdapter.ts` | 70% | 视图投影与流式状态透传 |

## 演进路线

### 短期（本轮 task）

- [ ] 固定 `SendRequest`、`ChatEvent`、`ChatTimelineState` 三套公共类型
- [ ] 落三份 `ChatProvider`
- [ ] 落 `ChatManager` 与 `ChatTimelineStore`
- [ ] 让三条频道视图改为消费 `ChatRenderAdapter`

### 中期（下 1-2 轮）

- [ ] 把 Generic 与 Codex 的 socket 完整收编进 `NetworkManager`
- [ ] 收口频道 hook，形成统一 `useChatRuntime`
- [ ] 为 `Streamdown` 补充更细的 message part 结构，例如增量 markdown block、thinking block

### 长期（方向性）

- 公共聊天运行时继续下沉，后端 provider route / history parser 再判断是否需要合并
- `ChatRenderAdapter` 演进为多渲染后端，当前 UI 与 `Streamdown` 共用同一套时间线状态
- 如果以后需要更多频道，新增 provider 以脚本形式接入，不再复制整条消息链路

## 演进原则

1. 先固定公共数据结构，再搬运旧逻辑。
2. 先统一发送与接收，再统一渲染。
3. provider 差异留在 provider 层，避免再次回流到视图组件。
4. `Streamdown` 只进入 adapter 与 view 边界，不侵入发送和时间线状态机。
