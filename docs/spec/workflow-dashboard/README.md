# Workflow Dashboard

> 状态：方案确认中
> 目标：在 kongming-agent Web 端提供工作流进度可视化看板，让用户一眼看到多个 task 在自定义流程中的当前阶段

## 系统目标

开发者同时推进多个 task（通过多个 Claude Code session），每个 task 经历不同的流程阶段（x-spec → x-req → x-dev → x-verify → x-qa-gate → x-fix）。目前没有统一视图看到"哪个 task 走到哪了"，只能靠记忆或翻文件。

Workflow Dashboard 通过扫描项目文件产物自动推断阶段状态，在 Web 看板上可视化展示，支持用户自定义工作流编排。

## 最小可用路径

扫描器扫 `docs/` + `dev-pipeline/tasks/` → 发现 spec 和 task → 按文件产物推断每个阶段是否跑过 → Web 看板渲染节点状态图 → 用户看到所有 task 的流程进度

这条链路涉及的模块：Scanner + Workflow Core + REST API + Dashboard UI，全部 P0。

## 范围边界

**包含**：
- 文件产物扫描器（定时轮询，间隔可配）
- 四对象模型：NodeTemplate / WorkflowDefinition / WorkflowRun / WorkflowEvent
- 预置工作流模板（full-pipeline、quick-dev）
- Web 看板：节点状态展示（只读）
- spec → task 树形关系展示
- JSON 文件持久化（`.kongming/workflows/`）

**不包含**：
- 拖拽式工作流编辑器（v2）
- Web 驱动 skill 执行（v2）
- 自动流转 / 自动触发下一阶段（v2）
- "进行中"状态检测（v1 只区分"跑过 / 没跑过"）
- skill 侧任何改动

## 模块导航

| 模块 | 状态 | 文档 | 可进 task | 说明 |
|------|------|------|-----------|------|
| A. Scanner | 可进入 x-req | [02-module-breakdown.md](./02-module-breakdown.md#模块-a-scanner文件扫描器) | 是 | 独立模块，无前置依赖 |
| B. Workflow Core | 可进入 x-req | [02-module-breakdown.md](./02-module-breakdown.md#模块-b-workflow-core工作流核心) | 是 | 可与 Scanner 并行 |
| C. REST API | 可进入 x-req | [02-module-breakdown.md](./02-module-breakdown.md#模块-c-rest-api后端接口) | 是 | 依赖 A + B |
| D. Dashboard UI | 可进入 x-req | [02-module-breakdown.md](./02-module-breakdown.md#模块-d-dashboard-ui看板前端) | 是 | 依赖 C |

## 文档导航

- [架构图](./architecture.html)（浏览器双击打开）
- [目标与完成标准](./01-goals-and-boundaries.md)
- [模块设计 + 接口 + 数据结构](./02-module-breakdown.md)
- [数据模型与状态](./04-data-and-state.md)
- [验证策略与演进](./05-validation-and-evolution.md)
- [Task 映射](./90-task-map.md)

## 当前建议

1. 四个模块方案均已确认，全部可进入 x-req
2. 建议开发顺序：A (Scanner) → B (Workflow Core) → C (REST API) → D (Dashboard UI)
3. A 和 B 可并行开发，C 和 D 需要 A+B 先就绪
4. 建议拆成 2 个 task：后端（A+B+C）和 前端（D）
