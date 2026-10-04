# workspace-shell 模块拆分

## 模块总览

| 模块 | 职责 | 主要依赖 | 状态 | 备注 |
|---|---|---|---|---|
| workspace-shell-layout | 提供 `Chat / Files / Git / Shell` 顶层壳层与 tab 切换 | `workspace-context-store` | 方案确认 | 前端入口 |
| workspace-context-store | 保存当前 thread/workspace/tab/打开文件/shell 会话状态 | `threads`、`chat` | 方案确认 | 状态单一真源 |
| workspace-files | 文件树、文件内容读取、保存、重命名、删除、上传 | `workspace-backend-shared` | 方案确认 | “切到目录查看”核心模块 |
| workspace-git | 仓库状态、diff、历史、分支、提交 | `workspace-backend-shared` | 方案确认 | 与文件面板联动 |
| workspace-shell | Shell 会话建立、输出流、输入、退出、重连 | `workspace-backend-shared` | 方案确认 | 独立 WS 协议 |
| workspace-backend-shared | 路由、仓库发现、工作区校验、路径边界 | `thread_metadata` | 方案确认 | 后端共享层 |

## 模块 1：workspace-shell-layout

**职责**：

- 在现有 `ChatPage` 主区域上方增加统一 tab header
- 提供 `Chat / Files / Git / Shell` 四 tab 切换
- 让 `ClaudeCodeView` 与 `MessageList` 共用同一个壳层
- 保持右侧白板继续可收起、可共存

**包含范围**：

- `Chat.tsx` 主区域壳层重构
- `WorkspaceTabs` 组件
- `MainPanelHeader` 组件
- 主区域空态 / 加载态

**不包含范围**：

- 文件树具体逻辑
- Git 业务逻辑
- Shell 业务逻辑

**参考点**：

- `ccui` 的 `MainContent.tsx` 四类主面板切换

**自有方案**：

- 保留当前 thread 路由与白板侧栏
- 不引入 `tasks/plugin` tab

## 模块 2：workspace-context-store

**职责**：

- 把当前工作区上下文组织成一个单一 store
- 统一管理 `threadId / workspaceRoot / activeTab / openedFile / shellSession`
- 在 thread 切换时同步刷新 Files / Git / Shell 的上下文

**包含范围**：

- `useWorkspaceStore`
- 当前 workspace root 解析规则
- tab 持久化规则
- open file / active diff / shell active session 状态

**不包含范围**：

- 聊天消息 store
- 白板内容 store

**参考点**：

- `ccui` 的 `selectedProject + selectedSession + activeTab`

**自有方案**：

- 用 `thread` 做宿主身份
- 用 `workspaceRoot` 做文件系统身份
- 用一个 store 聚合，不引入第二套 `project/session` 概念

## 模块 3：workspace-files

**职责**：

- 让用户切换到 Files tab 浏览目录、搜索文件、查看文件内容
- 提供文本文件编辑与保存
- 提供基础文件操作

**包含范围**：

- 文件树
- 文件内容只读预览
- 文本文件编辑与保存
- 目录展开/折叠
- 创建文件/目录
- 删除、重命名、上传

**不包含范围**：

- 富文本编辑
- 二进制高级预览
- 图片画廊

**参考点**：

- `ccui` 的 `FileTree` 搜索、展开祖先目录、树形操作

**自有方案**：

- 首版把编辑器做成右侧侧栏，减少主区域布局变化
- 首版先覆盖文本文件，二进制走只读提示

**更优方案对比**：

| 方案 | 优点 | 代价 | 结论 |
|---|---|---|---|
| `ccui` 式“文件树 + 独立编辑器侧栏” | 认知稳定，扩展容易 | 组件更多 | 推荐 |
| 单屏文件树点击后整页替换成内容 | 实现更快 | 切换成本高，丢失目录上下文 | 不推荐 |

## 模块 4：workspace-git

**职责**：

- 展示当前 workspace 对应 git repo 的状态
- 支持变更查看、diff、历史、分支与安全写操作

**包含范围**：

- `changes / history / branches` 三视图
- stage / unstage
- commit
- fetch / pull / push
- 受保护的 discard

**不包含范围**：

- rebase
- merge conflict editor
- interactive staging

**参考点**：

- `ccui` 的 `GitPanel` 三视图结构

**自有方案**：

- 初版把高风险动作缩到最少
- 所有 destructive 动作走明确确认

**更优方案对比**：

| 方案 | 优点 | 代价 | 结论 |
|---|---|---|---|
| 三视图 `changes/history/branches` | 能力完整，结构清楚 | 面板稍复杂 | 推荐 |
| 只做变更列表 | 实现最快 | 覆盖面不足 | 可做最小 MVP 子集 |

## 模块 5：workspace-shell

**职责**：

- 给当前 workspace 提供可持续交互的 shell 面板
- 处理输入、输出、退出、重连和历史滚动

**包含范围**：

- shell session 建立
- stdout/stderr 流
- 用户输入
- 退出码
- reconnect / resume

**不包含范围**：

- 多标签 shell
- 终端复用池

**参考点**：

- `ccui` 的 `StandaloneShell` 作为独立面板容器

**架构差异**：

- `ccui` 已有 shell runtime
- `kongming-agent` 当前只有工具层 `run_shell`，没有用户可见终端协议

**更优方案对比**：

| 方案 | 优点 | 代价 | 结论 |
|---|---|---|---|
| 独立 `WS + PTY` shell 面板 | 语义完整，用户预期稳定 | 后端实现较多 | 推荐 |
| 基于 `run_shell` 的命令执行面板 | 实现很快 | 交互性弱，覆盖面有限 | 适合临时 MVP，不适合最终壳层 |

## 模块 6：workspace-backend-shared

**职责**：

- 为 Files / Git / Shell 提供统一的 workspace 解析与边界校验
- 负责从 thread metadata 中得到 `workspaceRoot`
- 负责 repo 发现与能力判断

**包含范围**：

- `thread -> workspaceRoot` 解析
- 路径归一化与越界校验
- git repo 发现
- 能力探测 `files/git/shell`
- 路由层错误模型

**不包含范围**：

- 聊天 WS 协议
- 白板存储

**自有方案**：

- 路由前缀全部挂在 `thread` 下，避免再造一套 project id
- 让 Web 能力与 thread metadata 对齐

## 依赖顺序

1. `workspace-context-store`
2. `workspace-backend-shared`
3. `workspace-shell-layout`
4. `workspace-files`
5. `workspace-git`
6. `workspace-shell`
