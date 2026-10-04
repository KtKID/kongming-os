# 目标与边界

## 1. 系统意图

Self Evolution v0.1.9 的核心意图是把“任务结束后的经验提炼”做成一条独立、稳定、可追踪的链路。系统把 child reviewer 认为有价值的内容统一叫做“进化养料”，并由子 agent 直接写入 `evo` 目录。

这条链路回答三个问题：

- 哪些内容值得沉淀成进化养料。
- 哪些流程值得作为流程型进化养料留下来。
- 哪些内容证据不足，应当跳过。

## 2. 当前状态

### 2.1 已有能力

- `Runner` 已经管理完整的 turn loop，并在结束时产出 `Result`。
- `Session.history()` 已经提供完整历史读取能力。
- `SkillLoader` 与 `SkillTool` 已经支持正式 skill 的加载和执行。
- `SessionEngine.aclose()` 已有基础生命周期入口。

### 2.2 当前缺口

- 没有 after-run 学习触发器。
- 没有独立的 reviewer agent。
- 没有 transcript 证据窗口裁剪规则。
- 没有进化养料写入工具。
- 没有 `evo` 目录写入协议。
- `Config.evolution` 目前只有 memory 子配置。

## 3. 目标状态

### 3.1 主设计

v0.1.9 采用 `parent runtime + child reviewer` 结构：

- parent runtime 继续执行当前任务。
- parent runtime 在 `Result` 产出后决定是否触发 review。
- child reviewer 读取一段裁剪后的 transcript window。
- child reviewer 构造结构化 `ReviewResult`。
- child reviewer 通过 `evolution_write` 工具直接执行写入。

### 3.2 高价值判断标准

**适合作为进化养料**：

- 稳定用户偏好。
- 项目长期事实。
- 经验证有效的环境命令、路径、约束。
- 重复出现的坑点和修复经验。
- 一次任务中形成完整可复用流程。
- 多步工具组合已经稳定。
- 用户纠正后的工作流有明显复用价值。

**应当跳过**：

- 一次性闲聊。
- 证据不足的偏好推断。
- 临时状态。
- 只适用于单次上下文的临时命令。

## 4. 核心边界

### 4.1 模块边界

| 边界 | v0.1.9 职责 |
|---|---|
| `core/runner.py` | 继续只负责执行和事件，不承接学习策略 |
| `executors/agent_runtime` | 承接 review hook、child runtime 生命周期 |
| `tools/` | 新增 `evolution_write` |
| `context/skill_loader.py` | 继续只加载正式 skill |
| `evolution/` 新模块 | 承接 review、policy、state |

### 4.2 数据边界

| 资产 | 作用 | 存储位置 |
|---|---|---|
| 进化养料队列 | 内容层，承载流程型、事实型、错误型内容 | `.kongming/evolution/evolution-nutrients.jsonl` |
| Review Record | 单次 review 原始结果 | `.kongming/evolution/reviews/<run_id>.json` |
| Learning State | review 触发状态和控制游标 | `.kongming/evolution/evolution.state.json` |
| Session History | 原始对话证据 | `Session.history()` 后端 |

### 4.3 版本边界

v0.1.9 只解决“会后复盘”和“高价值筛选”。后续版本承接这些扩展：

- 正式 skill 生成与 promote。
- memory promote。
- pre-compact flush。
- 外部 memory provider。
- candidate 管理 UI。

## 5. 关键设计决定

### 5.1 review 放在 `after-run`

`after-run` 是当前仓库最稳的挂点。`Runner` 在这里已经给出完整 `Result`，主响应语义明确，失败隔离简单。

### 5.2 child reviewer 直接写入

Hermes 的链路是子 agent 直接调用 `memory` / `skill_manage` 工具写共享存储。v0.1.9 参考这个思路，子 agent 直接调用 `evolution_write` 工具写 `evo` 目录。主链路只负责触发和观察。

### 5.3 养料先入队

当前仓库已经有正式 skill 的加载和执行能力。v0.1.9 先沉淀统一的进化养料，其中流程型养料作为 skill promote 的输入，后续再做正式 promote。

### 5.4 `pre-compact flush` 暂缓

当前 `history.compact` 事件发生在压缩完成后。v0.1.9 先收敛 `after-run` 链，链路更清晰，验证成本更低。
