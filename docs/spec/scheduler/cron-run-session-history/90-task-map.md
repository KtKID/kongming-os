# Task 映射

## 模块到任务

| 模块 | Task | 优先级 | 可并行 | 说明 |
|------|------|--------|--------|------|
| M1 scheduler run index contract | T1 backend data/API | P0 | 与 T3 可并行 | run/session 字段、run summary、API DTO 基础 |
| M2 execution bridge run session | T2 execution chain | P0 | 依赖 T1 字段约定 | Runner session 切换、run audit、delivery 输入 |
| M3 web thread run API | T1 backend data/API | P0 | 与 T2 局部并行 | task runs/messages REST |
| M4 cron realtime protocol | T3 protocol/WS | P0 | 与 T1/T4 可并行 | `cron.*` frame 四元组和合同测试 |
| M5 frontend run timeline | T4 frontend state/routing | P0 | 依赖 T1 API shape，可先 mock | selected run、timeline key、run context 只读 |
| M6 migration and validation | T5 migration compatibility + T6 validation/e2e | P0 | T5 可早做 fixture，T6 收尾 | legacy 展示和端到端验收 |

## 推荐开发顺序

1. T1 定义 run/session 数据契约和 REST DTO。
2. T2 改造 `ExecutionBridge` 使用独立 run session。
3. T3 补齐 `cron.*` WS frame 的 `session_id` 和合同测试。
4. T4 前端接入 run selector、timeline 分流和 run context composer 禁用。
5. T5 处理旧 run 和旧 thread history 的 legacy 兼容。
6. T6 跑完整验证并回写 dev-report。

## 任务拆分说明

| Task | 目标 | 主要文件 |
|------|------|----------|
| T1 backend data/API | 后端可按 task/run 解析 session 并提供 messages API | `src/scheduler/domain.py`、`src/scheduler/store.py`、`src/hosts/web/routers/cron.py`、`src/hosts/web/threads/manager.py` |
| T2 execution chain | 每次 cron run 使用独立 session 执行并写入 run record | `src/application/scheduled_runs/execution_bridge.py`、`src/scheduler/delivery.py`、`src/hosts/web/app_support/cron_delivery.py` |
| T3 protocol/WS | 所有 cron 实时帧携带四元组，前后端 DTO 同步 | `src/hosts/web/protocol/ws_frames.py`、`web/src/protocol.ts`、WS tests |
| T4 frontend state/routing | 同一个 thread 页面按 run 切换 timeline，run context 禁用 composer | `web/src/modules/scheduler/store.ts`、`web/src/modules/scheduler/api.ts`、`web/src/chat/providers/GenericChatProvider.ts`、chat page/timeline store |
| T5 migration compatibility | 旧共享 history 显示为 legacy，新 run 独立 | scheduler store migration tests、frontend legacy label tests |
| T6 validation/e2e | 覆盖后端、前端、协议、smoke/e2e | pytest、vitest、Playwright 或现有 smoke harness |

## PoC 建议

最高风险是 `ExecutionBridge` session 切换和前端 timeline key 切换。建议先做一个窄 PoC：fake provider 连续运行同一 task 两次，断言两个 run session 文件各自只含自己的 user/assistant；前端用 mock API 切换两个 run，断言 timeline 替换而非追加。
