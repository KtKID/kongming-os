# web-media-input-v0.1.6

> 类型：`web-multi-thread-frontend-v0.1.5` 补充方案
> 状态：方案确认中
> 目标：给浏览器宿主增加图片发送能力，并建立同一条资产上传链路上的视频发送演进方案

## 系统目标

- 让 Web chat 支持图片粘贴、图片选择、图片预览、图片发送、图片历史回显
- 让后端持久化图片资产和附件引用，让 thread 历史、刷新重连、后续原生客户端都消费同一份附件模型
- 让图片输入进入 provider 的多模态请求，复用现有 runtime / session / protocol 主链
- 让视频发送走同一条 `upload-first + asset-ref` 资产链路，在后续阶段接入转码、抽帧、转写和摘要

## 范围边界

### 本阶段范围

- 浏览器侧图片粘贴、文件选择、缩略图预览、删除单张、发送
- `POST /api/uploads/images` 上传接口和本地磁盘资产存储
- `user.input.attachments[]` 协议扩展，WS 只发送附件引用和展示元数据
- user 历史消息持久化附件引用，前端历史回显缩略图
- OpenAI-compatible / Anthropic provider 的图片 content block 适配
- 视频发送的统一资产模型、上传入口、任务状态模型、处理流水线预留

### 后续阶段范围

- 视频直传后立即进入模型推理
- 通用文件发送（PDF / 音频 / 其它二进制）
- 对象存储、CDN、跨机器共享资产目录
- 图片编辑、批注、圈选、局部 OCR
- 移动端拍照和相册权限交互

## 阶段结论

### Phase 1：图片发送落地

- 传输方案：`upload-first + attachment refs`
- 历史模型：`Message.metadata.attachments[]`
- provider 输入：图片 block + 文本同轮组装
- x-req 准入：已满足

### Phase 2：视频发送演进

- 传输方案：沿用 `upload-first + attachment refs`
- 模型消费：优先走转写、抽帧、摘要，再决定是否直连原生视频输入
- x-req 准入：等待处理流水线、时长限制、provider 能力三项约束锁定

## 模块导航

| 模块 | 状态 | 文档 | 是否可进 task | 说明 |
|---|---|---|---|---|
| media-composer | 方案确认 | [模块拆分 §1](./spec-media-input-02-module-breakdown.md#模块-1media-composer) | 是 | 粘贴、选图、预览、发送、历史 UI |
| media-upload-shell | 方案确认 | [模块拆分 §2](./spec-media-input-02-module-breakdown.md#模块-2media-upload-shell) | 是 | 上传 API、资产落盘、缩略图读取 |
| attachment-contract | 方案确认 | [模块拆分 §3](./spec-media-input-02-module-breakdown.md#模块-3attachment-contract) | 是 | WS / REST / session 附件契约 |
| multimodal-assembly | 方案确认 | [模块拆分 §4](./spec-media-input-02-module-breakdown.md#模块-4multimodal-assembly) | 是 | 本轮输入组装、历史回放、附件注入 |
| provider-media-adapters | 方案确认 | [模块拆分 §5](./spec-media-input-02-module-breakdown.md#模块-5provider-media-adapters) | 是 | OpenAI / Anthropic 图片输入适配 |
| video-processing-pipeline | 探索中 | [模块拆分 §6](./spec-media-input-02-module-breakdown.md#模块-6video-processing-pipeline) | 否 | 转码、抽帧、转写、摘要 |

## 文档导航

- [模块拆分](./spec-media-input-02-module-breakdown.md)
- [核心流程](./spec-media-input-03-core-workflows.md)
- [数据与状态](./spec-media-input-04-data-and-state.md)
- [Task 映射](./spec-media-input-90-task-map.md)

## 当前建议

1. 先把图片发送拆成 5 个可开发模块，直接进入 x-req
2. 先交付图片发送全链路，再把视频发送推进到处理流水线
3. 继续把视频模块留在方案层，等时长上限、处理任务模型、provider 消费策略一起锁定

## 输出结论

- 这个系统应该拆分
- 推荐拆成 6 个模块
- 适合先进入 x-req 的模块有 5 个：`media-composer`、`media-upload-shell`、`attachment-contract`、`multimodal-assembly`、`provider-media-adapters`
- 继续停留在方案层的模块有 1 个：`video-processing-pipeline`
- 方案文档保存路径：`docs/web-multi-thread-frontend-v0.1.5/spec-media-input-*.md`
