# map-reduce-v0.1

> 状态：runtime 集成已完成，live smoke 待执行
> 目标：为 agent-workflow 增加 `map_reduce` 编排模式，让主 agent 能把大工程代码分析拆成同构分片、并行 mapper、结构化输出校验和 reducer 归并。

## 系统目标

`map_reduce` 用于大规模、同构、可归并的代码分析任务。主 agent 提供目标、输入范围、分片策略和输出契约，workflow 生成稳定 shard，多个 mapper 子 agent 并行分析，每个 mapper 按统一结构输出结果，reducer 负责校验、去重、排序、覆盖率汇总和最终报告。

## 策略目录文案

`map_reduce` 在运行时策略目录、Web slash catalog 和 LLM workflow 选型提示中使用同一组 title/desc：

| 字段 | 内容 |
|------|------|
| `mode` | `map_reduce` |
| `title` | `Map-Reduce 代码分析` |
| `desc` | `把大工程代码分析拆成稳定分片，派发 mapper 子 agent，并用确定性 reducer 合并 code_findings。` |
| `when_to_use` | 输入文件数量较多且每个分片可以独立分析；mapper 输出可以统一为 code_findings JSON 契约；最终结果需要去重、排序、覆盖率和失败 shard 汇总。 |

## 最小可用路径

统一 `AgentWorkflowTool` 校验 `map_reduce` JSON payload -> `AgentWorkflowManager.run_workflow_payload(mode="map_reduce")` 通过 strategy registry 分发到 `strategies/map_reduce/strategy.py::MapReduceStrategy` -> `MapReducePlanner` 根据输入范围生成稳定 shards -> strategy 将每个 shard 转成 mapper `SubAgentTask` -> `SubAgentManager` 并发启动 mapper 子 agent -> 每个 mapper 输出 `MapperOutputEnvelope[code_findings]` -> `MapperOutputValidator` 校验 JSON 契约 -> `MapReduceReducer` 合并 findings -> 公共 workflow writer 写根目录 `result.json`、`reports/index.json`、`audit.jsonl`，map_reduce artifact writer 写 `map_reduce/reducer/result.json` -> tool result 回流主 agent。

## 与现有底座对齐

当前已落地底座是 `run_parallel_subagents` + `AgentWorkflowManager.run_workflow_specs(mode="parallel")` + `AgentWorkflowStrategyManager`。`map_reduce` 第一版需要显式补齐这些增量：

- `MapReduceStrategy` 独立策略包：新增 `src/executors/agent_runtime/strategies/map_reduce/`，每个 map/reduce 子能力独立脚本。
- 通用 payload 入口：新增 `AgentWorkflowManager.run_workflow_payload(...)`，让 `map_reduce` 传入完整 JSON payload；旧 `run_workflow_specs(...)` 保持服务 `parallel`。
- tool 入口：沿用 late-bound `AgentWorkflowHandle`，tool 只解析参数和基础校验，通过 handle 把 JSON payload 交给 manager；`tools/` 不直接 import `executors/`，不构造 executor dataclass。
- workflow 目录：复用 `<session.file_store_path>/<parent_session_id>/agent-workflows/<workflow_id>/`，根目录 `result.json` 保持 workflow 公共结果，`map_reduce/` 保存分片、校验和 reducer 细节。
- parallel 保护：本轮不迁移 `parallel` 具体实现；`parallel.py`、`run_parallel_specs()`、`run_parallel()` 旧链路保持。
- mapper 权限：v0.1 采用 shard 输入物化方案，把每个 shard 的可读文件复制或摘录到 `agents/<task_run_id>/work/input/`，同时写 `input_manifest.json` 映射原始路径；子 agent 继续使用 `scoped_workdir`。后续可新增只读输入根 + 可写 workdir 的授权模式。
- 运行限制：现有子 agent 默认最多 3 turn，workflow 级 timeout、取消、重试和并发配额属于 workflow 接入任务的前置增量。
- Web 投影：v0.1 只产出可被后续 Web/Generic channel 消费的 `reports/index.json` 和 audit 字段，不做专用页面。

## 设计原则

- 输出契约优先：每个 mapper 必须声明 `output_contract`，第一版内置 `code_findings`。
- 分片稳定：同一输入范围和同一策略生成可复现 shard id。
- 归并可解释：reducer 记录每条 finding 的来源 shard、证据、去重原因和排序依据。
- 大工程友好：v0.1 分片支持路径、glob、文件列表和文件数量上限；模块图、依赖图和最近变更分片进入后续增强。
- 失败可降级：单个 shard 失败进入 `failed_shards`，reducer 仍产出部分结果和补跑建议。
- 审计完整：planner、mapper、validator、reducer 每个阶段都写 workflow audit。

## 范围

包含：
- `map_reduce` workflow mode。
- `code_findings` 第一版输出契约。
- path glob / file list 的 shard 生成、mapper prompt 模板、输出校验、reducer 合并。
- workflow 审计、根目录结果、`map_reduce/` 细节产物和 `reports/index.json` 投影字段。
- mapper scoped workdir 输入物化和覆盖率统计。

暂缓：
- 多轮动态补分片。
- reducer 直接改代码。
- 跨仓库分布式执行。
- Web 专用页面实现。
- 非代码领域的通用 map_reduce 契约。
- xcodeatlas / dependency graph / recent_changes 分片来源。
- 新增只读输入根 + 可写 workdir 的子 agent 授权模式。

## 模块导航

| 模块 | 状态 | 文档 | 是否可进 task | 说明 |
|------|------|------|---------------|------|
| `AgentWorkflowTool` | 已实现 | [02-module-breakdown.md](./02-module-breakdown.md) | 否 | `run_agent_workflow` 支持通用 payload，`run_parallel_subagents` 保持兼容入口 |
| `MapReduceStrategy` | 已实现 | [02-module-breakdown.md](./02-module-breakdown.md) | 否 | 在 `strategies/map_reduce/strategy.py` 接入 workflow strategy registry，持有 map_reduce 状态机 |
| `MapReducePlanner` | 已实现 | [02-module-breakdown.md](./02-module-breakdown.md) | 否 | 生成 shard plan 和 mapper 任务 |
| `MapperInputMaterializer` | 已实现 | [03-core-workflows.md](./03-core-workflows.md) | 否 | 把 shard 输入物化到 mapper workdir，并记录原始路径映射 |
| `MapperOutputValidator` | 已实现 | [04-data-and-state.md](./04-data-and-state.md) | 否 | 复用 contract validator，完成 mapper JSON 输出校验和错误收敛 |
| `MapReduceReducer` | 已实现 | [02-module-breakdown.md](./02-module-breakdown.md) | 否 | 合并、去重、排序和覆盖率汇总 |
| `CodeFindingsContract` | 已实现 | [04-data-and-state.md](./04-data-and-state.md) | 否 | `map-reduce-contracts-v0.1` 已落地大工程代码分析第一版输出契约 |
| `MapReduceResultProjection` | 已实现 | [03-core-workflows.md](./03-core-workflows.md) | 否 | 公共 workflow writer 写 root result/report，map_reduce artifact writer 写细节产物 |

## 文档导航

- [架构图](./architecture.html)
- [目标与边界](./01-goals-and-boundaries.md)
- [模块拆分](./02-module-breakdown.md)
- [核心流程](./03-core-workflows.md)
- [数据模型与状态](./04-data-and-state.md)
- [验证策略与演进](./05-validation-and-evolution.md)
- [Task 映射](./90-task-map.md)

## 当前建议

已完成 `map-reduce-contracts-v0.1` 和 `map-reduce-strategy-integration-v0.1`。下一轮进入 `map-reduce-live-smoke-v0.1`：用 MiniMax M3 对小目录执行真实 mapper 输出和 reducer 收口验证。parallel 拆包留给后续单独任务；xcodeatlas / dependency graph / recent_changes 作为 v0.2 增强分片来源。
