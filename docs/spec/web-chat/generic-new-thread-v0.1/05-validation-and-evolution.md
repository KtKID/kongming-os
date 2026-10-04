# 验证策略与演进

## 验证策略

### 单元测试

- **前端 `deriveThreadProjectOptions`**：覆盖 cwd 去重、空 cwd 排除、相对路径排除、同名项目 tooltip。
- **前端 `ThreadList`**：点击通用加号设置 `pendingNewSession.backendKind="generic_chat"` 并跳转 `/chat`。
- **前端 `ChatPage`**：generic pending 时渲染 `GenericEmptyThreadView`，已有 thread 时沿用 generic WS 分支。
- **前端 `GenericEmptyThreadView`**：项目按钮只在 pending 页面出现，发送成功后跳转真实 thread，失败保留输入。
- **后端 DTO**：`CreateGenericThreadFromFirstMessageRequest` 拒绝空文本、空 preset、相对 cwd。
- **后端 ThreadManager**：首条 user message 持久化成功后返回 metadata；持久化失败时清理 metadata。

### 集成测试

- **首发创建成功链路**：POST 首发接口后读取 metadata 和 session jsonl，确认 thread 存在且第一条 user message 内容一致。
- **首发失败链路**：模拟 session append 失败，确认 `<kongming_home>/web/threads/<thread_id>` 未残留。
- **现有 WS 接续**：首发成功后连接 `/ws/threads/{thread_id}`，确认收到包含第一条 user message 的 `thread.history`。
- **频道隔离**：Claude / Codex pending 新建测试保持通过。

### 手动验证

- 点击通用频道加号，页面切到空白新对话页。
- 项目下拉只展示已有 thread 的项目路径。
- 选择项目发第一句话，thread 列表出现新会话，workspace cwd 等于选择路径。
- 选择“不需要项目”发第一句话，workspace cwd 等于后端用户 home。
- 首发接口断网或 preset 错误时页面保留输入，左侧列表没有空 thread。

## 测试覆盖要求

| 模块 | 最低覆盖 | 重点文件 |
|------|---------|---------|
| `GenericPendingThreadEntry` | 单元测试 | `web/src/components/ThreadList.tsx` |
| `GenericEmptyThreadView` | 单元测试 | `web/src/pages/Chat.tsx` + 新组件 |
| `ThreadProjectSelector` | 单元测试 | 新组件和纯函数 |
| `FirstMessageThreadCreator` | 单元 + 集成 | `src/hosts/web/threads/manager.py` |
| `GenericFirstMessageProtocol` | round-trip | `src/hosts/web/protocol/rest_models.py` + `web/src/protocol.ts` |

## 演进路线

### 短期（本轮 task）

- [ ] 通用加号进入 generic pending 空白页。
- [ ] Composer 增加空白页项目选择按钮。
- [ ] 新增首发创建协议和后端门户。
- [ ] 成功后跳转真实 thread 并接入现有 WS。
- [ ] 单测覆盖项目候选、pending 分支、首发创建时机。

### 中期（下 1-2 轮）

- [ ] 支持空白页首发图片：先创建上传上下文，再绑定真实 thread。
- [ ] 项目下拉支持“选择新项目”，复用 Tauri 目录选择器。
- [ ] thread 标题从首条消息升级为自动标题。

### 长期（方向性）

- [ ] 把 generic / Claude / Codex 的 pending 创建统一收口到 `ChatManager.ensureThread`。
- [ ] 把首发创建和 runtime seed 做成可复用后端门户，减少各频道重复逻辑。
