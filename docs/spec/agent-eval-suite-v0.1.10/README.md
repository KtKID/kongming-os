# agent-eval-suite-v0.1.10

> 状态：方案确认中
> 目标：为当前 `kongming-agent` 框架设计一套第一性原理测试集，统一评估 `Runner / SessionEngine / Safety / Session / Tool / Host(Web)` 这条 agent 主链
> 创建时间：2026-05-04

## 系统目标

当前框架的核心职责很清晰：

- `Runner` 负责 turn loop 和 tool 回填
- `SessionEngine` 负责 provider / tool / session / safety 装配
- `Session + Context` 负责历史、指令、压缩、输入组装
- `SafetyChain` 负责 capability / permission / approval
- `EventSink + Web Host` 负责可观测性和宿主协议

所以测试集也应该围绕这条主链来设计。

第一性原理定义只有一句：

> agent 框架的价值，是把用户意图转成**安全、可观测、可恢复**的状态推进。

这套测试集就围绕六个不变量展开：

1. `状态推进正确`
2. `动作执行正确`
3. `权限边界正确`
4. `上下文连续性正确`
5. `观测与重放完整`
6. `宿主与后台任务隔离`

## 范围边界

**包含**：

- 当前仓库内框架级能力测试设计
- 统一的 case 数据结构、grader 结构、报告结构
- 与现有 `tests/unit`、`tests/e2e`、`tests/manual` 的映射
- 三条执行 lane：`stub`、`replay`、`real-provider-smoke`
- Web / skill / scheduler / self-evolution 在主框架里的位置

**不包含**：

- 公共 benchmark 排行榜接入
- 面向某个具体业务场景的 domain 数据集
- 大规模性能压测和多机压测
- 自动生成用例内容的 LLM pipeline

## 模块导航

| 模块 | 状态 | 文档 | 是否可进 task | 说明 |
|---|---|---|---|---|
| A. 测试对象与边界 | 方案确认 | [02-module-breakdown.md](./02-module-breakdown.md) | 是 | 把当前框架拆成可评估能力面 |
| B. 执行流程 | 方案确认 | [03-core-workflows.md](./03-core-workflows.md) | 是 | case 编写、执行、判分、报告 |
| C. 数据与状态 | 方案确认 | [04-data-and-state.md](./04-data-and-state.md) | 是 | `CaseSpec` / `ExecutionRecord` / `GraderResult` |
| D. 测试矩阵与演进 | 方案确认 | [05-validation-and-evolution.md](./05-validation-and-evolution.md) | 是 | MVP case 集、现有覆盖映射、缺口 |
| E. 横评任务集 | 方案确认 | [06-cross-runtime-task-set.md](./06-cross-runtime-task-set.md) | 是 | `kongming / hermes / openclaw` 零侵入黑盒横评任务 |
| F. task 拆分 | 方案确认 | [90-task-map.md](./90-task-map.md) | 是 | 实施顺序和前置依赖 |

## 关键决策

| # | 决策 | 说明 |
|---|---|---|
| 1 | 测试对象定义为“整套系统行为” | 公开 benchmark 测的是 system；内部测试也要测 system |
| 2 | case 的一等输出是 `trace + result + artifacts` | 最终文本只覆盖一部分质量 |
| 3 | 判分分三层：`exact assertion`、`trace assertion`、`semantic grader` | 当前框架的大多数回归都可以做成确定性断言 |
| 4 | 执行 lane 分三档：`stub`、`replay`、`real-provider-smoke` | 成本、稳定性、真实性三者分层处理 |
| 5 | 当前 repo 继续沿用 `tests/unit` + `tests/e2e` + `tests/manual` | 贴合现有结构，避免另起一套目录哲学 |
| 6 | Web、scheduler、self-evolution 作为框架扩展面进入同一测试集 | 它们都消费同一条 runtime 主链 |
| 7 | case id 必须稳定 | 让 trace、报告、CI 回归可以按用例维度追踪 |
| 8 | 先统一测试语义，再补公开 benchmark | 先把仓库自己的骨架守住 |

## 当前建议

1. 先把现有零散测试收编成统一 case 视图，不急着发明新的测试框架。
2. MVP 先落 `24` 条框架级 case，覆盖 `core / safety / context / tool / web / evolution` 六大面。
3. 第一批只做 `stub + replay` 两条 lane，`real-provider-smoke` 保持小而硬，只留少量真链路冒烟。
