# whiteboard-note-area Task Map

| 模块 | 建议 task 名 | 是否创建 task | 前置依赖 | 当前状态 |
|---|---|---|---|---|
| whiteboard-card-storage | `web-whiteboard-card-storage` | 是 | 无 | 可进入 x-req |
| whiteboard-card-sync | `web-whiteboard-card-sync` | 是 | `web-whiteboard-card-storage` | 可进入 x-req |
| whiteboard-layout-shell | `web-whiteboard-layout-shell` | 是 | `web-whiteboard-card-sync` | 可进入 x-req |
| whiteboard-card-interaction | `web-whiteboard-card-interaction` | 是 | `web-whiteboard-card-sync` | 可进入 x-req |
| 进阶能力：多端实时同步 | `web-whiteboard-live-sync` | 否 | 需要版本冲突策略 | 方案层 |
| 进阶能力：卡片关系线与分组 | `web-whiteboard-links-and-groups` | 否 | 需要额外交互定义 | 方案层 |
| 进阶能力：无限画布/缩放 | `web-whiteboard-infinite-canvas` | 否 | 需要重做坐标与视口模型 | 方案层 |
