# 核心流程

图形版流程见 [diagrams.md](./diagrams.md)，本文只写执行语义和降级规则。

## 父 agent 调用链

1. 主 agent 识别用户需要深度研究，调用 `run_agent_workflow`。
2. tool 层校验 `mode="deep_research"`，归一化 `payload.topic`、`limits`、`source_policy`、`report`。
3. tool 通过 late-bound handle 调用 `AgentWorkflowManager.run_workflow_payload()`。
4. `AgentWorkflowManager` 创建 workflow id、workflow 目录、audit writer、context，并把请求交给 `AgentWorkflowStrategyManager`。
5. `AgentWorkflowStrategyManager` 分发到 `DeepResearchStrategy.run()`。
6. `DeepResearchStrategy` 执行 6 阶段，所有子 agent 通过 `AgentWorkflowManager.run_subagent_task()` 派发。
7. `DeepResearchArtifactWriter` 写 `deep_research/` 细节产物，manager 写公共 result 和 reports index。
8. tool 层返回简短摘要，包含 workflow id、状态、报告路径、来源数、事实数、存活数和否决数。

## 六阶段执行流程

### 1. Plan

输入：
- `topic`：用户研究问题。
- `objective`：研究目标，可从 topic 派生。
- `source_policy`：语言、时间范围、来源偏好。

处理：
- planner 子 agent 生成 3-6 条互补搜索线。
- 每条搜索线包含 `topic`、`query`、`why`、`angle`。
- 推荐角度覆盖：概述、技术/学术深度、最新进展、反对/怀疑观点、实践经验。

输出：
- `plan.json`。
- `phase.plan.completed` audit。

降级：
- 空 topic 返回明确失败 result，写 `phase.plan.failed`。
- Plan 返回 null、空搜索线或 schema 错误时返回明确失败 result，后续阶段保持 pending。

### 2. Search

输入：
- `SearchLine[]`。
- `limits.search_results_per_line`、`limits.source_budget`。

处理：
- 每条搜索线通过 WebSearch 子 agent 或 `ResearchSourceProvider.search()` 返回 4-6 个候选。
- 对候选按 fit rank 排序：high > medium > low。
- 对 URL 做 canonicalize 去重。
- 按 `source_budget` 截断，记录 `duplicates` 和 `overflow`。

输出：
- `search_hits.jsonl`。
- `sources.selected.jsonl`。
- `sources.duplicates.jsonl`。
- `sources.overflow.jsonl`。
- `phase.search.completed` audit。

降级：
- 单条搜索线失败时记录该 line 的失败，其他搜索线继续。
- 全部搜索线失败时进入空来源 result，Report 阶段输出无来源说明。
- URL budget overflow 写 stats，保留优先级最高的来源集合。

### 3. Extract

输入：
- 去重后的 selected sources。

处理：
- 对每个 URL 并发 fetch。
- extractor 子 agent 从正文中抽取 2-5 条可证伪事实。
- 每条事实必须有 `statement`、`excerpt`、`source_url`、`source_title`、`tier`、`weight`。
- source tier 采用 `primary`、`secondary`、`blog`、`forum`、`weak`。
- fact weight 采用 `key`、`support`、`aside`。

输出：
- `sources.fetched.jsonl`。
- `facts.raw.jsonl`。
- `phase.extract.completed` audit。

降级：
- fetch 返回 null 时跳过该 source，并记录 `fetch_skipped`。
- fetch 异常时写 weak source，facts 为空，流程继续。
- 所有 facts 为 0 时直接生成空结果报告，包含来源、失败统计和补救建议。

### 4. Group

输入：
- raw facts，按 `weight` 和来源等级排序后截断到 `fact_cap`。

处理：
- grouper 子 agent 识别语义等价事实，把相同断言合并为 fact group。
- 每个 group 记录 canonical statement、member fact ids、source urls、best excerpt、support count。

输出：
- `facts.top.jsonl`。
- `groups.jsonl`。
- `phase.group.completed` audit。

降级：
- Group 返回 null、空 groups 或 schema 错误时回退到每条事实一个 group。
- members 越界时过滤越界成员，保留合法成员。
- group 过滤后为空时回退到对应事实自身。

### 5. Crosscheck

输入：
- fact groups。
- `jury_size`、`reject_quorum`、`jury_concurrency`。

处理：
- 每个 group 派发 `jury_size` 个 juror 子 agent。
- juror prompt 从 5 个维度审查：
  1. 引用是否支撑事实。
  2. 是否存在矛盾证据。
  3. 来源等级是否匹配主张力度。
  4. 信息是否过时。
  5. 是否属于营销、公关或低质量论坛内容。
- 每个 juror 输出 `reject`、`abstain`、`reason`、`evidence_notes`。
- 聚合规则：有效票数 `cast_count >= reject_quorum` 且反对票 `reject_count < reject_quorum` 时事实存活。
- tally 格式使用 `"pass-reject"`，例如 `2-1`。

输出：
- `rulings.jsonl`。
- `groups.checked.jsonl`。
- `phase.crosscheck.completed` audit。

降级：
- juror 返回 null 记为弃权。
- 全部弃权导致 `cast_count=0`，事实进入 rejected，原因是有效票不足。
- 部分弃权按有效票数和反对票规则处理。
- 全部事实被否决时仍返回 rejected 明细、tally 和来源。

### 6. Report

输入：
- upheld groups。
- rejected groups。
- sources、stats、limitations。

处理：
- reporter 子 agent 生成最终研究报告。
- 报告结构包含 `answer`、`findings`、`rejected`、`limitations`、`open_questions`、`stats`。
- 每个 finding 包含 statement、certainty、sources、source tiers、supporting excerpts、tally。
- findings 按 certainty 和来源等级排序。

输出：
- `report.json`。
- `report.md`。
- root `result.json` extra 字段。
- `phase.report.completed` audit。

降级：
- Report 返回 null 时返回已验证事实列表和 rejected 列表，写 `report_fallback=true`。
- upheld 为空时生成全否决报告，包含每条 rejected 的 tally 和 source。

## 错误降级流程

| 场景 | 策略响应 | result 状态 |
|------|----------|-------------|
| 空输入 | 写 plan failed，返回参数错误 | failed |
| Plan null | 写 plan failed，返回规划失败 | failed |
| 单条 Search 失败 | 记录 line error，继续其他 line | running/completed |
| URL budget overflow | 记录 overflow，按预算继续 | completed |
| Fetch null | 记录 skipped，丢弃该 source | completed |
| Fetch exception | 写 weak source 和空 facts | completed |
| facts=0 | 跳过 Group/Crosscheck，生成空结果报告 | completed |
| Group null | per-fact fallback | completed |
| members 越界 | 过滤越界成员，必要时 per-fact fallback | completed |
| Crosscheck 全弃权 | 事实 rejected，reason=insufficient_casts | completed |
| Crosscheck 全否决 | 输出 rejected 明细和 tally | completed |
| Report null | 输出 checked facts fallback | completed |

## 预算和并发流程

| 预算 | 控制点 | 默认建议 | 可配置方式 |
|------|--------|----------|------------|
| `jury_size` | 每个 group 的 juror 数 | 3 | payload limits / config |
| `reject_quorum` | 否决阈值和有效票最低数 | 2 | payload limits / config |
| `source_budget` | selected URLs 上限 | 10 | payload limits / config |
| `fact_cap` | crosscheck facts 上限 | 20 | payload limits / config |
| `search_results_per_line` | 每条搜索线候选数 | 6 | payload limits |
| `fetch_concurrency` | fetch 并发数 | 4 | payload limits / config |
| `jury_concurrency` | juror 子 agent 并发数 | 6 | payload limits / config |
| `workflow_timeout_seconds` | workflow 总时长 | 2400 | payload limits / config |

并发策略：
- Search 可以按搜索线并发，PoC 阶段可串行便于审计。
- Extract 按 source 并发，受 `fetch_concurrency` 控制。
- Crosscheck 按 group 和 juror 形成任务矩阵，受 `jury_concurrency` 控制。
- Report 单任务执行，读取前序产物。

预算消耗写入 `stats.json`：
- `search_line_count`
- `raw_hit_count`
- `selected_source_count`
- `duplicate_source_count`
- `overflow_source_count`
- `fetched_source_count`
- `raw_fact_count`
- `top_fact_count`
- `group_count`
- `jury_task_count`
- `abstain_count`
- `upheld_count`
- `rejected_count`

## Prompt contract

| 子 agent | 输入 | 输出 | 关键要求 |
|----------|------|------|----------|
| planner | topic、objective、source_policy | `SearchLine[]` | 3-6 条互补搜索线，每条写 why |
| searcher | SearchLine | `SearchHit[]` | 返回 URL、title、snippet、fit、reason |
| extractor | fetched source | `ExtractedFact[]` | 每条事实可证伪，带 excerpt 和 tier |
| grouper | top facts | `FactGroup[]` | 合并相同断言，保留 members |
| juror | fact group、source excerpts | `JuryRuling` | 主动寻找反证，支持弃权 |
| reporter | checked groups、sources、stats | `ResearchReport` | 引用、tally、limitations、open questions |

## 子 agent task log contract

每个 planner、searcher、extractor、grouper、juror、reporter task 都必须落地一份可审计日志，日志由 `AgentWorkflowManager.run_subagent_task()` 或其下游 `SubAgentManager` 统一创建。Deep Research strategy 负责提供 phase、role、输入 artifact 引用、prompt hash、预算、并发组和工具白名单；manager 负责写入日志路径和 child session 路径。

建议字段：

| 字段 | 说明 |
|------|------|
| `workflow_id` | 所属 workflow |
| `task_run_id` | 子 agent task 稳定 ID |
| `phase` | plan / search / extract / group / crosscheck / report |
| `role` | planner / searcher / extractor / grouper / juror / reporter |
| `input_artifacts` | 输入文件相对路径列表 |
| `prompt_hash` | prompt 模板或最终 prompt 的 hash |
| `tool_allowlist` | 本 task 允许工具列表 |
| `budget_snapshot` | token、turn、timeout、并发和来源预算 |
| `started_at` / `completed_at` | 起止时间 |
| `status` | completed / degraded / failed / cancelled |
| `error_digest` | 失败或降级摘要 |
| `output_artifacts` | 输出文件相对路径列表 |
| `child_session_log_path` | child session JSONL 路径 |

落地要求：
- `agents/<task_run_id>/task.log.jsonl` 记录 task 生命周期事件。
- `agents/<task_run_id>/subagent.json` 记录 `task_log_path` 和 `child_session_log_path`。
- `audit.jsonl` 写入 `deep_research.subagent_task_started`、`deep_research.subagent_task_completed` 或 `deep_research.subagent_task_failed`，payload 携带相对路径。
- Web viewer 通过 `subagent.json` 读取 task log，再跳转到 child session conversation。
