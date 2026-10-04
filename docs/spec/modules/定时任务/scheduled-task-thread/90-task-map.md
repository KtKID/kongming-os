# Task Map

| 模块 | 建议 task 名 | 前置依赖 | 对应 DoD | 风险 | 状态 | 备注 |
|------|--------------|---------|---------|------|------|------|
| M1 scheduler domain/store contract | `scheduled-task-thread` | 无 | DoD#3、DoD#4 | 低 | 可进入 x-req | 首先锁定字段和兼容读写 |
| M4 web thread metadata/REST contract | `scheduled-task-thread` | M1 | DoD#1、DoD#6 | 中 | 可进入 x-req | DTO 与 TS 协议同步 |
| M2 scheduler manager/provisioning | `scheduled-task-thread` | M1 + M4 | DoD#1、DoD#2 | 中 | 可进入 x-req | 建议作为创建链路核心门户 |
| M3 execution bridge session binding | `scheduled-task-thread` | M1 + M2 | DoD#4、DoD#5 | 高，建议先写失败复现测试 | 可进入 x-req | 重点验证重复 append 和广播保留 |
| M5 frontend navigation | `scheduled-task-thread` | M4 | DoD#7 | 低 | 可进入 x-req | 左侧分组和 row action 可并行开发 |
| M6 validation | `scheduled-task-thread` | M1-M5 | DoD#8 | 中 | 可进入 x-req | x-req 中展开真实命令和 smoke 步骤 |

## 推荐 x-req 拆法

建议创建一个 task：`scheduled-task-thread`。范围覆盖一条端到端薄切片：

1. 先做 M1 + M4 字段和协议。
2. 再做 M2 创建门户，让 Web 和 schedule_tool 走同一入口。
3. 接着做 M3 执行 session 绑定和 delivery 行为。
4. 最后做 M5 前端入口和 M6 验证闭环。

## PoC 建议

优先用 pytest 固定 M3 风险：

- 构造 `ScheduledTask(thread_id="thread-aaaaaaaaaaaa", delivery.target="thread:thread-aaaaaaaaaaaa")`。
- fake `Runner.run()` 断言接收 `session_id="thread-aaaaaaaaaaaa"`。
- fake dispatcher 断言 Web broadcast 被调用。
- fake ThreadTargetSink 断言同 thread append 被跳过。

该 PoC 通过后，剩余模块按常规 x-dev 实现。
