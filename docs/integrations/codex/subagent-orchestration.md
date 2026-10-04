# Codex 子 agent 编排实现说明

来源：`other/codex`，本地快进到 `upstream/main`，HEAD `e5af672d730a`。
用途：给别人解释 Codex multi-agent / agent job 的编排模式、核心流程和边界处理。

## 对外讲法

Codex 的子 agent 编排是线程树模型。root agent 持有一个 `AgentControl`，通过工具创建子线程、给子线程发消息、等待子线程 mailbox 更新、关闭或恢复子线程。每个子 agent 都是独立 Codex session，同时共享 root session tree 的注册表和父级运行上下文。父子之间通过 `InterAgentCommunication` 传递任务和结果，子 agent 完成一轮后系统自动把完成通知写回父 agent 的 mailbox，父 agent 再继续调度下一步。

Codex 里有三层编排：

| 层级 | 流程 | 适用场景 | 拆分来源 |
|---|---|---|---|
| 显式 multi-agent 协作 | `spawn_agent`、`send_message` / `followup_task`、`wait_agent`、`close_agent`、`list_agents` | 并行探索、分片实现、并行验证 | 主 agent 根据工具提示词和用户显式授权拆分 |
| CSV agent job fan-out | `spawn_agents_on_csv`、`report_agent_job_result` | 同构批量任务，一批 repo / 文件 / case / 数据行 | CSV 每行自动变成一个 worker sub-agent |
| 固定用途内部 sub-agent | review、memory consolidation、approval auto-review | 代码审查、记忆整理、审批评估 | 固定任务入口直接启动 one-shot worker |

## 核心模型

- 运行单元：子 agent 是 Codex thread/session，每个 thread 有独立会话状态、rollout、turn 状态。
- 树结构：父子关系由 `SessionSource::SubAgent(SubAgentSource::ThreadSpawn)` 表达，里面记录 parent thread id、depth、agent path、nickname、role。
- 控制中心：`AgentControl` 负责 spawn、message、list、close、resume，以及 thread-spawn edge 的持久化。
- 状态表：`AgentRegistry` 维护同一 root session tree 内的 active agents、canonical path、nickname、last task message、并发 slot。
- 通信协议：父子任务和结果统一走 `InterAgentCommunication`，v2 工具消息使用 encrypted content 承载真实消息。
- UI/trace 事件：工具生命周期用 `CollabAgent*` 事件表达，例如 spawn begin/end、interaction begin/end、waiting begin/end、close begin/end。

## 核心工具

| 工具 | 作用 | 关键行为 |
|---|---|---|
| `spawn_agent` | 创建子 agent | 必填 `task_name` 和 `message`，生成 canonical task path，提交初始任务 |
| `send_message` | 给 agent 发消息 | queue-only，不触发新 turn |
| `followup_task` | 给 agent 派新任务 | queue + trigger turn，目标 agent 空闲后开始下一轮 |
| `wait_agent` | 等 mailbox 更新 | 返回更新或超时信号，消息内容进入下一轮上下文 |
| `list_agents` | 列出 live agents | 支持 path prefix，包含 root 状态 |
| `close_agent` | 关闭 agent | 关闭目标和 open descendants，返回关闭前状态 |
| `resume_agent` | 恢复 agent | 从 rollout 恢复线程，并按 edge 恢复 open descendants |
| `spawn_agents_on_csv` | CSV 批量 fan-out | 读取 CSV，每行生成一个 worker sub-agent，并发执行直到全部完成 |
| `report_agent_job_result` | worker 回报结果 | agent job worker-only 工具，记录 item 结果，可请求停止剩余任务 |

## 显式 multi-agent 主流程

1. 父 agent 调 `spawn_agent`，传入 `task_name` 和 `message`。
2. `spawn.rs` 解析参数，校验 `fork_turns`、role/model/reasoning/service tier。
3. 系统从父 turn 构建子 agent config，继承当前 model provider、reasoning、cwd、approval policy、permission profile、sandbox、environment selections。
4. `thread_spawn_source()` 生成 `SubAgentSource::ThreadSpawn`，把父线程 ID、深度、agent path、role 写进 session source。
5. `AgentControl.spawn_agent_with_metadata()` 在 root session tree 里创建新 thread，占用并发 slot、注册 path/nickname、持久化 spawn edge。
6. 初始任务转换成 `InterAgentCommunication` 投递给子 agent，子 agent 开始处理。
7. 父 agent 后续用 `send_message` 或 `followup_task` 定位目标 agent path/thread id，再投递消息。
8. 子 agent 结束一轮时，session 层捕获 `TurnComplete` 或 final `TurnAborted`，生成标准 `<subagent_notification>`。
9. 完成通知写入 direct parent 的 mailbox，`wait_agent` 监听 mailbox 变化。
10. 父 agent 读取下一轮上下文，继续调度、收敛结果、关闭 agent。

## CSV agent job fan-out 流程

`spawn_agents_on_csv` 是 Codex 里最接近“自动拆任务到多个子 agent”的流程。它要求上层已经有一个 CSV item 列表，runtime 按行自动展开 worker。

1. 主 agent 调 `spawn_agents_on_csv`，传 `csv_path`、`instruction`、可选 `id_column`、`output_csv_path`、`max_concurrency`、`max_runtime_seconds`、`output_schema`。
2. handler 读取 CSV，校验 header、id column、行长度、重复 item id，并创建 agent job 记录。
3. `run_agent_job_loop()` 按并发槽位拉取 pending item。
4. 每个 item 用 `build_worker_prompt()` 渲染任务，模板里的 `{column_name}` 替换为该行字段值。
5. runtime 调 `AgentControl.spawn_agent_with_metadata()` 创建 worker sub-agent，source 标记为 `agent_job:<job_id>`。
6. worker 只能用 `report_agent_job_result` 回报本 item 的 JSON result；缺失回报按失败处理。
7. job loop 监听 worker status，处理完成、失败、超时、取消、stale active item。
8. 所有 item 完成后导出结果 CSV，返回整体 progress、错误列表和输出路径。

关键约束：

- feature gate 是 `Feature::SpawnCsv`，配置 key 是 `enable_fanout`，默认关闭。
- `spawn_agents_on_csv` 只在 collab tools enabled 时暴露。
- `report_agent_job_result` 只在 `SessionSource::SubAgent(SubAgentSource::Other("agent_job:<job_id>"))` worker 内暴露。
- 默认并发是 16，上限是 64，并受当前 agent thread limit 限制。
- 读取 CSV 时只允许单个 local environment；remote environment 或多 environment 会拒绝。
- spawn 触发 `AgentLimitReached` 时 item 回到 pending，等待后续槽位。

## 设计策略

- 授权门槛：工具描述要求只有用户明确提出 sub-agents、delegation 或 parallel agent work 时才使用 `spawn_agent`。
- 关键路径：主 agent 保留当前阻塞任务，把可并行的 sidecar 任务交给子 agent。
- 子任务质量：委派任务必须具体、自包含、能推进主任务。
- 代码分片：代码 worker 要有 disjoint write set，降低并行改动冲突。
- 等待策略：`wait_agent` 稀疏调用，只在下一步确实依赖子 agent 结果时等待。
- 并行模式：独立探索、非重叠代码切片、并行验证是主要推荐模式。

## 关键提示词中文翻译

### `spawn_agent` 使用门槛

来源：`multi_agents_spec.rs:681-684`

- 只有用户明确要求 sub-agents、delegation 或 parallel agent work 时，主 agent 才使用 `spawn_agent`。
- 用户要求更深入、更彻底、做研究、做调查、做详细代码库分析，不能作为启动子 agent 的授权依据。
- agent role 说明只用于已经授权 spawn 后选择合适角色，不能单独授权 spawn。

### 委派和本地执行的判断

来源：`multi_agents_spec.rs:685-690`

- 主 agent 先快速分析整体任务，形成简短高层计划。
- 主 agent 要识别当前关键路径上的 immediate blockers，以及可以并行推进的 sidecar tasks。
- 主 agent 要明确自己现在应该本地执行的下一步，再开始委派。
- 适合委派的子任务具备三个特征：子 agent 能处理、可以和主 agent 本地工作并行、能实质推进主任务。
- 阻塞型急活由主 agent 本地处理，保持关键路径推进。
- 高耦合、紧急、难以清晰委派的任务由主 agent 本地处理。

### 被委派子任务的设计规则

来源：`multi_agents_spec.rs:691-700`

- 子任务必须具体、边界清楚、自包含。
- 子任务必须能实质推进主任务。
- 主 agent 和子 agent 的工作内容要避免重复。
- 同一个未解决子线程上追加任务时，新任务要确实不同且必要。
- 委派提示要收窄到下一步真正需要的具体输出。
- 代码任务优先委派有清晰写入范围的 concrete code-change worker。
- 代码 worker 要直接在 forked workspace 里改文件，并在最终回复列出改动路径。
- 并行代码任务按不重叠写入范围拆分。

### 委派之后的主 agent 行为

来源：`multi_agents_spec.rs:702-706`

- `wait_agent` 谨慎调用，只在下一步关键路径需要子 agent 结果时等待。
- 主 agent 专注整合子 agent 结果，或者推进不重叠的本地工作。
- 子 agent 后台运行时，主 agent 立即做有意义且不重叠的工作。
- 子 agent 返回代码改动后，主 agent 快速审查上传改动，再整合或修正。

### 并行委派模式

来源：`multi_agents_spec.rs:708-712`

- 多个互相独立的信息搜集问题，可以并行派给多个子 agent。
- 实现任务可以按互不重叠的代码区域拆分，派多个 agent 并行修改。
- 验证任务可以作为并行工作派发，用来在最终整合前发现具体风险。
- 关键目标是同一轮内找到可并行的独立子任务，同时保证每个子任务定义清楚、自包含、能推进主任务。

### CSV fan-out 工具描述

来源：`agent_jobs_spec.rs:64-65`

- `spawn_agents_on_csv` 用来处理 CSV：每一行启动一个 worker sub-agent。
- `instruction` 是模板字符串，模板里的 `{column}` 会替换成当前行对应列的值。
- 每个 worker 必须调用 `report_agent_job_result`，回报一个 JSON 对象。
- 设置 `output_schema` 时，worker result 要符合该 schema。
- worker 缺失报告会按失败处理。
- 工具调用会等待所有行完成，并自动把结果导出到指定 CSV 路径或默认路径。

### code-review skill 编排描述

来源：`.codex/skills/code-review/SKILL.md:6`

- code-review orchestrator 使用 subagents 运行仓库里的所有 `code-review-*` skills。
- 每个 review skill 分配一个 subagent。
- 调用子 agent 时传入完整 skill path。
- 使用 xhigh reasoning。

### skill forward-test 编排描述

来源：`skill-creator/SKILL.md:332`、`388-416`

- skill 经过较大修改，或 skill 本身比较复杂时，用 subagents 做 forward-test。
- forward-test 只把待验证 artifact 交给子 agent，避免把诊断结论或隐藏答案泄漏给子 agent。
- 测试提示保持通用，让结果依赖可迁移推理能力。
- forward-test 使用 fresh subagents 和最小上下文。
- 如果 forward-test 只有在子 agent 看到泄漏上下文时才成功，应该收紧 skill 或测试设置，再信任测试结果。

## 其他并行能力

- 普通 tool call runtime 通过 `tool_supports_parallel` 判定是否并行执行，支持并行的工具走读锁并发。
- LLM request 会带 `parallel_tool_calls` 能力提示。
- MCP server 可通过 `supports_parallel_tool_calls` metadata opt-in 并行；缺省 metadata 时按串行处理。
- 这些能力是 tool-level 并行，和 sub-agent 线程树并行属于不同层级。

## 边界处理

### 参数和 schema

- v2 参数结构使用 `#[serde(deny_unknown_fields)]`，旧字段和未知字段会变成模型可见错误。
- `spawn_agent` 要求 `task_name + message`，空 message 会拒绝。
- `fork_context` 已由 `fork_turns` 承接，v2 收到 `fork_context` 会给出明确错误。
- `fork_turns` 只接受 `none`、`all`、正整数；非法字符串和 `0` 会拒绝。
- full-history fork 强制继承父 agent 的 agent type、model、reasoning effort；显式覆盖会拒绝。

### 目标寻址

- `resolve_agent_target()` 同时支持 thread id 和 task path。
- path 按当前 agent path 解析，支持相对 path 和 canonical path。
- 找不到 live path 时返回模型可读错误。
- `send_message` 支持发给 root，用于普通补充消息。
- `followup_task` 拒绝 root，因为它会触发新 turn，root turn 由主流程驱动。

### 并发和一致性

- `AgentRegistry` 维护同一个 root session tree 的并发 slot。
- spawn 使用 reservation 模式：先 reserve slot/path/nickname，成功后 commit。
- spawn 中途失败时 `SpawnReservation::drop()` 释放 slot 和预占 path。
- canonical task path 重复会拒绝。
- nickname 池耗尽时清空已用池并加序号，继续生成可读 nickname。
- v2 配置校验 `max_concurrent_threads_per_session >= 1`。

### 模型、推理和 service tier

- 子 agent 默认继承父 turn 的 live model provider、model、reasoning、approval policy、cwd、permission profile。
- 显式 model override 要在 picker-visible models 里找到。
- reasoning effort 会按目标模型支持列表校验。
- service tier 会按目标模型支持列表校验，父级 service tier 可作为候选继承值。
- role override 会在非 full-history fork 场景应用到 config。

### fork 历史

- full-history fork 会复制父 rollout，并清洗父级 usage hints。
- last-N fork 只保留最近 N 个父 turn，并重建 startup context。
- fork 前会 flush parent rollout，保证未落盘的最终 assistant 消息进入子 agent 历史。
- compacted history 中的父级 usage hints 会被剔除，再注入子 agent 自己的 hint。

### mailbox 和等待

- `send_message` 投递 queue-only mailbox mail。
- `followup_task` 投递 trigger-turn mailbox mail。
- `wait_agent` 等 mailbox watch 变化，返回 `Wait completed.` 或 `Wait timed out.`。
- wait timeout 有 min/default/max，配置加载和工具运行时都做校验。
- 当前 turn 已经过 answer boundary 后，新 mailbox mail 延迟到下一轮，保持当前答案边界稳定。
- steered input 或 tool call 可以重新打开当前 turn 的 mailbox delivery，把用户补充和 mailbox 更新一起交给模型。

### 完成通知

- 子 agent 完成通知只发给 direct parent。
- `AgentStatus::Completed`、`Errored`、`Shutdown` 属于 final 状态。
- `Interrupted` 属于中间状态，保留在 agent 状态里，等待后续 resume 或新输入。
- parent 已关闭或丢失时，通知回传安全退出。
- v2 子 agent 通知以 `InterAgentCommunication` 写入 parent mailbox，保持 agent path 的 author/recipient 关系。

### close 和 resume

- `close_agent` 拒绝关闭 root。
- agent 自己调用 close 自身会拒绝，结果应先返回给 parent，再由 parent 关闭。
- close 会关闭目标 agent 和 open descendants，并返回目标关闭前状态。
- completed agent 仍占并发 slot，直到 close 释放。
- resume 会尊重并发 slot，失败时释放预占 slot。
- 树恢复使用持久化 thread-spawn edge 恢复 descendants。
- 已关闭 descendants 在恢复 root 时保持关闭。
- metadata 过期时，恢复逻辑优先使用 edge 数据重建父子关系。

### agent job

- `spawn_agents_on_csv` 要求非空 instruction 和可读 CSV。
- CSV header 必须唯一。
- 指定 `id_column` 时必须存在。
- 行长度和 header 数量不匹配时拒绝。
- 重复 item id 会加后缀生成稳定唯一 id。
- worker 超过 `max_runtime_seconds` 会被关闭并标记失败。
- worker 完成线程但未调用 `report_agent_job_result` 会被标记为 missing report。
- job cancel 后停止拉新 pending item，等待 running item 收敛。
- output schema 存在时用于约束 worker result。

## 现有文档索引

- [`docs/codex/subagent-orchestration.md`](./subagent-orchestration.md)：本文件，Codex sub-agent 编排调查。
- [`docs/codex-web-integration-v0.1/README.md`](../codex-web-integration-v0.1/README.md)：Kongming 接入 Codex CLI Web 通道的任务方案。
- [`docs/codex-web-integration-v0.1/01-architecture.md`](../codex-web-integration-v0.1/01-architecture.md)：Codex Web 接入架构，不覆盖 multi-agent 编排细节。
- [`other/codex/codex-rs/app-server/README.md`](../../other/codex/codex-rs/app-server/README.md)：Codex app-server API 文档，包含 subagent thread metadata、review/start、collabToolCall 事件。
- [`other/codex/docs/skills.md`](../../other/codex/docs/skills.md)：Codex skill 公开文档入口。

## 代码索引

- 工具 schema：[`multi_agents_spec.rs`](../../other/codex/codex-rs/core/src/tools/handlers/multi_agents_spec.rs)
- v2 工具集合：[`multi_agents_v2.rs`](../../other/codex/codex-rs/core/src/tools/handlers/multi_agents_v2.rs)
- spawn 实现：[`spawn.rs`](../../other/codex/codex-rs/core/src/tools/handlers/multi_agents_v2/spawn.rs)
- send/followup 共享实现：[`message_tool.rs`](../../other/codex/codex-rs/core/src/tools/handlers/multi_agents_v2/message_tool.rs)
- wait 实现：[`wait.rs`](../../other/codex/codex-rs/core/src/tools/handlers/multi_agents_v2/wait.rs)
- close 实现：[`close_agent.rs`](../../other/codex/codex-rs/core/src/tools/handlers/multi_agents_v2/close_agent.rs)
- 目标解析：[`agent_resolver.rs`](../../other/codex/codex-rs/core/src/agent/agent_resolver.rs)
- 控制中心：[`control.rs`](../../other/codex/codex-rs/core/src/agent/control.rs)
- 注册表和 reservation：[`registry.rs`](../../other/codex/codex-rs/core/src/agent/registry.rs)
- 状态转换：[`status.rs`](../../other/codex/codex-rs/core/src/agent/status.rs)
- 完成通知回传：[`session/mod.rs`](../../other/codex/codex-rs/core/src/session/mod.rs)
- 协议结构：[`protocol.rs`](../../other/codex/codex-rs/protocol/src/protocol.rs)
- CSV fan-out 工具 schema：[`agent_jobs_spec.rs`](../../other/codex/codex-rs/core/src/tools/handlers/agent_jobs_spec.rs)
- CSV fan-out 入口：[`spawn_agents_on_csv.rs`](../../other/codex/codex-rs/core/src/tools/handlers/agent_jobs/spawn_agents_on_csv.rs)
- agent job loop：[`agent_jobs.rs`](../../other/codex/codex-rs/core/src/tools/handlers/agent_jobs.rs)
- fan-out feature gate：[`features/lib.rs`](../../other/codex/codex-rs/features/src/lib.rs)
- review one-shot subagent：[`review.rs`](../../other/codex/codex-rs/core/src/tasks/review.rs)
- memory consolidation subagent：[`runtime.rs`](../../other/codex/codex-rs/memories/write/src/runtime.rs)

## 解释模板

可以直接这样讲：

Codex 的 multi-agent 是线程树编排。root agent 通过 `spawn_agent` 创建子线程，子线程继承父 turn 的运行上下文，并通过 canonical task path 注册到 `AgentRegistry`。父 agent 用 `send_message` 或 `followup_task` 给子 agent 投递 `InterAgentCommunication`，用 `wait_agent` 等 mailbox 变化。子 agent 每轮结束后，系统把完成通知写回 direct parent 的 mailbox，父 agent 再读取上下文继续调度。整个系统用 schema 校验、path 解析、并发 reservation、fork 历史清洗、final 状态过滤、close/resume tree recovery 处理边界。

Codex 的自动批量编排是 CSV agent job。主 agent 调一次 `spawn_agents_on_csv`，runtime 读取 CSV 并把每行变成一个 worker sub-agent，按并发上限执行。worker 必须调用 `report_agent_job_result` 回报 JSON 结果，job loop 负责状态监听、超时、失败、取消和结果 CSV 导出。这个流程适合有明确 item 列表的同构批量任务；普通 multi-agent 适合主 agent 判断后的探索、分片实现和并行验证。
