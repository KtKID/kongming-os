# 验证策略与演进

## 已验证路径

| 验证 | 命令 / 方式 | 结果 |
|------|-------------|------|
| 单元测试 | `uv run pytest tests/unit/test_agent_workflow_manager.py -v` | 通过，覆盖审计、上下文隔离、tool 调用、父 agent 通过 tool 创建子 agent |
| 架构边界 | `uv run lint-imports --config .importlinter` | 通过，现有 import-linter contract 保持成立 |
| 格式与静态检查 | `uv run ruff check ...`、`uv run ruff format --check ...`、`uv run mypy ...` | 通过 |
| CLI 参数 | `uv run python -m cli.main --help` | `--subagent-smoke`、`--model-preset` 可见 |
| 真实模型 smoke | MiniMax M3 + `--subagent-smoke` | 通过，完成 `7 + 5` 和受限工作目录文件写入 |
| 子 agent 架构审查 | 只读 explorer 子 agent | 发现 2 个 P1、4 个 P2、2 个 P3 演进项 |
| 拆分任务编排汇报闭环 | `uv run pytest tests/unit/test_agent_workflow_manager.py -v` | 通过，覆盖 `reports/<task_run_id>.json`、`reports/index.json`、`subagent_reported`、失败 report、tool result 回流 |

## 子 agent 审查结论

### P1 路径与工作目录防护

发现：
- `AgentWorkflowManager._workflow_dir()` 只校验 `sessions_root` 位于 workspace root 内，随后使用原始 `parent_session_id` 拼接路径。`--session-id` 可控时，带路径分隔符的 session id 会影响审计目录落点。
- 子 agent 工作目录约束当前主要写进 prompt。`write_file` 和 `run_shell` 仍按普通工具语义接受路径或 cwd。

建议：
- 为 `parent_session_id` 生成专用目录 key，例如 `_slug(parent_session_id)` 或 session backend 提供的 safe storage key。
- 对最终 `workflow_dir.resolve()` 再做 `relative_to(sessions_root)` 校验。
- 为子 agent 提供 scoped tool wrapper，或在 `ToolContext` 中注入 `working_dir` 并由工具 / safety 边界强制校验。
- 把路径穿越和工作目录越界写成回归测试。

### P2 失败收敛与审计完整性

发现：
- `asyncio.gather()` 直接传播异常时，`workflow.json` 可能停留在 `running`，`workflow_failed` 和 `result.json` 可能缺席。
- 典型触发点是子 agent 请求未知工具，`SubAgentManager._resolve_enabled_tools()` 抛出异常。

建议：
- `run_parallel()` 对每个子任务异常进行结构化收敛。
- 写入 `agent_failed` 审计事件。
- workflow 结束时始终写入最终 `workflow.json` 和 `result.json`。
- `SubAgentRun.status` 当前收敛到 `completed`、`failed`；超时和取消状态归 B8 workflow timeout / cancellation。

### P2 manager 耦合面

发现：
- `SubAgentManager` 直接消费 `SessionEngine` 的 `runner`、`llm`、`tools`、`approval`、`config`、`agent_spec`、`session_factory`。
- 当前唯一 `Runner` 方向成立，后续多模式扩展会放大这个依赖面。

建议：
- 新增 `SubAgentRuntimeDeps` 或 `ChildAgentExecutor`，由 `SessionEngine` 产出子 agent 执行依赖快照。
- `SubAgentManager` 依赖小接口，保留 `run_task()` 公共边界。
- `SessionEngine` 仍然是装配源，子 agent manager 持有的是只读执行依赖。

### P2 CLI 装配收口

发现：
- CLI 当前直接注册 workflow tool、构造两个 manager、绑定 mutable handle，并持有 smoke 任务。
- 这条路径通过 import-linter，CLI 已承担 feature 级装配细节。

建议：
- 在 `executors.agent_runtime` 增加工厂函数，例如 `build_agent_workflow_runtime(runtime, cfg, workspace_root)`。
- CLI 只调用工厂并绑定 tool handle。
- smoke 入口可移动到 `agent_workflow_smoke.py`，CLI 只做参数触发。

### P2 多模式扩展

发现：
- 当前 `WorkflowMode = Literal["parallel"]`，tool schema 只暴露 `parallel`。
- DAG、supervisor-worker、review panel 会引入节点、边、角色、迭代、聚合结果、部分失败状态。

建议：
- 新增 `WorkflowPlan`：表达任务节点、依赖边、角色、工具白名单和聚合策略。
- 新增 strategy registry：`parallel` 是第一种 strategy。
- `AgentWorkflowManager` 只负责模式选择、审计生命周期和结果收口。

### P3 task slug 碰撞

发现：
- task slug 碰撞时可能共享 agent 工作目录、覆盖 `result.json`，并生成相同 child session id。

建议：
- workflow manager 在接收 task list 时校验 slug 唯一性。
- 或为每个 agent 工作目录强制追加 index / short uuid。

处理状态：
- 当前 req 已采用 `display_order + slug(task_id)` 作为 task_run_id，覆盖 agent 工作目录、report 文件和 child session id。

### P3 测试拆分

发现：
- tool 测试当前夹在 `tests/unit/test_agent_workflow_manager.py` 中。

建议：
- 拆出 `tests/unit/test_agent_workflow_tool.py`。
- 增加路径穿越、未知工具、失败审计、slug 碰撞、工作目录越界的回归测试。

## 验证矩阵

| 能力 | 当前覆盖 | 后续补强 |
|------|----------|----------|
| 子上下文隔离 | 单测检查 alpha / beta prompt 隔离 | 增加父历史不可见用例 |
| 审计文件 | 单测检查 action 顺序、结果文件、`subagent_reported` | 增加失败仍写最终 manifest |
| 工具白名单 | 单测覆盖 tool_names 传递 | 增加未知工具和越权工具 |
| 工作目录 | MiniMax smoke 写入指定目录 | 增加 scoped tool wrapper 强制校验 |
| 子 agent 汇报 | 单测覆盖 detail report、index projection、tool result 回流、slug 碰撞 | Web timeline 和 report card 后续接入 |
| 路径安全 | session root 位于 workspace 内 | 增加 parent_session_id safe key 和最终路径校验 |
| 模式扩展 | mode 边界已存在 | 引入 `WorkflowPlan` + strategy registry |
| CLI 边界 | `SessionEngine.build()` 后装配 manager | 工厂函数收口 feature 装配 |

## 演进路线

### v0.1.1 安全与审计收口

- safe parent session directory key。
- workflow final path 校验。
- scoped child workdir tool wrapper。
- 失败审计和最终 manifest 写入。
- slug 唯一性校验。

### v0.2 多模式基础

- `WorkflowPlan`。
- `WorkflowStrategy` 协议。
- `ParallelWorkflowStrategy`。
- strategy registry。
- `AgentWorkflowManager` 只保留模式选择、审计生命周期和结果收口。

### v0.3 协作型 agent tree

- agent registry。
- wait / followup / close / resume。
- mailbox 或 notification store。
- workflow-level concurrency config。
- timeout / cancellation。

### v0.4 渠道展示

- 通用 channel workflow event view model。
- Web workflow timeline。
- 审计文件查看与结果下载。
- 子 agent 产物路径展示。

## 推荐修复顺序

1. 先修 P1：session id 安全目录 key、最终路径校验、scoped workdir。
2. 再修 P2：失败审计收敛、`SubAgentRuntimeDeps`、CLI 工厂收口。
3. 最后做多模式基础：`WorkflowPlan`、strategy registry、review panel。
