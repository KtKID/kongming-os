# 目标与完成标准

## 需求要点

1. Web 通用频道点击加号后进入新的空白对话页。
2. 空白页没有聊天信息，只显示居中的现有对话框形态。
3. 进入空白页时不会新增 thread；用户发送第一句话后才保存真实 thread。
4. 创建时机采用 B：第一条 user message 持久化成功时创建业务可见 thread。
5. 空白页对话框底部新增项目选择按钮，按钮只在这个新页面出现。
6. 项目下拉来自当前已存在 thread 的所属项目，老 thread 缺字段或无有效 cwd 时直接排除。
7. 项目下拉包含“选择新项目”，点击后打开系统文件夹选择器，选中目录作为 `cwd`。
8. 选择项目就是设置 `cwd`；未选择项目时使用后端进程用户 home 路径。
9. 本轮只覆盖 Web 通用频道，Claude / Codex 频道沿用当前逻辑。

## 系统目标

通用频道新建会话要贴近自然聊天入口：用户先进入一个空白工作台，选择可选项目上下文，再用第一句话正式创建对话。后端的持久化边界要落在业务动作之后，避免空 thread 污染列表，也让 thread 列表只展示真正发生过对话的记录。

## 完成目标（DoD）

- [ ] 通用频道左侧加号点击后直接进入空白新对话页。
- [ ] 空白页只显示居中 Composer，没有历史消息、workspace tabs、whiteboard cards。
- [ ] 空白页 Composer 底部展示项目选择按钮，已有 thread 页面不展示该按钮。
- [ ] 项目下拉从现有 `ThreadMetadataDTO.cwd` 派生，排除空 cwd、无效路径和老 thread 缺失字段。
- [ ] 项目下拉提供“选择新项目”，成功选择本地文件夹后把绝对路径写入新 thread 首发创建请求。
- [ ] 未选择项目时，后端把 `cwd` 解析为 `Path.home()` 的绝对路径。
- [ ] 后端返回真实 `thread_id` 前，thread metadata 和第一条 user message 已持久化成功。
- [ ] 首发创建成功后前端跳转 `/chat/{thread_id}`，通用频道继续复用现有 WS、ChatManager、timeline 渲染。
- [ ] 首发创建失败时停留在空白页，用户输入保留，thread 列表没有新增空记录。
- [ ] Claude / Codex 新建、导入和历史恢复路径行为不变。

## 范围边界

**包含**：
- `ThreadList` 加号行为改为 generic pending 空白页
- `ChatPage` 增加 generic pending 渲染分支
- `Composer` 增加空白页专属项目选择插槽或按钮
- 前端项目候选从 thread store 派生
- “选择新项目”调用宿主文件夹选择能力，选中后进入同一套 cwd 提交流程
- 后端新增首发创建入口或 ThreadManager 门户方法
- 协议类型、前后端单测和关键集成测试

**不包含**：
- 老 metadata 迁移
- 首发附件上传闭环
- 非 generic 频道改造
- 通用频道模型 provider 管理重做

## 关键约束

- `ThreadManager` 仍是后端 thread 生命周期唯一门户。
- 业务可见创建时机是“第一条 user message 持久化成功”。
- `cwd` 必须是绝对路径；项目选择值只传 cwd。
- 项目候选派生自当前 `threads` store，额外的新项目只来自用户主动选择的本地文件夹。
- 空白页首发不能走现有 `/ws/threads/{thread_id}`，因为该 WS 需要已有 metadata。
- Markdown 文档不内嵌 Mermaid；图见 `diagrams.html`。

## DoD ↔ 模块追溯矩阵

| DoD 条目 | 需要哪些模块 | 需要哪些 task | 状态 |
|---------|------------|-------------|------|
| 通用频道加号进入空白页 | `GenericPendingThreadEntry` | `generic-new-thread-first-message` | 待实现 |
| 空白页居中 Composer | `GenericEmptyThreadView` | `generic-new-thread-first-message` | 待实现 |
| 项目按钮只在空白页出现 | `GenericEmptyThreadView` + `ThreadProjectSelector` | `generic-new-thread-first-message` | 待实现 |
| 项目候选从有效 cwd 派生 | `ThreadProjectSelector` | `generic-new-thread-first-message` | 待实现 |
| 选择新项目打开文件夹选择器 | `ThreadProjectSelector` | `generic-new-thread-first-message` | 待实现 |
| 未选择项目使用用户 home | `ThreadProjectSelector` + `FirstMessageThreadCreator` | `generic-new-thread-first-message` | 待实现 |
| 返回 thread 前首条 user message 已落盘 | `FirstMessageThreadCreator` + `GenericFirstMessageProtocol` | `generic-new-thread-first-message` | 待实现 |
| 成功后复用现有 WS 时间线 | `FirstMessageThreadCreator` + `GenericEmptyThreadView` | `generic-new-thread-first-message` | 待实现 |
| 失败时不产生空 thread | `FirstMessageThreadCreator` | `generic-new-thread-first-message` | 待实现 |
| Claude / Codex 行为不变 | `GenericPendingThreadEntry` | `generic-new-thread-first-message` | 待实现 |
