# whiteboard-note-area 核心流程

## 1. 打开聊天工作台

1. 用户进入 `/chat/:thread_id`
2. 页面继续建立现有聊天 WS 连接
3. 页面并行请求 `GET /api/whiteboard`
4. 前端把白板标题和卡片列表写入 `useWhiteboardStore`
5. 右侧渲染白板容器和卡片绝对定位布局

## 2. 新建卡片

1. 用户点击白板顶部或空白区的新建入口
2. 前端弹出最小表单，填写标题和类别
3. 调用 `POST /api/whiteboard/cards`
4. 后端在 `workspace/whiteboard/cards/` 创建新的 markdown 文件
5. 后端更新 `board.json`
6. 前端把新卡片插入白板，并放在默认坐标

## 3. 编辑卡片内容

1. 用户打开卡片编辑态
2. 修改 markdown 内容
3. 前端本地标记 `dirty=true`
4. debounce 到期后调用 `PUT /api/whiteboard/cards/{card_id}`
5. 后端原子写入对应 markdown 文件
6. 前端清除保存中状态

## 4. 拖动卡片位置

1. 用户拖住卡片头部
2. 前端只更新内存中的 `x/y`
3. 松手后触发节流保存 `PATCH /api/whiteboard/layout`
4. 后端仅更新 `board.json` 中的坐标
5. 刷新页面后恢复到同样位置

## 5. 调整卡片高度

1. 用户拖动卡片底边 resize handle
2. 前端实时更新卡片外框高度
3. 内容区继续保持内部滚动
4. 松手后保存新的 `height`

## 6. 折叠和展开卡片

1. 用户点击卡片头部折叠按钮
2. 前端切换 `collapsed`
3. 折叠态只保留头部和最小高度
4. 状态写回 `board.json`

## 7. 删除卡片

1. 用户点击删除
2. 前端二次确认
3. 后端删除 `cards/<file>.md`
4. 后端从 `board.json` 移除对应卡片
5. 前端更新白板状态
