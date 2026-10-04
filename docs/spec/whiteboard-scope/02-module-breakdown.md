# 模块拆分

## 模块总览

| 模块 | 职责 | 依赖 | 状态 | 备注 |
|------|------|------|------|------|
| WhiteboardManager | scope 路由 + 双 workspace 合并 + 唯一对外入口 | whiteboard_store, encode_project_dir | 方案确认 | 核心，P0 |
| import-linter contract | 强制 router 不直接调 store | .importlinter | 方案确认 | 架构约束，与 Manager 同 task |
| API 路由改造 | HTTP ↔ Manager 协议转换 + thread cwd 解析 + kongming_home 注入 | WhiteboardManager, ThreadManager(router 层), app.state | 方案确认 | 路径 + cwd 空降级 |
| 装配层补丁 | `app.state.kongming_home` 启动注入 + Manager 单例 | app.py | 方案确认 | 一行改 |
| 前端 Store + UX | 传 threadId + scope 下拉 + scope 标记 + cwd 空禁用 | 后端 API | 方案确认 | 并行开发 |

## 模块详情

### 模块 1：WhiteboardManager

**职责**：白板操作的唯一入口。封装 scope 路由（global / project → 对应 workspace 路径）、双 workspace 合并加载、卡片 CRUD。

**包含范围**：

- `load(cwd: str | None) -> ScopedWhiteboardSnapshot` — 双源合并（cwd 空时只读 global）
- `create_card(cwd, *, scope, ...)` — 按 scope 选 target workspace，调 store.create_card
- `update_card_content(cwd, card_id, ...)` — 自动定位 card 所在 workspace
- `update_layout(cwd, *, scope, title, card_layouts)` — 按 scope 选 board.json 写 layout
- `delete_card(cwd, card_id)` — 自动定位并删除
- 内部辅助：`_global_workspace()`、`_project_workspace(cwd)`、`_find_card_workspace(cwd, card_id)`、`_write_project_meta(cwd)`

**不包含范围**：

- scope 变更（提升/降级）——后续迭代
- HTTP 协议转换——router 负责
- 并发锁——复用 store 层 `_workspace_lock`（按 workspace 路径粒度加锁，自然按 global / 各 project 独立）
- thread 元数据获取——router 层从 ThreadManager 取 cwd 传入

**依赖**：

- `whiteboard_store` 的 `load_whiteboard`, `create_card`, `update_card_content`, `update_whiteboard_layout`, `delete_card`
- `whiteboard_store` 的数据模型 `WhiteboardSnapshot`, `WhiteboardCardRecord`, `WhiteboardLayoutUpdate`
- `web.whiteboard.manager.encode_project_dir`（whiteboard 自有）
- `config_loader.get_kongming_home`（或装配时注入 `whiteboard_root: Path`）

**复用 / 新建**：全新开发，文件 `src/web/whiteboard/manager.py`

**Manager 内部 DTO（运行时携带 scope）**：

```python
from typing import Literal
from pydantic import BaseModel, ConfigDict

from web.whiteboard.store import WhiteboardCardRecord

CardScope = Literal["project", "global"]


class ScopedCardRecord(BaseModel):
    """Manager 输出的卡片记录，比 store 多一个 scope 运行时标记。"""

    model_config = ConfigDict(frozen=True, extra="forbid")

    record: WhiteboardCardRecord
    scope: CardScope


class ScopedWhiteboardSnapshot(BaseModel):
    """Manager load 的合并快照。title 来自当前作用域的 board.json（见下文规则）。"""

    model_config = ConfigDict(frozen=True, extra="forbid")

    global_title: str          # global/board.json 的 title
    project_title: str | None  # 仅 cwd 空时为 None；cwd 非空但 workspace 未创建时取默认 "Whiteboard"
    cards: list[ScopedCardRecord]
```

> 也可以选择把 `scope` 直接打到 `WhiteboardCardRecord` 上（去掉 ScopedCardRecord 包装层）；权衡见下文 "数据结构权衡"。

**WhiteboardManager 接口**：

```python
from pathlib import Path
from typing import Literal

from web.whiteboard.store import (
    WhiteboardLayoutUpdate,
    create_card,
    delete_card,
    load_whiteboard,
    update_card_content,
    update_whiteboard_layout,
)
# encode_project_dir 在同模块定义，无需 import

CardScope = Literal["project", "global"]


class WhiteboardManager:
    """白板操作唯一入口。封装 scope 路由 + 双 workspace 合并 + cwd 编码。"""

    def __init__(self, whiteboard_root: Path) -> None:
        """whiteboard_root 通常为 ``<kongming_home>/whiteboard``，由装配层注入。"""
        self._root = whiteboard_root

    # -------- workspace 路径解析 --------

    def _global_workspace(self) -> Path:
        return self._root / "global"

    def _project_workspace(self, cwd: str) -> Path:
        return self._root / "projects" / encode_project_dir(cwd)

    def _write_project_meta(self, cwd: str) -> None:
        """首次为某 cwd 写 project 数据时，落盘 meta.json 备份原始 cwd。"""
        ws = self._project_workspace(cwd)
        meta_path = ws / "meta.json"
        if meta_path.exists():
            return
        ws.mkdir(parents=True, exist_ok=True)
        meta_path.write_text(
            json.dumps({"cwd": cwd}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    # -------- 公共操作 --------

    def load(self, cwd: str | None) -> ScopedWhiteboardSnapshot:
        """合并加载。cwd 空时只读 global。"""

    def create_card(
        self,
        cwd: str | None,
        *,
        scope: CardScope,
        title: str = ...,
        category: str = ...,
        content: str = ...,
        x: int = ...,
        y: int = ...,
        height: int = ...,
    ) -> ScopedCardRecord:
        """创建卡片。scope=global 时 cwd 可为 None；scope=project 时 cwd 必须非空。"""

    def update_card_content(
        self,
        cwd: str | None,
        card_id: str,
        *,
        content: str,
        expected_updated_at: float | None,
        title: str | None,
        category: str | None,
    ) -> ScopedCardRecord:
        """更新卡片正文。Manager 自动判定 card 在 global 还是 project workspace。"""

    def update_layout(
        self,
        cwd: str | None,
        *,
        scope: CardScope,
        title: str | None,
        card_layouts: list[WhiteboardLayoutUpdate],
    ) -> ScopedWhiteboardSnapshot:
        """更新布局。scope=global 改 global board.json；scope=project 改 project board.json。"""

    def delete_card(
        self,
        cwd: str | None,
        card_id: str,
    ) -> None:
        """删除卡片。Manager 自动判定 workspace。"""
```

**scope 路由策略**：

- **scope 不写进 board.json**：哪个目录就是哪个 scope，store 完全无感
- `create_card(scope=global)` → 调 `store.create_card(global_workspace, ...)`（同时写内容 + global board.json layout 条目）
- `create_card(scope=project)` → 先 `_write_project_meta(cwd)` → 调 `store.create_card(project_workspace, ...)`（同时写内容 + project board.json layout 条目）
- `load(cwd)` → 并行（顺序）调 `store.load_whiteboard(global_workspace)` 和 `store.load_whiteboard(project_workspace)` → 给每张 record 打 scope 标记 → 合并按 `z_index` 排序
- `_find_card_workspace(cwd, card_id)`：
  1. 先查 global board.json → 命中返回 `(global_ws, "global")`
  2. 再查 project board.json → 命中返回 `(project_ws, "project")`
  3. 都没命中 → raise KeyError
- `update_card_content` / `delete_card` 用 `_find_card_workspace` 定位后调 store 对应方法
- `update_layout` 显式传 scope（前端拖拽事件本就知道在哪边布局变了）

**风险等级**：低
**风险说明**：store 层签名零改动，Manager 只是路由 + 合并层，逻辑清晰；scope 不持久化避免了 schema 演进问题

**task 建议**：

- 建议 task 名：`whiteboard-manager`
- 对应 DoD：DoD-2, DoD-3, DoD-5, DoD-6, DoD-7, DoD-9
- 是否进入 x-req：是

---

### 模块 2：import-linter contract

**职责**：从架构层禁止 router 绕过 Manager 直接 import store。

**包含范围**：

- `.importlinter` 加一条 contract：
  ```ini
  [importlinter:contract:whiteboard-isolation]
  name = Whiteboard router must go through manager
  type = forbidden
  source_modules =
      web.routers.whiteboard
  forbidden_modules =
      web.whiteboard.store
  ```
- `make lint` 跑 lint-imports 自动检查

**不包含范围**：

- store 函数加 `_` 前缀（不改任何签名）
- `__all__` 调整（保留现状）

**依赖**：现有 `.importlinter`

**复用 / 新建**：修改已有 `.importlinter`

**风险等级**：极低
**task 建议**：与 WhiteboardManager 同 task

---

### 模块 3：装配层补丁（app.py）

**职责**：启动时把 `kongming_home` 和 `WhiteboardManager` 单例注入到 `app.state`。

**包含范围**：

- `app.state.kongming_home = get_kongming_home()`
- `app.state.whiteboard_manager = WhiteboardManager(whiteboard_root=app.state.kongming_home / "whiteboard")`

**不包含范围**：

- 移除 `app.state.workspace_root`（其他 router 还在用，保留）

**依赖**：`config_loader.get_kongming_home`, `WhiteboardManager`

**复用 / 新建**：修改已有 `src/web/app.py`

**task 建议**：与 WhiteboardManager 同 task

---

### 模块 4：API 路由改造

**职责**：HTTP 协议转换 + thread cwd 解析 + cwd 空降级。Router 不再有业务逻辑。

**包含范围**：

- 路由前缀从 `/api/whiteboard` 改为 `/api/threads/{thread_id}/whiteboard`
- 通过 `request.app.state.thread_manager` 拿 `ThreadMetadata` → `meta.cwd`（可能空字符串）
- 通过 `request.app.state.whiteboard_manager` 拿 Manager 单例
- 卡片创建端点 body 加 `scope` 字段；layout 端点路径加 `scope` query 参数（或塞 body）
- **cwd 空降级**：
  - `GET /api/threads/{tid}/whiteboard` 仍可调用，Manager 返回只含 global 的快照
  - `POST cards { scope: "project" }` + cwd 空 → 422 WhiteboardScopeError
  - `PATCH layout?scope=project` + cwd 空 → 422

**不包含范围**：

- scope 路由逻辑（Manager 负责）
- 存储逻辑（Store 负责，Manager 转交）

**依赖**：

- `WhiteboardManager`（通过 `app.state.whiteboard_manager`）
- `ThreadManager`（通过 `app.state.thread_manager` 取 thread meta）

**复用 / 新建**：修改已有 `src/web/routers/whiteboard.py` + `src/web/protocol/rest_models.py`

**REST DTO 变更**：

```python
class CreateWhiteboardCardRequest(BaseModel):
    scope: Literal["project", "global"]  # 新增，必填，避免歧义
    title: str = ...
    category: str = ...
    content: str = ...
    ...


class WhiteboardCardDTO(BaseModel):
    scope: Literal["project", "global"]  # 新增
    # 其他字段不变
    ...


class WhiteboardDTO(BaseModel):
    global_title: str           # 新增
    project_title: str | None   # 新增（仅 cwd 空时 None；cwd 非空 + workspace 未创建时取默认 "Whiteboard"）
    cards: list[WhiteboardCardDTO]
    schema_version: Literal[1] = 1  # 不变（白板 layout 文件 schema 没变）
```

`UpdateWhiteboardLayoutRequest` 加 `scope: Literal["project", "global"]` 字段（前端按发起 scope 传，后端不猜）。

**风险等级**：低
**task 建议**：与 WhiteboardManager 同 task；对应 DoD：DoD-5, DoD-6, DoD-9

---

### 模块 5：前端 Store + UX

**职责**：前端白板 store 传 threadId、双图标按钮创建、scope 边框差异色、cwd 空降级。

**包含范围**：

- `useWhiteboardStore` 所有 API 调用加 `threadId` 参数（拼到 URL）
- `fetchBoard(threadId)` 在 `threadId` 变化时重新调用（`Chat.tsx` 的 useEffect 依赖 `[threadId]`）
- **双图标按钮**创建（取代下拉）：
  - 主按钮 `[+]`：白板顶栏当前位置完全不动，**默认创建 project 卡片**；`projectTitle == null`（**仅当 cwd 空**，如纯聊天 thread）时**置灰禁用** + tooltip "该会话未绑定项目"。cwd 非空时即使 workspace 还没建过卡，后端也给默认标题保证按钮可点（避免「点不动→workspace 永远不创建」死锁）
  - 次按钮 `[🌐+]`：紧贴主按钮右侧，尺寸小一档（建议 icon 18px + 按钮 28px 高），**默认 `opacity-60`**，hover/focus 时 `opacity-100`；tooltip "新建全局卡片（所有项目可见）"；**始终可用**
- **scope 视觉差异 = 1px 差异色边框**（仅 global 加，project 不动）：
  - 在 `web/src/styles/globals.css` `:root` / `.dark` 各加一对 CSS variable：
    ```css
    :root { --whiteboard-scope-global-border: 217 91% 72%; }
    .dark { --whiteboard-scope-global-border: 217 50% 50%; }
    ```
  - `WhiteboardCard.tsx` 根据 `scope === 'global'` 切换 `style.borderColor` 用 `hsl(var(--whiteboard-scope-global-border))`；border-width 保持 1px（沿用现有 border 厚度）
  - **不加** 🌐 角标、不加 hairline、不加 cwd basename 文本——除了 1px 边框色，其他全不动
- `WhiteboardCardDTO` / `CreateWhiteboardCardRequest` / `WhiteboardDTO` TS 类型同步加 scope / global_title / project_title 字段

**不包含范围**：

- scope 变更 UI（提升/降级按钮）
- 白板协作 UI
- 全局暗色调色板优化（独立 task，本轮不做）

**视觉一致性原则**：cwd 空 / 主按钮不可用时**只改 disabled 样式**（灰阶 + cursor not-allowed + tooltip），**不做** `display: none` / `visibility: hidden` / 条件渲染移除节点。按钮始终在原位，避免用户切换 thread 时顶栏布局抖动。

**依赖**：后端 API

**复用 / 新建**：修改已有
- `web/src/stores/whiteboard.ts`
- `web/src/components/WhiteboardPanel.tsx`（顶栏按钮）
- `web/src/components/WhiteboardCard.tsx`（边框 scope 标记）
- `web/src/protocol.ts`
- `web/src/pages/Chat.tsx`
- `web/src/styles/globals.css`（注入 CSS variable）

**TS DTO**：

```typescript
export type CardScope = "project" | "global";

export interface WhiteboardCardDTO {
  scope: CardScope;
  // 其他字段不变
  ...
}

export interface CreateWhiteboardCardRequest {
  scope: CardScope;  // 必填
  ...
}

export interface WhiteboardDTO {
  global_title: string;
  project_title: string | null;
  cards: WhiteboardCardDTO[];
  schema_version: 1;
}
```

**风险等级**：低
**task 建议**：

- 建议 task 名：`whiteboard-scope-frontend`
- 对应 DoD：DoD-1, DoD-4, DoD-8, DoD-9
- 是否进入 x-req：是，可与 task-1 并行（联调时按后端契约对齐）
- 改动文件：6 个（含 globals.css）

---

## 数据结构权衡

是否在 `WhiteboardCardRecord` 上加 `scope` 字段（store 层），还是通过 `ScopedCardRecord` 包装（Manager 层）？

| 方案 | 优 | 劣 |
|------|---|---|
| **A. ScopedCardRecord 包装**（本 spec 推荐）| store 完全无感；scope 100% 运行时字段 | Manager 输出需要二次解包，DTO 转换层有一层包装 |
| B. WhiteboardCardRecord 加 scope（默认 `"project"`）| 减少一层包装类型 | store 层概念污染，运行时字段塞到本应纯持久化的 record；frozen model 加非持久化字段语义混乱 |

选 A。Router 转 DTO 时直接解：

```python
def _to_card_dto(scoped: ScopedCardRecord) -> WhiteboardCardDTO:
    record = scoped.record
    return WhiteboardCardDTO(
        scope=scoped.scope,
        id=record.id,
        title=record.title,
        ...
    )
```
