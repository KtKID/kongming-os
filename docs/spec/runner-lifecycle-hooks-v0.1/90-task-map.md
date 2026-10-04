# Task Map

| 模块 | 建议 task 名 | 前置依赖 | 对应 DoD | 风险 | 状态 | 备注 |
|------|--------------|---------|---------|------|------|------|
| Lifecycle Hook 定义 + Runner Hook 调度 | `runner-lifecycle-hook-points-v0.1` | 无 | DoD#1、DoD#2、DoD#3 | 高，建议先做 core gate | 方案确认 | 删除旧 `AfterRunHook` 与新增 `after_run` 必须同批落地 |
| SessionEngine 注册表 | `runtime-lifecycle-registry-v0.1` | `runner-lifecycle-hook-points-v0.1` | DoD#3、DoD#4、DoD#5 | 中 | 方案确认 | 明确 build 后注册与 run 入口快照语义 |
| Evolution Hook 消费者 | `evolution-lifecycle-consumer-v0.1` | `runtime-lifecycle-registry-v0.1` | DoD#5、DoD#6 | 中 | 方案确认 | 自我进化作为普通 `after_run` 消费者 |
| Host 装配迁移 | `host-lifecycle-registration-v0.1` | `runtime-lifecycle-registry-v0.1` + `evolution-lifecycle-consumer-v0.1` | DoD#5、DoD#6 | 低 | 方案确认 | CLI/Web build 后立即注册，首 run 前完成 |
| 验证与文档对齐 | `lifecycle-validation-docs-v0.1` | 前四个 task | DoD#2、DoD#4、DoD#7 | 中 | 方案确认 | 覆盖顺序、remove、per-run、continue、旧术语清理 |

## 排序依据

1. `runner-lifecycle-hook-points-v0.1` 先做，因为 Runner 是触发点定义和调用 owner。
2. `runtime-lifecycle-registry-v0.1` 第二步做，因为 build 后注册语义需要 runtime 管理入口。
3. `evolution-lifecycle-consumer-v0.1` 第三步做，因为它依赖 runtime 上下文注入。
4. `host-lifecycle-registration-v0.1` 第四步做，因为 CLI/Web 需要前两个接口稳定后迁移。
5. `lifecycle-validation-docs-v0.1` 贯穿实现，最终作为 gate 收尾。

## 可并行性

- `runner-lifecycle-hook-points-v0.1` 与其他实现 task 存在前置关系，建议串行。
- `evolution-lifecycle-consumer-v0.1` 的接口草案可以与 `runtime-lifecycle-registry-v0.1` 并行评审。
- 文档对齐可以在 core gate 后启动，最终等待 host migration 完成。

## PoC 建议

先写一个最小 fake hook 顺序测试：fake LLM 返回终态 assistant message，fake EventSink 记录事件，fake hook 在 `after_run` 追加 marker。断言 marker 出现在 `run.end` 前，且 failed/cancelled 分支也触发。这个 PoC 能提前暴露 Result 分支遗漏和事件顺序漂移。

## x-req 拆分建议

- 第一张 x-req：`runner-lifecycle-hook-points-v0.1`，覆盖 core lifecycle 与 runner 调度。
- 第二张 x-req：`runtime-lifecycle-registry-v0.1`，覆盖 runtime add/remove/snapshot。
- 第三张 x-req：`evolution-lifecycle-consumer-v0.1` + `host-lifecycle-registration-v0.1`，覆盖消费者与装配迁移。
- 第四张 x-req：`lifecycle-validation-docs-v0.1`，覆盖测试与模块文档收尾。
