# Hermes Agent 编排机制总结

源码快照：`other/hermes-agent` 本地 `xdev` 已合并 `origin/main`，当前 HEAD 为 `871be48b`。

## 关键结论

Hermes 的 agent 编排核心是“主 agent + 工具化编排入口”。主 agent 通过 system prompt、tool schema、skills index、上下文文件和工具白名单获得模式选择能力；实际扩展执行由 `delegate_task`、`mixture_of_agents`、`execute_code`、cron、batch runner、Mini-SWE runner、RL 环境各自承载。

最重要的复用对象是 `delegate_task`。它创建完整的子 `AIAgent` 实例，给子 agent 分配独立会话、独立 system prompt、受限 toolsets、独立迭代预算，并把最终 summary 回填给父 agent。

## 源码索引

| 主题 | 代码位置 | 作用 |
|---|---|---|
| 主 agent turn loop | `other/hermes-agent/run_agent.py` | `AIAgent` 主循环、工具调用、并发工具执行、delegate 调用裁剪 |
| 工具定义注入 | `other/hermes-agent/model_tools.py` | 按 toolset / platform 过滤工具 schema |
| prompt 组装 | `other/hermes-agent/agent/prompt_builder.py` | tool-use enforcement、skills guidance、环境上下文 |
| 子 agent 编排 | `other/hermes-agent/tools/delegate_tool.py` | `delegate_task` schema、子 agent 创建、并发、深度和能力限制 |
| 代码沙箱 agent | `other/hermes-agent/tools/code_execution_tool.py` | 进程内 mini agent / RPC 工具循环 |
| MoA | `other/hermes-agent/tools/mixture_of_agents_tool.py` | 多模型参考回答 + 聚合模型 |
| cron agent | `other/hermes-agent/cron/scheduler.py` | 定时任务触发独立 agent |
| batch runner | `other/hermes-agent/batch_runner.py` | 多进程批量 prompt 执行 |
| Mini-SWE runner | `other/hermes-agent/mini_swe_runner.py` | SWE 任务循环 |
| RL 环境 | `other/hermes-agent/environments/agent_loop.py` | Atropos 环境下的 agent loop |

## 关键证据点

- `delegate_task` 默认并发子 agent 数是 3，递归深度是 2：`other/hermes-agent/tools/delegate_tool.py:52`。
- `delegate_task` 每个子 agent 默认迭代预算是 50：`other/hermes-agent/tools/delegate_tool.py:80`。
- `delegate_task(tasks=[...])` 超过并发上限时返回 `tool_error`：`other/hermes-agent/tools/delegate_tool.py:670`。
- 主 agent 同轮多个 `delegate_task` call 使用同一个 `max_concurrent_children` 裁剪：`other/hermes-agent/run_agent.py:3343`。
- 主 agent 本地工具并发上限是 8：`other/hermes-agent/run_agent.py:237`。
- `execute_code` 默认超时 300 秒，默认工具调用上限 50：`other/hermes-agent/tools/code_execution_tool.py:67`、`other/hermes-agent/tools/code_execution_tool.py:68`。
- MoA 默认 4 个 reference models，至少 1 个成功即可聚合：`other/hermes-agent/tools/mixture_of_agents_tool.py:63`、`other/hermes-agent/tools/mixture_of_agents_tool.py:79`。
- cron job pool 固定 `max_workers=1`，cron agent 默认 `max_iterations=90`，默认 timeout 600 秒：`other/hermes-agent/cron/scheduler.py:677`、`other/hermes-agent/cron/scheduler.py:765`、`other/hermes-agent/cron/scheduler.py:768`。
- batch runner 默认 `num_workers=4`，单 prompt 默认 `max_iterations=10`：`other/hermes-agent/batch_runner.py:525`、`other/hermes-agent/batch_runner.py:529`。
- Mini-SWE runner 默认 `max_iterations=15`：`other/hermes-agent/mini_swe_runner.py:155`。
- RL base agent loop 默认 `max_turns=30`，工具 executor 默认 128 workers：`other/hermes-agent/environments/agent_loop.py:33`、`other/hermes-agent/environments/agent_loop.py:138`。

## 编排模式总览

| 模式 | 入口 | agent 数量 | 默认限制 | 适用任务 |
|---|---|---:|---|---|
| 主 agent 单循环 | `AIAgent.run()` | 1 | CLI / Gateway 默认 `max_iterations=90` | 普通对话、顺序工具任务 |
| 本地工具并发 | 主 agent 同一轮多个 tool call | 1 | `_MAX_TOOL_WORKERS=8` | 独立工具调用并发，例如多文件读取 |
| `delegate_task` 单任务 | `tools/delegate_tool.py::delegate_task(goal=...)` | 1 个子 agent | 子 agent 默认 `max_iterations=50`，CLI 默认配置写入 `45` | 独立研究、代码定位、长任务拆分 |
| `delegate_task` 批任务 | `delegate_task(tasks=[...])` | 默认最多 3 个子 agent | `delegation.max_concurrent_children` / `DELEGATION_MAX_CONCURRENT_CHILDREN` / 默认 3 | 多主题并行研究、多文件并行检查 |
| 同轮多个 `delegate_task` call | 主循环裁剪工具调用 | 默认最多 3 个 delegate call | 使用同一个 `max_concurrent_children` | 模型一次输出多个 delegate 工具调用 |
| MoA | `mixture_of_agents` | 4 个参考模型 + 1 个聚合模型 | 默认 4 refs，至少 1 个成功 | 高价值回答合成、跨模型意见聚合 |
| `execute_code` | `execute_code` tool | 0 个 `AIAgent` 子实例，1 个脚本进程 | 默认 `timeout=300s`，`max_tool_calls=50` | 隔离代码执行、受限工具 RPC |
| cron | `cron/scheduler.py` | 每个 job 1 个 agent | job pool `max_workers=1`，默认 `max_iterations=90`，`HERMES_CRON_TIMEOUT=600s` | 定时任务、后台自动执行 |
| batch runner | `batch_runner.py` | 默认 4 个 worker 进程 | `num_workers=4`，单 prompt 默认 `max_turns=10` | 离线批处理 |
| Mini-SWE | `mini_swe_runner.py` | 单 agent 循环 | 默认 `max_iterations=15` | SWE benchmark / 代码修复任务 |
| RL / Atropos 环境 | `environments/agent_loop.py` | 环境内 agent loop | base 默认 `max_agent_turns=30`，工具池默认 128 | 强化学习环境采样 |

## 主 agent 如何选择编排模式

Hermes 让主 agent 通过三层信息选择模式：

1. **system prompt**：`run_agent.py` 组装身份、工作方式、技能指导、上下文文件、环境信息和平台提示。
2. **tool schema**：`model_tools.py` 按平台和 toolset 暴露工具；`delegate_task` 的 description 明确写入单任务、批任务、适用场景、能力边界和限制。
3. **prompt builder**：`agent/prompt_builder.py` 注入 tool-use enforcement 和 skills guidance，引导模型在需要外部能力、专业 skill 或并行拆分时使用工具。

`delegate_task` schema 直接承担模式引导：

- `goal` 表示单子任务。
- `tasks` 表示并行子任务数组。
- `context` 只传递必要背景。
- `toolsets` 限定子 agent 的工具范围。
- `max_iterations` 限定每个子 agent 的迭代预算。

Hermes 的选择机制主要靠 prompt 和 schema steering。代码侧负责执行边界、数量上限、工具过滤、深度限制和结果汇总。

## `delegate_task` 子 agent 能力下发

| 能力维度 | 下发方式 | 代码语义 |
|---|---|---|
| 模型 / provider | 继承父 agent，或读取 `delegation.provider` / `delegation.model` / `delegation.base_url` / `delegation.api_key` | 子 agent 可走单独模型路由 |
| reasoning | `delegation.reasoning_effort` 优先，缺省继承父 agent | 子 agent 可按任务提升或降低推理力度 |
| 工作目录 | 继承父 agent `working_directory` | 子 agent 在同一工程上下文内执行 |
| 会话 | 设置 `parent_session_id`，子 agent 独立 session | 父上下文只接收 delegation call 和 summary |
| system prompt | `ephemeral_system_prompt` 注入 child prompt | 子 agent 获得“你是子 agent”的明确身份和输出契约 |
| 上下文文件 | `skip_context_files=True` | 子 agent 只拿到 goal / context / child prompt |
| 记忆 | `skip_memory=True` | 子 agent 跳过父 agent 长期记忆注入 |
| 工具 | `toolsets` 与父 agent effective toolsets 求交集，再剔除 blocked tools | 子 agent 权限小于等于父 agent |
| skills | 通过子 agent tool schema 和 prompt 间接可用 | 可用性受 toolset / tool schema 过滤影响 |
| 用户交互 | blocked tools 剔除 `clarify` | 子 agent 直接完成任务并返回 summary |
| 外发消息 | blocked tools 剔除 `send_message` | 子 agent 避免直接对外沟通 |
| 递归编排 | blocked tools 剔除 `delegate_task`，同时 `MAX_DEPTH=2` | 子 agent 无法继续创建新子 agent |
| 代码执行 | blocked tools 剔除 `execute_code` / `code_execution` | 子 agent 使用普通 terminal / file / web 等工具完成任务 |

blocked tool 名单包含：`delegate_task`、`clarify`、`memory`、`send_message`、`execute_code`。blocked toolset 名单包含：`delegation`、`clarify`、`memory`、`code_execution`。

## `delegate_task` 数量限制

Hermes 对 delegation 设置三层限制：

1. **批任务数量**：`tasks` 长度超过 `max_concurrent_children` 时返回 `tool_error`。当前代码报错，文档里“truncated to 3”的说法已经漂移。
2. **同轮多个 delegate tool call**：`run_agent.py::_cap_delegate_task_calls()` 使用 `max_concurrent_children` 裁剪多余 `delegate_task` calls，保留其他工具调用。
3. **递归深度**：`MAX_DEPTH=2`，父 agent depth 0，子 agent depth 1，后续 delegation 被拒绝。

`max_concurrent_children` 的优先级：

1. `config.yaml` 的 `delegation.max_concurrent_children`
2. 环境变量 `DELEGATION_MAX_CONCURRENT_CHILDREN`
3. 默认值 `3`

## 其他编排模式

### 本地工具并发

主 agent 在同一轮收到多个可并发工具调用时，走 thread pool 并发执行。上限是 `_MAX_TOOL_WORKERS=8`。这类并发只提升工具吞吐，仍然只有一个主 agent 持有推理上下文。

### MoA

`mixture_of_agents` 使用 4 个默认 reference models 并发生成答案，再用 1 个 aggregator model 合成。默认 reference models：

- `anthropic/claude-opus-4.6`
- `google/gemini-3-pro-preview`
- `openai/gpt-5.4-pro`
- `deepseek/deepseek-v3.2`

聚合模型默认 `anthropic/claude-opus-4.6`。至少 1 个 reference model 成功即可进入聚合。

### `execute_code`

`execute_code` 是脚本进程内的 mini agent / RPC loop。它提供受限工具集合、默认 300 秒超时、默认 50 次工具调用上限。它适合隔离运行代码和数据分析，形态上属于“沙箱执行器”，与 `delegate_task` 的完整子 `AIAgent` 实例分工清晰。

### cron

cron scheduler 为每个 job 构建独立 `AIAgent`。默认 job pool `max_workers=1`，agent 默认 `max_iterations=90`，`HERMES_CRON_TIMEOUT` 默认 600 秒。cron agent 禁用 `cronjob`、`messaging`、`clarify` toolsets，并跳过上下文文件和记忆注入。

### batch runner

batch runner 通过多进程 worker 批量跑 prompt。默认 `num_workers=4`，单 prompt 默认 `max_turns=10`。它适合离线评测和批量任务吞吐。

### Mini-SWE runner

Mini-SWE runner 使用单 agent 循环处理 SWE 类任务，默认 `max_iterations=15`。batch 路径按任务列表逐个执行。

### RL / Atropos 环境

Atropos 环境把 agent loop 包进 RL environment。base 配置默认 `max_agent_turns=30`，工具池默认 128。它服务训练 / 采样链路，约束重点是环境 step 和 tool pool。

## 文档漂移

`other/hermes-agent/website/docs/user-guide/features/delegation.md` 写着 `tasks` array 超过 3 会被截断。当前 `delegate_tool.py` 在 `len(tasks) > max_children` 时返回 `tool_error`，提示减少任务数量、拆成多个 `delegate_task` call，或提高 `delegation.max_concurrent_children`。

## 对 Kongming 的直接建议

1. `AgentWorkflowManager` 作为统一门户，承接模式选择、子 agent 创建、能力下发、审计事件和限制策略。
2. 模式选择写进 system prompt 与 tool schema，代码层只执行确定的边界策略。
3. 子 agent 能力用显式 grant 表达：`tool_names`、`skill_names`、`workdir_scope`、`permission_profile`、`max_iterations`、`context_budget`。
4. delegation 的数量限制分成批任务上限、同轮 call 上限、递归深度上限、单子 agent 迭代上限。
5. `execute_code`、MoA、batch、cron 作为独立编排类型建模，避免和完整子 agent delegation 混在一个抽象里。
6. 子 agent 默认只获得最小上下文：任务目标、必要背景、授权工具、授权 skill、输出契约。
7. 每次编排产出 audit event：模式、子任务数量、grant、工作目录、迭代预算、退出原因、失败任务和汇总结果。
