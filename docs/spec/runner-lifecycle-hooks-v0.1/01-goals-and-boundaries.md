# 目标与完成标准

## 需求要点

1. `SessionEngine.build(...)` 后注册 lifecycle hook 的时机有效，前提是注册发生在第一次 `runtime.run()` 或 `continue_from_last_user_message()` 前。
2. 独立 `AfterRunHook` / `after_run_hooks` 机制并入现有 `LifecycleHook`，形成统一 Runner lifecycle hook 体系。
3. hook 触发点必须有明确命名，并在定义处写明触发时机；新增机制点时通过同一套定义、调度和测试扩展。
4. `LifecycleHook` 在现有 `before_turn`、`after_turn`、`before_tool`、`after_tool` 基础上新增 `after_run`。
5. `after_run` 的语义固定为 Result 已构造、`run.end` 发出前。
6. 推荐注册方式为 `runtime.add_lifecycle_hook(EvolutionLifecycleHook(runtime, evolution_manager))`，让 hook 对象持有 runtime 上下文。
7. Runner 保留 per-run `lifecycle_hooks` 参数，支持单次 run 临时 hook；Runtime 提供 add/remove lifecycle hook 管理方法。
8. 自我进化只是 `LifecycleHook.after_run` 的一个消费者；EventSink 继续只做事实事件落地。

## 系统目标

统一 lifecycle 扩展点，减少 Runner 终态路径上的并行机制。完成后，Runner 是所有 hook 点的定义与调用者，SessionEngine 是装配期注册管理者，EvolutionManager 只保留自我进化业务判断与 reviewer 任务启动，EventSink 继续负责 `run.start`、`turn.*`、`tool.*`、`run.end` 等事实事件落地。

## 完成目标（DoD）

- [ ] `repo:src/core/lifecycle.py` 只导出 `LifecycleHook` 及命名触发点定义，`AfterRunHook` 类型被移除。
- [ ] `LifecycleHook.after_run(state, session, result)` 在 Result 构造完成后、`run.end` 发出前被 Runner 调用。
- [ ] `Runner.run(...)` 与 `Runner.continue_from_last_user_message(...)` 都使用同一份 effective lifecycle hook 列表，覆盖 constructor hooks、runtime hooks 和 per-run hooks。
- [ ] `SessionEngine` 提供 `add_lifecycle_hook` 与 `remove_lifecycle_hook`，在每次 run/continue 入口快照当前注册表。
- [ ] `SessionEngine.build(...)` 不再接收 `after_run_hooks`，CLI/Web 在 build 完 runtime 后注册 evolution hook。
- [ ] `EvolutionLifecycleHook` 持有 `SessionEngine` 与 `EvolutionManager`，在 `after_run` 调用 evolution 业务逻辑。
- [ ] 测试覆盖 hook 调用顺序、build 后首 run 前注册、remove 后后续 run 生效、per-run 临时 hook、旧 after-run API 清理和 evolution 接入。

## 范围边界

**范围内**：
- Core lifecycle Protocol 扩展与触发点说明。
- Runner 统一 hook 调度与旧 after-run 机制删除。
- SessionEngine 装配期注册管理方法。
- Evolution hook adapter 与 CLI/Web 注册点迁移。
- 单元测试、host 装配测试、模块文档更新。

**范围外**：
- 改变 EventSink 协议、事件 kind 或 trace schema。
- 改变 approval、tool execution、compaction、provider 调用语义。
- 新增跨模块公共合同。
- 改写 evolution reviewer 的 cadence、文件产物或业务策略。

## 关键约束

- `repo:src/core/` 保持 core 零 sibling 依赖；`LifecycleHook` 仍位于 core 内部扩展面。
- Hook 异常由 Runner 隔离为 `error` 事件，Result 状态保持原构造结果，`run.end` 继续作为 run 主事件收尾。
- 装配期注册的生效边界是 run/continue 入口快照；运行中 add/remove 影响后续 run。
- 自定义触发点必须同步更新触发点定义、Protocol 方法、Runner 调度函数和测试。
- `EventSink` 只记录事实事件；生命周期扩展逻辑放在 `LifecycleHook`。

## DoD ↔ 模块追溯矩阵

| DoD 条目 | 需要哪些模块 | 需要哪些 task | 状态 |
|---------|------------|-------------|------|
| 移除 `AfterRunHook`，统一导出 `LifecycleHook` | Lifecycle Hook 定义 + Runner Hook 调度 | `runner-lifecycle-hook-points-v0.1` | 方案确认 |
| `after_run` 时机位于 Result 构造后、`run.end` 前 | Lifecycle Hook 定义 + Runner Hook 调度 + 验证与文档对齐 | `runner-lifecycle-hook-points-v0.1` | 方案确认 |
| run/continue 使用同一 effective hook 机制 | Runner Hook 调度 + SessionEngine 注册表 | `runner-lifecycle-hook-points-v0.1` + `runtime-lifecycle-registry-v0.1` | 方案确认 |
| Runtime 支持 add/remove 并在 run 入口快照 | SessionEngine 注册表 + 验证与文档对齐 | `runtime-lifecycle-registry-v0.1` | 方案确认 |
| CLI/Web build 后注册 evolution hook | SessionEngine 注册表 + Evolution Hook 消费者 + Host 装配迁移 | `evolution-lifecycle-consumer-v0.1` + `host-lifecycle-registration-v0.1` | 方案确认 |
| 自我进化成为普通 after-run 消费者 | Evolution Hook 消费者 + 验证与文档对齐 | `evolution-lifecycle-consumer-v0.1` | 方案确认 |
| EventSink 边界保持事实落地 | Runner Hook 调度 + 验证与文档对齐 | `lifecycle-validation-docs-v0.1` | 方案确认 |
