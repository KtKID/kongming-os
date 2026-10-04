# 验证策略与演进

## 验证目标

验证必须证明三件事：每次执行上下文独立、同一个 thread 可以切换不同 run 历史、实时帧可以按 run 分流。单纯的单元测试通过只能说明局部函数正确，完整验收需要覆盖 Web UI -> API -> scheduler store -> runner session -> WS -> timeline 的薄链路。

## 后端测试

| 层级 | 覆盖点 | 建议文件 |
|------|--------|----------|
| Domain/store | `ScheduledRun.thread_id/session_id` roundtrip，旧 run 回填，legacy 标记 | `tests/unit/scheduler/test_scheduler_store.py` |
| SchedulerManager | `list_thread_runs`、`resolve_run_session`、task/thread 归属校验 | `tests/unit/scheduler/test_scheduler_manager.py` |
| ExecutionBridge | 连续两次 run 生成不同 `session_id`，Runner 使用 run session | `tests/unit/scheduler/test_scheduler_execution_bridge.py` |
| Web routes | task runs/messages API 的路径、DTO、错误码 | `tests/unit/web/test_cron_router.py` |
| ThreadManager | cron message appended frame 透传 run 元信息 | `tests/unit/test_web_thread_manager_boot.py` |
| WS protocol | `cron.run.started/finished/completed/message.appended` 必含四元组 | `tests/unit/web/test_ws_frames_contract.py` |

## 前端测试

| 层级 | 覆盖点 | 建议文件 |
|------|--------|----------|
| API client | runs/messages 路径和 DTO 字段 | `web/src/modules/scheduler/__tests__/api.test.ts` |
| scheduler store | `runsByTaskId`、selected run、未选中 run 的 WS 更新 | `web/src/modules/scheduler/__tests__/store.test.ts` |
| chat provider | `cron.message.appended` 携带 run/session 并转 timeline event | `web/src/chat/providers/__tests__/providers.contract.test.ts` |
| timeline/page | 切换 run 后消息列表替换，run context 禁用 composer | `web/src/pages/__tests__/Chat.test.tsx` |
| UI interaction | 点击今天/昨天/手动运行记录切换可见历史 | scheduler 或 chat 页面组件测试 |

## 协议漂移测试

- Python `CronMessageAppendedFrame` fixture 包含 `frame_type/thread_id/task_id/run_id/session_id/message_id/content`。
- TypeScript `CronMessageAppendedFrame` fixture 使用同一 JSON。
- 缺 `session_id` 的 frame 在前端合同测试中失败。
- unknown extra fields 保持兼容读取。
- `cron.run.completed` 兼容旧名称，但新字段必须齐全。

## Smoke / E2E

| ID | 链路 | 验收 |
|----|------|------|
| SM-001 | 创建 scheduled_task thread -> 运行两次 -> list runs | 同一 `thread_id` 下出现两个 `run_id`，两个 `session_id` 不同 |
| SM-002 | 选择第一条 run -> load messages -> 刷新页面 | 恢复第一条 run session 历史，入口 thread timeline 不混入该 run |
| SM-003 | 当前选择第二条 run -> 收到第一条 run 的 WS frame | timeline 不追加，运行记录列表更新第一条 run 状态 |
| E2E-001 | Web UI run_now -> cron finished -> 当前 run timeline 实时出现回复 | 页面无需手动刷新即可看到当前 run 的 assistant message |
| E2E-002 | 刷新页面 -> URL 带 `runId` -> 恢复对应 timeline | 刷新后仍显示同一 run 历史 |

## 回归范围

- `scheduled-task-thread` 已有一任务一 thread 测试继续通过。
- cron drawer 的运行记录刷新继续通过。
- generic_chat 普通 thread 不受 run selector 影响。
- approval inbox 仍能处理 cron run 的 tool approval。

## 演进路线

| 阶段 | 内容 |
|------|------|
| Phase 1 | 独立 run session、run list、messages API、前端切换 |
| Phase 2 | run unread/badge、失败 run 快速定位、运行摘要增强 |
| Phase 3 | run search、run diff、长期 session compaction |
| Phase 4 | scheduler store 数据库化和跨设备同步 |

## 上线策略

先让新 run 严格独立，legacy 历史保留为混合入口。上线后观察 run list 和 WS 分流日志，确认没有 `thread_id == session_id` 的新 run 写入，再考虑提示用户旧历史的迁移说明。
