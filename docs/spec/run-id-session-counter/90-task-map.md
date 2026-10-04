# Task Map

## 推荐方案：合 1 个 task

| 模块 | 建议 task 名 | 是否创建 task | 前置依赖 | 当前状态 |
|------|--------------|----------------|----------|----------|
| M1+M2+M3+M4+M5+M6 | `run-id-session-counter` | 是 | 无 | 可进入 x-req |

整体改动跨 core / context / executors / web / 前端，但因强依赖链（M1 → M2 → M3 → M4），合为一个 task 一气呵成更稳；M5、M6 顺手做。

## 备选方案：拆 2 段

如果觉得单 task 过大想分阶段交付：

| 阶段 | task 名 | 范围 | 前置依赖 | 状态 |
|------|---------|------|----------|------|
| Phase 1 | `run-id-backend` | M1 + M2 | 无 | 可进入 x-req |
| Phase 2 | `run-id-web-flow` | M3 + M4 + M5 + M6 | Phase 1 | 待 Phase 1 完成 |

Phase 1 完成后理论上能跑 CLI 验证 run_id 新格式（用 `make cli` 看 trace 输出），不影响 web；Phase 2 才动 web 协议和前端。

## 不建议的拆法

- **按文件拆 6 个 task**：M1-M6 各自一个 → 太碎，跨 task 调试 ChatItem 显示是否正确需要把 6 个都做完才能验证；交付节奏拖
- **按"修 bug" + "增强"拆**：把 M5/M6 单独砍出来 → M5 依赖 M4 的 runId 字段，无法独立；M6 倒是真独立

## 进入 x-req 前的准备

无论选哪个方案，进入 `x-req` 前要确认：

1. **session_id 在 cli/web 的实际取值**：CLI 是 `--session-id` 入参或自生成；Web 是 `thread-{12hex}`。run_id 拼成 `run-{session_id}-{n}` 后整体长度 ~30 chars，trace / 前端 badge 可读
2. ~~manifest schema 升级是否要 SCHEMA_VERSION bump~~：已拍板**不 bump**，旧 session 全删处理
3. ~~SQLite ALTER 兼容~~：已拍板 **sqlite 后端不维护**，仅留 NotImplementedError stub

这些问题在 x-req 阶段已全部澄清完毕，可进 x-plan / x-dev。
