# 核心流程

> 所有流程的 cwd 来源都是 `request.app.state.thread_manager.get(thread_id).cwd`，可能为空字符串。
> "global workspace" = `<kongming_home>/whiteboard/global/`
> "project workspace" = `<kongming_home>/whiteboard/projects/<encode_project_dir(cwd)>/`

## 1. 创建卡片（scope 路由）

```mermaid
sequenceDiagram
    participant FE as 前端
    participant Router as Router
    participant TM as ThreadManager
    participant Mgr as WhiteboardManager
    participant Store as whiteboard_store
    participant GFS as global/
    participant PFS as projects/<encoded>/

    FE->>Router: POST /api/threads/{id}/whiteboard/cards<br/>{scope, title, content, ...}
    Router->>TM: get(thread_id) → meta.cwd
    alt scope=project AND cwd 空
        Router-->>FE: 422 WhiteboardScopeError
    else 正常
        Router->>Mgr: create_card(cwd, scope, ...)
        alt scope=global
            Mgr->>Store: create_card(global_ws, ...)
            Store->>GFS: 写 cards/<slug>.md + board.json layout
        else scope=project
            Mgr->>Mgr: _write_project_meta(cwd)<br/>(首次写时落盘 meta.json)
            Mgr->>Store: create_card(project_ws, ...)
            Store->>PFS: 写 cards/<slug>.md + board.json layout
        end
        Mgr-->>Router: ScopedCardRecord(record, scope)
        Router-->>FE: WhiteboardCardDTO{scope, ...}
    end
```

**关键点**：

- scope 决定 store 的 workspace 参数，store 无感
- global / project 各自的 board.json 各管各的 layout
- 内容文件 + layout 条目在同一个 `_workspace_lock` 内原子写入（复用现有 store 实现）
- project workspace 首次创建时落盘 `meta.json` 备份原 cwd（仅调试/迁移用）

## 2. 加载白板（双源合并 + cwd 空降级）

```mermaid
flowchart TD
    classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
    classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px

    A["Router 拿到 thread_id<br/>→ meta.cwd（可能空）"]:::p0
    B{"cwd 是否非空？"}:::p0
    C1["Mgr.load(None)<br/>只读 global"]:::p1
    C2["Mgr.load(cwd)<br/>双源加载"]:::p0
    D1["store.load_whiteboard(global_ws)<br/>→ cards 打标 scope=global"]:::p0
    D2["store.load_whiteboard(project_ws)<br/>→ cards 打标 scope=project<br/>(目录不存在时返回空)"]:::p0
    E["合并 cards + 按 z_index 排序"]:::p0
    F["返回 ScopedWhiteboardSnapshot<br/>{global_title, project_title?, cards}"]:::p0

    A --> B
    B -->|否| C1
    B -->|是| C2
    C1 --> D1
    C2 --> D1
    C2 --> D2
    D1 --> E
    D2 --> E
    E --> F
```

**关键点**：

- cwd 空 → 不走 project 分支，`project_title` 字段为 `None`（前端据此 disable 主按钮）
- cwd 非空 + project 目录不存在（用户尚未创建任何 project 卡片）→ Manager 取默认标题 `DEFAULT_WHITEBOARD_TITLE`，`project_title="Whiteboard"`——**必须非 None**，否则前端按钮会被锁死，永远无法点出首张 project 卡（chicken-and-egg）
- scope 标记由 Manager 在合并阶段打到 `ScopedCardRecord` 上，store 不参与
- 排序键统一 `z_index`：global / project 卡片混排，按 z_index 顺序渲染

## 3. 切换 Thread（前端重载）

```mermaid
sequenceDiagram
    participant User as 用户
    participant Chat as Chat.tsx
    participant WBStore as useWhiteboardStore
    participant API as 后端 API

    User->>Chat: 点击切换 thread
    Chat->>Chat: threadId 变化触发 useEffect([threadId])
    alt threadId == null（未选 thread）
        Chat->>WBStore: clearBoard()
    else 有 thread
        Chat->>WBStore: fetchBoard(threadId)
        WBStore->>API: GET /api/threads/{newId}/whiteboard
        API->>API: Router 拿 meta.cwd（可能空）
        API->>API: Manager.load(cwd)
        API-->>WBStore: WhiteboardDTO（global + project 合并，或仅 global）
        WBStore->>WBStore: set({ cards, globalTitle, projectTitle })
    end
    Chat->>Chat: WhiteboardPanel 重新渲染<br/>主按钮 [+] 置灰 disabled（保留可见，不隐藏）<br/>次按钮 [🌐+] 始终可用
```

**关键点**：

- `useEffect` 依赖 `[threadId]`，切换自动触发
- thread 未选 → `clearBoard()` 不调 API
- `projectTitle == null` → 主按钮 `[+]` **置灰 disabled 但保留可见**（不做 `display: none` / `visibility: hidden`），按钮位置稳定，用户视觉一致；次按钮 `[🌐+]` 照常可点
- 切换 thread 后 z_index 排序混合 global + 新项目卡片

## 4. 更新卡片内容（自动定位）

```mermaid
flowchart TD
    classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
    classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px

    A["Router: PUT /api/threads/{id}/whiteboard/cards/{card_id}<br/>body={content, expected_updated_at, ...}"]:::p0
    B["Mgr.update_card_content(cwd, card_id, ...)"]:::p0
    C["_find_card_workspace(cwd, card_id):<br/>读 global board.json"]:::p0
    D{"card_id 在 global？"}:::p0
    E1["是 → ws = global_ws, scope=global"]:::p0
    E2["否 → 读 project board.json<br/>(cwd 非空时)"]:::p0
    F{"在 project？"}:::p0
    G1["是 → ws = project_ws, scope=project"]:::p0
    G2["否 → raise KeyError → 404"]:::p1
    H["store.update_card_content(ws, card_id, ...)"]:::p0
    I["返回 ScopedCardRecord(record, scope)"]:::p0

    A --> B --> C --> D
    D -->|"yes"| E1 --> H
    D -->|"no"| E2 --> F
    F -->|"yes"| G1 --> H
    F -->|"no"| G2
    H --> I
```

**关键点**：

- 前端**不**传 scope，Manager 自动查
- 先查 global 再查 project，顺序固定（避免 id 在两边都意外存在时行为歧义）
- 若 cwd 空 → 只查 global，project 分支跳过 → 没命中直接 404
- `expected_updated_at` 冲突检测照常工作（store 层原逻辑）

## 5. 删除卡片

```mermaid
flowchart TD
    classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
    classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px

    A["Router: DELETE /api/threads/{id}/whiteboard/cards/{card_id}"]:::p0
    B["Mgr.delete_card(cwd, card_id)"]:::p0
    C["_find_card_workspace(cwd, card_id)"]:::p0
    D{"在哪个 workspace？"}:::p0
    E1["global → store.delete_card(global_ws, card_id)"]:::p0
    E2["project → store.delete_card(project_ws, card_id)"]:::p0
    E3["都没有 → 404"]:::p1
    F["返回 204"]:::p0

    A --> B --> C --> D
    D -->|"global"| E1 --> F
    D -->|"project"| E2 --> F
    D -->|"无"| E3
```

**关键点**：

- store 的 `delete_card` 原子操作：删内容文件 + 从对应 board.json 移除 layout 条目（已有行为）
- 不需要跨 workspace 协调；锁粒度本来就是 workspace 级
- global 卡片被删后，任何项目下次加载都自动看不到，无需额外清理
