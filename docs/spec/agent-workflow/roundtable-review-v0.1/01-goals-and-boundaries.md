# 目标与边界

## 系统目标

`roundtable_review` 的目标是让主 agent 在代码模块设计 review 时获得多视角、证据绑定、可审计的评审结果。评审过程必须减少从众效应，保留 reviewer 原始主张，记录交叉质询，并由 arbiter 输出可执行结论。

## 完成目标（DoD）

- [ ] `run_agent_workflow` 可用 `mode="roundtable_review"` 触发策略。
- [ ] 策略只通过 `AgentWorkflowStrategyManager` 注册和分发，`AgentWorkflowManager` 继续只管 workflow 生命周期、审计、报告和子 agent 运行。
- [ ] `participants.select` 选出的角色独立评审时互相不可见，只共享同一份输入上下文。
- [ ] 每条 claim 和 rebuttal 都落盘到 ReviewBoard，并绑定证据字段。
- [ ] 交叉质询只允许 `support`、`refute`、`supplement` 三类发言。
- [ ] Arbiter 输出 6 节报告：共识问题、主要分歧、高优先级风险、建议修改方案、需要人工确认的问题、可直接交给开发 Agent 的任务清单。
- [ ] 子 agent 总预算、讨论轮次、并发、超时和单文件输入上限都有明确字段。
- [ ] 失败、超时、输出非法、预算耗尽都有可审计记录和 fallback 行为。

## 范围边界

**包含**
- workflow mode、payload schema、策略说明和 tool schema。
- participant reviewer prompt、rebuttal prompt、arbiter prompt。
- ReviewBoard 目录和文件契约。
- 子 agent scoped workdir 输入物化。
- 结构化输出提取和 schema 校验。
- 单元测试和 fake subagent 测试。

**边界外职责**
- provider 真实 token 计费强约束。
- Web timeline 专用交互。
- 自动补跑 participant。
- 自动改代码和提交。
- 多 workflow 聚合报告。

## 关键约束

- `core.Runner` 仍是唯一 turn loop。
- `roundtable_review` 作为 strategy 包存在，不能把模式逻辑写入 `AgentWorkflowManager`。
- 子 agent 文件访问沿用 scoped workdir，只读取物化后的 `input/`。
- 跨模块协议优先收敛在 workflow strategy 自有 contract；需要被其他模块共享时再提升到 `core.contracts`。
- 默认讨论轮次包含第 1 轮独立分析。
- `max_discussion_rounds` 默认 6，运行期对用户输入做硬封顶。
- 第一版 `total_child_token_budget=50000` 是全部子 agent 的输入快照预算加输出估算预算总额，输入物化前必须裁剪上下文。

## DoD 到模块追踪矩阵

| DoD 条目 | 需要模块 | 需要 task | 状态 |
|---------|----------|----------|------|
| mode 可触发 | Strategy Entry + Tool Schema | task-1 | 待实现对齐 |
| manager 解耦 | Strategy Entry | task-1 | 待审核 |
| 独立评审隔离 | Prompt Contracts + ReviewBoard | task-2 | 待实现对齐 |
| claims/rebuttals 落盘 | ReviewBoard | task-3 | 待实现对齐 |
| 三类质询 | Prompt Contracts + Contract Parser | task-4 | 待实现对齐 |
| Arbiter 六节报告 | Arbiter | task-5 | 待实现对齐 |
| 预算和轮次边界 | Budget Controller | task-6 | 待实现对齐 |
| 失败和 fallback | Strategy Entry + ReviewBoard | task-7 | 待实现对齐 |
