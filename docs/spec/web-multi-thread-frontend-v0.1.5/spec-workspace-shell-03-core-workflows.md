# workspace-shell 核心流程

## 1. 进入工作区

1. 用户在左侧选择一个 thread
2. `ChatPage` 读取 `ThreadMetadataDTO`
3. `workspace-context-store` 解析 `workspaceRoot`
4. 主区域默认进入 `Chat` tab
5. Files / Git / Shell 读取同一个 `workspaceRoot`

## 2. 切换到 Files 查看目录

1. 用户点击 `Files`
2. 前端读取 `workspaceRoot`
3. 调 `GET /api/threads/{id}/workspace/context`
4. 调 `GET /api/threads/{id}/workspace/tree?path=/`
5. 渲染树形目录
6. 用户点击文件
7. 调 `GET /api/threads/{id}/workspace/file?path=...`
8. 右侧编辑器侧栏打开

## 3. 切换到 Git 查看仓库状态

1. 用户点击 `Git`
2. 前端调 `GET /api/threads/{id}/workspace/git/status`
3. 若 workspace 内存在 repo，则渲染 `changes` 视图
4. 若不存在 repo，则显示空态
5. 用户点击某个文件 diff
6. 前端调 `GET /api/threads/{id}/workspace/git/diff?path=...`

## 4. 切换到 Shell 执行命令

1. 用户点击 `Shell`
2. 前端连 `WS /ws/workspace-shell?thread_id=...`
3. 后端建立 PTY shell session
4. 前端显示启动输出与 prompt
5. 用户输入命令
6. 后端持续推流 stdout/stderr
7. 用户离开 Shell tab 时会话保持存活
8. thread 切换或手动关闭时 session 回收

## 5. 聊天与文件联动

1. 聊天工具结果里出现文件路径
2. 用户点击文件路径
3. 前端切换 `activeTab = files`
4. 文件树展开目标路径的父目录
5. 文件编辑器直接打开目标文件

## 6. 参考点与偏离点

### 参考 `ccui` 的部分

- 主内容区多 tab 壳层
- 文件树搜索和目录展开体验
- Git 面板三视图结构
- Shell 作为独立主面板

### 本方案主动偏离的部分

- `ccui` 从 `selectedProject` 驱动，当前方案从 `thread + workspaceRoot` 驱动
- `ccui` 把聊天、文件、Git、Shell 放在同一个 project shell 下，当前方案把它们挂在 thread 下
- `ccui` 还带 tasks/plugin，当前方案首版先收窄到四 tab
