# multi-strategy-orchestration-v0.1

> 状态：方案确认
> 目标：把 agent workflow 从单一 `parallel` 模式升级为多策略编排底座，让 LLM 通过中文策略说明选择模式，由 runtime strategy 负责生成调度计划和归并规则，由 `SubAgentManager` 负责子 agent 生命周期，由 workflow runtime 负责审计和结果收口。

## 系统目标

多策略编排解决两个问题：第一，LLM 需要知道当前 runtime 支持哪些编排模式、每种模式适合什么任务、需要哪些输入；第二，runtime 需要用统一边界执行不同策略，把调度计划、子 agent 生命周期调用、权限、审计、重试和结果归并逻辑收口到 runtime。

核心设计是在现有 `AgentWorkflowManager` facade 内新增 `AgentWorkflowStrategyManager`。facade 继续作为 tool handle 绑定对象，负责公开 workflow 生命周期入口；strategy manager 作为内部组件，负责注册策略、列出策略、返回中文策略说明，并按 `mode` 分发到对应 `WorkflowStrategy`。LLM 选择策略并填写 payload；策略执行编排。

## 最小可用路径

主 agent 调用 `list_agent_workflow_strategies` 查看中文策略目录 -> 选择一个 `mode` -> 调用 `describe_agent_workflow_strategy(mode)` 获取输入 schema、适用场景、示例和风险 -> 主 agent 生成 payload -> 调用 `run_agent_workflow(mode, payload)` -> tool 通过 late-bound handle 交给 `AgentWorkflowManager` -> facade 委托 `AgentWorkflowStrategyManager` 查找策略并执行 -> strategy 生成调度计划并调用 `SubAgentManager` 执行子 agent 任务 -> workflow runtime 写审计与结果产物 -> 返回 `AgentWorkflowResult` 给主 agent。

## 设计结论

- 策略包含两部分：LLM 可见的中文说明和 runtime 可执行的调度逻辑。
- `catalog_entry()` 面向快速选型，字段名稳定，说明文本中文。
- `describe()` 面向详细使用，包含适用场景、输入 schema、输出、示例、风险。
- `run()` 面向 runtime 执行，负责策略级调度、调用 `SubAgentManager` 和结果归并；workflow audit、result、report index 通过 `WorkflowExecutionContext` / facade 统一写入。
- `parallel` 是第一种可执行 strategy，当前通过 registry 分发后复用既有 `AgentWorkflowManager.run_parallel_specs()` 链路。
- `map_reduce` 的 contract 已完成，下一步以独立 `strategies/map_reduce/` 策略包接入 registry；第一阶段保持 `parallel` 旧链路稳定。

## 策略分层

| 层 | 职责 | LLM 可见 |
|----|------|----------|
| `AgentWorkflowManager` | 公开 facade、workflow 生命周期入口、tool handle 绑定对象 | 部分可见 |
| `AgentWorkflowStrategyManager` | registry、catalog、describe、run dispatch | 部分可见 |
| `WorkflowStrategy` | 单个编排模式的调度计划、子 agent 调用顺序和归并规则 | 通过 description 可见 |
| `AgentWorkflowTool` | 暴露 list / describe / run 三类工具 | 可见 |
| `SubAgentManager` | 子 agent 创建、session、权限、工具白名单和运行生命周期 | 隐藏 |
| `AgentWorkflowAudit` | workflow.json、audit.jsonl、result.json、reports/index.json | 通过结果路径可见 |

## 模块导航

| 模块 | 状态 | 文档 | 是否可进 task | 说明 |
|------|------|------|---------------|------|
| `AgentWorkflowManager facade` | 可进入 x-req | [02-module-breakdown.md](./02-module-breakdown.md) | 是 | 保持现有公开入口，内部持有 strategy manager |
| `AgentWorkflowStrategyManager` | 可进入 x-req | [02-module-breakdown.md](./02-module-breakdown.md) | 是 | 管理策略注册、中文说明查询和 mode 分发 |
| `WorkflowStrategy` | 可进入 x-req | [02-module-breakdown.md](./02-module-breakdown.md) | 是 | 所有编排策略的执行协议 |
| `WorkflowStrategyDescription` | 可进入 x-req | [04-data-and-state.md](./04-data-and-state.md) | 是 | 给 LLM 看的中文 catalog 和详细说明 |
| `WorkflowExecutionContext` | 可进入 x-req | [04-data-and-state.md](./04-data-and-state.md) | 是 | 统一 workflow id、目录、审计、result 生命周期 |
| `ParallelWorkflowStrategy` | 已完成 | [02-module-breakdown.md](./02-module-breakdown.md) | 后续重构 | 已接入 registry，当前保留旧 manager 执行链路 |
| `AgentWorkflowTool v2` | 方案确认 | [03-core-workflows.md](./03-core-workflows.md) | 是 | 暴露 list / describe / run 工具入口 |
| `MapReduceStrategy` | 可进入 x-req | [map-reduce-v0.1](../map-reduce-v0.1/README.md) | 是 | 先独立拆包并接入 runtime strategy，parallel 暂不搬迁 |

## 文档导航

- [架构图](./architecture.html)
- [目标与边界](./01-goals-and-boundaries.md)
- [模块拆分](./02-module-breakdown.md)
- [核心流程](./03-core-workflows.md)
- [数据模型与状态](./04-data-and-state.md)
- [验证策略与演进](./05-validation-and-evolution.md)
- [Task 映射](./90-task-map.md)

## 当前建议

已完成 `agent-workflow-strategy-manager-v0.1` 和 `parallel-strategy-migration-v0.1`。下一轮进入 `map-reduce-strategy-integration-v0.1`，先把 `map_reduce` 作为独立策略包接入 registry，复用现有 strategy manager、`WorkflowExecutionContext` 和 `SubAgentManager`；`parallel` 拆包重构单独进入后续 `parallel-strategy-package-refactor-v0.1`，避免同一轮同时改动已有稳定链路和新增策略。
