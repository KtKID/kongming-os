# Task 映射

## 已完成任务

| Task | 状态 | 代码位置 | 验收点 |
|------|------|----------|--------|
| A1 `SubAgentManager` | 已完成 | `src/executors/agent_runtime/subagent_manager.py` | 独立 session、子 `AgentSpec`、最小 dispatch prompt、工具白名单 |
| A2 `AgentWorkflowManager` parallel | 已完成 | `src/executors/agent_runtime/workflow/manager.py` | `parallel` 并发、workflow 目录、audit、result |
| A3 主 agent tool | 已完成 | `src/tools/agent_workflow_tool.py` | `run_parallel_subagents` schema、任务校验、结果格式化 |
| A4 CLI 装配与 smoke | 已完成 | `src/cli/main.py` | `--subagent-smoke`、`--model-preset`、manager handle 绑定 |
| A5 单元测试 | 已完成 | `tests/unit/test_agent_workflow_manager.py` | 审计、上下文隔离、tool 调用、父 agent 调 tool |

## 下一阶段任务

### 当前 req

| Task | 状态 | 文档 | 说明 | 验收点 |
|------|------|------|------|--------|
| `split-task-orchestration-reporting` | 已完成 | [dev-pipeline/tasks/split-task-orchestration-reporting](../../../dev-pipeline/tasks/split-task-orchestration-reporting/README.md) | 补齐拆分任务编排的子 agent 完成汇报闭环，生成可审计 report、audit 事件和 Web 投影字段 | 每个子 agent 有 report 文件，`audit.jsonl` 有 `subagent_reported`，tool result 回流主 agent |

### 后续 backlog

| Task | 优先级 | 说明 | 验收点 |
|------|--------|------|--------|
| B1 `WorkflowStrategy` | P1 | 把 `parallel` 从 manager 主类里抽成 strategy | 新增模式时不扩大 `AgentWorkflowManager` 主流程 |
| B2 `AuditRootResolver` | P1 | 显式解析 workflow 审计根目录 | file / sqlite backend 都能得到项目内审计目录 |
| B3 safe path hardening | P1 | 对 `parent_session_id` 使用安全目录 key，并校验最终 workflow path | 路径穿越回归测试通过 |
| B4 scoped child tools | P1 | 子 agent 文件 / shell 工具强制限制在 working_dir 内 | 越界写入和 cwd 越界用例被拒绝 |
| B5 failure recovery policy | P1 | 在已有失败 report 基础上增加重试、跳过、降级等恢复策略 | 失败恢复策略有配置、审计和回归测试 |
| B6 `SubAgentRuntimeDeps` | P1 | 缩小 `SubAgentManager` 对 `SessionEngine` 的直接依赖面 | manager 只依赖小接口 |
| B7 CLI factory收口 | P1 | 将 workflow manager 装配收进 agent_runtime 工厂 | CLI 只调用工厂和 smoke 入口 |
| B8 workflow timeout / cancellation | P1 | 为整体 workflow 和单 agent 运行设置上限 | 超时写入 audit，结果包含 timeout 状态 |
| B9 concurrency config | P1 | 用 config 控制最大并发子 agent 数 | 超限时给模型可读错误 |
| B10 agent target registry | P2 | 后续 wait / followup / close 模式需要稳定 agent target registry | 支持按 path / task id / session id 定位 live agent |
| B11 review panel mode | P2 | 多个 agent 对同一产物做不同维度审查 | 输出按 reviewer role 聚合 |
| B12 supervisor-worker mode | P2 | 支持 wait / followup / close / resume | 子 agent 可跨轮协作 |
| B13 Web / Generic channel view model | P2 | 将 workflow audit 投影为前端可展示事件 | 前端可查看分派、完成、结果和产物路径 |

## 发布顺序建议

1. 先合并当前 v0.1，实现 CLI 和通用渠道可用的最小并行编排。
2. 再做 B1 + B2，把模式扩展和审计路径从当前 manager 主流程里拆清楚。
3. 接着做 B3 + B4，补资源治理。
4. 最后做 review panel 与 supervisor-worker，进入多轮协作能力。
