# Task Map

| 模块 | 建议 task 名 | 前置依赖 | 对应 DoD | 风险 | 状态 | 备注 |
|------|--------------|---------|---------|------|------|------|
| WhiteboardManager + 装配 + Router + import-linter | `whiteboard-manager` | 无 | DoD-2,3,5,6,7,9（后端部分）| 低 | **✅ 已完成 (2026-05-15)** | 14/14 ✅；Gate ① 6/6 + Gate ② R1/R2/R3 一次通过；qa-gate report 见 task `reports/qa-gate/` |
| 前端 Store + UX | `whiteboard-scope-frontend` | 无（与 task-1 并行完成）| DoD-1,4,8,9（前端部分）| 低 | **✅ 已完成 (2026-05-15)** | 8/9 ✅（#8 端到端手动 H1~H7 留用户）；Gate ① 3/3（rerun pass）+ Gate ② R1/R2/R3 一次通过；tsc 0 错 + vitest 282 / 282 |

## 开发顺序建议

```
task-1 (后端)  ──────────────────────────→  联调
task-2 (前端)  ──────────────────────────→  联调
```

两个 task 无强依赖，可并行开发。联调时需要后端 API 先就位（前端开发期可用 mock）。

### task-1: whiteboard-manager（后端）

**新建文件**：

1. `src/web/whiteboard/manager.py`
   - `class WhiteboardManager`（构造接 `whiteboard_root: Path`）
   - `class ScopedCardRecord` / `class ScopedWhiteboardSnapshot`
   - `class WhiteboardScopeError(ValueError)`（cwd 空 + scope=project 时抛出）
2. `tests/unit/test_web_whiteboard_manager.py` — Manager 单测（M1~M15）

**修改文件**：

3. `src/web/app.py`
   - 加 `app.state.kongming_home = get_kongming_home()`
   - 加 `app.state.whiteboard_manager = WhiteboardManager(whiteboard_root=app.state.kongming_home / "whiteboard")`
4. `src/web/routers/whiteboard.py`
   - 前缀 `/api/whiteboard` → 路径含 `/api/threads/{thread_id}/whiteboard`（建议挂到 threads router 子路由，或单独 router 用 path param）
   - 所有 endpoint 改调 `request.app.state.whiteboard_manager`
   - 删除直接 import `whiteboard_store` 的语句（改为只 import Manager + DTO）
   - 加 `WhiteboardScopeError` → 422 的映射
5. `src/web/protocol/rest_models.py`
   - `CreateWhiteboardCardRequest` 加 `scope: Literal["project", "global"]`（必填）
   - `UpdateWhiteboardLayoutRequest` 加 `scope: Literal["project", "global"]`
   - `WhiteboardCardDTO` 加 `scope` 字段
   - `WhiteboardDTO` 用 `global_title` / `project_title` 取代旧 `title` 字段
6. `tests/unit/test_web_routers_whiteboard.py`（已存在）
   - 全部 URL 适配新路径
   - fixture 从 `app.state.workspace_root` 改为 `app.state.thread_manager` + `app.state.whiteboard_manager`
   - 加 R1~R8 新场景
7. `.importlinter`
   - 加 contract：`web.routers.whiteboard` forbid `web.whiteboard.store`
   - `make lint` 跑通

**不改动的文件**：

- `src/web/whiteboard/store.py` 的函数签名 + 数据模型（零变更）
- `tests/unit/test_web_whiteboard_store.py`（已有 store 单测保持）

**改动文件计数**：7 个（含 1 个 `.importlinter`），其中新建 2 个、修改 5 个。

### task-2: whiteboard-scope-frontend（前端）

**修改文件**：

1. `web/src/protocol.ts`
   - 新增 `CardScope` 类型
   - `WhiteboardCardDTO` 加 `scope`
   - `CreateWhiteboardCardRequest` 加 `scope`（必填）
   - `WhiteboardDTO`：用 `global_title` / `project_title` 取代旧 `title`
2. `web/src/stores/whiteboard.ts`
   - `fetchBoard(threadId: string)` URL `/api/threads/{tid}/whiteboard`
   - `createCard({..., scope})` 强制传 scope
   - `saveCardContent` / `saveLayout` / `deleteCard` 内部用闭包记的 threadId 拼 URL
   - state 加 `globalTitle` / `projectTitle`
3. `web/src/pages/Chat.tsx`
   - `useEffect([threadId])` 触发 `fetchBoard(threadId)`；threadId 为 null 时 `clearBoard()`
4. `web/src/components/WhiteboardPanel.tsx` —— **双图标按钮**
   - 主按钮 `[+]`：当前"新建"按钮位置不动，行为改为创建 project 卡片；`projectTitle == null` 时置灰禁用 + tooltip "该会话未绑定项目"
   - 次按钮 `[🌐+]`：紧邻主按钮右侧，尺寸小一档（icon 18px / 按钮 28px 高），`opacity-60` 默认 → hover `opacity-100`；tooltip "新建全局卡片（所有项目可见）"；始终可用
5. `web/src/components/WhiteboardCard.tsx` —— **1px 边框差异色**
   - `scope === 'global'` 时 `style={{ borderColor: 'hsl(var(--whiteboard-scope-global-border))' }}`，border 宽度沿用当前
   - `scope === 'project'` 时**完全不动**视觉
6. `web/src/styles/globals.css` —— **CSS variable 注入**
   - `:root` 加 `--whiteboard-scope-global-border: 217 91% 72%`
   - `.dark` 加 `--whiteboard-scope-global-border: 217 50% 50%`
7. `web/src/components/__tests__/WhiteboardCard.test.tsx`（已存在，可能有 aria-label dup 测试 bug）
   - 加 scope=global → border style 测试
   - 顺便修 sleep-report 提到的 aria-label dup 问题（可选，不属于本 task 强制范围）

**不改动的文件**：

- WhiteboardPanel / WhiteboardCard 的核心交互逻辑（拖拽、resize、编辑器）
- markdown 渲染器
- 其他无关组件
- 全局暗色调色板（独立 task，本轮不做）

**改动文件计数**：6 个（不含可选的 Card 单测修复）。

## 风险与备注

| 风险 | 应对 |
|------|------|
| `encode_project_dir` 不可逆，调试时不知道目录对应哪个 cwd | 每个 project 子目录写 `meta.json` 备份原 cwd |
| 旧 `<cwd>/whiteboard/` 数据用户不知道要 mv | spec 05 + task README 都给出迁移命令模板 |
| 前端切 thread 后 layout 重新渲染抖动 | useEffect 内部 set loading=true，UI 显示骨架；切完 set loading=false |
| 单测里 `_WORKSPACE_LOCKS` 模块级 dict 污染 | 每用例临时 `whiteboard_root`，路径唯一 → 锁 key 唯一，自然隔离 |
| `app.state.workspace_root` 旧字段是否清理 | **不清理**：其他 router（diagrams、threads、workspace_git）仍在用 |
