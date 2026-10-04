# Task 映射

## 依赖顺序

```
M1（数据契约）→ M2（preset LLM）→ M3（thread 投递）
                ↗
M4（schedule_tool）
M5（trace）← 独立
```

## 映射表

| 模块 | 建议 task 名 | 是否可进 x-req | 依赖 | 工作量 | 风险 | 备注 |
|------|-------------|---------------|------|--------|------|------|
| M1 | `cron-thread-preset-v0.4-m1-schema` | ✅ | 无 | 1h | 低 | 先行 |
| M2 | `cron-thread-preset-v0.4-m2-preset-llm` | ✅ | M1 | 2h | 中 | provider 构建要跟 run.py 对齐 |
| M3 | `cron-thread-preset-v0.4-m3-thread-delivery` | ✅ | M1, M2 | 2h | 中 | thread session 追加接口需确认 |
| M4 | `cron-thread-preset-v0.4-m4-tool-context` | ✅ | M1 | 1h | 低 | 与 M2 可并行 |
| M5 | `cron-thread-preset-v0.4-m5-trace` | ✅ | 无 | 0.5h | 低 | 任何时候可做 |

## 建议执行顺序

1. **M1 + M5 并行**（数据契约 + trace，无依赖关系）
2. **M2 + M4 并行**（preset LLM + tool context，互不依赖，都只依赖 M1）
3. **M3 最后**（thread 投递，依赖 M1 + M2）

总工作量：~6.5h

## DoD ↔ 模块追溯矩阵

| DoD | 模块 |
|-----|------|
| D1: 任务携带 delivery.target + preset_id | M1, M4 |
| D2: 用正确 LLM 跑 | M2 |
| D3: 有 target 时投递到目标 | M3 |
| D4: /ws/cron 始终广播 | — (v0.3 已有) |
| D5: trace 落盘 | M5 |
| D6: v3→v4 重置式迁移 | M1 |
| D7: lint/typecheck/test 全过 | 全部 |
