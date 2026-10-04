# loop 多 agent 重构方案

## 目标

构建一套统一的 Agent Harness 框架，让主 agent、子 agent、workflow、tool call、approval、shell process 都进入同一棵会话任务树。

核心目标：

- 主 agent 与子 agent 使用同一套代码路径：同一个 `Runner` turn loop，同一种 `AgentNode` 身份模型，同一种 `HarnessTask` 任务模型。
- 数据结构通过 `parent_agent_id` 表达层级：会话根 agent 的 `parent_agent_id = None`，派生 agent 指向父 agent。
- 每个聊天会话是一棵独立 `AgentTree`：树根是当前会话主 agent，树枝是子 agent、tool call、approval、process 等任务节点。
- agent 派发后台任务后，父 agent 的当前 run 可以结束并进入 idle；后台 agent 继续执行，用户可以继续和父 agent 对话。
- interrupt 按树递归传播：打断父 agent 会递归打断它派出的 agent、正在执行的工具、pending approval、bash 进程。
- subagent 与 workflow 都通过同一个 TaskGraph 提交和执行机制组合出来。

## 第一性原理

1. Agent 是带身份的执行者。
   一个 agent 的本质是 `agent_id + parent_agent_id + session_id + AgentSpec + runtime scope`。主 agent 与子 agent 的执行语义相同，层级关系只由 `parent_agent_id` 表达。

2. Task 是可观察的工作单元。
   每个可被调度、追踪、等待、取消的工作都建模为 `HarnessTask`。agent run、tool call、approval、shell process、workflow step 都是 task。

3. 会话树是隔离域。
   `tree_id = thread_id`。同一树内共享父子关系、事件、任务索引和取消链；不同树的 session、task、tool state、approval、process registry 分桶隔离。

4. Runner 负责 turn loop。
   `Runner` 继续作为唯一 turn 推进逻辑，负责 LLM 请求、tool call 回填、取消收口、Result 生成。Harness 负责调度、生命周期、后台任务、树级状态和递归取消。

5. Tool call 也是 task。
   工具调用带上 `tree_id + agent_id + run_id + task_id + tool_call_id`。工具内部产生的 approval、process、文件产物都挂到同一 task 链上。

6. 后台派发是异步任务。
   父 agent 调用派发工具后，Harness 创建子 agent task 并启动后台 run。父 run 可以通过 `RunDirective` 正常结束，子 agent 完成后把结果写入 parent inbox 与事件流。

7. Workflow 是 TaskGraph。
   workflow 的价值是规划任务图、约束并发、汇总结果。底层执行统一走 `AgentHarnessManager.submit_task_graph()`，单个 subagent 派发也走同一机制。

## 核心数据模型

### AgentTree

`AgentTree` 是会话级运行时边界。

建议字段：

```python
@dataclass(frozen=True)
class AgentTree:
    tree_id: str
    root_agent_id: str
    thread_id: str
    created_at: str
    status: Literal["active", "archived", "cancelled"]
```

职责：

- 维护 root agent 与 descendants 的归属关系。
- 提供树级 task/event/process/approval 索引。
- 支撑 Web 侧展示整棵会话任务树。

### AgentNode

`AgentNode` 表示一个 agent 身份。

建议字段：

```python
@dataclass(frozen=True)
class AgentNode:
    tree_id: str
    agent_id: str
    parent_agent_id: str | None
    session_id: str
    name: str
    spec: AgentSpec
    tool_names: tuple[str, ...]
    skill_names: tuple[str, ...]
    metadata: dict[str, object]
```

语义：

- root agent：`parent_agent_id = None`。
- child agent：`parent_agent_id = <parent agent id>`。
- 每个 agent 有自己的 session、system prompt、tool set、skill set、runtime config。

### HarnessTask

`HarnessTask` 表示任务树中的可执行或可等待单元。

建议字段：

```python
@dataclass
class HarnessTask:
    tree_id: str
    task_id: str
    agent_id: str
    parent_task_id: str | None
    kind: Literal[
        "agent_run",
        "tool_call",
        "approval",
        "process",
        "workflow_step",
    ]
    status: Literal[
        "queued",
        "running",
        "awaiting_approval",
        "completed",
        "failed",
        "cancelled",
    ]
    run_id: str | None
    tool_call_id: str | None
    started_at: str | None
    finished_at: str | None
    result_ref: str | None
    error_message: str | None
    metadata: dict[str, object]
```

语义：

- task 是统一状态机；`asyncio.Task` 是 runtime handle，存放在 manager 内部。
- tool call、approval、process 都有稳定 task id，便于日志、UI、取消和审计。
- workflow step 是 TaskGraph 中的计划节点，执行时可以派生 agent run。

### TaskGraph

`TaskGraph` 表示 workflow 或批量派发计划。

建议字段：

```python
@dataclass(frozen=True)
class TaskGraph:
    graph_id: str
    tree_id: str
    owner_agent_id: str
    nodes: tuple[TaskGraphNode, ...]
    edges: tuple[TaskGraphEdge, ...]
    limits: TaskGraphLimits
```

语义：

- `parallel` 是多个无依赖 node。
- `map_reduce` 是 mapper node 集合 + reducer node。
- `roundtable_review` 是多轮 node graph。
- `deep_research` 是 planner/source/jury/report 的图。

### RunDirective

`RunDirective` 让工具调用可以显式结束父 agent 当前 run。

建议字段：

```python
@dataclass(frozen=True)
class RunDirective:
    finish_parent_run: bool
    finish_reason: Literal["background_delegated", "completed", "blocked"]
    assistant_notice: str | None
    task_ids: tuple[str, ...]
```

典型场景：

- A 调用 `delegate_agent_task(wait=false)`。
- Harness 创建 B 的后台 task。
- tool result 带 `RunDirective(finish_parent_run=True, assistant_notice="我已经派出 b 读文档，等待 b 回复")`。
- Runner 追加 assistant notice，父 run 正常收口为 completed，A 进入 idle。

## 统一 Manager 接口

新增 `application/agent_harness/agent_harness_manager.py`，作为唯一调度门户。

建议接口：

```python
class AgentHarnessManager:
    async def submit_user_input(
        self,
        *,
        tree_id: str,
        agent_id: str,
        text: str,
        attachments: list[dict[str, object]] | None = None,
        references: list[dict[str, object]] | None = None,
    ) -> HarnessTaskSnapshot: ...

    async def delegate_agent_task(
        self,
        *,
        tree_id: str,
        parent_agent_id: str,
        task_name: str,
        prompt: str,
        context: str = "",
        wait: bool = False,
        agent_role_id: str | None = None,
        tool_names: tuple[str, ...] = (),
        skill_names: tuple[str, ...] = (),
        metadata: dict[str, object] | None = None,
    ) -> DelegateResult: ...

    async def submit_task_graph(
        self,
        *,
        tree_id: str,
        owner_agent_id: str,
        graph: TaskGraph,
    ) -> TaskGraphRun: ...

    async def collect_task_result(
        self,
        *,
        tree_id: str,
        task_id: str,
        timeout_seconds: float | None = None,
    ) -> HarnessTaskResult: ...

    async def interrupt_scope(
        self,
        *,
        tree_id: str,
        agent_id: str | None = None,
        task_id: str | None = None,
        reason: str = "user_interrupt",
    ) -> InterruptResult: ...
```

入口语义：

- `submit_user_input` 服务 root agent 和用户继续对话。
- `delegate_agent_task` 服务单个子 agent 派发，可等待或后台执行。
- `submit_task_graph` 服务所有 workflow。
- `collect_task_result` 服务父 agent 主动等待已派发任务。
- `interrupt_scope` 服务 Web Stop、thread evict、shutdown、workflow cancel。

## A 派 B 的执行流

```text
user -> A(root) Runner.run
  A 调用 delegate_agent_task(wait=false)
    AgentHarnessManager 创建 B AgentNode(parent=A)
    AgentHarnessManager 创建 HarnessTask(kind=agent_run, agent_id=B)
    AgentHarnessManager 后台启动 B Runner.run
    delegate tool 返回 task_id + RunDirective
  Runner 追加 assistant notice
  Runner 结束 A 当前 run
thread cell 显示 A idle, B running
user 可以继续向 A 发送输入
B 完成后写入 B session、parent inbox、task.completed event
A 下一轮上下文读取 active_children / completed_children 摘要
```

关键点：

- B 的历史写入 B 自己的 session。
- A 的历史只接收派发记录、任务状态摘要、B 的最终结果摘要。
- A 后续对话通过 context source 看到 `running child tasks` 和 `completed child reports`。
- B 的工具调用与 A 的工具调用进入同一 `HarnessTask` 索引，使用 `agent_id` 区分归属。

## ToolContext 扩展

现有 `ToolContext` 已包含 `run_id/session_id/turn/call_id/metadata`。建议增加强类型 harness 字段：

```python
@dataclass(frozen=True)
class ToolContext:
    run_id: str
    session_id: str
    turn: int
    call_id: str
    tree_id: str | None = None
    agent_id: str | None = None
    task_id: str | None = None
    parent_task_id: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
```

短期可以先继续通过 `metadata["harness"]` 传递，迁移完成后提升为字段。

工具执行流程：

1. Runner 收到 tool call。
2. HarnessManager 创建 `HarnessTask(kind="tool_call")`。
3. Runner 构造带 `tree_id/agent_id/task_id` 的 ToolContext。
4. tool 内部如果创建 approval 或 process，继续挂到当前 task。
5. tool 完成后 HarnessManager 更新 task status。

## 取消链设计

`interrupt_scope(tree_id, agent_id=root)` 递归取消整棵子树。

取消顺序：

1. 标记 scope 为 cancelling，冻结新任务提交。
2. 找到 active descendant tasks。
3. cancel agent run 的 `asyncio.Task`。
4. cancel 正在执行的 tool call。
5. cancel pending approval。
6. kill process registry 中关联 PID。
7. 等待 task 收口并写入 cancelled result。
8. 广播 `task.cancelled`、`agent.cancelled`、`tree.cancelled` 事件。

建议新增 `ProcessRegistry`：

```python
class ProcessRegistry:
    def register(self, *, tree_id: str, task_id: str, pid: int) -> None: ...
    async def kill_task_processes(self, *, tree_id: str, task_id: str) -> None: ...
    async def kill_scope_processes(self, *, tree_id: str, task_ids: set[str]) -> None: ...
```

`ShellTool` 当前已有 `CancelledError -> process.kill() + wait()` 兜底。`ProcessRegistry` 负责跨层取消时从树级索引找到 PID。

## Workflow 统一方式

workflow strategy 只做三件事：

1. 解析 payload，生成 `TaskGraph`。
2. 调用 `AgentHarnessManager.submit_task_graph()`。
3. 汇总 `TaskGraphRun` 生成报告产物。

`parallel` 示例：

```text
payload.task_specs
  -> TaskGraph(nodes=[agent_run, agent_run, ...], edges=[])
  -> submit_task_graph(max_concurrency=N)
  -> collect all results
  -> report_index/result.json
```

`map_reduce` 示例：

```text
mapper nodes 并发执行
  -> reducer node 依赖所有 mapper
  -> reducer 汇总 mapper outputs
```

`roundtable_review` 示例：

```text
independent reviewer nodes
  -> optional rebuttal nodes
  -> arbiter node
```

所有 workflow 通过 TaskGraph 表达并发、依赖、超时、取消和结果汇总。

## Web 状态模型

前端建议展示三层：

- Thread tree：root agent 与子 agent 树。
- Task list：当前 tree 的 active/completed tasks。
- Task detail：单个 task 的 session、tool calls、approval、process、result refs。

后端 REST/WS 建议：

- `GET /api/threads/{thread_id}/agent-tree`
- `GET /api/threads/{thread_id}/tasks`
- `GET /api/threads/{thread_id}/tasks/{task_id}`
- `POST /api/threads/{thread_id}/tasks/{task_id}/interrupt`
- WS frame：`agent.node.started/completed/cancelled`
- WS frame：`harness.task.started/progress/completed/failed/cancelled`

协议真源仍遵循 Python `src/hosts/web/protocol/` 与 TS `web/src/protocol.ts` 同步。

## 技术栈

沿用当前仓库技术栈：

- Python 3.11+：匹配当前 `pyproject.toml`。
- `asyncio` + `TaskGroup`：表达后台 agent、并发 TaskGraph、结构化取消。
- dataclass：表达 core contracts 与不可变值对象。
- Pydantic v2：表达 REST/WS DTO，继续使用 `extra="forbid"` 做协议漂移防护。
- FastAPI：承载 Web REST/WS。
- EventSink：承载 task/agent/tree 事件 fan-out。
- pytest + pytest-asyncio：覆盖 manager、runner、tool、Web route、cancel 链。
- React + TypeScript + Zustand：前端状态树与任务列表展示。
- Vitest + Playwright：覆盖 UI 状态和跨前后端 smoke。

设计理由：

- `Runner` 已经是唯一 turn loop，复用它可以保持核心执行语义稳定。
- HarnessManager 放在 application 层，符合 core 零 sibling 依赖约束。
- `core.contracts` 只放共享数据合同，保持跨模块协议真源。
- `TaskGraph` 把 workflow 变成调度输入，策略层保持轻量。
- `ProcessRegistry` 让 bash 进程进入 task 归属链，interrupt 能精确回收资源。

## 迁移路径

### 阶段 1：合同与骨架

- 新增 `src/core/contracts/agent_harness.py`。
- 定义 `AgentTree`、`AgentNode`、`HarnessTask`、`TaskGraph`、`RunDirective`。
- 新增 `src/application/agent_harness/agent_harness_manager.py`。
- 先接入内存 registry，再写 JSONL/task snapshot 持久化。

### 阶段 2：Runner 与 ToolContext

- Runner 注入 harness metadata。
- tool call 前后登记 `HarnessTask(kind="tool_call")`。
- `ToolContext` 透传 `tree_id/agent_id/task_id`。
- `ShellTool` 接入 `ProcessRegistry`。

### 阶段 3：后台派发工具

- 新增 `delegate_agent_task`。
- 支持 `wait=false` 后台派发和 `wait=true` 同步等待。
- 支持 `RunDirective` 结束父 run。
- 父 agent 上下文增加 active/completed child task 摘要。

### 阶段 4：workflow 收敛

- `run_parallel_subagents` 改为提交 `TaskGraph`。
- `run_agent_workflow` 各 strategy 改为 planner + summarizer。
- 现有 `SubAgentManager` 的 child session 创建、runtime resolve、scoped permission 逻辑迁入 HarnessManager。
- 现有 workflow artifact writer 可保留为报告层。

### 阶段 5：Web 与取消链

- Web Stop 调用 `interrupt_scope(tree_id, agent_id=root)`。
- thread evict/shutdown 调用 tree scope cancel。
- REST/WS 增加 agent tree 与 task tree DTO。
- 前端展示 root agent idle 与 child agent running 的并存状态。

### 阶段 6：测试

必须覆盖：

- A 派 B 后 A 进入 idle，B 后台 running，用户继续给 A 发送输入。
- B 有独立 session、system prompt、tool set、skill set。
- tool call 带 `tree_id/agent_id/task_id`。
- interrupt A 递归 cancel B、B 的 tool、B 的 shell process。
- 两个 thread 的 agent tree 完全隔离。
- workflow 与直接 subagent 派发走同一 HarnessManager。
- Web REST/WS DTO 与 TS protocol 同步。

## 推荐最终形态

最终架构保持三层：

```text
core
  Runner: 唯一 turn loop
  contracts.agent_harness: AgentTree / AgentNode / HarnessTask / TaskGraph / RunDirective

application
  AgentHarnessManager: 唯一 agent/task/tree 调度门户
  Workflow strategies: TaskGraph planner + report summarizer

hosts
  CLI/Web/Scheduler: 只提交 user input、TaskGraph、interrupt scope
```

最关键的落点是：HarnessManager 成为唯一调度入口，Runner 成为唯一执行 loop，TaskGraph 成为 workflow 与 subagent 的共同表达。
