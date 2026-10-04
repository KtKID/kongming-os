# 目标与完成标准

## 需求要点

1. 用户要把 `E:\xgt\proj\MiMo-Code\docs\deep-research-workflow.md` 描述的 MiMo Deep-Research workflow 接入 kongming-agent。
2. Deep Research 采用 6 阶段流程：Plan -> Search -> Extract -> Group -> Crosscheck -> Report。
3. 核心语义要保留：多角度搜索、URL 去重、来源提取、可证伪事实、事实等价合并、adversarial jury 交叉验证、带引用和投票比分的研究报告。
4. MiMo 默认预算语义要进入 Kongming contract：`JURY_SIZE=3`、`REJECT_QUORUM=2`、`SOURCE_BUDGET=15`、`FACT_CAP=25`；Kongming v0.1 可使用保守默认值并支持配置覆盖。
5. 架构边界要清晰：`AgentWorkflowManager` 管生命周期、审计、manifest 和 result；`DeepResearchStrategy` 管阶段状态机；`SubAgentManager` 管子 agent 执行；WebSearch/WebFetch 或 `ResearchSourceProvider` 是高风险接入前置；tool 层只做 payload 归一化和展示。
6. 测试策略要覆盖 MiMo 文档列出的边界缺口，并包含单元、集成、完整 e2e 和 live smoke。

## 系统目标

`deep_research` 的目标是让主 agent 能对开放式问题执行证据绑定的研究流程。系统需要把检索、读取、事实提取、等价合并、对抗验证和最终报告收束为一个 workflow strategy，并把每个阶段的输入、输出、降级、预算消耗和审计证据写成可复跑产物。

## 完成目标（DoD）

- [ ] 主 agent 可通过 `run_agent_workflow(mode="deep_research", payload=...)` 发起研究，payload 校验、默认 limits 和错误提示清晰。
- [ ] `AgentWorkflowManager` 只承担生命周期、审计、manifest、report index 和 result 写入；`DeepResearchStrategy` 独立持有六阶段状态机。
- [ ] Plan 阶段输出 3-6 条互补搜索线，支持空输入和 Plan null 的明确错误结果。
- [ ] Search 阶段支持多搜索线结果汇总、fit 排序、URL canonicalize 去重、`SOURCE_BUDGET` 限制和 overflow 记录。
- [ ] Extract 阶段支持 WebFetch/ResearchSourceProvider 读取、source tier 标注、2-5 条可证伪事实提取、读取失败降级为 weak source。
- [ ] Group 阶段把等价事实合并为事实组，Group null 或成员越界时回退到可审计的 per-fact 检查。
- [ ] Crosscheck 阶段使用 `JURY_SIZE` 并发陪审，按 `REJECT_QUORUM` 和有效票规则判定存活、否决和弃权。
- [ ] Report 阶段输出核心回答、findings、rejected、limitations、open_questions、引用、来源等级和投票比分；Report null 时返回已验证事实。
- [ ] `FactBoard` artifact 覆盖 source、fact、group、ruling、report、stats 和 phase summaries。
- [ ] 每个子 agent task 都写入可审计落地日志，至少包含 task_run_id、phase、role、输入 artifact 引用、prompt 版本或 hash、权限/工具白名单、预算、开始/结束时间、状态、错误摘要和输出 artifact 引用。
- [ ] 单元、集成、完整 e2e、live smoke 测试覆盖 MiMo 文档列出的边界缺口。

## 范围边界

**包含**
- `deep_research` mode 的策略说明、payload contract、状态机、artifact schema 和测试计划。
- WebSearch/WebFetch 工具合同或内部 `ResearchSourceProvider` PoC 的边界定义。
- 子 agent prompt contract：planner、searcher、extractor、grouper、juror、reporter。
- 预算和并发语义：source budget、fact cap、jury size、reject quorum、fetch concurrency、jury concurrency、workflow timeout。
- Viewer 兼容产物：v0.1 至少写通用 `result.json` 和 `reports/index.json`，后续 adapter 有稳定数据源。

**范围外职责**
- 业务代码实现、测试代码实现和配置文件修改。
- 真实外部搜索服务采购、密钥托管和计费策略。
- Web 专用详情页和交互式证据浏览。
- 跨 workflow 的事实缓存、长期记忆写入和自动发布研究结论。
- 自动改写用户报告或发送到外部系统。

## 关键约束

- `src/core/contracts/` 仍是跨模块协议单一真源；新增跨模块协议需要先判断是否进入 core contracts。
- `src/tools/` 只做 tool schema、payload 归一化、调用 manager 和展示 result；工具层保持业务编排之外。
- `DeepResearchStrategy` 只通过 `AgentWorkflowManager.run_subagent_task()` 调度子 agent，通过 manager 写公共 manifest、report index 和 result。
- `SubAgentManager` 继续负责 child session、权限、运行目录和子 agent 审计；Deep Research 只生成任务规格和阶段上下文。
- 所有 planner、searcher、extractor、grouper、juror、reporter 子 agent task 必须有持久化 task log，日志路径写入 `agents/<task_run_id>/subagent.json` 和 workflow `audit.jsonl`，便于从 workflow、phase 和 child session 三个入口追溯。
- WebSearch/WebFetch 接入需要权限边界：要么扩展 scoped subagent 工具白名单并审计网络目标，要么用内部 `ResearchSourceProvider` 在 strategy 内统一访问来源。
- v0.1 默认参数以成本可控为优先：保持 `jury_size=3`、`reject_quorum=2`，建议 `source_budget=10`、`fact_cap=20`；payload 和 config 可覆盖到 MiMo 默认 `15/25`。
- 所有阶段失败都要写 phase status、错误、fallback 和 stats，便于复跑和 viewer 展示。

## DoD ↔ 模块 ↔ Task 追溯矩阵

| DoD 条目 | 支撑模块 | 建议 task | 状态 |
|---------|----------|-----------|------|
| tool 可发起 `deep_research` | `AgentWorkflowTool`、`DeepResearchContracts` | task-2 | 方案确认 |
| manager 与 strategy 分层清晰 | `AgentWorkflowManager`、`DeepResearchStrategy` | task-3 | 方案确认 |
| Plan 3-6 搜索线和空输入/Plan null | `PlannerPhase`、`DeepResearchContracts` | task-4 | 方案确认 |
| Search 去重和预算 overflow | `ResearchSourceProvider`、`SourceDeduper` | task-1、task-5 | 方案确认 |
| Extract 可证伪事实和读取降级 | `ExtractorPhase`、`FactBoard` | task-6 | 方案确认 |
| Group 等价合并和 fallback | `GrouperPhase`、`FactBoard` | task-7 | 方案确认 |
| Crosscheck jury 裁决 | `AdversarialJury`、`FactBoard` | task-8 | 方案确认 |
| Report 引用和投票比分 | `ReporterPhase`、`DeepResearchResultProjection` | task-9 | 方案确认 |
| artifact 和 viewer 数据源 | `FactBoard`、`DeepResearchArtifactWriter` | task-10 | 方案确认 |
| 测试矩阵覆盖缺口 | `tests/unit`、`tests/e2e`、`tests/e2e -m live` | task-11 | 方案确认 |
