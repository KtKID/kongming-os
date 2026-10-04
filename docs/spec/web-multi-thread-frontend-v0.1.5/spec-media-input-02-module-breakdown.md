# 模块拆分

## 模块总览

| 模块 | 职责 | 依赖 | 状态 | 备注 |
|---|---|---|---|---|
| media-composer | 浏览器侧粘贴、选图、预览、发送、历史展示 | attachment-contract / media-upload-shell | 方案确认 | 图片先落地，视频入口复用同一交互 |
| media-upload-shell | 上传 API、资产落盘、读取和鉴权 | web-app-shell / thread-manager | 方案确认 | 第一版走本地磁盘 |
| attachment-contract | WS / REST / session 附件契约 | ws-protocol / rest DTO / session schema | 方案确认 | 历史回显依赖它 |
| multimodal-assembly | 把文本和附件组装成 provider 输入 | runner / session / input assembly | 方案确认 | 决定多模态主链入口 |
| provider-media-adapters | OpenAI-compatible / Anthropic 图片输入映射 | multimodal-assembly | 方案确认 | 图片优先，视频后续 |
| video-processing-pipeline | 视频处理任务、抽帧、转写、摘要 | media-upload-shell / attachment-contract | 探索中 | 处理资源约束待确认 |

## 模块详情

### 模块 1：media-composer

**职责**：浏览器端媒体输入体验。

**包含范围**：
- `Composer.tsx` 增加图片按钮、隐藏文件 input、粘贴监听、缩略图条、删除单张
- 上传进度、失败 toast、图片数量和尺寸校验
- 用户消息项渲染图片缩略图和点击预览
- 历史消息加载时复用同一展示组件

**后续范围**：
- 视频封面、时长展示、处理中状态展示
- 拖拽上传、批量上传排序、重试队列

**依赖**：
- `attachment-contract`
- `media-upload-shell`

**风险与讨论点**：
- 大文件上传和消息发送需要拆成两段提交
- 粘贴行为和 textarea 快捷键需要保持协调
- 图片预览和历史回显要消费同一份附件 view model

**task 建议**：
- 建议 task 名：`web-media-composer-v0.1.6`
- 是否进入 x-req：是
- 原因：交互边界清晰，依赖上传接口和附件契约

### 模块 2：media-upload-shell

**职责**：浏览器宿主侧的资产接入层。

**包含范围**：
- `POST /api/uploads/images`
- `GET /api/uploads/{asset_id}` 或受控静态读取端点
- 本地磁盘落盘：`.kongming/web/uploads/images/<thread_id>/<asset_id>.<ext>`
- 资产元数据持久化：mime、size、width、height、sha256、created_at、thread_id
- 基础校验：图片类型、单张大小、线程归属、登录态

**后续范围**：
- `POST /api/uploads/videos`
- 视频缩略图提取、转码任务提交
- 对象存储适配层

**依赖**：
- `web-app-shell`
- `thread-manager`

**风险与讨论点**：
- 读取接口需要 thread 级访问控制
- 资产 GC 策略需要和 thread 删除一起设计
- 上传完成后返回的预览地址要稳定，方便历史回显

**task 建议**：
- 建议 task 名：`web-media-upload-shell-v0.1.6`
- 是否进入 x-req：是
- 原因：Phase 1 的基础模块，接口和存储布局已足够稳定

### 模块 3：attachment-contract

**职责**：统一附件在前端、协议、持久化之间的形态。

**包含范围**：
- `UserInputFrame.attachments[]`
- `HistoryMessageDTO.attachments[]`
- `ChatItem.user.attachments[]`
- session 历史里的 `Message.metadata.attachments`
- 统一字段：`asset_id`、`kind`、`mime_type`、`width`、`height`、`size_bytes`、`preview_url`、`status`

**后续范围**：
- 视频时长、帧率、转写状态、处理任务引用
- 通用文件类型和下载策略

**依赖**：
- `ws-protocol`
- `rest_models`
- `core.message`
- `file_session`

**风险与讨论点**：
- 历史消息 DTO 需要稳定承载附件字段，刷新和重连才能一致
- session JSONL 需要只存引用和元数据，保持体积可控
- status 字段要覆盖上传完成、处理中、处理失败三类状态

**task 建议**：
- 建议 task 名：`web-attachment-contract-v0.1.6`
- 是否进入 x-req：是
- 原因：接口边界清晰，是前后端并行开发的契约中心

### 模块 4：multimodal-assembly

**职责**：把文本输入和附件引用组装成模型输入。

**包含范围**：
- `SessionBridge.run_once(...)` 接受结构化 user input
- `Runner` 和 `Message.user(...)` 承载附件 metadata
- 本轮图片附件转换成 provider 可消费的 content blocks
- 历史重放时把 user 文本和附件一起还原

**后续范围**：
- 抽象成通用 content parts，承载图片、视频、文件、宿主快照
- token / media budget 裁剪策略

**依赖**：
- `attachment-contract`
- `core.message`
- `runner`
- `session`

**风险与讨论点**：
- 当前主链以字符串 user input 为中心，需要一次明确升级
- 输入组装位置要保持唯一，避免 web 侧和 provider 侧重复拼接
- 历史消息读取后要保持同样的组装规则

**task 建议**：
- 建议 task 名：`multimodal-input-assembly-v0.1.6`
- 是否进入 x-req：是
- 原因：Phase 1 图片能力依赖它，职责已经清晰

### 模块 5：provider-media-adapters

**职责**：把统一多模态输入映射到具体 provider 格式。

**包含范围**：
- OpenAI-compatible chat content 中的 image block 映射
- Anthropic messages content 中的 image block 映射
- 图片大小、数量、mime 兼容性校验
- provider 不支持图片时的显式失败和用户提示

**后续范围**：
- 视频原生输入适配
- provider 能力探测和降级策略

**依赖**：
- `multimodal-assembly`
- `executors/llm/base.py`
- `executors/llm/anthropic_messages.py`

**风险与讨论点**：
- 各 provider 对图片输入字段和大小预算不同
- 统一的内部模型需要先于 provider 适配落地
- 降级行为要稳定，避免 silent fallback

**task 建议**：
- 建议 task 名：`provider-media-adapters-v0.1.6`
- 是否进入 x-req：是
- 原因：图片路径已足够清晰，适合在 assembly 之后进入开发

### 模块 6：video-processing-pipeline

**职责**：建立视频发送后的处理链。

**包含范围**：
- 视频上传后的异步处理任务
- 转码、抽帧、音频分离、转写、摘要
- 处理状态回写到附件 metadata
- 前端读取任务状态并展示处理中、完成、失败

**后续范围**：
- 视频原生多模态请求
- 关键帧检索、片段引用、时间轴预览

**依赖**：
- `media-upload-shell`
- `attachment-contract`
- 未来的异步任务执行器

**风险与讨论点**：
- 时长上限、磁盘占用、CPU 开销需要先锁定
- 同步发送体验和异步处理结果之间需要状态模型
- provider 直接吃视频和“视频转摘要再消费”两条路径都存在，需要独立评估

**task 建议**：
- 建议 task 名：`video-processing-pipeline-v0.1.6`
- 是否进入 x-req：否
- 原因：处理任务模型、资源预算、provider 策略还在探索
