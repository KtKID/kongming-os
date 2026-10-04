# agent-workflow

> 多 agent 编排模块，负责把主 agent 的高层任务拆成独立子 agent 执行单元，并把结果、审计和后续汇总边界统一收口。

## 运行时策略目录

`WorkflowStrategyDescription.summary` 是运行时策略的 desc 来源，会投影到 Web slash catalog 的 `description` 字段，也会进入 LLM 的 workflow 选型提示。

| mode | title | desc | 对应文档 |
|------|-------|------|----------|
| `parallel` | 并行子任务 | 把多个互不依赖的子任务同时派发给子 agent，等待全部返回后汇总报告。 | [subagent-orchestration-v0.1](../spec/agent-workflow/subagent-orchestration-v0.1/) |
| `map_reduce` | Map-Reduce 代码分析 | 把大工程代码分析拆成稳定分片，派发 mapper 子 agent，并用确定性 reducer 合并 code_findings。 | [map-reduce-v0.1](../spec/agent-workflow/map-reduce-v0.1/) |
| `roundtable_review` | 多 Agent 圆桌评审 | 按 participants.select 选择子 agent 角色，并行审查代码模块设计，通过共享 ReviewBoard 进行质询和仲裁。 | [roundtable-review-v0.1](../spec/agent-workflow/roundtable-review-v0.1/) |
| `deep_research` | Deep Research 研究工作流 | 围绕研究问题规划搜索线、收集来源、抽取事实、分组交叉检查并生成带引用报告。 | [deep-research-v0.1](../spec/agent-workflow/deep-research-v0.1/) |
| `task_flow` | 任务流 Task Flow | 通用计划执行 workflow。适合把用户目标拆成可视化步骤并逐步完成；parallel、map_reduce、deep_research、roundtable_review 均无法精准覆盖时选择它。 | [task-flow-v0.1](../spec/agent-workflow/task-flow-v0.1/) |

## Spec 导航

| Spec | 状态 | 说明 |
|------|------|------|
| [subagent-orchestration-v0.1](../spec/agent-workflow/subagent-orchestration-v0.1/) | 实现已落地，spec 回写 | 第一版只实现并行 fan-out / fan-in，提供主 agent tool、独立子上下文、任务级审计目录 |
| [subagent-scoped-permissions-v0.1](../spec/agent-workflow/subagent-scoped-permissions-v0.1/) | 方案确认 | 子 agent 创建时固化最小授权，默认只允许在自己的工作目录内 read / write / list，越界直接拒绝并审计 |
| [map-reduce-v0.1](../spec/agent-workflow/map-reduce-v0.1/) | 方案确认 | 新增 map_reduce 编排模式，面向大工程代码分析的同构分片处理、结构化 mapper 输出和 reducer 归并 |
| [roundtable-review-v0.1](../spec/agent-workflow/roundtable-review-v0.1/) | 方案确认中 | 新增 roundtable_review 编排模式，面向代码模块设计 review 的 reviewer 并行审查、共享 ReviewBoard、交叉质询和 arbiter 仲裁 |
| [deep-research-v0.1](../spec/agent-workflow/deep-research-v0.1/) | 方案确认 | 接入 Deep Research 六阶段研究编排，覆盖多角度搜索、来源提取、事实合并、adversarial jury 交叉验证和带引用报告 |
| [task-flow-v0.1](../spec/agent-workflow/task-flow-v0.1/) | 方案确认 | 新增 task_flow 编排模式，面向基础任务计划、逐节点执行、Progress 弹窗可视化和严重异常暂停询问 |
| [multi-strategy-orchestration-v0.1](../spec/agent-workflow/multi-strategy-orchestration-v0.1/) | 方案确认 | 多编排策略底座，提供 strategy manager、中文策略说明、registry 分发和 parallel 迁移路径 |
| [agent-role-presets-v0.1](../spec/agent-workflow/agent-role-presets-v0.1/) | 方案确认 | 新增可复用子 agent 角色库，支持主 agent 先选角色，缺角色时创建并保存，再用于 roundtable 等编排 |
| [workflow-run-viewer-v0.1](../spec/agent-workflow/workflow-run-viewer-v0.1/) | 可进入 x-req | Web 线程级 Agent Workflow Viewer，只读投影 workflow 产物，展示流程、子 agent 完整对话和 token 消耗 |

状态：探索中 / 方案确认 / 可进入 x-req / 开发中 / 已完成 / 实现已落地，spec 回写
