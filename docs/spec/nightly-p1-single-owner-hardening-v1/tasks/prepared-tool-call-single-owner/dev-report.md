# Dev Report — prepared-tool-call-single-owner — 20260729

## 根因与修复

Runner 已在审批前调用 `ToolCallPreparer.prepare()`，随后把裸 arguments 传给
`BaseBuiltinTool.execute()`。基类执行入口会再次识别 preparer 并执行第二次
prepare，同时 required 校验、默认填充或路径归一化仍可能发生在审批之后。审批
事实与真正执行事实因此拥有两个语义 owner。

修复把 `Tool.execute` 收紧为只接收 `PreparedToolCall`。Runner 对 preparer 只调用
一次，对普通 Tool 构造空 execution scope 的默认快照，再为审批与执行各生成一份
等值深拷贝。`BaseBuiltinTool.prepare()` 负责审批前 required 校验，
`BaseBuiltinTool.execute()` 只调用 `_run()`。Shell、Web Fetch、Skill、Schedule、
workflow、evolution、MCP、Web Search、subagent scoped file 和 CLI smoke 均迁移到
相同合同；测试直调统一经过 `execute_prepared_tool()`。

## 红灯证据

生产修改前运行
`test_runner_prepares_once_and_isolates_approval_from_execution`，断言失败值为
`prepare_count actual=2, expected=1`。spy 第一次 prepare 产出 A，第二次产出 B；
审批还会把自己的嵌套副本改成 C。修复后同一测试证明 prepare 与 validation 均只
调用一次，审批观察 A/scope A，执行继续观察 A，B/C 均未进入执行。

## 改动文件

- `src/core/contracts/tool_runtime.py`
- `src/core/runner.py`
- `src/tools/runtime/base.py`
- `src/tools/builtin/shell_tool.py`
- `src/tools/builtin/schedule_tool.py`
- `src/tools/builtin/skill_tool.py`
- `src/tools/builtin/web_fetch_tool.py`
- `src/tools/agent_workflow_tool.py`
- `src/tools/mcp/adapter.py`
- `src/application/subagents/permissions.py`
- `src/application/web_search/manager.py`
- `src/evolution/review_request_tool.py`
- `src/hosts/cli/main.py`
- `tests/support/tool_calls.py`
- 30 个直接 Tool 调用测试文件及 Runner/stream/CLI 测试替身
- `docs/modules/核心/README.md`
- `docs/modules/工具/README.md`
- `docs/spec/nightly-p1-single-owner-hardening-v1/tasks/prepared-tool-call-single-owner/dev-checklist.md`
- `docs/spec/nightly-p1-single-owner-hardening-v1/tasks/prepared-tool-call-single-owner/dev-report.md`

## 验证证据

```verify
id: SC20-default-prepared-call
scenario: SC_20
cmd: uv run pytest -q tests/unit/test_core_runner_basic.py::test_runner_plain_tool_gets_copied_arguments_and_empty_scope
cwd: .
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

```verify
id: SC21-single-preparation
scenario: SC_21
cmd: uv run pytest -q tests/unit/test_core_runner_basic.py::test_runner_prepares_once_and_isolates_approval_from_execution tests/unit/test_core_runner_basic.py::test_runner_rejection_keeps_single_preparation_and_skips_execution
cwd: .
expect_exit: 0
expect_contains: 2 passed
mode: auto
```

```verify
id: SC28-post-approval-isolation
scenario: SC_28
cmd: uv run pytest -q tests/unit/test_core_runner_basic.py::test_runner_approval_and_shell_execution_share_prepared_cwd tests/unit/test_core_runner_basic.py::test_runner_prepares_once_and_isolates_approval_from_execution tests/unit/test_core_runner_basic.py::test_runner_write_file_approval_matches_canonical_execution tests/unit/test_core_runner_basic.py::test_runner_workflow_approval_matches_normalized_execution tests/unit/test_core_runner_basic.py::test_runner_schedule_approval_matches_frozen_create_defaults
cwd: .
expect_exit: 0
expect_contains: 5 passed
mode: auto
```

```verify
id: SC22-prepared-direct-callers
scenario: SC_22
cmd: uv run pytest -q tests/unit/tools/runtime/test_base.py tests/unit/tools/test_mcp_tool_adapter.py tests/unit/test_subagent_permissions.py
cwd: .
expect_exit: 0
expect_contains: 15 passed
mode: auto
```

## 补充质量证据

- Runner 与 production tool preparation 聚焦回归：`142 passed`。
- 30 个迁移测试文件批量回归：`270 passed, 1 skipped`；唯一跳过项是需显式环境
  开关和外部 MiniMax MCP 的 live smoke。
- `uv run mypy`：25 个目标生产文件通过。
- `uv run ruff check`：目标源码与测试通过。
- `uv run lint-imports`：20 个架构合同通过。
- `git diff --check`：通过。
- 静态扫描：`src/` 与 `tests/` 中旧 `execute(args: dict, ctx)` Tool 签名为零；
  生产 Tool 调用均传入 `PreparedToolCall`。

## Gate② 修复回归

- issue-1：File、Choice、TaskProgress、AgentRole、Memory、EvolutionWrite、
  AgentWorkflow 和 Schedule 的类型校验、默认填充、路径/工作流/trigger 归一化
  已进入各自 `prepare()`；execute/_run 只消费 canonical arguments。
- map_reduce inline 输入在 prepare 阶段只生成确定路径计划，文件写入保留在审批后，
  且执行按批准的 root/files 原样物化。
- 新增真实 Runner + WriteFile/Workflow/Schedule 三条生产哨兵，分别证明绝对路径与
  append 默认值、task_flow 默认结构、schedule trigger/default/next_run_at 在审批
  与执行两侧完全相等。
- issue-2：按 x-fix 的 P2 规则保留在 issue ledger；SC_28 的生产错误事实通过
  Runner 测试补充覆盖。

本报告由 x-dev 于 2026-07-29 生成。
