# Task Map

| 模块 | 建议 task 名 | 是否创建 task | 前置依赖 | 当前状态 |
|---|---|---|---|---|
| Core Runtime | `v1-core-runtime` | 是 | 无 | 可进入 x-req |
| Tool Runtime | `v1-tool-runtime` | 是 | `v1-core-runtime` | 可进入 x-req |
| Session / Context | `v1-session-context` | 是 | `v1-core-runtime` | 可进入 x-req |
| Model Executor | `v1-model-executor` | 是 | `v1-core-runtime` | 可进入 x-req |
| Host Bridge + CLI Shell | `v1-host-cli-shell` | 是 | `v1-core-runtime`, `v1-tool-runtime`, `v1-model-executor` | 可进入 x-req |
| Safety Baseline | `v1-safety-baseline` | 是 | `v1-tool-runtime`, `v1-model-executor`, `v1-host-cli-shell` | 可进入 x-req |
| Observability Baseline | `v1-observability-baseline` | 是 | `v1-core-runtime`, `v1-tool-runtime` | 可进入 x-req |

## 建议顺序

开工前建议先补一个很小但很关键的前置任务：

`v0-contracts`

产物：

- `docs/kongming-agent-v1-minimal/10-contracts.md`
- `core/contracts.py`
- 最小依赖方向规则说明，后续接进 CI

这个前置任务不长，但它决定后面模块是不是在同一套边界上开发。

第一批先做：

1. `v1-core-runtime`
2. `v1-tool-runtime`
3. `v1-model-executor`
4. `v1-host-cli-shell`

这四个 task 做完，系统就能形成第一个最小可运行闭环。

这里默认带着两个“第一批内嵌最小实现”一起走：

- `v1-core-runtime` 内嵌最小 `Session` 接口和 in-memory 实现
- `v1-tool-runtime` 内接最小 approval 能力

所以第二批不是“从零补 session / safety”，而是把第一批已经存在的最小闭环升级成工程版。

第一批默认不内嵌结构化 observability，先用标准 logging 顶住调试。第二批 `v1-observability-baseline` 只做 `EventSink` Protocol + 一个 `JsonlTraceSink` —— 所有事件 fan-out 到同一份 JSONL。usage 聚合和 audit 审计延后到 v0.2+，按需从 trace JSONL 派生，不在 v1 阶段拆成三个独立文件。

第二批再补：

1. `v1-session-context`
2. `v1-safety-baseline`
3. `v1-observability-baseline`

这三块补完，v1 才算从“能跑 demo”进入“可持续开发的最小工程版本”。

其中 `v1-session-context` 的职责要明确成“工程化升级”而不是“首次引入会话能力”：

- 抽正式 `session_store.py`
- 补持久化和恢复
- 加历史压缩、规则加载、输入组装

第二批这三个 task 没有硬性串行依赖，严格说可以并行。这里保留 `session → safety → observability` 的建议顺序，只是因为 session 的持久化和恢复最早会被后两者拿来做验证上下文，不是因为它们之间有硬依赖。

## 说明

这份 task map 故意没有把下面这些内容拆进 v1：

- `memory/` 长期记忆
- `tools/mcp/`
- `host/http_adapter.py`
- `host/game_adapter.py`
- `host/macos_adapter.py`
- `executors/agent_runtime/external_runtime_adapter.py`
- `coordinator/`
- `plugins/`

原因很简单：它们都重要，但都不属于“最小可运行版本模块”。如果现在一起拆进来，v1 会直接退化成 roadmap 文档，而不是最小闭环方案。
