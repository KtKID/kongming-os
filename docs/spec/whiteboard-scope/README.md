# 白板 Scope 双作用域

> 状态：方案确认（v2，2026-05-15 修订）
> 目标：白板支持 project / global 双 scope，根目录搬到 `<kongming_home>/whiteboard/`，架构补 WhiteboardManager 层

## 系统目标

当前白板数据写到 server 启动时的 `Path.cwd() / whiteboard/`，全部 thread 共享同一份卡片——用户在不同项目切换时看到无关卡片。需要：

1. **白板根目录搬到 `<kongming_home>/whiteboard/`**（统一在 `.kongming/` 下管理，不再散落到每个项目 cwd）
2. **卡片按 scope 隔离**：
   - `global` 卡片所有项目可见，位置/布局全局共享
   - `project` 卡片按 `cwd` 隔离，目录名用 whiteboard 自有的 `encode_project_dir()`（`<basename-slug>-<sha256[:8]>`，可读 + 唯一 + 路径派生）
3. **架构补层**：引入 `WhiteboardManager` 作 router 与 store 之间的唯一入口

## 最小可用路径

切到 thread → 前端 `GET /api/threads/{tid}/whiteboard` → 后端从 thread meta 取 cwd → Manager 双源加载（global + 该 cwd 对应的 project workspace） → 合并按 z_index 排序返回。

> 核心改动三处：API 路径加 threadId、Manager 接 cwd 解析双 workspace、前端切 thread 自动重载。

## 范围边界

**包含**：

- 白板根目录搬迁到 `<kongming_home>/whiteboard/`（旧 `<cwd>/whiteboard/` 弃用）
- `WhiteboardManager` 后端类：scope 路由 + 双 workspace 合并 + 唯一对外入口
- 目录结构：`<root>/global/` + `<root>/projects/<encode_project_dir(cwd)>/`
- 每个 project 子目录有 `meta.json` 备份原 cwd（encode 不可逆，调试/迁移用）
- API 路径改为 `/api/threads/{threadId}/whiteboard`
- 前端创建卡片时 scope 下拉选择
- 前端切换 thread 时重新加载白板
- 纯聊天 thread（`meta.cwd` 空）只显示 global 卡片

**不包含**：

- 自动迁移旧 `<cwd>/whiteboard/` 数据（用户手动 mv，spec 提供命令示例）
- `board.json` schema 升级（scope **不写入** board.json，由 Manager 运行时按存储位置推断）
- scope 变更（project↔global 提升/降级）——后续迭代
- 白板协作（多人共享）——不在本轮范围
- 卡片模板 / 卡片类型扩展——独立 feature

## 关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| scope 是否持久化字段 | **否**，由"卡片所在目录"运行时推断 | board.json 零 schema 变更；store 函数零改动 |
| layout 归属 | global 卡 layout 存 global board.json；project 卡 layout 存 project board.json | global 卡片"所有项目位置一致"；不存在"跨项目去找 layout"的歧义 |
| cwd 编码 | whiteboard 自有 `encode_project_dir()`（`src/web/whiteboard/manager.py`）| 格式 `<basename-slug>-<sha256[:8]>`：basename 保留可读，hash 后缀避免撞名 |
| cwd 不可逆怎么调试 | 每个 project 子目录写 `meta.json` 备份原 cwd | 不影响主流程，仅调试/迁移用 |
| 旧数据迁移 | 用户手动 `mv` | spec 提供命令示例，不写代码迁移 |
| 纯聊天 thread（cwd 空）切换 | 只显示 global 卡片，禁用 "创建项目卡片" 入口 | 行为明确、不报错 |

## 模块导航

| 模块 | 状态 | 文档 | 是否可进 task | 说明 |
|------|------|------|---------------|------|
| WhiteboardManager | 方案确认 | `./02-module-breakdown.md` | 是 | 后端核心，scope 路由 + 双 workspace 合并 |
| Store 调用边界 | 方案确认 | `./02-module-breakdown.md` | 是 | 函数签名零改动；用 import-linter 限制只允许 Manager import |
| API 路由改造 | 方案确认 | `./02-module-breakdown.md` | 是 | 路径加 threadId，cwd 走 thread meta，全局走 app.state.kongming_home |
| 前端 Store + UX | 方案确认 | `./02-module-breakdown.md` | 是 | 传 threadId + scope 下拉 + 标记 |

## 文档导航

- [架构图](./architecture.html)（浏览器双击打开）
- [目标与完成标准](./01-goals-and-boundaries.md)
- [模块设计 + 接口 + 数据结构](./02-module-breakdown.md)
- [核心流程](./03-core-workflows.md)（5 条：创建 / 加载 / 切换 / 更新 / 删除）
- [数据模型与状态](./04-data-and-state.md)
- [验证策略与演进](./05-validation-and-evolution.md)
- [Task 映射](./90-task-map.md)

## 当前建议

1. WhiteboardManager + API 路由改造 + import-linter contract 一起进入 x-req，作为 task-1
2. 前端 scope UX + threadId 改造 进入 task-2，可与 task-1 并行
3. scope 变更（提升/降级）留后续迭代
