# dev-report · task-tool-call-arguments

> date: 2026-09-30 · x-dev

## 结论

✅ 全绿：行 3/3 🟢，场景覆盖 2/2（feat07 场景1、场景2 的数据源头），回归通过。

- T1：`src/core/runner.py` `_execute_single_tool_call` 的 `tool.call.start` payload 补发 `arguments: call.arguments`。
- T2：`tests/unit/test_runner_tool_call_start_arguments.py` 新增 2 用例（事件 payload 层 + 真实 `WSEventSink` 帧层）。TDD 红灯先行：修复前失败原因为 payload 缺 `arguments`（帧层 `{}` 对比 `{"path": ...}`），与 spec 缺陷描述一致；修复后同测试转绿。
- T3：未改文件。`ChatRenderAdapter.test.ts:131-154` 已存在 `arguments` 透传断言（`expect(toolItem.arguments).toEqual({ path: "/x" })`），本次运行 19/19 通过，投影链路已锁。绿灯属预期——该行是回归锁而非新功能。

## 回归

- `tests/unit/test_core_runner_basic.py` + `test_runner_interrupt.py` + `test_web_ws_event_sink_full_log.py`：35 passed。
- 前端 `ChatRenderAdapter.test.ts`：19 passed。
- mypy（runner.py + 新测试）no issues；ruff check / format 通过。

## 高风险行

无（无鉴权 / 持久化 / 并发 / 不可逆改动；wire 字段 `ToolCallStartFrame.arguments` 原有定义只是开始有值）。

## 未决

无。
