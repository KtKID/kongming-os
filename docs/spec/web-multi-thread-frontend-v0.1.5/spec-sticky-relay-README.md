# whiteboard-note-area（web 补充方案）

> 状态：方案确认
> 目标：在现有聊天页右侧增加一个“白板”区域，白板里摆放多个可拖拽的 markdown 卡片

## 系统目标

- 让聊天页从“消息流 + 侧栏”升级成“消息流 + 白板工作区”
- 右侧是一个命名明确的 `白板` 区域，里面钉着很多卡片
- 一个卡片对应一个 markdown 文件，卡片内部承载多条独立清单、备注或结构化小段
- 卡片支持自由拖动位置、折叠缩小、展开查看、拖动外框高度
- 新建卡片时在当前 workspace 创建独立目录与独立 markdown 文件

## 范围边界

**包含**：
- `ChatPage` 升级为三栏工作台：左侧 thread、中间消息流、右侧白板
- 白板区域顶部有标题，默认名为 `白板`
- 卡片自由拖动位置，拖动范围限制在右侧白板容器内
- 卡片支持折叠、展开、缩小、调整外框高度
- 卡片内部内容区滚动，内容格式为 markdown
- 卡片顶部可编辑标题，并可填写类别名，例如 `note`、`todo`、`detail`、`bug`
- 每个卡片一个 markdown 文件
- workspace 内创建专用目录保存白板索引和卡片 markdown 文件

**不包含**：
- 多人协作
- 跨浏览器实时同步
- 富文本编辑器
- AI 自动生成卡片内容
- 自由连接线、图形绘制、无限画布缩放

## 模块导航

| 模块 | 状态 | 文档 | 是否可进 task | 说明 |
|---|---|---|---|---|
| whiteboard-layout-shell | 方案确认 | [模块拆分 §1](./spec-sticky-relay-02-module-breakdown.md#模块-1whiteboard-layout-shell) | 是 | 右侧白板区域、画布容器、三栏布局 |
| whiteboard-card-storage | 方案确认 | [模块拆分 §2](./spec-sticky-relay-02-module-breakdown.md#模块-2whiteboard-card-storage) | 是 | workspace 目录、board 索引、单卡 markdown 文件 |
| whiteboard-card-interaction | 方案确认 | [模块拆分 §3](./spec-sticky-relay-02-module-breakdown.md#模块-3whiteboard-card-interaction) | 是 | 拖拽、折叠、调高、滚动、命名 |
| whiteboard-card-sync | 方案确认 | [模块拆分 §4](./spec-sticky-relay-02-module-breakdown.md#模块-4whiteboard-card-sync) | 是 | REST 接口、store、自动保存、布局持久化 |

## 文档导航

- [模块拆分](./spec-sticky-relay-02-module-breakdown.md)
- [核心流程](./spec-sticky-relay-03-core-workflows.md)
- [数据与状态](./spec-sticky-relay-04-data-and-state.md)
- [Task 映射](./spec-sticky-relay-90-task-map.md)

## 第一版推荐形态

- 页面结构采用 `24rem / minmax(0,1fr) / minmax(24rem, 32rem)` 三栏
- 右侧区域标题明确显示 `白板`
- 白板容器内部使用绝对定位卡片
- 卡片头部包含：
  - 可编辑标题
  - 可编辑类别标签
  - 折叠/展开按钮
  - 新建卡片入口
- 卡片本体包含：
  - 可调整高度的外框
  - 内部滚动区
  - markdown 内容预览与编辑态
- 第一版优先做桌面端交互，保证拖拽、缩放、滚动不打架

## 当前建议

1. 这个需求应该拆分，推荐按 4 个模块推进
2. 第一版直接做“右侧白板 + 多卡片自由摆放”，产品方向已经明确
3. 存储改为当前 workspace 下的专用目录，卡片一文件，布局单独存索引
4. 第一版先做样式、拖拽、折叠、改高、保存链路，卡片间关系和协作能力继续留在后续版本
5. `whiteboard-layout-shell`、`whiteboard-card-storage`、`whiteboard-card-interaction`、`whiteboard-card-sync` 四个模块都已具备进入 x-req 的条件
