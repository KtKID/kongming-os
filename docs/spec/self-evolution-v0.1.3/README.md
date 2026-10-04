# Self Evolution v0.1.3

> 状态：方案确认中  
> 目标：把 Hermes 的自我进化闭环移植到 kongming-agent，让 Agent 在跨会话中积累记忆、沉淀技能、记录错误、自动恢复，并在修改文件前保留安全快照。

## 系统目标

Self Evolution v0.1.3 是 kongming-agent 的长期学习基础设施。它把每次任务中的用户偏好、环境事实、工具坑点、错误修复路径和可复用流程沉淀成长期资产，并在下一轮对话自动加载。

核心目标：

- Memory 保存陈述性经验：用户偏好、环境事实、路径、工具约束、错误坑点。
- Skill 保存程序性经验：可复用任务流程、命令序列、平台差异、验证步骤。
- Error Repair 把 provider、tool、context 类失败转成结构化原因和恢复动作。
- Checkpoint 在高风险修改前创建恢复点，支撑 Agent 自修补。
- Learning Loop 在主响应后抽取经验，在压缩前 flush 关键上下文。

## 范围边界

v0.1.3 范围：

- 本地文件型 MemoryStore，默认落盘到 `.kongming/memory/`。
- 冻结 Memory 快照，启动或会话绑定时注入 system prompt。
- Memory tool，支持受控 add / replace / remove / view。
- SkillStore，默认落盘到 `.kongming/skills/`。
- Skill index prompt，支持轻量索引和按需查看完整 skill。
- LearningLoop，支持 after-run review、memory nudge、pre-compact flush。
- ErrorClassifier，覆盖 provider API、上下文、payload、tool 执行类错误。
- CheckpointManager，覆盖 file write / patch / shell mutating 命令前快照。
- 配置开关、trace events、单元测试与架构合约更新。

后续阶段：

- v0.1.5：MemoryProvider 外接大脑，支持自动 ingest、语义 prefetch、主动 recall tool、推理合成。
- 多 Agent 学习协作、跨设备记忆同步、技能评测与自动 benchmark。
- 高级 skill marketplace、权限化技能安装、按项目共享技能。
- 语义级 memory merge、遗忘策略、冲突解决 UI。

## 架构原则

- Runner 继续保持唯一 turn loop，Self Evolution 挂在 `SessionEngine`、`PromptAssembler`、Tool 实现和 Provider 错误层。
- `core/contracts.py` 继续作为跨模块协议单一真源，新增跨模块协议时只放这里。
- `src/core/` 继续零 sibling import。
- Memory 和 Skill 的写入都走 validate + scan + atomic write。
- 后台学习任务默认失败降级为 trace 事件，主响应先完成。
- 自动学习默认受配置开关控制，生产环境可以只开 memory、关 skill auto-create。

## 模块导航

| 模块 | 状态 | 文档 | 是否可进 task | 说明 |
|---|---|---|---|---|
| Memory Snapshot | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-1memory-snapshot) | 是 | 最小闭环入口，先做 |
| Learning Loop | 方案确认 | [核心流程](./03-core-workflows.md) | 是 | 需要确认后台 review 同步策略 |
| Skill Store | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-3skill-store) | 是 | 与 memory tool 同批或第二批 |
| Error Repair | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-4error-repair) | 是 | provider 层和 runner 错误路径都能受益 |
| Checkpoint Safety | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-5checkpoint-safety) | 是 | 文件与 shell 工具前置安全网 |
| Config / Observability | 可进入 x-req | [数据与状态](./04-data-and-state.md) | 是 | 支撑灰度、审计和测试 |
| MemoryProvider v0.1.5 | 待办 | [模块拆分](./02-module-breakdown.md#模块-7memoryprovider-v015) | 否 | 外接大脑：语义召回、自动同步、主动查询 |

## 文档导航

- [模块拆分](./02-module-breakdown.md)
- [核心流程](./03-core-workflows.md)
- [数据与状态](./04-data-and-state.md)
- [Task 映射](./90-task-map.md)
- [Hermes 挖掘笔记](../hermes-agent-self-evolution.md)

## 当前建议

1. v0.1.3 拆成 6 个开发 task：Memory、Learning Loop、Skill、Error Repair、Checkpoint、Config/Observability。
2. 第一批先做 Memory Snapshot、Error Repair、Checkpoint，建立安全和学习底座。
3. 第二批接 Learning Loop 和 Skill Store，把任务经验转成长期资产。
4. MemoryProvider 放入 v0.1.5 待办，v0.1.3 先完成 builtin MemoryStore 的本地文件、冻结快照和工具维护能力。

## v0.1.5 MemoryProvider 待办

MemoryStore 解决“记性”问题：模型主动把关键信息写进本地 Markdown，下一次启动通过冻结快照看到。MemoryProvider 解决“回忆”问题：外部后端自动同步每轮对话，并在每轮 API 调用前按当前话题做语义召回。

| 能力 | MemoryStore builtin | MemoryProvider external |
|---|---|---|
| 存储 | 本地 Markdown 文件 | 语义向量库、知识图谱、远端记忆服务 |
| 写入 | 模型主动调用 memory tool | 系统每轮自动 sync |
| 召回 | system prompt 中的冻结快照 | 每轮 prefetch 语义检索并注入 |
| 跨会话 | 下次启动后读取 | 可立即查询，有独立 recall tool |
| 推理 | 本地文件事实记录 | dialectic Q&A、reflect、语义合成 |

v0.1.5 默认架构：builtin MemoryStore 始终启用，external MemoryProvider 可选启用一个。配置形态参考：

```yaml
memory:
  enabled: true
  provider: honcho
  recall_mode: hybrid
```

`provider` 缺省时只启用 builtin MemoryStore。`recall_mode` 支持 `context`、`tools`、`hybrid`：context 只做自动 prefetch，tools 只暴露主动 recall tool，hybrid 同时启用自动召回和主动查询。
