# subagent-orchestration-v0.1

> 状态：实现已落地，spec 回写
> 目标：在 CLI 和通用 agent 内核里提供最小多 agent 编排能力，让主 agent 能通过 tool 创建独立子 agent 并行处理简单任务。

## 系统目标

多 agent 编排的本质是把一个父级目标拆成多个有边界的状态机：每个子 agent 只拿到完成自己任务所需的 prompt、最小上下文和显式工具白名单；workflow 层负责派发、并发、审计和结果收口；父 agent 保留最终判断权。

第一版采用 fan-out / fan-in：主 agent 调用 `run_parallel_subagents`，一次提交 N 个独立任务；`AgentWorkflowManager` 为每个任务创建工作目录和审计记录；`SubAgentManager` 使用同一个 `Runner` 边界启动独立 session；所有子任务结束后，workflow 把结果报告给主 agent。

## 策略目录文案

`parallel` 在运行时策略目录、Web slash catalog 和 LLM workflow 选型提示中使用同一组 title/desc：

| 字段 | 内容 |
|------|------|
| `mode` | `parallel` |
| `title` | `并行子任务` |
| `desc` | `把多个互不依赖的子任务同时派发给子 agent，等待全部返回后汇总报告。` |
| `when_to_use` | 任务可拆成多个互不依赖子任务；每个子任务只需要自己的 prompt、上下文和授权工具；结果可按子任务报告直接汇总。 |

## 最小可用路径

主 agent 识别可拆分任务 -> 调用 `run_parallel_subagents` -> tool 层解析 `tasks` 与 `mode` -> `AgentWorkflowManager.run_workflow_specs()` 选择 `parallel` -> 为每个任务创建独立工作目录和审计记录 -> `SubAgentManager.run_task()` 用新 session 调 `Runner.run()` -> workflow 写入 `result.json` 与 `audit.jsonl` -> tool 把子 agent 报告返回主 agent。

## 编排方式取舍

| 模式 | 核心机制 | 适合场景 | 主要代价 | v0.1 处理 |
|------|----------|----------|----------|-----------|
| 并行 fan-out / fan-in | 一次拆 N 个独立任务，并发执行后汇总 | 简单计算、独立文件操作、并行审查、资料归纳 | 依赖任务拆分质量，跨任务协调弱 | 已实现 |
| supervisor-worker | 主 agent 分阶段派活、等待、追问、收敛 | 复杂实现、迭代式调研、持续修复 | 需要 mailbox、状态寻址、超时和取消 | 后续 |
| pipeline / DAG | 上游结果成为下游输入，按依赖图调度 | 构建、分析、验证链路 | 需要依赖图、失败传播和重试策略 | 后续 |
| review panel | 多个 agent 对同一产物从不同维度审查 | 架构评审、安全审查、测试审查 | 成本更高，需要冲突合并 | 后续 |
| recursive tree | 子 agent 继续拆分子任务 | 大任务递归规划 | 深度控制、资源治理和审计复杂度高 | 后续 |

## 范围边界

**包含**：
- `SubAgentManager`：子 agent 生命周期、独立 session、子 agent prompt 和工具白名单。
- `AgentWorkflowManager`：workflow 模式入口、并行调度、审计目录、结果文件。
- `AgentWorkflowTool`：主 agent 可见的 tool schema、参数校验、结果格式化。
- CLI 装配：在 `SessionEngine.build()` 后创建 manager 并把 tool handle 绑定到 workflow manager。
- 第一版 CLI smoke：用真实模型跑一个计算任务和一个受限文件写入任务。

**后续演进**：
- mailbox / followup / wait / close / resume。
- DAG、supervisor-worker、review panel 等模式。
- workflow 级 timeout、取消、重试和并发配额。
- Web UI 上的 workflow 时间线和审计查看器。
- 跨 session backend 的显式 audit root resolver。

## 模块导航

| 模块 | 状态 | 文档 | 是否可进 task | 说明 |
|------|------|------|---------------|------|
| `SubAgentManager` | 已实现 | [02-module-breakdown.md](./02-module-breakdown.md) | 是 | 子 agent 生命周期边界，内部持有 runtime，外部只传任务 |
| `AgentWorkflowManager` | 已实现 | [02-module-breakdown.md](./02-module-breakdown.md) | 是 | workflow 编排边界，当前实现 `parallel` |
| `AgentWorkflowTool` | 已实现 | [02-module-breakdown.md](./02-module-breakdown.md) | 是 | 主 agent 唯一入口 tool |
| `CLI Assembly` | 已实现 | [03-core-workflows.md](./03-core-workflows.md) | 是 | 只做装配和 smoke，不复制执行循环 |
| `WorkflowStrategy` | 待演进 | [05-validation-and-evolution.md](./05-validation-and-evolution.md) | 是 | 后续多模式扩展点 |

## 文档导航

- [架构图](./architecture.html)
- [目标与边界](./01-goals-and-boundaries.md)
- [模块拆分](./02-module-breakdown.md)
- [核心流程](./03-core-workflows.md)
- [数据模型与状态](./04-data-and-state.md)
- [验证策略与演进](./05-validation-and-evolution.md)
- [Task 映射](./90-task-map.md)

## 当前建议

1. 保持 v0.1 的 manager 边界：tool -> `AgentWorkflowManager` -> `SubAgentManager` -> `Runner`。
2. 下一轮优先补 `WorkflowStrategy` 和 `AuditRootResolver`，把多模式扩展和审计路径解析从 `AgentWorkflowManager` 里拆出来。
3. Web 和通用渠道接入时只复用 `AgentWorkflowManager` 公共入口，渠道层负责展示和触发，编排状态仍由 workflow manager 维护。
