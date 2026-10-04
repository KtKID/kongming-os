# 验证策略与演进

## 验证目标

Deep Research 的验证重点是事实链路完整性、阶段降级可复跑、预算裁剪可解释、jury 判定可预测。测试需要覆盖 contracts、source provider、dedupe、phase fallback、artifact schema、manager/tool 集成、完整 e2e 和 live smoke。

## 单元测试

建议文件：

| 文件 | 覆盖范围 |
|------|----------|
| `tests/unit/test_deep_research_contracts.py` | payload 校验、limits 默认值、MiMo 参数对照、非法 quorum |
| `tests/unit/test_deep_research_dedupe.py` | `canonicalize_url()`、大小写、`www.`、尾 slash、重复 URL、budget overflow |
| `tests/unit/test_deep_research_fact_board.py` | artifact writer、jsonl append、stats、phase summaries |
| `tests/unit/test_deep_research_jury.py` | reject quorum、全弃权、部分弃权、全部否决、tally |
| `tests/unit/test_deep_research_grouping.py` | Group null fallback、members 越界过滤、per-fact fallback |
| `tests/unit/test_agent_workflow_tool_deep_research.py` | tool schema、payload normalize、错误提示、mode enum |

核心场景表：

| 场景 | 输入 | 期望 |
|------|------|------|
| 空输入 | `topic=""` / `None` | 返回参数错误，Plan failed |
| Plan null | fake planner 返回 null | workflow failed，错误写 result |
| URL canonicalize | 大小写、`www.`、尾 slash | 归一后重复 |
| URL budget overflow | hits 超过 source budget | selected 截断，overflow 写入 |
| FACT_CAP 截断 | raw facts > fact_cap | top facts 数量等于 cap，stats 记录 raw/top |
| Group null | grouper 返回 null | 每条 fact 一个 group |
| members 越界 | `member_indexes=[0, 99]` | 过滤 99，保留 0 |
| Crosscheck 全弃权 | 3 个 null ruling | rejected，reason=insufficient_casts |
| Crosscheck 部分弃权 | 2 pass + 1 abstain | upheld，tally=2-0 |
| Crosscheck 全部否决 | 3 reject | rejected，tally=0-3 |
| Report null | reporter 返回 null | report fallback 包含 upheld/rejected |

## 集成测试

建议文件：

| 文件 | 覆盖范围 |
|------|----------|
| `tests/unit/test_agent_workflow_deep_research_strategy.py` | strategy 用 fake source provider 和 fake subagent runner 跑完整阶段 |
| `tests/unit/test_agent_workflow_deep_research_artifacts.py` | workflow 目录、公共 result、deep_research artifact、audit event |
| `tests/unit/test_deep_research_subagent_task_logs.py` | 每个子 agent task 的 `task.log.jsonl`、`subagent.json.task_log_path`、child session 路径和 audit 事件 |
| `tests/unit/test_subagent_permissions_deep_research.py` | WebSearch/WebFetch 路线的权限边界，或 ResearchSourceProvider 路线的审计边界 |
| `tests/unit/web/workflow_viewer/test_deep_research_adapter.py` | 后续专用 viewer adapter 投影 |

集成场景：

| 场景 | Fake 设置 | 期望 |
|------|-----------|------|
| happy path | 3 lines、6 hits、4 sources、8 facts、3 groups、jury 通过 2 组 | result completed，report.md 存在 |
| Read 失败降级 | 1 个 source fetch exception | weak source 写入，流程继续 |
| facts=0 | 所有 sources facts 为空 | 跳过 Group/Crosscheck，空结果报告 |
| all rejected | jury 对全部 group 达到 reject quorum | completed，rejected 明细完整 |
| source provider missing | provider 未配置 | 明确前置能力错误 |
| audit completeness | 每阶段至少 started/completed 或 degraded | audit.jsonl 事件完整 |
| subagent task log completeness | fake planner/extractor/grouper/juror/reporter 全部运行 | 每个 task 有 task.log.jsonl、subagent.json 索引和 audit 事件 |

## 完整 e2e 测试

建议文件：`tests/e2e/test_deep_research_workflow.py`

执行方式：

```bash
uv run pytest tests/e2e/test_deep_research_workflow.py -v
```

e2e 使用离线 fake provider 和 deterministic fake LLM/subagent runner，覆盖从 tool 到 manager 到 strategy 到 artifacts 的完整链路：

1. 构造 `RunAgentWorkflowTool`，绑定测试 `AgentWorkflowManager`。
2. 调用 `mode="deep_research"` 和最小 payload。
3. fake planner 返回 3 条搜索线。
4. fake source provider 返回含重复 URL 和 overflow 的 hits。
5. fake fetch 返回 3 个成功来源和 1 个失败来源。
6. fake extractor 返回超过 `fact_cap` 的 facts。
7. fake grouper 返回含越界 member 的 groups。
8. fake jury 返回通过、部分弃权、全弃权和否决组合。
9. fake reporter 返回报告。
10. 断言 root `result.json`、`reports/index.json`、`deep_research/report.md`、`stats.json` 和 audit 事件。
11. 断言每个 planner、extractor、grouper、juror、reporter task 都有 `agents/<task_run_id>/task.log.jsonl`，且 `subagent.json.task_log_path` 可读。

通过标准：
- exit code 0。
- `result.json.completed == true`。
- `stats.selected_source_count <= source_budget`。
- `stats.top_fact_count <= fact_cap`。
- `groups.checked.jsonl` 同时包含 upheld 和 rejected。
- `report.md` 含 citations 和 tally。
- 每个子 agent task 都能从 workflow detail 追溯到 task log 和 child session log。

## Web Viewer E2E 测试

建议文件：`tests/e2e/web/test_deep_research_workflow_viewer.py`

执行方式：

```bash
./start.sh web start --build
uv run pytest tests/e2e/web/test_deep_research_workflow_viewer.py -v
```

数据准备：
1. 先运行确定性完整 e2e，生成一个 `mode="deep_research"` 的 workflow 目录。
2. 创建测试 thread，记录 `thread_id`。
3. 将 `agent-workflows/<workflow_id>` 复制到该 thread 的 `session.file_store_path` 下。
4. 同步复制 `subagent-*` child session 目录，确保 `subagent.json.child_session_log_path` 可读。

检查项：
- workflow 列表显示 deep_research、status、report 数、usage 摘要。
- workflow detail API 返回公共 flow nodes、reports 和 mode panel。
- 专用 adapter 未实现时，Unknown adapter 能展示公共 result 和 artifact diagnostics。
- 专用 adapter 实现后，页面展示 plan、sources、facts、jury tally、rejected、report 和 stats。
- 点击子 agent report 行能加载完整 conversation。
- 缺少 `rulings.jsonl` 或 `report.md` 时返回 diagnostics，页面展示可读错误。

## 快速 Smoke 测试

Smoke 目标是用最低成本检查装配链路和主要 artifact。

| Smoke | 建议文件 | 命令 | 必查项 |
|-------|----------|------|--------|
| strategy catalog | `tests/unit/test_agent_workflow_strategy_manager.py` | `uv run pytest tests/unit/test_agent_workflow_strategy_manager.py -k deep_research -v` | list/describe 包含 `deep_research` |
| tool schema | `tests/unit/test_agent_workflow_tool_deep_research.py` | `uv run pytest tests/unit/test_agent_workflow_tool_deep_research.py -v` | mode enum、payload normalize、错误提示 |
| deterministic workflow | `tests/e2e/test_deep_research_workflow.py` | `uv run pytest tests/e2e/test_deep_research_workflow.py -k smoke -v` | result、stats、report.md、audit.jsonl 存在 |
| viewer projection | `tests/e2e/web/test_deep_research_workflow_viewer.py` | `uv run pytest tests/e2e/web/test_deep_research_workflow_viewer.py -k smoke -v` | detail API 和主要 panel 可读 |

## Live smoke 测试

建议文件：`tests/e2e/test_deep_research_live_smoke.py`

执行方式：

```bash
uv run pytest tests/e2e/test_deep_research_live_smoke.py -v -m live
```

live smoke 使用真实 provider 和一个低成本问题，默认 limits 降低成本：

```json
{
  "topic": "What are the current official docs for OpenAI Responses API tool calling?",
  "limits": {
    "source_budget": 3,
    "fact_cap": 5,
    "jury_size": 3,
    "reject_quorum": 2,
    "fetch_concurrency": 2,
    "jury_concurrency": 3
  },
  "source_policy": {
    "prefer_primary_sources": true,
    "allowed_domains": ["openai.com", "platform.openai.com"]
  }
}
```

live smoke 验收：
- 搜索和 fetch 可完成，或返回明确 provider 前置错误。
- 至少写出 `plan.json`、`sources.selected.jsonl`、`stats.json`。
- 若有 facts，报告包含 URL 引用和 tally。
- 失败时错误指向 provider、网络、权限或 LLM 阶段。
- 测试默认标记 `live`，常规 unit/e2e 默认跳过。

## MiMo 缺口映射

| MiMo 缺口 | Kongming 测试建议 | 优先级 |
|-----------|-------------------|--------|
| 空输入 | `test_empty_topic_returns_failed_result` | P0 |
| Plan null | `test_plan_null_stops_with_clear_error` | P0 |
| URL budget overflow | `test_source_budget_records_overflow` | P0 |
| Read 失败降级 | `test_fetch_failure_records_weak_source` | P0 |
| facts=0 | `test_zero_facts_returns_empty_report` | P0 |
| Group null | `test_group_null_falls_back_to_per_fact` | P1 |
| members 越界 | `test_group_members_out_of_bounds_are_filtered` | P1 |
| Crosscheck 全弃权 | `test_jury_all_abstain_rejects_for_insufficient_casts` | P0 |
| Crosscheck 部分弃权 | `test_jury_partial_abstain_uses_cast_quorum` | P0 |
| 全部否决 | `test_all_groups_rejected_returns_rejected_report` | P0 |
| Report null | `test_report_null_returns_checked_fact_fallback` | P1 |
| FACT_CAP 截断 | `test_fact_cap_truncates_before_crosscheck` | P0 |

## 演进路线

### v0.1

- 完成 source provider PoC。
- 完成 `deep_research` strategy、contracts、artifact writer 和核心测试矩阵。
- 使用通用 workflow result 和 reports index 展示。
- 预算默认保守，允许 payload 覆盖到 MiMo 默认上限。

### v0.2

- 增加 `DeepResearchWorkflowViewerAdapter`。
- 支持 source provider 缓存和来源质量评分扩展。
- 支持 domain allow/block policy 和 primary-source 强约束。
- 增加 report citation renderer，支持 Markdown footnote 或 numbered citations。

### v0.3

- 支持跨 run 事实复用和 contradiction memory。
- 支持多语言报告模板。
- 支持更细粒度 budget ledger 和 provider token 成本统计。
