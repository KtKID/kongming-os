# Task Map

| 模块 | 建议 task 名 | 是否创建 task | 前置依赖 | 当前状态 |
|---|---|---|---|---|
| media-composer | `web-media-composer-v0.1.6` | 是 | `web-attachment-contract-v0.1.6`, `web-media-upload-shell-v0.1.6` | 方案确认 |
| media-upload-shell | `web-media-upload-shell-v0.1.6` | 是 | `web-app-shell-v0.1.5`, `thread-manager-v0.1.5` | 方案确认 |
| attachment-contract | `web-attachment-contract-v0.1.6` | 是 | `ws-protocol-v0.1.5` | 方案确认 |
| multimodal-assembly | `multimodal-input-assembly-v0.1.6` | 是 | `web-attachment-contract-v0.1.6` | 方案确认 |
| provider-media-adapters | `provider-media-adapters-v0.1.6` | 是 | `multimodal-input-assembly-v0.1.6` | 方案确认 |
| video-processing-pipeline | `video-processing-pipeline-v0.1.6` | 否 | `web-media-upload-shell-v0.1.6`, `web-attachment-contract-v0.1.6` | 探索中 |

## 推荐推进顺序

1. `web-attachment-contract-v0.1.6`
2. `web-media-upload-shell-v0.1.6`
3. `web-media-composer-v0.1.6`
4. `multimodal-input-assembly-v0.1.6`
5. `provider-media-adapters-v0.1.6`
6. `video-processing-pipeline-v0.1.6`

## x-req 准入结论

### 适合立刻进入 x-req

- `web-attachment-contract-v0.1.6`
- `web-media-upload-shell-v0.1.6`
- `web-media-composer-v0.1.6`
- `multimodal-input-assembly-v0.1.6`
- `provider-media-adapters-v0.1.6`

### 继续停留在方案层

- `video-processing-pipeline-v0.1.6`

原因：

- 图片发送链路的边界、协议、持久化和 provider 入口已经稳定
- 视频发送的资产接入方向已经稳定，处理任务模型和资源预算还需要单独锁定
