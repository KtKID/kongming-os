# 模块拆分

## 模块总览

| 模块 | 职责 | 依赖 | 状态 | 备注 |
|------|------|------|------|------|
| A. Scanner | 扫描文件产物，推断阶段状态 | 无 | 可进入 x-req | 核心数据源 |
| B. Workflow Core | 四对象模型 + 预置模板 + 状态管理 | 无 | 可进入 x-req | 可与 A 并行 |
| C. REST API | 后端接口层 | A + B | 可进入 x-req | 薄层 |
| D. Dashboard UI | Web 看板展示 | C | 可进入 x-req | 纯前端 |

## 模块详情

### 模块 A: Scanner（文件扫描器）

**职责**：定时扫描项目文件系统，根据产物文件存在性推断 task 的阶段状态，构建 spec → task 树形关系。

**包含范围**：
- 扫描 `docs/` 下的 spec 目录（检测 `01-goals-and-boundaries.md`）
- 扫描 `dev-pipeline/tasks/` 下的 task 目录
- 按产物文件映射阶段状态（见下方映射表）
- 解析 task README.md 中的 spec 引用，建立 spec ↔ task 关联
- 可配扫描间隔（通过 `WorkflowConfig.scan_interval`）

**不包含范围**：
- 不解析报告内容（不判断 pass/fail）
- 不检测"进行中"状态
- 不修改任何被扫描的文件

**依赖**：无（纯文件系统读取）

**复用/新建**：全新开发。可参考 `src/scheduler/store.py` 的 JSON 持久化模式。

**产物文件 → 阶段映射表**：

| 阶段 | 检测文件 | 检测位置 |
|------|---------|---------|
| x-spec | `01-goals-and-boundaries.md` | `docs/<module>/<spec>/` |
| x-req | `dev-checklist.md` | `dev-pipeline/tasks/<task>/` |
| x-dev | `dev-report.md` | `dev-pipeline/tasks/<task>/` |
| x-verify | `reports/verify/verify-report-*.md` | 同上 |
| x-qa-gate | `reports/qa-gate/qa-gate-report-*.md` | 同上 |
| x-fix | `reports/fix/fix-*.md` | 同上 |

**spec → task 关联策略**：
- 扫描 `dev-pipeline/tasks/<task>/README.md` 前 20 行
- 正则匹配 `docs/<path>` 形式的引用 → 关联到对应 spec
- 无引用的 task 归入"未关联"组

**数据结构/接口**：

```python
@dataclass
class ScanResult:
    specs: list[SpecSnapshot]
    tasks: list[TaskSnapshot]
    scanned_at: str  # ISO8601

@dataclass
class SpecSnapshot:
    spec_id: str          # docs 下的相对路径，如 "workflow-dashboard"
    name: str             # 从 README.md 标题提取
    path: str             # 绝对路径
    has_goals: bool
    has_module_breakdown: bool
    has_task_map: bool
    has_architecture: bool

@dataclass
class TaskSnapshot:
    task_id: str          # task 目录名，如 "workflow-dashboard-backend"
    name: str             # 从 README.md 标题提取
    path: str             # 绝对路径
    spec_ref: str | None  # 关联的 spec_id（从 README 解析）
    stages: dict[str, StageStatus]
    # stages 示例: {"x-req": "done", "x-dev": "done", "x-verify": "not_started"}

class StageStatus(str, Enum):
    DONE = "done"            # 产物文件存在
    NOT_STARTED = "not_started"  # 产物文件不存在
```

**风险等级**：低
**风险说明**：纯文件系统读取，逻辑简单。唯一风险是 README 格式不统一导致 spec 引用解析失败，但可以 fallback 到"未关联"。

**task 建议**：
- 建议 task 名：`workflow-dashboard-backend`（与 B、C 合并）
- 对应 DoD：D1, D2, D3, D7
- 是否进入 x-req：是
- 原因：逻辑清晰，无技术风险

---

### 模块 B: Workflow Core（工作流核心）

**职责**：管理四对象模型（NodeTemplate / WorkflowDefinition / WorkflowRun / WorkflowEvent），提供预置模板，维护 task ↔ workflow 绑定关系。

**包含范围**：
- NodeTemplate 注册表（节点类型元数据）
- WorkflowDefinition CRUD（模板的节点 + 边）
- WorkflowRun 生命周期（创建、状态更新、归档）
- WorkflowEvent 追加日志
- 预置模板内置（full-pipeline、quick-dev）
- JSON 文件持久化到 `.kongming/workflows/`

**不包含范围**：
- 拖拽编辑器逻辑（v2）
- 自动流转引擎（v2）
- port 类型校验（v2，v1 不限制连接）

**依赖**：无

**复用/新建**：全新开发。JSON 持久化参考 `src/scheduler/store.py`（schema_version + 原子写入模式）。

**数据结构/接口**：

```python
@dataclass
class NodeTemplate:
    id: str                    # 如 "x-spec", "x-req", "x-dev"
    name: str                  # 显示名称
    category: str              # "analysis" | "planning" | "execution" | "gate" | "repair"
    detection_file: str | None # Scanner 用的产物文件 pattern

@dataclass
class WorkflowDefinition:
    id: str
    name: str
    description: str
    nodes: list[WorkflowNode]
    edges: list[WorkflowEdge]
    is_preset: bool            # 预置模板不可删除

@dataclass
class WorkflowNode:
    id: str
    template_id: str           # 引用 NodeTemplate.id
    position: int              # v1 用线性排序代替 x/y 坐标

@dataclass
class WorkflowEdge:
    id: str
    from_node_id: str
    to_node_id: str
    trigger: str               # "on_completed" | "on_failed"

@dataclass
class WorkflowRun:
    id: str
    workflow_id: str            # 引用 WorkflowDefinition.id
    task_id: str                # 对应 dev-pipeline/tasks/<task_id>
    spec_id: str | None         # 关联的 spec（可选）
    node_states: dict[str, str] # node_id → "done" | "not_started"
    created_at: str
    updated_at: str

@dataclass
class WorkflowEvent:
    event_id: str
    run_id: str
    node_id: str
    old_status: str
    new_status: str
    source: str                 # "scanner" | "manual"
    timestamp: str
```

**风险等级**：低
**风险说明**：四对象模型在头脑风暴阶段已充分推敲，边界清晰。

**task 建议**：
- 建议 task 名：`workflow-dashboard-backend`（与 A、C 合并）
- 对应 DoD：D4, D5
- 是否进入 x-req：是
- 原因：模型已定义清楚

---

### 模块 C: REST API（后端接口）

**职责**：为前端提供 HTTP 接口，串联 Scanner 和 Workflow Core。

**包含范围**：
- `GET /api/workflows` — 列出所有 workflow 定义（含预置）
- `GET /api/workflows/{id}` — 获取单个 workflow 定义
- `GET /api/workflow-runs` — 列出所有 run（含节点状态）
- `POST /api/workflow-runs` — 创建 run（绑定 task + workflow）
- `PATCH /api/workflow-runs/{id}` — 手动更新 run 状态
- `GET /api/workflow-runs/{id}/events` — 获取 run 的事件历史
- `GET /api/scanner/status` — 扫描器状态 + 最近扫描结果
- `POST /api/scanner/trigger` — 手动触发一次扫描

**不包含范围**：
- WebSocket 推送（v1 前端轮询 REST，v2 再加 WS 推送）
- workflow 定义的 CRUD（v1 只用预置模板，v2 编辑器再加）

**依赖**：Scanner + Workflow Core

**复用/新建**：新建 FastAPI router。参考 `src/web/routers/threads.py` 的 router 注册模式。

**数据结构/接口**：REST DTO 从 Python dataclass 直接序列化，无需额外定义。

**风险等级**：低
**风险说明**：薄接口层，逻辑在 Scanner 和 Workflow Core 里。

**task 建议**：
- 建议 task 名：`workflow-dashboard-backend`（与 A、B 合并）
- 对应 DoD：D4（绑定接口）
- 是否进入 x-req：是
- 原因：接口简单

---

### 模块 D: Dashboard UI（看板前端）

**职责**：在 Web 端渲染工作流进度看板，展示 spec → task 树和每个 task 的节点状态。

**包含范围**：
- 看板入口按钮（右上角，架构图按钮旁）
- 看板 Dialog / Panel（全屏或抽屉）
- spec → task 树形列表（左侧）
- 每个 task 的工作流节点状态图（右侧）
- 节点颜色：已完成（绿）/ 未开始（灰）
- 未绑定 workflow 的 task 显示"分配模板"操作
- 前端轮询 REST 接口刷新状态

**不包含范围**：
- 拖拽连线编辑器（v2）
- 节点详情展开（v2）
- WebSocket 实时推送（v2）

**依赖**：REST API（模块 C）

**复用/新建**：
- 复用 `Dialog` / `Sheet` 组件（已有 shadcn/ui）
- 复用 `ArchitectureDiagramDialog.tsx` 的双面板布局模式
- 新建 `WorkflowDashboard.tsx` + `useWorkflowStore.ts`

**数据结构/接口**：

```typescript
interface WorkflowDefinition {
  id: string
  name: string
  description: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  is_preset: boolean
}

interface WorkflowNode {
  id: string
  template_id: string
  position: number
}

interface WorkflowEdge {
  id: string
  from_node_id: string
  to_node_id: string
  trigger: 'on_completed' | 'on_failed'
}

interface WorkflowRun {
  id: string
  workflow_id: string
  task_id: string
  spec_id: string | null
  node_states: Record<string, 'done' | 'not_started'>
  created_at: string
  updated_at: string
}

interface ScannerStatus {
  last_scan_at: string | null
  scan_interval_seconds: number
  specs: SpecSnapshot[]
  tasks: TaskSnapshot[]
}
```

**风险等级**：低
**风险说明**：纯展示，复用已有组件模式。

**task 建议**：
- 建议 task 名：`workflow-dashboard-frontend`
- 对应 DoD：D6, D8
- 是否进入 x-req：是
- 原因：依赖后端接口，但 UI 结构可先行
