# 目标与完成标准

## 系统目标

白板卡片当前绑定在 server 启动时的 `Path.cwd() / whiteboard/`（`app.state.workspace_root`），所有 thread 共享同一份白板数据。用户在多项目工作时，会看到其他项目的卡片混在一起。

本次改造解决三个问题：

1. **根目录归位**：白板根从 `<cwd>/whiteboard/` 搬到 `<kongming_home>/whiteboard/`，跟随 `.kongming/` 而不是 server 启动目录
2. **数据隔离**：project 卡片按 `cwd` 隔离（目录 `projects/<encode_project_dir(cwd)>/`），global 卡片在所有项目可见（目录 `global/`）
3. **架构补层**：引入 WhiteboardManager 作为白板操作的唯一入口，router 禁止绕过 Manager 直接操作 store

## 完成目标（DoD）

- [ ] **DoD-1**：创建卡片时可选择 scope（project / global），**通过双图标按钮**完成：白板顶栏主按钮 `[+]` 默认创建 project；次按钮 `[🌐+]` 紧邻主按钮、尺寸小一档 + `opacity-60`，点击创建 global
- [ ] **DoD-2**：白板根目录为 `<kongming_home>/whiteboard/`；global 卡存 `<root>/global/cards/`，project 卡存 `<root>/projects/<encode_project_dir(cwd)>/cards/`
- [ ] **DoD-3**：加载白板时合并 global 与当前 cwd 对应的 project 卡片，global / project 各自的 layout 来自各自的 `board.json`
- [ ] **DoD-4**：切换 thread 时白板自动重新加载（前端 useEffect 响应 threadId 变化）
- [ ] **DoD-5**：API 路径从 `/api/whiteboard` 改为 `/api/threads/{threadId}/whiteboard`，与其他 workspace 端点一致
- [ ] **DoD-6**：后端 WhiteboardManager 是白板操作的唯一入口，router 不直接 import store 函数（`.importlinter` contract 强制）
- [ ] **DoD-7**：白板相关单测覆盖 scope 路由、双 workspace 合并加载、cwd 空降级、encode_project_dir 一致性、冲突检测五条核心路径
- [ ] **DoD-8**：卡片 scope 可视区分 **= 1px 差异色边框**。global 卡片在亮/暗主题下分别用 `hsl(217 91% 72%)` / `hsl(217 50% 50%)`（即新增 CSS variable `--whiteboard-scope-global-border`）；project 卡片**完全不加**视觉标记，外观与当前一致
- [ ] **DoD-9**：thread `meta.cwd` 为空时，端点只返回 global 卡片；前端**主按钮 `[+]` 置灰禁用**（tooltip "该会话未绑定项目"），次按钮 `[🌐+]` **始终可用**

## 范围边界

**包含**：

- 白板根目录搬到 `<kongming_home>/whiteboard/`（旧 `<cwd>/whiteboard/` 弃用）
- WhiteboardManager 类 + scope 路由逻辑 + cwd 解析
- API 路径改为 thread-scoped
- 每个 project 子目录创建 `meta.json` 备份原始 cwd（encode 不可逆，调试/迁移用）
- 前端 store 所有 API 调用加 `threadId`
- 前端创建卡片**双图标按钮**（主 `[+]` = project，次 `[🌐+]` = global）
- 前端切换 thread 时 `fetchBoard` 重载
- 卡片 scope **1px 边框差异色**（仅 global，project 不动）
- 在 `web/src/styles/globals.css` 注入 `--whiteboard-scope-global-border` 一对（light/dark）CSS variable
- 纯聊天 thread（cwd 空）降级行为
- `.importlinter` contract：禁止 `web.routers.whiteboard` 直接 import `web.whiteboard.store`

**不包含**：

- 自动迁移旧 `<cwd>/whiteboard/` 数据（spec 仅提供手动迁移命令示例，不写代码）
- scope 变更操作（project → global 提升、global → project 降级）
- 白板协作 / 多人共享
- 卡片模板 / 卡片类型扩展
- 白板导入导出
- `board.json` schema_version 升级（scope **不写入** board.json）

## 关键约束

- **`whiteboard_store.py` 函数签名零改动**：`create_card(workspace, ...)` 等函数的入参和返回值保持不变；Manager 负责按 scope 选择传哪个 `workspace`
- **scope 不持久化**：`WhiteboardCardMeta`、`WhiteboardMeta`、`WhiteboardSnapshot`、`WhiteboardCardRecord`（store 层数据模型）**不加 scope 字段**；scope 是 Manager 运行时按"卡片所在 workspace 目录"推断出来的标记，仅出现在 Manager 内部 DTO 和 REST DTO 中
- **已有 store 单测保持通过**：`tests/unit/test_web_whiteboard_store.py` 全部用例不变
- **`encode_project_dir` 定义在 `web.whiteboard.manager`**：格式 `<basename-slug>-<sha256[:8]>`——basename 保留可读性，hash 后缀保证唯一（同 basename 不同路径不会撞）；不复用 Claude SDK 的 `encode_cwd`（那个只做 `/ _ . → -` 替换，对白板撞名风险更高）
- **与 ThreadManager 平级**：WhiteboardManager 不依赖 ThreadManager，router 层从 ThreadManager 取 cwd 后传入 Manager
- **前端协议同步**：TypeScript `protocol.ts` 和 Python `rest_models.py` 同步加 `scope` 字段（仅 DTO 层，store 不加）

## 旧数据处理（不自动迁移）

旧白板数据在 `<server启动cwd>/whiteboard/`，新版只读 `<kongming_home>/whiteboard/`。spec 不写迁移代码，给出人工命令模板：

```bash
# 1. 算 encoded cwd（确认目标项目子目录名）
python -c "from web.whiteboard.manager import encode_project_dir; print(encode_project_dir('/your/cwd'))"

# 2. 把旧白板转成对应 scope 的目录
mkdir -p <kongming_home>/whiteboard/projects/<encoded>/
mv <old_cwd>/whiteboard/board.json <kongming_home>/whiteboard/projects/<encoded>/
mv <old_cwd>/whiteboard/cards      <kongming_home>/whiteboard/projects/<encoded>/

# 3. 想全部转 global 的话
mkdir -p <kongming_home>/whiteboard/global/
mv <old_cwd>/whiteboard/board.json <kongming_home>/whiteboard/global/
mv <old_cwd>/whiteboard/cards      <kongming_home>/whiteboard/global/
```

> 旧目录留着无影响（新版不读），用户自行清理。

## DoD ↔ 模块追溯矩阵

| DoD 条目 | 需要哪些模块 | 需要哪些 task | 状态 |
|---------|------------|-------------|------|
| DoD-1 双图标按钮创建 | 前端 UX | task-2 | 待实现 |
| DoD-2 双目录存储 | WhiteboardManager | task-1 | 待实现 |
| DoD-3 合并加载 | WhiteboardManager | task-1 | 待实现 |
| DoD-4 切 thread 重载 | 前端 Store | task-2 | 待实现 |
| DoD-5 API 路径 | API 路由改造 | task-1 | 待实现 |
| DoD-6 Manager 封装 | WhiteboardManager + import-linter | task-1 | 待实现 |
| DoD-7 单测 | WhiteboardManager | task-1 | 待实现 |
| DoD-8 scope 边框差异色 | 前端 UX + globals.css | task-2 | 待实现 |
| DoD-9 cwd 空降级 | API 路由 + 前端 UX | task-1 + task-2 | 待实现 |
