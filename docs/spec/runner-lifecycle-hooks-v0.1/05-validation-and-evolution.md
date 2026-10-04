# 验证策略与演进

## 验证策略

### Smoke / E2E 验收入口

- **Smoke 路径**：构造 fake `SessionEngine` → build 后注册 fake lifecycle hook → 执行一次 `runtime.run()` → 断言 fake hook 收到 `after_run` 且事件顺序为 `after_run` 早于 `run.end`。
- **E2E 路径**：CLI/Web 装配路径 build runtime → 注册 `EvolutionLifecycleHook` → 首个 run 完成后触发 EvolutionManager fake → trace 中保留 `run.end` 作为 terminal 事实事件。
- **进入 x-req 的规则**：x-req 需要明确覆盖 core gate、runtime registry gate、evolution consumer gate 和 host migration gate；每个 gate 都给出 pytest 命令。

### 单元测试

- **覆盖模块**：Lifecycle Hook 定义、Runner Hook 调度、SessionEngine 注册表、Evolution Hook 消费者。
- **框架**：pytest。
- **重点场景**：
  - `after_run` 在 completed / failed / cancelled Result 分支均触发。
  - `after_run` 触发早于 `run.end`。
  - hook 异常生成 `error` 事件，Result 状态保持原值。
  - `runtime.add_lifecycle_hook(...)` 在首次 run 前注册生效。
  - `runtime.remove_lifecycle_hook(...)` 影响后续 run。
  - `continue_from_last_user_message()` 与 `run()` 使用同一 hook 快照逻辑。
  - per-run temporary `lifecycle_hooks` 与 runtime hooks 合并执行。
  - 生产代码中 `AfterRunHook` / `after_run_hooks` 引用清理完成。

### 集成测试

- **端到端链路**：`SessionEngine.build(...)` → host 注册 lifecycle hook → `SessionBridge` 或 Web thread manager 启动 run → fake EvolutionManager 收到 `after_run`。
- **环境要求**：fake LLM provider、fake session、fake EventSink；外部模型服务用 stub。
- **触发方式**：x-verify 复跑 pytest；Web 装配路径用 unit-level fake app/thread fixture 覆盖。

### 手动验证

- **必须人工过的场景**：查看模块文档中 core/runtime/evolution 对 after-run 的描述是否统一为 lifecycle hook。
- **验收人**：架构 owner。

## 测试覆盖要求

| 模块 | 最低覆盖 | 重点文件 |
|------|---------|---------|
| Lifecycle Hook 定义 | Protocol 与触发点表单测/静态断言 | `repo:tests/unit/test_runner_lifecycle_hooks.py` |
| Runner Hook 调度 | completed/failed/cancelled + 事件顺序 | `repo:tests/unit/test_runner_lifecycle_hooks.py` |
| SessionEngine 注册表 | add/remove/snapshot/run/continue | `repo:tests/unit/test_native_runtime.py` |
| Evolution Hook 消费者 | fake manager 接收 runtime/session/result | `repo:tests/unit/test_native_runtime_evolution.py` |
| Host 装配迁移 | CLI/Web build 后注册路径 | `repo:tests/unit/`、`repo:tests/unit/web/` |
| 文档对齐 | 旧术语扫描 + 模块 README 检查 | `repo:tests/unit/test_docs_harness_links.py` 或新增文档扫描测试 |

## 迁移验证命令建议

```bash
uv run pytest tests/unit/test_runner_lifecycle_hooks.py -v
uv run pytest tests/unit/test_native_runtime.py -k "lifecycle or continue" -v
uv run pytest tests/unit/test_native_runtime_evolution.py -k "evolution" -v
uv run pytest tests/unit/web -k "runtime or evolution" -v
rg -n "AfterRunHook|after_run_hooks|add_after_run_hook" src tests docs
```

## 演进路线

### 短期（本轮 task）

- [ ] 删除独立 after-run 类型与参数。
- [ ] `LifecycleHook.after_run` 进入 core 定义与 Runner 调度。
- [ ] Runtime 注册表支持 add/remove 与 run 入口快照。
- [ ] EvolutionLifecycleHook 接入 CLI/Web 装配路径。
- [ ] 测试覆盖旧机制删除和新机制时机。

### 中期（下 1-2 轮）

- [ ] 将触发点定义渲染进核心模块 README，作为新增 hook point 的维护入口。
- [ ] 为 lifecycle hook 增加更细的 error event metadata，例如 hook class name。
- [ ] 梳理 scheduler、workflow、subagent 是否存在可复用 lifecycle hook 消费场景。

### 长期（方向性）

- 保持 `LifecycleHook` 为 core 内部扩展点。
- 当 hook 点数量继续增长时，评估是否引入统一 `LifecycleHookCallContext`。
- 将生命周期扩展能力用于 debug、evolution、run-level instrumentation，事实事件继续走 EventSink。
