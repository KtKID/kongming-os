# 模块拆分

## 模块总览

| 模块 | 职责 | 依赖 | 状态 | 备注 |
|------|------|------|------|------|
| 进度入口与面板 | 在当前 chat 顶部提供入口、popover、空态、compact checklist 与轮询刷新 | 进度读写 API | 可进入 x-req | 前端边界优先放在 `web/src/components` 或 chat 局部组件 |
| 进度读写 API | 提供当前 thread 进度的 REST 读取和受控写入 | Session 进度仓储、thread metadata | 可进入 x-req | 建议新建 Web router |
| Session 进度仓储 | 统一 session 目录解析、JSON schema 校验、原子读写 | config path resolver | 可进入 x-req | API 与 LLM 工具共享 |
| LLM 进度写入工具 | 让 LLM 在当前 session 写入任务列表 | Session 进度仓储、ToolContext | 可进入 x-req | 需要安全策略决策 |
| 编排进度桥接 | 读取编排 task_id / task_run_id 并在 workflow 事件发生时同步写入任务进度 | workflow manager、Session 进度仓储 | 可进入 x-req | 可随 MVP 薄集成 |

## 模块详情

### 模块 1：进度入口与面板

**职责**：在当前 chat/thread 顶部提供“进度”入口，点击后显示当前 session 的任务进度 popover，并根据 API 轮询刷新。

**包含范围**：
- 顶部工具区按钮或按钮组入口。
- popover 空态、加载态、错误态、任务列表态。
- compact checklist 展示结构，接近 Codex 进度样式：状态图标 + 任务文本。
- 任务状态中文展示：未完成、进行中、已完成。
- 从进度快照映射出稳定 view model，方便组件测试直接喂 fixture。
- 2 秒刷新定时器，随 popover 可见性和 thread 切换启停。
- 移动端紧凑工具区入口。

**不包含范围**：
- 左侧 thread 列表内容和布局。
- 全局汇总页面。
- 编排业务逻辑。

**依赖**：进度读写 API。

**复用/新建**：复用 `web/src/components/Layout.tsx` 的当前 thread 上下文、顶部区域、`web/src/components/MobileToolsMenu.tsx` 移动入口和现有 API helper；新增面板组件与前端 store/hook。

**数据结构/接口**：

```typescript
type ThreadTaskStatus = "pending" | "in_progress" | "completed";

interface ThreadTaskProgressItem {
  id: string;                         // 当前 session 内稳定任务 ID，等于 orchestration_task_id
  orchestration_task_id: string;      // 展示稳定 ID，由后端派生
  workflow_id?: string;               // 所属 workflow ID，用于追溯来源
  task_id: string;                    // 编排原始任务 ID，例如 SubAgentTask.task_id
  task_run_id: string;                // 编排运行任务 ID，例如 metadata.task_run_id
  desc: string;                       // Web checklist 展示文本
  status: ThreadTaskStatus;           // 任务状态枚举
  source_status?: string;             // 编排原始状态，用于保留 failed 等细节
  error_message?: string;             // 编排失败或异常说明
  display_order: number;              // 展示排序，从 0 开始
  updated_at_ms?: number;             // 任务最近更新时间，Unix 毫秒
}

interface ThreadTaskProgressSnapshot {
  schema_version: 1;                         // 当前文件格式版本
  session_id: string;                        // 绑定的 session/thread ID
  updated_at_ms: number;                     // 快照更新时间，Unix 毫秒
  source: "llm" | "workflow" | "api";        // 最近写入来源
  tasks: ThreadTaskProgressItem[];           // 当前任务列表
}

interface ThreadTaskProgressViewModel {
  title: "进度";                              // popover 标题
  variant: "compact_checklist";              // 当前展示样式
  items: ThreadTaskProgressDisplayItem[];     // 直接用于渲染和测试的展示项
  empty: { title: string; desc?: string };     // 无任务空态
}

interface ThreadTaskProgressDisplayItem {
  key: string;                               // React key，来自后端派生 progress key
  orchestration_task_id: string;             // 与编排任务的稳定映射
  task_id: string;                           // 编排任务 ID，方便测试和回溯
  desc: string;                              // Web checklist 展示文本
  status: ThreadTaskStatus;                  // 控制图标和可访问标签
  status_label: "未完成" | "进行中" | "已完成"; // 稳定中文状态标签
  icon_variant: "check_circle" | "ring" | "active_ring"; // 稳定视觉 token
  order: number;                             // 展示顺序
  aria_label: string;                        // 测试和无障碍共用标签
}
```

**风险等级**：中

**风险说明**：顶部区域已有 workflow、tools、status 等入口，新增入口需要保持扫描效率，移动端空间需要单独适配。

**task 建议**：
- 建议 task 名：`web-chat-thread-task-progress-v0.1`
- 对应 DoD：顶部入口、popover、空态、2 秒刷新、thread 切换
- 是否进入 x-req：是
- 原因：需求入口、交互、数据合同已经明确

### 模块 2：进度读写 API

**职责**：为 Web UI 与受控调用方提供当前 thread 的任务进度读取和写入入口。

**包含范围**：
- `GET /api/threads/{thread_id}/task-progress`
- `PUT /api/threads/{thread_id}/task-progress`
- thread id 校验与 thread metadata 存在性校验。
- DTO 校验、错误码、空文件默认值。
- `PUT` 仅作为 Web/测试/受控内部调试入口，写入时固定 `source="api"`。
- LLM 工具和 workflow 桥接各自调用仓储，不通过 REST 绕路写入。

**不包含范围**：
- 直接操作前端状态。
- 直接执行业务编排。
- 跨 session 写入。

**依赖**：Session 进度仓储、Web thread manager 或 thread metadata helper。

**复用/新建**：建议新增 `src/hosts/web/routers/thread_task_progress.py`，复用现有 Web router 注册方式和 API 测试模式。

**数据结构/接口**：

```python
class TaskProgressItemPayload(BaseModel):
    id: str                         # 当前 session 内稳定任务 ID，等于 orchestration_task_id
    orchestration_task_id: str      # 展示稳定 ID，由后端派生
    workflow_id: str | None = None  # 所属 workflow ID
    task_id: str                    # 编排原始任务 ID，例如 SubAgentTask.task_id
    task_run_id: str                # 编排运行任务 ID，例如 metadata.task_run_id
    desc: str                       # Web checklist 展示文本
    status: Literal["pending", "in_progress", "completed"]
    source_status: str | None = None
    error_message: str | None = None
    display_order: int              # 展示排序，从 0 开始
    updated_at_ms: int | None = None

class TaskProgressSnapshotPayload(BaseModel):
    schema_version: Literal[1] = 1
    session_id: str
    updated_at_ms: int
    source: Literal["llm", "workflow", "api"]
    tasks: list[TaskProgressItemPayload]
```

**风险等级**：低

**风险说明**：主要风险在路径解析和 schema 校验，接口本身简单。

**task 建议**：
- 建议 task 名：`web-chat-thread-task-progress-v0.1`
- 对应 DoD：GET/PUT、空态默认值、校验错误
- 是否进入 x-req：是
- 原因：可以用单元测试覆盖完整行为

### 模块 3：Session 进度仓储

**职责**：提供 API、LLM 工具、编排桥接共享的进度文件读写能力。

**包含范围**：
- 根据配置解析 session root，唯一口径为 `resolve_kongming_path(config.session.file_store_path)`。
- 计算 `<session_root>/<session_id>/task_progress.json`。
- 读取缺失文件时返回空快照。
- 写入前做 status、id、task_id、task_run_id、desc 校验；LLM 工具入口先由 `workflow_id + step_id` 派生内部 key。
- 原子写入 JSON。

**不包含范围**：
- UI 展示格式。
- LLM tool 参数解释。
- workflow 状态推导。

**依赖**：`resolve_kongming_path()`。

**复用/新建**：建议在基础设施侧新增共享 repository，供 `hosts.web` 与 `tools` 调用，避免 tool import web 或 web import tool。

**数据结构/接口**：

```python
class SessionTaskProgressRepository:
    @classmethod
    def from_config(cls, config: Config) -> "SessionTaskProgressRepository":
        """按 config.session.file_store_path 解析 session root，输出仓储实例。"""

    def read(self, session_id: str) -> TaskProgressSnapshot:
        """读取当前 session 的任务进度，文件缺失时返回空快照。"""

    def write(
        self,
        session_id: str,
        snapshot: TaskProgressSnapshot,
        *,
        expected_source: Literal["llm", "workflow", "api"],
    ) -> TaskProgressSnapshot:
        """校验并原子写入当前 session 的任务进度。"""
```

**风险等级**：中

**风险说明**：仓储位置需要符合项目依赖边界；建议放在 `infrastructure` 或专用合同模块，保持 hosts、tools、application 都能依赖。

**task 建议**：
- 建议 task 名：`web-chat-thread-task-progress-v0.1`
- 对应 DoD：路径解析、缺失文件、原子写入、schema 校验
- 是否进入 x-req：是
- 原因：这是 UI、API、LLM 工具共享事实源

### 模块 4：LLM 进度写入工具

**职责**：给 LLM 提供“设置当前 session 任务进度”的工具接口，写入同一 session 目录文件。

**包含范围**：
- 工具名称和参数 schema。
- 使用当前 `ToolContext.session_id`，禁止参数指定任意 session。
- 推荐参数中的每条任务只带 `workflow_id`、`step_id`、`desc`、`status`；`task_id`、`task_run_id`、`orchestration_task_id` 由工具派生并写入存储合同。临时手写任务省略 `workflow_id` 时使用 `manual:<step_id>`。
- 调用 Session 进度仓储写入快照。
- 工具写入固定 `source="llm"`，`session_id` 只来自 `ToolContext.session_id`。
- 返回写入后的 counts 和更新时间。
- 安全策略配置。

**不包含范围**：
- 读取其他 session。
- 创建 workflow。
- 自动推断任务拆分策略。

**依赖**：Tool registry、ToolContext、Session 进度仓储、安全默认规则。

**复用/新建**：建议新增 builtin tool，并在 Web/CLI 默认 registry 中注册；是否静默允许由 x-req 明确。

**数据结构/接口**：

```json
{
  "tasks": [
    {
      "step_id": "task-001",
      "desc": "梳理接口合同",
      "status": "in_progress",
      "display_order": 0
    }
  ],
  "source": "llm"
}
```

**风险等级**：中

**风险说明**：工具会写文件，但范围限定为当前 session 元数据；安全策略需要在“静默允许”和“标准审批”之间做产品决策。

**task 建议**：
- 建议 task 名：`web-chat-thread-task-progress-v0.1`
- 对应 DoD：LLM 写入、当前 session 限定、返回结果、测试覆盖
- 是否进入 x-req：是
- 原因：用户明确要求提供 LLM 填写接口

### 模块 5：编排进度桥接

**职责**：读取 agent workflow 的 `task_id` 和 `task_run_id`，在 workflow 事件发生时把编排状态同步为当前 session 任务进度。

**包含范围**：
- 明确 workflow 事件到 task status 的映射。
- 明确 `workflow_id`、`task_id`、`task_run_id`、`desc`、排序和内部 progress key 生成规则。
- 在确定时机调用 Session 进度仓储。
- workflow 桥接固定 `source="workflow"`。
- 与 LLM 工具写入同一 schema。

**不包含范围**：
- 改写 agent workflow artifact 格式。
- 建立完整 timeline。
- 强制所有 provider 支持编排进度。

**依赖**：agent workflow manager、Session 进度仓储。

**复用/新建**：优先做薄桥接函数，放在 workflow 所属模块内，由 workflow manager 在状态变化时调用。

**数据结构/接口**：

```python
def sync_workflow_progress(session_id: str, workflow_state: AgentWorkflowState) -> TaskProgressSnapshot:
    """把当前 workflow 状态映射为 session 任务进度快照。"""
```

第一版 ID 映射规则：

| 来源字段 | 目标字段 | 说明 |
|----------|----------|------|
| `workflow_id` | `workflow_id` | 所属 workflow |
| `SubAgentTask.task_id` | `task_id` | 编排原始任务 ID |
| `SubAgentTask.metadata.task_run_id` | `task_run_id` | 一次运行的任务 ID，例如 `001-reviewer` |
| `<workflow_id>:<task_run_id>` | workflow bridge 的 `orchestration_task_id` / `id` | 展示项稳定 key |
| `<workflow_id>:<step_id>` | LLM tool 的 `orchestration_task_id` / `id` | task_flow 执行期展示项稳定 key |
| `SubAgentTask.task_name` 或 task spec desc | `desc` | Web checklist 展示文本 |
| `display_order` | `display_order` | compact checklist 顺序 |

第一版事件映射规则：

| workflow 事件 | 目标状态 | 说明 |
|---------------|----------|------|
| `workflow_started` / `agent_assigned` | `pending` | 初始写入任务列表 |
| `agent_started` 或子 agent 运行开始 | `in_progress` | 当前任务执行中 |
| `agent_completed` | `completed` | 子任务成功完成 |
| `agent_failed` | `pending` | 保持三态合同；`source_status="failed"`，`error_message` 保存失败原因 |
| `workflow_completed` | 重新计算 | 按最终 run/report 状态覆盖快照 |

**风险等级**：中

**风险说明**：现有 parallel workflow 是事件驱动并发模型，第一版以 `task_run_id` 为展示粒度，并把失败映射到未完成加错误说明。

**task 建议**：
- 建议 task 名：`web-chat-thread-task-progress-v0.1` 或 `agent-workflow-task-progress-bridge-v0.1`
- 对应 DoD：workflow 事件写入、task_run_id 映射
- 是否进入 x-req：是
- 原因：用户已指定数据来源暂定读取编排 task id
