# whiteboard-note-area 模块拆分

## 模块总览

| 模块 | 职责 | 依赖 | 状态 | 备注 |
|---|---|---|---|---|
| whiteboard-layout-shell | 三栏工作台和右侧白板容器 | `ChatPage`、`Layout`、thread 路由 | 方案确认 | 主改动在页面结构和白板画布 |
| whiteboard-card-storage | workspace 级白板目录和卡片文件存储 | 新 router、workspace 路径解析 | 方案确认 | 一卡一 markdown |
| whiteboard-card-interaction | 卡片交互与视觉 | 拖拽库或自实现 pointer 逻辑 | 方案确认 | 拖拽、折叠、改高是核心 |
| whiteboard-card-sync | store、REST、自动保存、布局持久化 | 协议 DTO、`lib/api.ts` | 方案确认 | 内容和布局分开保存 |

## 模块详情

### 模块 1：whiteboard-layout-shell

**职责**：把当前聊天页升级成带右侧白板的工作台布局。

**包含范围**：
- `web/src/pages/Chat.tsx` 的三栏重组
- 右侧白板标题区和工具栏
- 白板滚动容器、边界、背景风格
- 消息流区域与白板区域的并存布局

**不包含范围**：
- 卡片存储
- 卡片内容保存
- 拖拽算法细节

**依赖**：
- 现有 `ThreadList`、`MessageList`、`Composer`
- 新增 `WhiteboardPanel`

**风险与讨论点**：
- 白板区域要足够宽，避免卡片操作拥挤
- 中央消息区滚动和白板交互需要隔离
- 白板容器需要稳定的定位上下文

**task 建议**：
- 建议 task 名：`web-whiteboard-layout-shell`
- 是否进入 x-req：是
- 原因：布局结果已明确，目标可直接开发

### 模块 2：whiteboard-card-storage

**职责**：在当前 workspace 为白板和卡片提供持久化目录结构。

**包含范围**：
- `workspace/whiteboard/board.json`
- `workspace/whiteboard/cards/*.md`
- 创建卡片时生成 markdown 文件
- 删除卡片时删除对应文件
- 白板索引保存卡片标题、类别、位置、高度、折叠态、文件名

**不包含范围**：
- thread 元数据目录
- 全局知识库整合
- 二进制附件

**依赖**：
- workspace 根路径解析能力
- 新增 `src/web/routers/whiteboard.py`

**风险与讨论点**：
- workspace 白板是工作区级，不是 thread 级，需要和现有 thread 概念明确分层
- 文件名生成要稳定，建议用 slug + 短 id
- 用户手动改动 markdown 文件后，前端刷新要能读到最新内容

**task 建议**：
- 建议 task 名：`web-whiteboard-card-storage`
- 是否进入 x-req：是
- 原因：目录结构和落盘模型已经足够清晰

### 模块 3：whiteboard-card-interaction

**职责**：实现卡片的直接操作体验。

**包含范围**：
- 卡片拖动位置
- 卡片折叠缩小和展开
- 卡片外框高度拖动
- 卡片内部滚动区
- 顶部标题与类别编辑
- 新建卡片、删除卡片入口

**不包含范围**：
- 卡片内容保存接口
- 协同编辑
- 无限画布和缩放手势

**依赖**：
- `whiteboard-card-sync`
- markdown 渲染组件

**风险与讨论点**：
- 拖动、改高、内部滚动是三个不同手势，需要清晰分区
- 折叠态需要有一致的最小卡片高度
- 卡片过多时需要考虑遮挡和层级

**task 建议**：
- 建议 task 名：`web-whiteboard-card-interaction`
- 是否进入 x-req：是
- 原因：交互集合明确，适合单独拆任务推进

### 模块 4：whiteboard-card-sync

**职责**：连接前端白板状态和 workspace 文件存储。

**包含范围**：
- `GET /api/whiteboard`
- `POST /api/whiteboard/cards`
- `PUT /api/whiteboard/cards/{card_id}`
- `PATCH /api/whiteboard/layout`
- 独立 `useWhiteboardStore`
- 内容 autosave
- 布局变更节流保存

**不包含范围**：
- WebSocket 多端同步
- 冲突自动合并
- 离线缓存

**依赖**：
- `whiteboard-card-storage`
- `web/src/protocol.ts`
- `web/src/lib/api.ts`

**风险与讨论点**：
- 卡片拖动过程不能高频直写磁盘，需要节流
- 内容保存和布局保存是两条不同链路
- 新建卡片后的默认位置要避免重叠

**task 建议**：
- 建议 task 名：`web-whiteboard-card-sync`
- 是否进入 x-req：是
- 原因：接口分层与前端状态模型都已明确
