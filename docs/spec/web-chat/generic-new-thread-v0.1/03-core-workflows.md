# 核心流程

流程图和时序图见 `diagrams.html` §流程 与 §时序。

## 空白页进入流程

1. 用户在通用频道 `ThreadList` 点击加号。
2. 前端调用 `useThreadsStore.startPendingGenericThread()`。
3. store 写入 `pendingNewSession = { backendKind: "generic_chat", cwd: "", projectName: "" }`。
4. 前端跳转 `/chat`。
5. `ChatPage` 命中 generic pending 分支，渲染 `GenericEmptyThreadView`。

## 项目选择流程

1. `GenericEmptyThreadView` 从 `useThreadsStore.threads` 读取当前 thread 列表。
2. `deriveThreadProjectOptions` 只保留带有效绝对 `cwd` 的 thread。
3. 按规范化 `cwd` 去重，展示 basename 和完整路径 tooltip。
4. 用户选择项目后，组件保存选中的 `cwd`。
5. 用户选择“不需要项目”或保持默认时，前端传空 `cwd`，后端解析为 `Path.home()`。

## 首发创建流程

1. 用户在空白页 Composer 输入第一句话并发送。
2. 前端调用 `POST /api/threads/generic/first-message`。
3. 后端解析 JSON，校验 `text`、`preset_id`、`cwd`。
4. 后端把空 `cwd` 转成用户 home 绝对路径。
5. `ThreadManager.create_generic_thread_from_first_message` 生成 thread id。
6. 后端创建 metadata 并确保第一条 user message 持久化成功。
7. 后端启动后续 generic run 或注册可被现有 WS 接管的运行任务。
8. 后端返回 `ThreadMetadataDTO`。
9. 前端刷新 thread store，跳转 `/chat/{thread_id}`。
10. 现有 `ChatPage` generic 分支打开 `/ws/threads/{thread_id}`，继续接收 history 和流式帧。

## 失败流程

1. 请求校验失败：后端返回 400，前端保留输入，不新增 thread。
2. preset 不存在：后端返回 400，前端提示模型配置错误。
3. cwd 非绝对路径：后端返回 400，前端保留项目选择。
4. 第一条 user message 持久化失败：后端回滚 metadata，返回 500，前端停留空白页。
5. LLM 后续失败：thread 已存在，第一条 user message 已存在，错误进入现有 generic 错误帧或 history。

## 创建时机裁决

采用用户确认的 B 时机：第一条 user message 持久化成功时创建业务可见 thread。实现上允许后端在同一门户方法内部先准备临时 metadata，但在 user message 持久化成功前不得把 thread 作为成功结果返回给前端；持久化失败时必须清理 metadata。
