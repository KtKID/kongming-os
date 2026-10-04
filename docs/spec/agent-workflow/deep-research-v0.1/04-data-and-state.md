# 数据模型与状态

状态流转和 artifact 关系图见 [diagrams.md](./diagrams.md)。

## Payload schema

```json
{
  "topic": "What changed in OpenAI agent SDK design in 2026?",
  "objective": "Produce a cited research report with verified facts and unresolved questions.",
  "source_policy": {
    "language": "zh-CN",
    "freshness_days": 30,
    "allowed_domains": [],
    "blocked_domains": [],
    "prefer_primary_sources": true
  },
  "limits": {
    "jury_size": 3,
    "reject_quorum": 2,
    "source_budget": 10,
    "fact_cap": 20,
    "search_results_per_line": 6,
    "fetch_concurrency": 4,
    "jury_concurrency": 6,
    "workflow_timeout_seconds": 2400
  },
  "report": {
    "language": "zh-CN",
    "max_findings": 12,
    "include_rejected": true,
    "include_open_questions": true
  }
}
```

## 核心数据模型

### `ResearchPlan`

| 字段 | 类型 | 说明 |
|------|------|------|
| `topic` | string | 用户研究问题 |
| `objective` | string | 研究目标 |
| `lines` | `SearchLine[]` | 3-6 条搜索线 |
| `created_by` | string | planner task run id |

### `SearchLine`

| 字段 | 类型 | 说明 |
|------|------|------|
| `line_id` | string | 稳定搜索线 ID |
| `topic` | string | 搜索主题 |
| `query` | string | 具体搜索查询 |
| `why` | string | 该搜索方向的理由 |
| `angle` | string | overview / technical / latest / skeptical / practical 等 |

### `SearchHit`

| 字段 | 类型 | 说明 |
|------|------|------|
| `hit_id` | string | 搜索结果 ID |
| `line_id` | string | 来源搜索线 |
| `url` | string | 原始 URL |
| `canonical_url` | string | 去重 URL |
| `title` | string | 标题 |
| `snippet` | string | 摘要 |
| `fit` | string | high / medium / low |
| `rank` | int | 搜索线内排名 |

### `ResearchSourceRecord`

| 字段 | 类型 | 说明 |
|------|------|------|
| `source_id` | string | 来源 ID |
| `canonical_url` | string | canonical URL |
| `url` | string | 实际读取 URL |
| `title` | string | 标题 |
| `tier` | string | primary / secondary / blog / forum / weak |
| `fetch_status` | string | selected / fetched / skipped / failed |
| `excerpt` | string | 可引用正文片段 |
| `error` | string/null | 读取错误摘要 |

### `ExtractedFact`

| 字段 | 类型 | 说明 |
|------|------|------|
| `fact_id` | string | 事实 ID |
| `statement` | string | 可证伪断言 |
| `excerpt` | string | 原文引用 |
| `source_id` | string | 来源 ID |
| `source_url` | string | 来源 URL |
| `source_tier` | string | 来源等级 |
| `weight` | string | key / support / aside |
| `confidence_hint` | string | extractor 初步信心 |

### `FactGroup`

| 字段 | 类型 | 说明 |
|------|------|------|
| `group_id` | string | 事实组 ID |
| `canonical_statement` | string | 合并后的主断言 |
| `member_fact_ids` | string[] | 成员 fact ID |
| `source_ids` | string[] | 支撑来源 ID |
| `best_excerpt` | string | 最强引用片段 |
| `support_count` | int | 支撑事实数 |

### `JuryRuling`

| 字段 | 类型 | 说明 |
|------|------|------|
| `ruling_id` | string | 裁决 ID |
| `group_id` | string | 被审查事实组 |
| `juror_id` | string | 陪审员 ID |
| `reject` | bool | true 表示反对 |
| `abstain` | bool | true 表示弃权 |
| `reason` | string | 裁决理由 |
| `contradicting_evidence` | string[] | 矛盾证据摘要 |
| `source_coverage` | string | 引用支撑评价 |

### `CheckedFactGroup`

| 字段 | 类型 | 说明 |
|------|------|------|
| `group_id` | string | 事实组 ID |
| `status` | string | upheld / rejected |
| `cast_count` | int | 有效票数 |
| `reject_count` | int | 反对票数 |
| `abstain_count` | int | 弃权票数 |
| `tally` | string | `"pass-reject"` |
| `decision_reason` | string | upheld / reject_quorum / insufficient_casts |

### `ResearchReport`

| 字段 | 类型 | 说明 |
|------|------|------|
| `answer` | string | 3-5 句核心回答 |
| `findings` | array | 存活发现，含引用和 tally |
| `rejected` | array | 被否决事实，含理由和 tally |
| `limitations` | string[] | 局限性 |
| `open_questions` | string[] | 未解决问题 |
| `stats` | object | 运行统计 |

## Artifact 目录树

```text
agent-workflows/<workflow_id>/
├── workflow.json
├── audit.jsonl
├── result.json
├── reports/
│   └── index.json
├── agents/
│   └── <task_run_id>/
│       ├── subagent.json
│       ├── task.log.jsonl
│       ├── result.json
│       └── work/
└── deep_research/
    ├── spec.json
    ├── plan.json
    ├── search_hits.jsonl
    ├── sources.selected.jsonl
    ├── sources.duplicates.jsonl
    ├── sources.overflow.jsonl
    ├── sources.fetched.jsonl
    ├── facts.raw.jsonl
    ├── facts.top.jsonl
    ├── groups.jsonl
    ├── rulings.jsonl
    ├── groups.checked.jsonl
    ├── phase_summaries.jsonl
    ├── stats.json
    ├── report.json
    └── report.md
```

## 状态机

Workflow phase 状态：

| 状态 | 含义 |
|------|------|
| `pending` | 阶段尚未开始 |
| `running` | 阶段正在执行 |
| `completed` | 阶段正常完成 |
| `degraded` | 阶段完成且使用 fallback |
| `failed` | 阶段失败并终止后续关键链路 |
| `skipped` | 前置条件为空导致跳过 |

阶段转移：
- `Plan.completed` 进入 `Search.running`。
- `Plan.failed` 进入 workflow failed。
- `Search.completed/degraded` 进入 `Extract.running`。
- `Extract.completed` 且 facts=0 时跳过 Group/Crosscheck，进入 Report fallback。
- `Group.completed/degraded` 进入 `Crosscheck.running`。
- `Crosscheck.completed/degraded` 进入 `Report.running`。
- `Report.completed/degraded` 进入 workflow completed。

## 审计事件

| 事件 | 触发点 | payload 核心字段 |
|------|--------|------------------|
| `deep_research.phase_started` | 每阶段开始 | `phase`、`workflow_id`、`limits_snapshot` |
| `deep_research.phase_completed` | 每阶段完成 | `phase`、`status`、`artifact_paths`、`stats_delta` |
| `deep_research.phase_degraded` | fallback 生效 | `phase`、`fallback`、`reason` |
| `deep_research.subagent_task_started` | 子 agent task 创建 | `task_run_id`、`phase`、`role`、`task_log_path`、`child_session_log_path`、`budget_snapshot` |
| `deep_research.subagent_task_completed` | 子 agent task 完成 | `task_run_id`、`phase`、`role`、`status`、`output_artifacts`、`task_log_path` |
| `deep_research.subagent_task_failed` | 子 agent task 失败或降级 | `task_run_id`、`phase`、`role`、`status`、`error_digest`、`task_log_path` |
| `deep_research.source_selected` | URL 进入预算 | `source_id`、`canonical_url`、`fit`、`line_id` |
| `deep_research.source_duplicate` | URL 去重 | `canonical_url`、`kept_source_id`、`dropped_hit_id` |
| `deep_research.source_overflow` | 预算截断 | `canonical_url`、`fit`、`source_budget` |
| `deep_research.fetch_failed` | fetch 异常 | `source_id`、`url`、`error_digest` |
| `deep_research.fact_extracted` | fact 写入 | `fact_id`、`source_id`、`weight` |
| `deep_research.group_created` | group 写入 | `group_id`、`member_count`、`source_count` |
| `deep_research.ruling_recorded` | jury 裁决 | `group_id`、`juror_id`、`reject`、`abstain` |
| `deep_research.group_decided` | group 聚合裁决 | `group_id`、`status`、`tally` |
| `deep_research.report_written` | 报告写入 | `report_path`、`finding_count`、`rejected_count` |

## 配置字段

payload `limits` 优先级高于 config 默认值，config 默认值优先级高于内置常量。

建议配置项：

| 字段 | 默认建议 | 说明 |
|------|----------|------|
| `deep_research.enabled` | false | WebSearch/WebFetch PoC 通过后打开 |
| `deep_research.default_jury_size` | 3 | 单个 fact group juror 数 |
| `deep_research.default_reject_quorum` | 2 | 否决阈值和有效票最低数 |
| `deep_research.default_source_budget` | 10 | v0.1 保守来源预算 |
| `deep_research.max_source_budget` | 15 | 对齐 MiMo 默认上限 |
| `deep_research.default_fact_cap` | 20 | v0.1 保守事实上限 |
| `deep_research.max_fact_cap` | 25 | 对齐 MiMo 默认上限 |
| `deep_research.fetch_concurrency` | 4 | fetch 并发 |
| `deep_research.jury_concurrency` | 6 | juror 并发 |
| `deep_research.workflow_timeout_seconds` | 2400 | workflow 总超时 |
| `deep_research.source_provider` | `internal` | `internal` / `subagent_tools` |

环境变量后续可映射为：
- `KONGMING_DEEP_RESEARCH_ENABLED`
- `KONGMING_DEEP_RESEARCH_SOURCE_PROVIDER`
- `KONGMING_DEEP_RESEARCH_SOURCE_BUDGET`
- `KONGMING_DEEP_RESEARCH_FACT_CAP`
- `KONGMING_DEEP_RESEARCH_FETCH_CONCURRENCY`
- `KONGMING_DEEP_RESEARCH_JURY_CONCURRENCY`
