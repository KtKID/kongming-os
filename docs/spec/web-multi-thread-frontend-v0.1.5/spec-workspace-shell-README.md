# workspace-shell（web 工作区壳层补充方案）

> 状态：方案确认
> 目标：把当前 `Chat` 页面升级成 `Chat / Files / Git / Shell` 四 tab 的工作区壳层，在保持 thread 主模型不变的前提下，补齐文件浏览、仓库变更查看、命令执行三类高频能力。

## 系统目标

- 让 `kongming-agent` 的 Web 从“对话页”升级成“工作区页”
- 保持当前 `thread` 作为对话身份与运行时身份
- 给每个 thread 绑定一个清晰的 `workspace root`
- 在主内容区提供 `Chat / Files / Git / Shell` 四个一等 tab
- 用最小可行的状态树和路由合同覆盖高频工作流

## 第一性原理

- 用户当前关注的是一个工作区，而不是一组松散面板
- `thread` 表达“这次对话和运行时是谁”
- `workspace` 表达“这次读写和查看发生在哪个目录”
- 面板能力围绕 `workspace` 组织，消息能力围绕 `thread` 组织
- 主内容区同一时刻承载一个主任务面板，右侧继续保留白板能力
- 初版优先覆盖高频读取、查看、轻量修改与命令执行

## 参考输入

本方案全面参考了 `claudecodeui` 的工作台结构，重点看了这些文件：

- [/Volumes/machub_app/proj/claudecodeui/src/components/main-content/view/MainContent.tsx](/Volumes/machub_app/proj/claudecodeui/src/components/main-content/view/MainContent.tsx)
- [/Volumes/machub_app/proj/claudecodeui/src/components/file-tree/view/FileTree.tsx](/Volumes/machub_app/proj/claudecodeui/src/components/file-tree/view/FileTree.tsx)
- [/Volumes/machub_app/proj/claudecodeui/src/components/git-panel/view/GitPanel.tsx](/Volumes/machub_app/proj/claudecodeui/src/components/git-panel/view/GitPanel.tsx)
- [/Volumes/machub_app/proj/claudecodeui/src/components/standalone-shell/view/StandaloneShell.tsx](/Volumes/machub_app/proj/claudecodeui/src/components/standalone-shell/view/StandaloneShell.tsx)

## 架构差异

`ccui` 的主模型是 `selectedProject + selectedSession + activeTab`。  
`kongming-agent` 当前主模型是 `thread + backend_kind + claude_thread_id + codex_thread_id + cwd`，代码依据在：

- [web/src/pages/Chat.tsx](/Volumes/machub_app/proj/kongming-agent/web/src/pages/Chat.tsx)
- [src/web/thread_metadata.py](/Volumes/machub_app/proj/kongming-agent/src/web/thread_metadata.py)
- [web/src/protocol.ts](/Volumes/machub_app/proj/kongming-agent/web/src/protocol.ts)

这个差异带来一个关键决策：

- `ccui` 适合 project-first 壳层
- `kongming-agent` 适合 thread-first workspace 壳层

## 方案结论

推荐采用 `thread-first workspace shell`：

- 左侧继续保持 thread / Claude session 入口
- 中间主内容区加入 `Chat / Files / Git / Shell` 顶部 tab
- 当前 thread 解析出一个 `workspace root`
- Files / Git / Shell 全部围绕当前 thread 的 `workspace root` 工作
- 右侧白板继续是 workspace 级侧栏

## 参考方案 vs 自有方案

| 主题 | `ccui` 做法 | 本方案 | 结论 |
|---|---|---|---|
| 主内容区 tab | `chat/files/shell/git/tasks/plugin` | `chat/files/git/shell` | 参考结构，收窄首版范围 |
| 主上下文键 | `selectedProject + selectedSession` | `threadId + workspaceRoot + activeTab` | 采用自有方案 |
| 文件树搜索 | 本地内存即时过滤 + 自动展开祖先目录 | 同样采用 | 直接复用交互思想 |
| 编辑器侧栏 | 文件树与编辑器联动 | 首版保留右侧文件预览/编辑侧栏 | 参考结构，降低功能面 |
| Git 面板 | `changes/history/branches` 三视图 | 同样保留三视图 | 参考结构，缩小动作范围 |
| Shell 面板 | 独立 shell 容器 | 独立 shell WS/PTY 容器 | 参考目标，重做传输层 |
| 插件 / tasks | 首屏即支持 | 后续版本进入 | 延后 |
| 白板 | 无 | 保留现有白板 | 自有能力 |

## 包含范围

- `Chat / Files / Git / Shell` 四 tab 主壳层
- workspace context store
- 文件树浏览、搜索、展开、文件读取、文本编辑保存
- Git 状态、diff、历史、分支的只读与安全写操作
- Shell 面板的独立传输协议和运行时生命周期

## 暂不包含

- 多工作区项目列表页
- 插件 tab
- tasks 面板
- 图片高级预览器
- 二进制文件编辑
- Git rebase / cherry-pick / merge 冲突解决
- Shell 多标签页

## 模块导航

| 模块 | 状态 | 文档 | 是否可进 task | 说明 |
|---|---|---|---|---|
| workspace-shell-layout | 方案确认 | [模块拆分 §1](./spec-workspace-shell-02-module-breakdown.md#模块-1workspace-shell-layout) | 是 | 四 tab 壳层、头部、主区域布局 |
| workspace-context-store | 方案确认 | [模块拆分 §2](./spec-workspace-shell-02-module-breakdown.md#模块-2workspace-context-store) | 是 | thread-first workspace 状态树 |
| workspace-files | 方案确认 | [模块拆分 §3](./spec-workspace-shell-02-module-breakdown.md#模块-3workspace-files) | 是 | 文件树、文件内容、保存链路 |
| workspace-git | 方案确认 | [模块拆分 §4](./spec-workspace-shell-02-module-breakdown.md#模块-4workspace-git) | 是 | status / diff / history / branches |
| workspace-shell | 方案确认 | [模块拆分 §5](./spec-workspace-shell-02-module-breakdown.md#模块-5workspace-shell) | 是 | shell session、WS/PTY 协议 |
| workspace-backend-shared | 方案确认 | [模块拆分 §6](./spec-workspace-shell-02-module-breakdown.md#模块-6workspace-backend-shared) | 是 | 路由、路径约束、repo 发现、权限边界 |

## 文档导航

- [模块拆分](./spec-workspace-shell-02-module-breakdown.md)
- [核心流程](./spec-workspace-shell-03-core-workflows.md)
- [数据与状态](./spec-workspace-shell-04-data-and-state.md)
- [Task 映射](./spec-workspace-shell-90-task-map.md)

## 当前建议

1. 先做 `workspace-shell-layout + workspace-context-store`，把主壳层定住。
2. 第二步做 `workspace-files`，先拿到“切换到文件目录查看”的完整闭环。
3. 第三步并行评估 `workspace-git` 与 `workspace-shell`，前者优先级略高。
4. Shell 面板首版直接采用独立 WS/PTY 方案，覆盖率最高，用户心智最稳定。
