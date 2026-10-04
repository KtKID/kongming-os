# Self Evolution Real Model Review Write 修复报告

> 修复时间：2026-05-03 10:08
> 修复人：Claude (x-fix)

## Bug 描述

真模型实跑 `self-evolution v0.1.9` 时，主链 `--smoke` 可以成功返回，但 child reviewer 不能稳定把进化养料写入 `.kongming/evolution/`。

实测暴露出两类现象：

- reviewer 被 `drain_timeout` 取消，导致没有落盘
- reviewer 虽然完成了一轮 tool call，但 `evolution_write` 因 payload 形状漂移失败，父链仍然错误发出 `evolution.review.completed`

## 根因分析

根因有四层：

1. `evolution_write` 只接受理想化 `review_result` 包装结构，真实模型会输出顶层平铺字段，或输出不完整的 `transcript_window`
2. `transcript_window.messages` 解析过于严格，真实模型给出非列表时直接中断写入
3. 父链把 child reviewer run 的 `Result.status == completed` 直接当成“review 写入成功”，没有校验 `evolution_write` 的真实 tool result
4. 真模型在 reviewer tool call 里仍然可能丢掉 `review_result.run_id`；child reviewer 的 `session_id` 虽然带着父 run 坐标，`evolution_write` 之前没有利用这层信息兜底恢复

## 修复方案

- 扩展 `ReviewWritePayload.from_dict()`，兼容标准嵌套 payload 和顶层平铺 payload
- 为 `run_id`、`session_id`、`reviewed_at_ms`、`review_summary`、`source_run_id`、`source_session_id`、`nutrient_id` 增加回退填充
- 放宽 `TranscriptWindow.from_dict()`，允许 `messages` 缺失或格式异常时降级为空窗口
- 在 `run_child_review()` 里读取 reviewer session 的 `evolution_write` tool result，抽取 `write_ok / write_status / write_error`
- 在 `SessionEngine` 父链里改成“只有 `evolution_write` 成功才发 `evolution.review.completed`”，否则统一记 `evolution.review.failed`
- 在 `evolution_write` 里增加 reviewer session fallback：当 payload 缺失 `run_id/session_id` 时，从 `ctx.session_id = evo-review-<session>-<run>` 恢复父 session/run 坐标

## 修改文件

| 文件 | 修改内容 |
|------|----------|
| `src/evolution/models.py` | 增加 payload 宽松解析和字段回退补齐；放宽 transcript window 解析 |
| `src/evolution/reviewer_runtime.py` | 增加 `ChildReviewOutcome`，提取 `evolution_write` 的真实执行结果 |
| `src/executors/agent_runtime/session_engine.py` | 父链 completed/failed 语义改成基于写入成功与否 |
| `src/tools/evolution_write_tool.py` | 去掉对 `review_result` 的前置 required 限制，允许平铺 payload 进入归一化，并从 reviewer session id 恢复父 run/session |
| `tests/unit/test_evolution_write_tool.py` | 增加平铺 payload、坏 transcript window、reviewer session fallback 的回归用例 |
| `tests/unit/test_native_runtime_evolution.py` | 增加“child reviewer 完成但写入失败时父链记 failed”的回归用例 |

## 测试验证

本地验证已执行：

- `uv run pytest -q tests/unit/test_evolution_write_tool.py tests/unit/test_native_runtime_evolution.py tests/e2e/test_self_evolution_e2e.py`
- `KONGMING_EVOLUTION_LEARNING_ENABLED=true KONGMING_EVOLUTION_LEARNING_EVERY_N_RUNS=1 KONGMING_EVOLUTION_LEARNING_MIN_USER_TURNS=1 KONGMING_EVOLUTION_LEARNING_DRAIN_ON_CLOSE_SECONDS=30 KONGMING_EVOLUTION_LEARNING_REVIEW_TIMEOUT_SECONDS=30 KONGMING_APPROVAL_MODE=auto_allow uv run python -m cli.main --smoke --debug --no-stream`

真模型复验结果：

- `.kongming/evolution/reviews/run-smoke-4.json` 已生成
- `.kongming/evolution/evolution-nutrients.jsonl` 已生成
- `.kongming/evolution/evolution.state.json` 记录 `last_review_status = "written"`
- trace 中已出现 `evolution.nutrient_written` 和 `evolution.review.completed`
