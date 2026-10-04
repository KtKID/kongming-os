# runner-lifecycle-hooks-v0.1

> 状态：方案确认
> 目标：统一 Runner lifecycle hook 机制，把 turn/tool/run 触发点收敛到 `LifecycleHook`，并支持 `SessionEngine.build(...)` 后、首次 run 前完成装配期注册。

## 系统目标

Runner 已经拥有 `before_turn`、`after_turn`、`before_tool`、`after_tool` 四个 lifecycle hook 点，当前未提交代码里又临时增加了独立 `AfterRunHook` / `after_run_hooks` 机制。这个 spec 将 after-run 收敛为 `LifecycleHook.after_run`，让 Runner 继续定义并调用所有触发点，让 `SessionEngine` 管理装配期 hook 注册，让自我进化作为普通 after-run 消费者接入。

## 最小可用路径

主程序调用 `SessionEngine.build(...)` 得到 runtime → 创建 `EvolutionLifecycleHook(runtime, evolution_manager)` → 在 CLI run loop 或 Web 首个请求到达前调用 `runtime.add_lifecycle_hook(...)` → 首次 `runtime.run()` 或 `continue_from_last_user_message()` 生成 Result 后触发 `LifecycleHook.after_run` → Runner 发出 `run.end`。

## 范围边界

**范围内**：
- `LifecycleHook` 增加 `after_run`，语义固定为 Result 已构造、`run.end` 发出前。
- 删除独立 `AfterRunHook` / `after_run_hooks` 类型、构造参数、runtime 绑定和 runner 调用路径。
- `SessionEngine` 提供 `add_lifecycle_hook` / `remove_lifecycle_hook` 管理方法，并在每次 run 启动前快照注册表。
- Runner 保留 per-run `lifecycle_hooks` 参数，支持单次 run 临时 hook。
- CLI / Web 在 `SessionEngine.build(...)` 返回后注册 `EvolutionLifecycleHook(runtime, evolution_manager)`。

**范围外**：
- 修改 EventSink 事实事件模型。
- 把 `LifecycleHook` 提升到 `repo:src/core/contracts/`。
- 让自我进化独占 after-run 机制。
- 改写 turn loop、tool approval 或 session append 主流程。

## 模块导航

| 模块 | 状态 | 文档 | 是否可进 task | 说明 |
|------|------|------|---------------|------|
| Lifecycle Hook 定义 | 方案确认 | [模块拆分](./02-module-breakdown.md#模块-1lifecycle-hook-定义) | 是 | 扩展 Protocol、命名触发点、写明触发时机 |
| Runner Hook 调度 | 方案确认 | [模块拆分](./02-module-breakdown.md#模块-2runner-hook-调度) | 是 | 统一调用 before/after turn/tool/run，删除独立 terminal hook |
| SessionEngine 注册表 | 方案确认 | [模块拆分](./02-module-breakdown.md#模块-3nativeruntime-注册表) | 是 | build 后可注册，run 前快照，提供 add/remove |
| Evolution Hook 消费者 | 方案确认 | [模块拆分](./02-module-breakdown.md#模块-4evolution-hook-消费者) | 是 | 自我进化实现 after_run 消费者，持有 runtime 上下文 |
| Host 装配迁移 | 方案确认 | [模块拆分](./02-module-breakdown.md#模块-5host-装配迁移) | 是 | CLI / Web 从 build 参数迁移到 build 后注册 |
| 验证与文档对齐 | 方案确认 | [模块拆分](./02-module-breakdown.md#模块-6验证与文档对齐) | 是 | 覆盖时机、移除旧机制、更新模块文档 |

## 文档导航

- [图集：总览、E2E 链路、核心流程、状态与数据关系](./diagrams.md)
- [目标、边界与完成标准](./01-goals-and-boundaries.md)
- [模块拆分、边界入口与风险](./02-module-breakdown.md)
- [数据模型与状态](./04-data-and-state.md)
- [验证策略与演进](./05-validation-and-evolution.md)
- [Task 映射](./90-task-map.md)

## 当前建议

先进入 `runner-lifecycle-hook-points-v0.1` 的 x-req，把 `LifecycleHook.after_run`、触发点定义、Runner 调度和旧 `AfterRunHook` 删除作为同一个 core gate。Core gate 通过后推进 `runtime-lifecycle-registry-v0.1` 与 `evolution-lifecycle-consumer-v0.1`，最后迁移 CLI / Web 装配点并补齐验证与模块文档。
