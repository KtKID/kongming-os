# Self Evolution v0.1.9

> 状态：方案确认中
> 目标：在每次 `run` 结束后 fork 一个专用 child reviewer，审阅当前聊天证据，抽取高价值“进化养料”，并由子 agent 直接写入 `evo` 目录。

## 系统目标

Self Evolution v0.1.9 聚焦一条简单而高价值的学习主链：

- 主 agent 继续专注完成当前任务。
- 主任务结束后，系统基于本次对话证据启动 child reviewer。
- child reviewer 只做高价值判断。
- child reviewer 通过专用 `evolution_write` 工具直接写入 `evo` 目录。

这个版本服务两个结果：

- 会后经验形成独立可追踪资产。
- 多次出现的稳定流程开始进入可筛选、可升级的进化养料队列。

## 当前状态

当前仓库已经具备这条链路的三个基础件：

- `SessionEngine.run()` 已经是最合适的 after-run 挂点。[`src/executors/agent_runtime/session_engine.py`](../../src/executors/agent_runtime/session_engine.py)
- `Runner` 继续保持唯一 turn loop，`run.end` 和 `history.compact` 事件已经存在。[`src/core/runner.py`](../../src/core/runner.py)
- `Session.history()` 已经提供完整历史读取能力。[`src/core/contracts.py`](../../src/core/contracts.py)

当前仓库也有三个明确空缺：

- 没有 `after-run` 学习编排器。
- 没有 child reviewer runtime。
- 没有进化养料专用写入工具和 `evo` 目录持久化规则。

## 目标状态

v0.1.9 的目标状态是一条独立学习副链：

```text
main run
  -> Result produced
  -> EvolutionManager checks trigger
  -> child reviewer analyzes transcript window
  -> child reviewer calls evolution_write
  -> nutrients persisted in evo dir
```

主链路和学习副链保持明确边界：

- `Runner` 负责执行。
- `EvolutionManager` 负责是否复盘。
- `ChildReviewerRuntime` 负责高价值判断。
- `EvolutionWriteTool` 负责持久化和事件。

## 范围边界

**v0.1.9 包含**：

- `after-run` child review。
- transcript window 裁剪与证据选择。
- child reviewer 专用 prompt。
- `evolution_write` 工具。
- `evo` 目录持久化。
- learning state、review trace、shutdown drain。

**v0.1.9 不包含**：

- memory 写入。
- 正式 skill 自动创建和自动 patch。
- 外部 memory provider。
- error repair 和 checkpoint 新能力。
- UI 管理面板。

## 模块导航

| 模块 | 状态 | 文档 | 是否可进 task | 说明 |
|---|---|---|---|---|
| Evolution Hook | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-1evolution-hook) | 是 | `SessionEngine.run()` 后挂 review |
| Evidence Selection | 可进入 x-req | [核心流程](./03-core-workflows.md#2-review-trigger-与证据选择) | 是 | 选高价值证据窗口 |
| Child Reviewer Runtime | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-3child-reviewer-runtime) | 是 | 子 agent 负责判断和调用工具 |
| Evolution Write Tool | 可进入 x-req | [数据与状态](./04-data-and-state.md#4-reviewresult) | 是 | 子 agent 直写 `evo` 目录 |
| Config / Observability | 可进入 x-req | [验证与演进](./05-validation-and-evolution.md) | 是 | 配置、事件、测试、灰度 |
| Skill Promotion v0.2 | 方案层 | [Task 映射](./90-task-map.md) | 否 | 后续把流程型进化养料升级成正式 skill |

## 文档导航

- [目标与边界](./01-goals-and-boundaries.md)
- [模块拆分](./02-module-breakdown.md)
- [核心流程](./03-core-workflows.md)
- [数据与状态](./04-data-and-state.md)
- [验证与演进](./05-validation-and-evolution.md)
- [Task 映射](./90-task-map.md)
- [Hermes 挖掘笔记](../hermes-agent-self-evolution.md)
- [上一版总方案 v0.1.3](../self-evolution-v0.1.3/README.md)

## 当前建议

1. `v0.1.9` 直接拆 5 个开发 task：review hook、evidence selection、child reviewer、evolution write tool、config/observability。
2. 第一批先完成 `after-run hook + child reviewer + evolution_write`，形成可用闭环。
3. 第一版统一记录“进化养料”，全部沉淀到 `evo` 目录。
4. `memory` 写入、正式 `SKILL.md` promote、external provider 留到后续版本。
