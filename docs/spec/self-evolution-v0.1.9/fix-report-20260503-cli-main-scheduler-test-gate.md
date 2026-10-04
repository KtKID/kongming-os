# CLI Main Scheduler Test Gate 修复报告

> 修复时间：2026-05-03 18:35
> 修复人：Codex (x-fix)

## Bug 描述

`self-evolution-v0.1.9` 提交前，pre-commit 的 `pytest tests/unit` 在 `tests/unit/test_cli_main.py` 失败 4 条。失败点集中在 `_DummyRuntime` 相关 CLI 装配测试。

## 根因分析

`src/cli/main.py` 现在会在 `_run()` 里按 `cfg.scheduler.enabled` 默认装配 cron ticker。`tests/unit/test_cli_main.py` 的 `_build_cfg()` 没显式关闭 scheduler，测试里的 `_DummyRuntime` 又缺少 `runner` 等 cron bridge 需要的属性，导致测试在进入 session bridge 之前就抛出 `AttributeError`。

## 修复方案

在 `tests/unit/test_cli_main.py` 的 `_build_cfg()` 中显式注入 `SchedulerConfig(enabled=False)`，让这组测试继续只覆盖 CLI runtime/session 选择逻辑，把 cron ticker 装配职责留给 `test_cli_main_scheduler.py`。

## 修改文件

| 文件 | 修改内容 |
|------|----------|
| `tests/unit/test_cli_main.py` | 引入 `SchedulerConfig`，并在测试配置里显式关闭 scheduler |

## 测试验证

- `uv run pytest -q tests/unit/test_cli_main.py`
- `git commit` 触发的 pre-commit 全量 `pytest tests/unit`
