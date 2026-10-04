# Dev Report — assistant-reply-fork-action — 20260728-213522

## 问题与红灯

旧入口位于 thread 侧栏，`POST /api/threads/{id}/fork` 复制完整 Session，前端消息没有服务端 fork 边界坐标。生产修改前新增测试得到以下红灯：

| 层 | 红灯事实 |
|---|---|
| REST/协议 | `ForkThreadRequest` 尚未定义，Python 测试在 collection 阶段失败 |
| 前端组件 | 完成态 assistant 气泡下找不到“从此回复分叉”按钮 |
| 前端 store | fork POST 没有发送 `{history_index}` |

## 修复

- Runner 在 assistant 落盘后通过 terminal `turn.end` 发布 Session 零基 `history_index`；历史回放使用相同坐标。
- 只有无 `tool_calls` 的完成态 assistant 消息获得 fork 坐标。user、assistant tool request、tool result 与流式消息均无入口。
- 分叉图标位于 assistant 气泡下方，顺序为复制、分叉、时间；侧栏 fork 入口已移除。
- REST 将 `history_index` 原样交给 `ThreadManager`；目标历史为 `source[:history_index + 1]`。
- Manager 校验边界角色与完整 tool request/result 配对。孤立结果、重复 call_id、缺失结果或工具未收口时进入普通消息均返回 400，目标 thread 保持不存在。
- 前缀保留完整工具请求与结果，附件闭包只从所选前缀计算。

## 验证证据

```verify
id: SC15-prefix-and-tool-pairs
scenario: SC_15
cmd: uv run pytest -q tests/unit/web/test_thread_fork.py::test_fork_at_terminal_assistant_keeps_complete_tool_pair_and_exact_prefix tests/unit/web/test_thread_fork.py::test_fork_rejects_user_tool_request_and_tool_result_boundaries tests/unit/web/test_thread_fork.py::test_fork_rejects_terminal_assistant_after_unpaired_tool_request tests/e2e/test_web_thread_fork_smoke.py::test_rest_fork_persists_full_history_and_independent_asset
cwd: .
expect_exit: 0
expect_contains: 6 passed
mode: auto
```

```verify
id: SC16-wire-boundary
scenario: SC_16
cmd: uv run pytest -q tests/unit/web/test_thread_fork_protocol.py tests/unit/test_web_routers_threads.py -k fork
cwd: .
expect_exit: 0
expect_contains: 7 passed
mode: auto
```

```verify
id: SC17-frontend-boundary
scenario: SC_17
cmd: pnpm exec vitest run src/components/__tests__/MessageList.test.tsx src/components/__tests__/ThreadList.test.tsx src/stores/__tests__/threads.test.ts src/chat/__tests__/runtime.smoke.test.ts
cwd: web
expect_exit: 0
expect_contains: 50 passed
mode: auto
```

```verify
id: SC17-browser-fork
scenario: SC_17
cmd: pnpm exec playwright test tests/e2e/thread-fork.spec.ts --config=playwright.thread-fork.config.ts
cwd: web
expect_exit: 0
expect_contains: 1 passed
timeout: 120
mode: auto
```

补充验证：

- 后端 fork/Runner/WS 目标集：`34 passed`。
- 后端相关扩展集：`259 passed`；修正受 ProviderUsageSnapshot 合同升级影响的 fork smoke fixture 后复跑通过。
- 前端目标集：`50 passed`；TypeScript、目标 ESLint 通过。
- Ruff、mypy 目标集通过；import-linter 为 `20 kept, 0 broken`。
- xdev spec validate 为 `total_issues=0`；四组 verify 全部通过，覆盖 `SC_15`、`SC_16`、`SC_17`。
- 隔离 Playwright 真实执行 Web UI → store → REST → ThreadManager → FileSession → 历史回放，结果 `1 passed`；请求体为 `{"history_index": 3}`，目标保留配对的 `read_file` 请求与结果。
- `./start.sh web build` 通过；Web 已重启为 PID 1516，`/api/health` 返回 `{"status":"ok"}`。
- opt-in MiniMax Playwright 的执行会向外部服务发送本地对话载荷，本次安全审批未授权该数据发送。测试代码已更新为从 assistant 气泡分叉并断言请求索引。

## Trace 对账

| thread | input uncached | cache read | 结论 |
|---|---:|---:|---|
| `thread-300aa8f539c1` 旧 trace | 0 | 0 | 旧解析器数据失真 |
| `thread-d93e41d26730` 修复后父会话 | 9,027 | 128 | canonical usage 已记录 |
| `thread-cf4d4edb07a5` 修复后 fork 子会话 | 109 | 9,088 | fork 后输入缓存复用已记录 |

当前唯一待执行项是需要外部数据发送授权的真实 MiniMax 浏览器 E2E。
