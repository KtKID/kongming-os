# Deep Research v0.1

> 状态：方案确认
> 目标：把 MiMo Deep-Research workflow 接入 `agent-workflow`，提供可审计、可降级、带引用和投票比分的深度研究编排。

## 系统目标

`deep_research` 面向需要证据链的开放式研究问题。它把用户问题拆成互补搜索线，收集并去重 URL，从来源中抽取可证伪事实，合并事实等价类，再用 adversarial jury 逐条交叉验证，最终输出带引用、来源等级、事实存活状态和投票比分的研究报告。

## 策略目录文案

`deep_research` 在运行时策略目录、Web slash catalog 和 LLM workflow 选型提示中使用同一组 title/desc：

| 字段 | 内容 |
|------|------|
| `mode` | `deep_research` |
| `title` | `Deep Research 研究工作流` |
| `desc` | `围绕研究问题规划搜索线、收集来源、抽取事实、分组交叉检查并生成带引用报告。` |
| `when_to_use` | 问题需要多来源证据和可追溯引用；需要记录来源去重、预算裁剪、事实和裁决过程；需要离线 fake provider 或确定性兜底跑通完整产物链路。 |

## 最小可用路径

主 agent 调用 `run_agent_workflow(mode="deep_research", payload=...)`，tool 层做 mode schema、payload 归一化和结果摘要展示，`AgentWorkflowManager.run_workflow_payload()` 创建 workflow 生命周期、manifest、audit 和 result，`DeepResearchStrategy` 执行 `Plan -> Search -> Extract -> Group -> Crosscheck -> Report` 六阶段状态机，`SubAgentManager` 执行规划、提取、合并、陪审和报告子 agent，WebSearch/WebFetch 工具或 `ResearchSourceProvider` 提供搜索与读取来源，最终产物写入 `deep_research/` 目录并回流给主 agent。

## 范围边界

**包含**
- 新增 workflow mode：`deep_research`。
- 复用 `AgentWorkflowManager`、`AgentWorkflowStrategyManager`、`SubAgentManager`、workflow audit/result writer 和 viewer adapter 注册模式。
- 定义 6 阶段策略状态机、payload contract、预算字段、artifact schema、审计事件和错误降级规则。
- 定义 WebSearch/WebFetch 工具合同或内部 `ResearchSourceProvider` 的前置 PoC 边界。
- 定义带引用、来源等级、事实合并、jury 投票比分和局限性的报告结构。

**范围外职责**
- 实现具体业务代码。
- 构建 Web 专用 Deep Research 详情页。
- 引入外部搜索服务账号、计费和密钥管理。
- 长期知识库沉淀和跨 run 事实缓存。
- provider 级强制 token 中断。

## 组件状态

| 模块 | 状态 | 文档 | 是否可进 task | 说明 |
|------|------|------|---------------|------|
| `DeepResearchStrategy` | 方案确认 | [02-module-breakdown.md](./02-module-breakdown.md) | 是 | 独立策略包，持有 6 阶段状态机和降级规则 |
| `DeepResearchContracts` | 方案确认 | [04-data-and-state.md](./04-data-and-state.md) | 是 | payload、limits、phase output、report schema |
| `ResearchSourceProvider` / Web tools | 方案确认 | [02-module-breakdown.md](./02-module-breakdown.md) | 是 | 搜索和 fetch 能力的可用性、权限和审计合同；风险等级高 |
| `SourceDeduper` | 方案确认 | [03-core-workflows.md](./03-core-workflows.md) | 是 | URL canonicalize、fit 排序、source budget overflow |
| `FactBoard` | 方案确认 | [04-data-and-state.md](./04-data-and-state.md) | 是 | source、fact、group、ruling、report 的结构化产物 |
| `AdversarialJury` | 方案确认 | [03-core-workflows.md](./03-core-workflows.md) | 是 | jury 并发、弃权处理、reject quorum 裁决 |
| `DeepResearchViewerAdapter` | 探索中 | [90-task-map.md](./90-task-map.md) | 否 | v0.1 先写通用 result；专用展示走后续 task |

## 文档导航

- [图集：总览、策略组件、六阶段时序、事实状态和 artifact ER](./diagrams.md)
- [目标与完成标准](./01-goals-and-boundaries.md)
- [模块设计、接口和数据结构](./02-module-breakdown.md)
- [核心流程](./03-core-workflows.md)
- [数据模型与状态](./04-data-and-state.md)
- [验证策略与演进](./05-validation-and-evolution.md)
- [Task 映射](./90-task-map.md)

## 当前建议

先执行 `ResearchSourceProvider` 或 WebSearch/WebFetch 工具合同 PoC，确认搜索、fetch、权限、审计和测试替身都可稳定工作；随后进入 x-req，把 `DeepResearchStrategy`、数据 contract、artifact writer 和测试矩阵拆成可开发任务。
