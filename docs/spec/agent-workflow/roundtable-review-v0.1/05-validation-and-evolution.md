# 验证策略与演进

## 验证目标

验证重点是架构边界、产物契约和失败行为。真实模型质量通过 e2e smoke 覆盖，单元测试使用 fake subagent 稳定验证状态机。

## 单元测试

| 测试 | 覆盖 |
|------|------|
| `test_roundtable_review_strategy_writes_review_board` | participants.select、rebuttal、arbiter、ReviewBoard 六件套 |
| `test_agent_workflow_manager_registers_roundtable_review` | strategy registry 默认注册 |
| `test_run_agent_workflow_tool_dispatches_roundtable_review` | tool schema、payload 归一化、result data |
| contract parser tests | limits、participants.select、input_source、max_discussion_rounds 封顶 |
| validation tests | 非法 JSON、缺 evidence、非法 severity、非法 comment type |
| budget tests | 预算耗尽停止 rebuttal 或 arbiter |
| Windows path tests | 长 role id 生成短 task_run_id |

## 架构验证

- `ruff check` 覆盖新增 strategy 包。
- `lint-imports` 验证 `core` 和 `tools` 边界。
- `pytest tests/unit/test_agent_workflow_roundtable_review.py -v` 覆盖新策略。
- `pytest tests/unit/test_agent_workflow_map_reduce.py tests/unit/test_agent_workflow_manager.py -v` 覆盖相邻 workflow 兼容性。

## 当前 spike 差距

| 项 | 当前状态 | spec 要求 |
|----|----------|-----------|
| 方案文档 | 已补本 spec | 后续先审 spec |
| manager 解耦 | 基本方向正确 | 保持 manager 只注册 strategy |
| prompt 文本 | 有初版 | 按 `03-core-workflows.md` 精确对齐 |
| 预算语义 | 输出估算为主 | 输入快照和输出估算都纳入总预算 |
| schema 校验 | 只做宽松提取 | 严格校验 claim/comment，非法记录写 validation event |
| `/review` slash | 尚未接入 | 后续 task 单独接入 prompt command 或 action command |
| ReviewBoard | 已有六件套方向 | 补 estimated budget、validation error、state 字段 |
| fallback | 有初版 | 明确区分 budget fallback、arbiter fallback、all-participants-failed |

## e2e smoke

真实模型 smoke 命令建议：

```bash
KONGMING_E2E_REAL_MODEL=1 uv run pytest tests/e2e/test_roundtable_review_live.py -v -s
```

smoke 场景：
- 输入 `src/application/agent_workflows/strategies/map_reduce`。
- topic 为“MapReduce 策略边界是否清晰”。
- `discussion_rounds=2`。
- 断言 `final_report.md` 存在，至少 3 个 claim 有 code evidence。

## 演进方向

1. 真实 token usage 接入：provider 返回 usage 后替代估算器。
2. Reviewer 可配置：在 config 或 payload 中允许 role preset。
3. Web 投影：读取 ReviewBoard 展示 claims、rebuttals、consensus。
4. Re-run 单 claim：对某个 claim 或 participant 补跑。
5. 与 x-req 衔接：final_report 的任务清单可转成 `dev-pipeline/tasks/*` 草稿。
