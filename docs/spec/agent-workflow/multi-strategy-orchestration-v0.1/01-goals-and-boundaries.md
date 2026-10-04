# 目标与边界

## 目标

多策略编排的目标是建立统一的 workflow strategy 执行底座，让 LLM 可以基于中文策略说明选择编排模式，runtime 可以基于同一套协议执行不同策略。

## 完成标准

| DoD | 说明 | 对应模块 |
|-----|------|----------|
| D1 | LLM 可以列出所有已注册策略，并看到中文标题、摘要、适用场景和风险 | `AgentWorkflowStrategyManager`、`WorkflowStrategyDescription` |
| D2 | LLM 可以按 `mode` 获取某个策略的详细中文说明、输入 schema 和示例 payload | `describe()`、`AgentWorkflowTool v2` |
| D3 | `AgentWorkflowManager` 作为公开 facade 按 `mode` 分发到已注册 strategy | `AgentWorkflowStrategyManager` |
| D4 | `parallel` 迁移为 `ParallelWorkflowStrategy` 后旧行为保持 | `ParallelWorkflowStrategy` |
| D5 | 未知 `mode`、缺字段、schema 不匹配能返回模型可读错误 | `WorkflowRunRequest`、validator |
| D6 | workflow audit、result、report index 的生命周期由 manager 统一维护 | `WorkflowExecutionContext` |
| D7 | 后续 `map_reduce`、pipeline/DAG、review panel 可以独立注册 | `WorkflowStrategy` |

## 范围

包含：
- `AgentWorkflowStrategyManager`。
- `AgentWorkflowManager` facade 集成。
- `WorkflowStrategy` protocol。
- `WorkflowStrategyCatalogEntry` 与 `WorkflowStrategyDescription`。
- `WorkflowExecutionContext`。
- 中文策略说明规范。
- `parallel` strategy 迁移。
- tool 层 list / describe / run 入口。
- registry 分发、未知模式错误、审计生命周期统一。

暂缓：
- `map_reduce` planner/materializer/reducer 的完整实现。
- pipeline/DAG 节点执行器。
- review panel 冲突归并。
- supervisor-worker 的 wait / followup / close / resume。
- mailbox / notification store。
- Web workflow timeline 专用 UI。

## 关键约束

- 协议字段名使用英文，LLM 面向文本使用中文。
- `tools/` 层通过 late-bound handle 调用 `AgentWorkflowManager` facade。
- `AgentWorkflowManager` 持有 `AgentWorkflowStrategyManager`，保留 workflow 生命周期公开边界。
- `WorkflowStrategy` 表达单个策略的 payload 校验和调度逻辑。
- 子 agent 创建、权限、工作目录和工具白名单仍由 `SubAgentManager` / scoped permission 模块承接。
- `parallel` 旧 tool 行为必须通过回归测试保持。

## 追溯矩阵

| DoD 条目 | 模块 | 首批 task |
|----------|------|-----------|
| D1 | Strategy manager + description | `agent-workflow-strategy-manager-v0.1` |
| D2 | Tool v2 + description | `agent-workflow-tool-catalog-v0.1` |
| D3 | Manager facade + strategy manager | `agent-workflow-strategy-manager-v0.1` |
| D4 | Parallel strategy | `parallel-strategy-migration-v0.1` |
| D5 | Request parser + errors | `agent-workflow-strategy-manager-v0.1` |
| D6 | Execution context + audit | `agent-workflow-strategy-manager-v0.1` |
| D7 | Strategy protocol | `agent-workflow-strategy-manager-v0.1` |

## 成功信号

- `list_agent_workflow_strategies` 返回中文策略目录。
- `describe_agent_workflow_strategy("parallel")` 返回完整中文说明和示例。
- `run_agent_workflow(mode="parallel", payload={...})` 复用现有并行编排行为。
- 未注册 `mode` 返回包含可用策略列表的错误。
- 后续 `map_reduce` 完成 planner、input materializer、reducer 后接入 strategy，manager 主流程保持稳定。
