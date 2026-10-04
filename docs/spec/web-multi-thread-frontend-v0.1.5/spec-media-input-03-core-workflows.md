# 核心流程

## 流程 1：图片发送 happy path

1. 用户在 `Composer` 里粘贴图片或选择图片文件。
2. 前端先调用 `POST /api/uploads/images` 上传文件，拿到 `asset_id`、`preview_url`、`width`、`height`、`mime_type`。
3. `Composer` 把上传结果加入本地附件列表，展示缩略图和删除按钮。
4. 用户点击发送，前端通过 `user.input` 把 `text + attachments[] + request_id` 发到 WS。
5. 后端把附件引用写入 user message metadata，并进入本轮 `run_once`。
6. assembly 层把文字和图片附件组装成 provider content blocks。
7. provider 返回 assistant 输出，前端继续走现有流式链路展示结果。

## 流程 2：刷新页面后的图片历史回显

1. 前端重新连接 thread。
2. 后端发送 `thread.history`。
3. `HistoryMessageDTO.attachments[]` 回到前端 store。
4. `MessageList` 根据附件 view model 渲染用户图片缩略图。
5. 用户点击缩略图，前端用 `preview_url` 打开预览层。

## 流程 3：删除 thread 后的资产回收

1. 用户删除 thread。
2. `ThreadManager.delete_thread()` 删除 thread metadata 和 session 历史。
3. 资产索引根据 `thread_id` 找到该 thread 的附件目录。
4. 回收任务删除本地文件和附件元数据。
5. 后端返回删除成功，前端同步移除该 thread。

## 流程 4：视频发送演进路径

1. 用户选择视频文件。
2. 前端调用 `POST /api/uploads/videos`。
3. 后端写入视频资产，生成 `asset_id`，创建处理任务。
4. 处理任务执行转码、抽帧、转写、摘要。
5. 任务状态持续写回附件 metadata。
6. 用户发送消息时，当前轮输入消费视频摘要、转写文本和关键帧引用。
7. 后续阶段根据 provider 能力决定是否增加原生视频输入。

## 流程 5：provider 不支持图片输入

1. assembly 层构造统一多模态输入。
2. provider 适配层检查能力矩阵。
3. 不支持图片输入的 preset 返回显式错误。
4. 前端展示错误提示，并保留用户上传的附件引用。
5. 用户可以切换支持图片的 preset 后重试。
