# 验证策略与演进

## 验证策略

### 单元测试

- **覆盖模块**：WhiteboardManager（核心），Router（HTTP 层），import-linter contract（架构边界）
- **框架**：pytest（`tests/unit/`）+ lint-imports（make lint）
- **测试隔离**：每个用例用临时目录作 `whiteboard_root`，避免 `_WORKSPACE_LOCKS` 模块级 dict 跨用例污染（参考项目记忆 `feedback_test_isolation`）

**WhiteboardManager 关键场景**：

| # | 场景 | 期望 |
|---|------|------|
| M1 | `create_card(cwd=None, scope=global)` | 内容写 `<root>/global/cards/`，layout 写 global board.json，返回 ScopedCardRecord(scope=global) |
| M2 | `create_card(cwd="/a", scope=project)` | 首次写 `meta.json` + 内容文件 + project board.json layout |
| M3 | `create_card(cwd=None, scope=project)` | raise `WhiteboardScopeError`（或 ValueError）|
| M4 | `load(cwd=None)` | 只读 global，project_title=None |
| M5 | `load(cwd="/a")`，global 有 2 张 + project 有 1 张 | 返回 3 张，分别标 scope，按 z_index 排序 |
| M6 | `load(cwd="/a")`，project 目录不存在 | 只返回 global，**project_title="Whiteboard"**（默认标题；不能是 None，否则前端按钮锁死），不报错 |
| M7 | `update_card_content(cwd="/a", card_id=X)`，X 在 global | 路由到 global_ws 调 store |
| M8 | `update_card_content(cwd="/a", card_id=X)`，X 在 project | 路由到 project_ws 调 store |
| M9 | `update_card_content(cwd=None, card_id=X)`，X 在 global | 命中，正常返回 |
| M10 | `delete_card(cwd="/a", card_id=X)`，X 在 global | 删除 global 内容 + global board layout 条目 |
| M11 | `delete_card(cwd="/a", card_id=Y)`，Y 都不在 | raise KeyError → router 转 404 |
| M12 | `update_card_content` 冲突检测（expected_updated_at 不匹配）| store 层抛 `WhiteboardContentConflictError`，原样传播 |
| M13 | `update_layout(cwd="/a", scope=global, ...)` | 改 global board.json，不改 project board.json |
| M14 | `update_layout(cwd="/a", scope=project, ...)` | 改 project board.json，不改 global |
| M15 | `update_layout(cwd=None, scope=project, ...)` | raise `WhiteboardScopeError` |

**Router 关键场景**：

| # | 场景 | 期望 |
|---|------|------|
| R1 | `GET /api/threads/{tid}/whiteboard`，tid 不存在 | 404 |
| R2 | `GET ...`，thread 有 cwd | 调 Manager.load(cwd)，返回 WhiteboardDTO 完整 |
| R3 | `GET ...`，thread cwd="" | 调 Manager.load(None)，返回 project_title=null |
| R4 | `POST cards { scope: "project" }`，thread cwd="" | 422 |
| R5 | `POST cards { scope: "global" }`，thread cwd="" | 200，写到 global |
| R6 | `PATCH layout?scope=project`，cwd="" | 422 |
| R7 | `DELETE cards/{card_id}`，找不到 | 404 |
| R8 | router 直接 import `web.whiteboard.store` | `make lint` 失败（import-linter contract）|

**encode_project_dir 一致性测试**：

- E1：`encode_project_dir("/Users/kid/proj/a") == encode_project_dir("/Users/kid/proj/a")`（确定性）
- E2：两个不同 cwd 编码后写入不同 project 子目录，相互不污染

### 集成测试

- **端到端链路**：前端选 thread → 创建 global 卡片 → 切到另一个 thread → 验证 global 卡片仍可见、project 卡片不可见
- **环境要求**：本地 web server + 两个不同 cwd 的 thread
- **触发方式**：`make test-e2e`（按项目 e2e 流程）

### 手动验证（由开发者人工过）

| # | 场景 | 期望 |
|---|------|------|
| H1 | 在 thread A（cwd=/a）点次按钮 `[🌐+]` 创建 global 卡片"X" | 卡片落 `<root>/global/cards/`，UI 显示 1px 淡蓝边框（亮色 #94BDF6 / 暗色 #4076BF）|
| H2 | 切到 thread B（cwd=/b）| 看到 X 含淡蓝边框，看不到 thread A 的 project 卡片 |
| H3 | 在 thread B 移动 X 的位置 | global board.json 的 layout 更新，thread A 切回也是新位置 |
| H4 | 在 thread B 点主按钮 `[+]` 创建 project 卡片"Y" | 卡片落 `<root>/projects/<encode(/b)>/cards/`，UI **无任何标记**（保持当前 project 卡视觉）|
| H5 | 切到无 cwd 的纯聊天 thread | 只看到 global 卡片；主按钮 `[+]` **置灰禁用** + tooltip；次按钮 `[🌐+]` 仍可点 |
| H6 | 删除 global 卡片 X | thread A / B 都不再看到 X |
| H7 | 切换 light ↔ dark 主题 | global 卡片边框色跟随主题切换（CSS variable 体系自动）|

## 测试覆盖要求

| 模块 | 最低覆盖率 | 重点文件 |
|------|-----------|---------|
| WhiteboardManager | 90% | `src/web/whiteboard/manager.py` |
| Router（whiteboard）| 80% | `src/web/routers/whiteboard.py` |
| Store（whiteboard）| 不降 | `src/web/whiteboard/store.py`（已有单测保持通过）|
| import-linter | N/A | `.importlinter` 跑 `lint-imports` 必须 0 broken |

## 旧数据迁移（手动，spec 不写代码）

旧白板数据在 `<server启动cwd>/whiteboard/`。新版只读 `<kongming_home>/whiteboard/`，**不做自动迁移**，也不做 fallback。

用户手动迁移命令模板（spec 提供，不打包成脚本）：

```bash
# 1. 算 encoded cwd
python -c "from web.whiteboard.manager import encode_project_dir; print(encode_project_dir('/your/project/cwd'))"

# 2. 选一：转成 project 卡（绑定到指定 cwd）
mkdir -p "$KONGMING_HOME/whiteboard/projects/<encoded>/"
echo '{"cwd": "/your/project/cwd"}' > "$KONGMING_HOME/whiteboard/projects/<encoded>/meta.json"
mv <old_cwd>/whiteboard/board.json "$KONGMING_HOME/whiteboard/projects/<encoded>/"
mv <old_cwd>/whiteboard/cards      "$KONGMING_HOME/whiteboard/projects/<encoded>/"

# 2. 选二：转成 global（所有项目可见）
mkdir -p "$KONGMING_HOME/whiteboard/global/"
mv <old_cwd>/whiteboard/board.json "$KONGMING_HOME/whiteboard/global/"
mv <old_cwd>/whiteboard/cards      "$KONGMING_HOME/whiteboard/global/"
```

> 旧 `<old_cwd>/whiteboard/` 目录留着无影响，用户自行清理。

## 演进路线

### 短期（本轮 task）

- [ ] WhiteboardManager + scope 路由 + 双 workspace 合并
- [ ] 白板根目录搬到 `<kongming_home>/whiteboard/`
- [ ] API 路径 thread-scoped
- [ ] 前端双图标按钮创建 + global 卡片 1px 边框差异色
- [ ] 切 thread 自动重载白板
- [ ] cwd 空降级行为（只显示 global；主按钮置灰，次按钮可用）
- [ ] import-linter contract 守护架构边界

### 中期（下 1-2 轮）

- [ ] scope 变更操作（project → global 提升、global → project 降级；实现 `move_card`）
- [ ] 全局卡片搜索 / 聚合视图（在所有项目看所有 global 卡片）
- [ ] 卡片移动时自动换 workspace 的原子操作
- [ ] 项目子目录清理工具（删除 cwd 已不存在的 `<root>/projects/<encoded>/`）

### 长期（方向性）

- 白板模板（预设一组 global 卡片作为新项目起点）
- 白板协作（多人共享，需要服务端冲突解决）
- 卡片引用（卡片间互相链接）
- per-project layout override：global 卡片在不同项目可有不同位置（当前是全局统一位置）
- 全局暗色调色板优化：当前 `--background` / `--card` L 差只有 3%，卡片"贴底"层次扁平。建议独立 task `web-dark-palette-polish`：把 `--background` 从 `240 10% 4%` 提到 `240 10% 6%`、`--card` 从 `240 8% 7%` 提到 `240 8% 10%`，并新增 `--card-elevated`（240 6% 14%）给浮起卡片用
