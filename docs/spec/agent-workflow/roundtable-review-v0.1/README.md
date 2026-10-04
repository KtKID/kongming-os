# Roundtable Review v0.1

> 状态：方案确认中  
> 目标：为代码模块设计 review 提供可审计、可复跑、证据绑定的多 Agent 圆桌评审编排。

> 迁移说明：角色来源已由 [agent-role-presets-v0.1](../agent-role-presets-v0.1/) 接管。后续实现使用 `AgentRoleManager` 管理角色，并通过 `participants.select` 显式选择角色 ID；本 spec 中的固定 reviewer 描述只保留为 roundtable code review preset 的历史背景。

## 系统目标

`roundtable_review` 面向代码模块设计 review 场景。它把主 agent 的单点自查扩展为已选择 participant 角色的并行独立审查、共享 ReviewBoard 记录、交叉质询和 arbiter 仲裁，最终输出共识、分歧、风险和可交给开发 agent 的任务清单。

## 策略目录文案

`roundtable_review` 在运行时策略目录、Web slash catalog 和 LLM workflow 选型提示中使用同一组 title/desc：

| 字段 | 内容 |
|------|------|
| `mode` | `roundtable_review` |
| `title` | `多 Agent 圆桌评审` |
| `desc` | `按 participants.select 选择子 agent 角色，并行审查代码模块设计，通过共享 ReviewBoard 进行质询和仲裁。` |
| `when_to_use` | 需要多角色审查同一模块或方案；需要记录独立 claims、交叉质询和 arbiter 仲裁；需要输出共识、分歧、风险和后续任务。 |

## 最小可用路径

用户通过 `run_agent_workflow(mode="roundtable_review", payload=...)` 或后续 `/review <module_path> --topic ...` 发起评审，workflow strategy 收集代码和文档上下文，按 `participants.select` 解析出的子 agent 独立写入 claims，一轮或多轮 rebuttal 子 agent 读取共享白板做支持、反驳、补充，arbiter 子 agent 读取 ReviewBoard 生成 `final_report.md`。

## 范围边界

**包含**
- 新增独立 workflow mode：`roundtable_review`。
- 复用 `AgentWorkflowManager`、`AgentWorkflowStrategyManager`、`SubAgentManager`、scoped workdir 权限和 workflow 审计目录。
- code review preset 提供 5 个内置角色：架构、代码质量、测试、性能、安全/稳定性。
- 定义 ReviewBoard 文件形态、claims/rebuttals JSONL 契约、最终报告结构。
- 定义触发工作流的主 agent 提示词、每阶段子 agent prompt 契约、预算和轮次边界。
- 定义从现有 spike 调整到稳定实现的任务映射。

**边界外职责**
- Web 专用评审 UI。
- 跨 workflow 的长期知识库沉淀。
- 自动改代码。
- 多轮无限辩论。
- 真实 token 计费器和 provider 级强中断。

## 模块导航

| 模块 | 状态 | 文档 | 是否可进 task | 说明 |
|------|------|------|---------------|------|
| Strategy Entry | 方案确认中 | [02-module-breakdown.md](./02-module-breakdown.md) | 是 | 注册 mode、解析 payload、编排阶段 |
| ReviewBoard | 方案确认中 | [04-data-and-state.md](./04-data-and-state.md) | 是 | 共享白板产物与 JSONL schema |
| Prompt Contracts | 方案确认中 | [03-core-workflows.md](./03-core-workflows.md) | 是 | 主 agent 触发提示词和子 agent prompt |
| Budget Controller | 方案确认中 | [01-goals-and-boundaries.md](./01-goals-and-boundaries.md) | 是 | 总预算、轮次、并发和输出上限 |
| Arbiter | 方案确认中 | [03-core-workflows.md](./03-core-workflows.md) | 是 | 最终裁决报告 |

## 文档导航

- [架构图](./architecture.html)
- [目标与边界](./01-goals-and-boundaries.md)
- [模块设计、接口和数据结构](./02-module-breakdown.md)
- [核心流程和提示词契约](./03-core-workflows.md)
- [数据模型与状态](./04-data-and-state.md)
- [验证策略与演进](./05-validation-and-evolution.md)
- [Task 映射](./90-task-map.md)

## 当前建议

先审这个 spec，再把当前 spike 对齐到 spec：保留 strategy registry 接入、ReviewBoard 目录和三阶段编排方向；重做预算控制、schema 校验、prompt 文本和 slash command 入口。
