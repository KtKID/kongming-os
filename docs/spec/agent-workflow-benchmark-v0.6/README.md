# agent-workflow-benchmark-v0.6

> 状态：方案确认
> 目标：为 `application.agent_workflows` 建立可复算 benchmark，评估任务质量、token 消耗、完成时间、失败率和审计可追溯性
> 创建时间：2026-06-16

## 系统目标

任务编排 benchmark 的目标是评估 workflow strategy 把一个复杂任务拆解、执行、收口和记录为可审计产物的能力。

本方案承接 [agent-eval-suite-v0.1.10](../agent-eval-suite-v0.1.10/README.md) 的执行 lane 和 grader 语义，把评测对象聚焦到 `AgentWorkflowManager` 及其默认策略：

- `parallel`：并行子任务分派、失败收口、报告索引
- `map_reduce`：分片、mapper 校验、reducer 汇总、重试与超时
- `roundtable_review`：多角色独立评审、反驳轮次、共识报告
- `deep_research`：source provider、事实板、交叉验证、阶段统计

## 关键原则

| # | 原则 | 说明 |
|---|---|---|
| 1 | 产物优先 | benchmark 读取 `workflow.json`、`result.json`、`audit.jsonl`、`reports/*`、`agents/*` 等事实产物 |
| 2 | 确定性评分优先 | CI 主评分由 schema、artifact、JSON path、gold assertion、阈值断言组成 |
| 3 | 真实链路分层 | `stub` / `replay` 进入稳定门禁，`real-provider-smoke` 进入手动 benchmark 和 release gate |
| 4 | 指标可比较 | token、耗时和质量分都按 case budget 和阈值归一化 |
| 5 | 门户统一 | 新增公共入口使用 `BenchmarkManager`，文件名使用 `benchmark_manager.py` |

## 范围

范围内：

- workflow benchmark case manifest
- workflow artifact collector
- 通用指标投影：完成状态、token、耗时、失败率、artifact 完整性
- mode 专属评分：`map_reduce`、`roundtable_review`、`deep_research`
- suite 报告：`summary.json`、`case-results.jsonl`、`report.md`

范围外：

- 公共排行榜
- 大规模压测
- 多机性能基准
- 用 LLM 自动生成 benchmark case

## 模块导航

| 模块 | 文档 | 说明 |
|---|---|---|
| 指标与评分 | [02-metrics-and-scoring.md](./02-metrics-and-scoring.md) | 评分维度、权重、P0/P1 指标 |
| 数据与状态 | [03-data-and-state.md](./03-data-and-state.md) | manifest、snapshot、result、report 结构 |
| 采集与执行 | [04-collector-and-runner.md](./04-collector-and-runner.md) | artifact 采集顺序、执行 lane、报告落盘 |
| task 映射 | [90-task-map.md](./90-task-map.md) | P0/P1/P2 实施顺序和验收口径 |

## 推荐结论

第一阶段先做 `P0`：离线 collector、确定性 scorer、report writer 和 4 个样例 case。这个阶段可以直接对已有 workflow 目录出 benchmark 报告，并为后续真实 suite runner 提供稳定合同。
