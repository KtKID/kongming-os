# 目标与边界

## 目标

`map_reduce` 的目标是让 kongming-agent 具备大工程代码分析能力。它把一个大型分析目标切成多个同构 shard，让 mapper 子 agent 并行处理，再由 reducer 生成稳定、可审计、可复跑的最终报告。

## 成功标准

- 主 agent 可以用 `mode="map_reduce"` 或专用 tool 发起分析。
- planner 能根据输入范围生成稳定 `MapShard` 列表。
- mapper 子 agent 必须按 `output_contract` 输出 JSON。
- validator 能把格式错误、超时、空输出收敛为结构化 shard error。
- reducer 能合并所有 mapper 输出，生成去重 finding、覆盖率摘要和补跑建议。
- workflow 目录包含 planner、mapper、validator、reducer 的审计事件。
- `code_findings` 契约能支撑大工程代码审查。

## 最小范围

第一版聚焦 `code_findings`：
- 找 bug、架构风险、安全风险、性能风险、测试缺口。
- 支持按目录、glob、文件列表分片。
- 支持每个 shard 的文件数量和 token 预算上限。
- 支持失败 shard 进入最终报告。
- 支持 reducer 对 finding 做标题、文件、行号、证据的去重。

## 范围暂缓

- mapper 自动修改代码。
- reducer 自动提交修复。
- 多 reducer 层级归并。
- 远程机器执行 shard。
- Web UI 专用交互。
- 任意用户自定义 JSON Schema 的完整校验器。

## 关键约束

- 协议真源仍放在 `core.contracts` 或 agent workflow 自有 runtime 数据结构中，跨模块共享时按现有边界收敛。
- `core.Runner` 仍是唯一 turn loop，map_reduce 只新增编排策略。
- 子 agent 权限沿用 `subagent-scoped-permissions-v0.1`，v0.1 通过输入物化让 mapper 在自己的 workdir 内读取 shard 内容并写输出。
- `AgentWorkflowManager` 负责 workflow 目录和 audit，具体策略逻辑进入独立 strategy。
- 第一版 reducer 固定为确定性代码路径，agent-assisted reducer 进入 v0.2 演进。

## DoD

- 新增 `map_reduce` mode 的 task 包进入 x-req。
- `MapReduceWorkflowSpec`、`MapShard`、`MapperOutputEnvelope`、`CodeFinding`、`ReducerOutput` 字段均有中文注释。
- 单元测试覆盖 planner 分片、mapper 输出校验、reducer 去重和失败 shard 汇总。
- live smoke 覆盖一个小型 repo 目录扫描。
- 文档给出大工程代码分析的默认 contract 和示例 JSON。
