# 目标与边界

## 第一性原理

agent 是“上下文 + 工具 + 模型 + 运行循环”的状态机。多 agent 编排是在多个状态机之间分配信息、权限和结果流，核心变量只有四个：上下文隔离、工具授权、调度顺序、结果收敛。

kongming-agent 已有单一 `Runner`、统一 `Tool` 协议、统一 `Session` 协议和 `EventSink` fan-out。子 agent 编排要复用这些稳定边界，新增 manager 负责生命周期和审计，保持 `core` 的运行语义稳定。

## 设计目标

- 主 agent 通过一个工具创建多个子 agent，子 agent 并行完成简单独立任务。
- 每个子 agent 使用独立 session，父会话历史不会整体 fork 给子 agent。
- 每个子 agent 只收到任务 prompt、必要 context、显式工具白名单和工作目录。
- workflow 审计文件落在父 session 目录下的独立编排任务目录。
- CLI 首版可真实跑通 MiniMax M3 的小任务 smoke。
- 后续可扩展多种编排模式，第一版只实现 `parallel`。

## 非目标

- v0.1 不实现跨轮 mailbox。
- v0.1 不实现子 agent resume / close。
- v0.1 不实现子 agent 递归创建子 agent。
- v0.1 不实现 full-history fork。
- v0.1 不把编排协议提前上升到 `core.contracts`。

## 编排方式

| 编排方式 | 本质 | 优点 | 代价 |
|----------|------|------|------|
| 并行 fan-out / fan-in | 把任务拆成独立叶子节点，统一等待结果 | 实现简单、上下文隔离强、审计清晰 | 依赖拆分质量，任务间协作弱 |
| supervisor-worker | 父 agent 分阶段派活、追问和收敛 | 适合复杂目标和长链路修复 | 需要 mailbox、寻址、等待和状态恢复 |
| pipeline / DAG | 按依赖图把上游结果传给下游 | 适合有明确阶段依赖的工程流 | 需要依赖建模、失败传播和重试 |
| review panel | 多个 agent 从不同视角评审同一产物 | 适合架构、安全、测试等审查 | 需要冲突归并和成本控制 |

v0.1 选择并行 fan-out / fan-in，因为它能验证最关键的系统性质：独立上下文、显式工具白名单、审计目录、结果回传、单一 `Runner` 复用。

## 边界约束

- `core/` 保持运行协议和 `Runner` 语义，编排模块不向 core 注入专用流程。
- `SubAgentManager` 只暴露 `run_task()`，内部维护子 session、子 `AgentSpec`、dispatch prompt 和 enabled tools。
- `AgentWorkflowManager` 只通过 `SubAgentManager` 运行子任务，内部维护 workflow id、工作目录、审计文件和结果文件。
- `AgentWorkflowTool` 只解析主 agent 的 tool 参数并调用 `AgentWorkflowManager`，不接触 runner、session factory、LLM provider。
- CLI 只负责装配：`SessionEngine.build()` 完成后创建 manager 并绑定 tool handle。
- 子 agent 工作目录必须位于项目 workspace root 内。

## 完成标准

- 主 agent 可见 tool 名为 `run_parallel_subagents`，schema 支持 `tasks[]` 与 `mode=parallel`。
- `tasks` 至少 1 个、最多 8 个，每个任务包含 `task_name` 和 `prompt`，可选 `context` 与 `tool_names`。
- 每个任务生成独立子 session id，子 session 文件与父 session 分离。
- 每个 workflow 生成 `workflow.json`、`audit.jsonl`、`result.json` 和每个子 agent 的 `agents/<task_id>/result.json`。
- 单测覆盖上下文隔离、审计文件、tool 调用、父 agent 通过 tool 创建子 agent。
- CLI smoke 能用真实 MiniMax M3 跑通一个计算任务和一个受限文件写入任务。
