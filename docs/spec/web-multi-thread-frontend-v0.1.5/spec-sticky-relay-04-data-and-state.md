# whiteboard-note-area 数据与状态

## 1. 推荐目录结构

```text
<workspace>/
└── whiteboard/
    ├── board.json
    └── cards/
        ├── card-product-note-a1b2.md
        ├── card-todo-c3d4.md
        └── card-bug-e5f6.md
```

## 2. `board.json` 建议结构

```json
{
  "schema_version": 1,
  "board_title": "白板",
  "updated_at": 1777600000.0,
  "cards": [
    {
      "id": "card-a1b2",
      "title": "发版前检查",
      "category": "todo",
      "file_name": "card-todo-a1b2.md",
      "x": 24,
      "y": 32,
      "width": 320,
      "height": 260,
      "collapsed": false,
      "z_index": 1
    }
  ]
}
```

## 3. 存储原则

- 一个卡片对应一个 markdown 文件
- 卡片内容只存在 `.md` 文件
- 卡片位置、尺寸、折叠态、标题、类别存在 `board.json`
- 删除卡片时同时删除索引和 markdown 文件
- 用户在 workspace 直接编辑 markdown 文件后，前端刷新应读取最新文件内容

## 4. REST 契约建议

### `GET /api/whiteboard`

返回：

- `board_title`
- `updated_at`
- `cards[]`
- 每张卡的 `content`

### `POST /api/whiteboard/cards`

请求体建议字段：

- `title`
- `category`
- `content`
- `x`
- `y`
- `height`

### `PUT /api/whiteboard/cards/{card_id}`

请求体建议字段：

- `title`
- `category`
- `content`
- `expected_updated_at`

### `PATCH /api/whiteboard/layout`

请求体建议字段：

- `board_title`
- `cards: [{ id, x, y, width, height, collapsed, z_index }]`

## 5. 前端状态建议

```ts
interface WhiteboardCardState {
  id: string;
  title: string;
  category: string;
  content: string;
  fileName: string;
  x: number;
  y: number;
  width: number;
  height: number;
  collapsed: boolean;
  zIndex: number;
  dirtyContent: boolean;
  dirtyLayout: boolean;
  saving: boolean;
  error?: string;
  updatedAt: number;
}
```

白板状态建议独立于聊天 store：

- `boardTitle`
- `cards[]`
- `selectedCardId`
- `draggingCardId`
- `resizingCardId`

## 6. markdown 规则建议

第一版支持以下语法就够用：

- 标题 `#` `##`
- 段落
- 列表
- task-list `- [ ]` / `- [x]`
- 代码块
- 行内代码
- 粗体 / 斜体
- 链接

卡片内部“多条独立清单信息”的推荐写法：

- 用多个二级标题分段
- 每段下用 task-list 或普通列表
- 一张卡片承载一个主题文件，文件内部允许多个清单块

## 7. 交互约束建议

- 拖动只允许在白板区域内
- 改高最小值建议 `120px`
- 折叠态高度建议 `48px ~ 60px`
- 卡片内容区始终内部滚动
- 拖动热区放在头部，改高热区放在底边，正文区域只负责滚动和编辑

## 8. 视觉建议

- 白板背景比主界面略深或略暖，形成独立工作区感
- 卡片用便签纸语言：浅黄、浅粉、浅绿、浅蓝等低饱和色
- 卡片头部类别可以做成小 label
- 卡片阴影轻，边框柔和，避免做成厚重 kanban
