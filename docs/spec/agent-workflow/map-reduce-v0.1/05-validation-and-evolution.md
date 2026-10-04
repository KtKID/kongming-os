# 验证策略与演进

## 第一版验证

| 层级 | 命令 | 断言 |
|------|------|------|
| validator 单测 | `uv run pytest tests/unit/test_map_reduce_contracts.py -v` | `MapperOutputEnvelope` 字段缺失、类型错误、空 finding 都有结构化错误 |
| workflow 单测 | `uv run pytest tests/unit/test_agent_workflow_map_reduce.py -v` | strategy registry 分发 map_reduce，状态机写 audit、root result、report index 和 reducer result；覆盖 planner token limit、mapper output limit、timeout failed shard 和 `validation_repair_retries` 拒绝 |
| manager 回归 | `uv run pytest tests/unit/test_agent_workflow_manager.py -v` | parallel 旧链路、tool 输出、audit 和报告路径保持 |
| strategy catalog 回归 | `uv run pytest tests/unit/test_agent_workflow_strategy_manager.py -v` | 默认策略目录包含 `map_reduce` 和 `parallel`，unknown mode 报告 available/runnable modes |
| 架构边界 | `uv run lint-imports` | import-linter 架构边界全部保持 |
| live smoke | `KONGMING_E2E_REAL_MODEL=1 uv run pytest tests/e2e/test_map_reduce_live.py -v -s` | 后续 `map-reduce-live-smoke-v0.1` 补 MiniMax M3 扫小目录，产出 `code_findings` reducer result |

## 关键测试用例

1. workflow fake mapper：3 个稳定 shard，写 `workflow.json`、`audit.jsonl`、root `result.json`、`reports/index.json`、`map_reduce/shards.json`、`map_reduce/mappers/index.json`、`map_reduce/reducer/result.json`。
2. validator contract：合法 JSON、fenced JSON、自然语言包裹 JSON 都能提取，字段缺失和类型错误返回结构化 validation error。
3. token limit：单个输入文件超过 `max_estimated_tokens_per_shard` 时显式拒绝。
4. output limit：mapper 输出超过 `max_output_chars` 时进入 validation failed shard。
5. mapper timeout：单个 mapper 超时写 agent result / report / audit，并进入 reducer failed shard 汇总。
6. unsupported repair：`validation_repair_retries > 0` 在 v0.1 显式拒绝。
7. tool 分流：`run_agent_workflow(mode="map_reduce")` 将完整 payload 交给 `AgentWorkflowManager.run_workflow_payload(...)`。
8. parallel 回归：旧 `run_parallel_subagents` 和 `parallel` strategy 路径保持。
9. live smoke：后续任务验证真实模型 mapper 只读取物化输入，工作目录内写 mapper output，越界写沿用 scoped permission 拒绝。

## 观测与审计

`audit.jsonl` 必须覆盖：
- `map_reduce_started`
- `map_reduce_shards_planned`
- `map_reduce_inputs_materialized`
- `map_mapper_started`
- `map_mapper_completed`
- `map_mapper_output_validated`
- `map_reduce_reducer_started`
- `map_reduce_reducer_completed`
- `map_reduce_completed`

每个 mapper 输出保留原始内容摘要和校验结果，reducer 输出保留去重前数量、去重后数量、排序策略和失败 shard 数量。

## 演进路线

### v0.1

- `code_findings` 契约。
- path glob / file list 分片。
- 确定性 reducer。
- JSON 输出校验。
- workflow 审计和 tool result 回流。

### v0.2

- 接入 xcodeatlas module map 和 dependency graph。
- 增加 `code_inventory` 契约。
- reducer 支持 agent-assisted 摘要。
- 支持 mapper 输出自动修复一次。

### v0.3

- 支持层级 map_reduce：mapper -> local reducer -> global reducer。
- 支持长任务断点续跑。
- 支持 Web workflow timeline。

## 风险与处理

| 风险 | 处理 |
|------|------|
| mapper 输出格式漂移 | prompt 中嵌入字段中文注释和 JSON 示例，validator 拦截 |
| shard 太大 | planner 估算 token 后二次切分 |
| reducer 丢失重要 finding | 保留 raw mapper output 和 dedupe audit |
| 模型自行总结缺少证据 | `CodeFinding.locations` 和 `evidence` 设为必填 |
| 大工程扫描成本过高 | `limits.max_shards`、`max_concurrency`、`max_files_per_shard` 控制 |

## 当前建议

下一步 task 进入 `map-reduce-live-smoke-v0.1`，用真实模型跑小目录 map_reduce smoke，验证 mapper JSON 稳定性、scoped workdir、artifact 可读性和主 agent tool result 回流。parallel 包拆分保持独立后续任务。
