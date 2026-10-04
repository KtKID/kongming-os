# v1-minimal 拆分审查报告

> 范围：针对 `README.md` + `02-module-breakdown.md` + `90-task-map.md` 的一次集中审查
> 结论：**方向正确、粒度合理、可开工**；有 4 处建议调整 + 1 个开工前补丁

---

## A. 整体评价

优点：

- 与 v2 文档的"core 宿主无关"约束一致
- 7 个模块数量适中——再少边界会揉乱，再多就不再是最小可运行
- 每个模块都有"职责 / 包含 / 不包含 / 参考项目 / 风险 / task 名"
- 第一批 4 个 → 第二批 3 个的分批合理
- 明确排除 memory / MCP / coordinator / plugins / external runtime adapter 等 roadmap 项，没被长期路线污染

整体评分：**可进入 x-req**。下面的调整不是阻塞项，是"开工前顺手改掉更省事"的项。

---

## B. 需要调整的 4 点

### 🔴 高优先级｜第一批缺"最简 session + 最简 approval"

**问题**：

1. `Core Runtime` 的 loop 要推进 turn，turn 要喂消息给 model，**消息历史必须存在某处**。如果 `Session / Context` 在第二批才做，第一批的 core_runtime 就得自己维护一个临时 history list，第二批再 refactor——典型的"先欠债后还"
2. 第一批有 `shell_tool.py` 能调 bash，但 `Safety Baseline` 还在第二批 → 就是文档自己说的"危险 demo"

**建议**（不改第一批/第二批的划分，只在第一批内嵌最小实现）：

- **Core Runtime 模块**的"包含范围"追加：一个 `Session` 接口 + 最简 in-memory 实现（十来行）。第二批 `v1-session-context` 再做持久化版本 / `session_store.py`
- **Tool Runtime 模块**的"包含范围"追加：最简 approval（执行前 `y/n` 人工确认，不是策略引擎）。第二批 `v1-safety-baseline` 再做 `permission_policy.py` 的规则化版本

这样第一批就能**真跑**，第二批是"从 demo 升级到工程版"，不是"从零搭 session/safety"。

### 🟡 中优先级｜Safety 的依赖漏了 Model Executor

`guardrails.py` 不只是工具调用前后的 tripwire，它也要能挂在 **model call 前后**（input guardrail / output guardrail）。

`02-module-breakdown.md` 里 `Safety Baseline` 的依赖写的是 `Tool Runtime + Host Bridge`，应补加 **Model Executor**。

### 🟡 中优先级｜`session_engine.py` 的归属要明确

v2 文档里把它放在 `executors/agent_runtime/`，但 v1-minimal 里又把它列进 `Model Executor` 模块。如果这个文件就是 `Runner` 的胶水层，它应该**归 Core Runtime**；Model Executor 只负责"LLM 调用 + 返回转换"。否则 `core/runner.py` 和 `agent_runtime/session_engine.py` 职责会重叠。

**建议**：v1 干脆**不要** `session_engine.py` 这个文件：

- `core/runner.py` 直接就是 runtime
- `executors/llm/*` 只做 provider 适配

等 v0.2+ 真需要多 runtime（native 执行器 vs external SDK adapter）时再抽。

### 🟢 低优先级｜每个模块缺 "Done Criteria"

task 开工后最容易范围蔓延。每个模块建议加一句"做到什么算完成"会省很多来回。建议补的标准：

| 模块 | Done Criteria |
|---|---|
| `v1-core-runtime` | 能跑一轮空循环（无 tool、model 返回写死字符串）并通过 1 个 smoke test |
| `v1-tool-runtime` | `Tool` 协议冻结，`file_tools.Read` 和 `shell_tool.Bash` 能被 Runner 调用并回填结果 |
| `v1-model-executor` | 用真 OpenAI key 跑通一次 "你好" 往返 |
| `v1-host-cli-shell` | 终端里能输入 → agent 回话 → 支持一次 tool call + 审批 y/n |
| `v1-session-context` | 重启进程后 `--resume <run-id>` 能恢复历史 |
| `v1-safety-baseline` | guardrail 能拦一次恶意输入、approval 能拦一次危险 bash |
| `v1-observability-baseline` | `~/.kongming/logs/<run-id>.jsonl` 有完整一轮 trace |

---

## C. 开工前建议补的一份文档：接口契约

7 个模块如果**并行开发**（尤其 core / tool / model 并行）会踩同一个坑：每个任务对 `Tool` / `Message` / `RunState` 的理解稍有不同，整合时要返工。

**建议**：开工前先花半天产出 `docs/kongming-agent-v1-minimal/10-contracts.md`（或直接写成 `core/contracts.py`），把以下类型冻结：

- `Message` 的字段（role / content / tool_calls / tool_results / timestamp 等）
- `Tool.execute()` 的签名和返回值
- `RunState` 的可序列化字段
- `Session` 的 `get_history() / append()` 接口
- `LLMProvider.call()` 的签名

这份契约是**所有 task 的公共依赖**，开工前定死，整合会顺很多。第二批 `v1-session-context` 等即使晚做，对外暴露的接口也早已在 10-contracts 里签好，不会破坏第一批代码。

---

## D. 一句话总结

**方向没问题，可以开工**。动手前做两件事：

1. 把"最简 session + 最简 approval"明确写进第一批对应模块的"包含范围"（改 `02-module-breakdown.md`）
2. 补一份接口契约文档 `10-contracts.md`

之后按 `v1-core-runtime → v1-tool-runtime → v1-model-executor → v1-host-cli-shell` 顺序走第一批，第二批补 `session-context / safety-baseline / observability-baseline`。

---

## 附：本次审查的 4 处调整对 task 依赖图的影响

原依赖图（第 90-task-map.md 的建议）：

```
v1-core-runtime
  ├── v1-tool-runtime
  ├── v1-session-context
  ├── v1-model-executor
  └── v1-host-cli-shell (依赖 tool + model)
      └── v1-safety-baseline (依赖 tool + host)
      └── v1-observability-baseline (依赖 core + tool)
```

建议调整后：

```
docs/10-contracts.md  ← 所有 task 的公共前置
v1-core-runtime       ← 含最简 Session 接口 + in-memory 实现
  ├── v1-tool-runtime ← 含最简 approval (y/n)
  ├── v1-model-executor
  └── v1-host-cli-shell
      └── v1-safety-baseline (依赖 tool + model + host)   ← 补 model
      └── v1-observability-baseline
      └── v1-session-context  ← 从第一批移到这里，做持久化版本
```

第一批第二批的**人力顺序**不变，变的只是"第一批内部承担了更多最小实现，第二批从独立搭建变成从 demo 升级"。
