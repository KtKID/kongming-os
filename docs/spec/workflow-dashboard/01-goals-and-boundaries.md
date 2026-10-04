# 目标与完成标准

## 系统目标

kongming-agent 的开发流程通过 skill 管线（x-spec → x-req → x-dev → x-verify → x-qa-gate → x-fix）推进，每个 task 对应 `dev-pipeline/tasks/<name>/` 目录，skill 执行会产出特定文件。

当前痛点：多个 task 并行推进时，缺少统一视图展示各 task 的流程进度。Workflow Dashboard 通过扫描文件产物自动推断状态，在 Web 上渲染可视化看板。

核心原则：**skill 定义能力，workflow 定义关系，event 定义事实，runtime 维护状态**。skill 与 flow 完全解耦，flow 系统是纯观察者。

## 完成目标（DoD）

- [ ] D1: Web 看板能自动发现 `docs/` 下的 spec 目录和 `dev-pipeline/tasks/` 下的 task 目录
- [ ] D2: 看板能根据文件产物自动推断每个 task 的阶段状态（跑过 / 没跑过）
- [ ] D3: 看板能展示 spec → task 的树形关系（通过 README 反向引用）
- [ ] D4: 用户能在 Web 上将 task 绑定到工作流模板
- [ ] D5: 系统提供至少 2 个预置工作流模板（full-pipeline、quick-dev）
- [ ] D6: 多个 task 可同时展示，各自独立的流程节点状态
- [ ] D7: 扫描间隔可通过配置文件调整
- [ ] D8: 看板入口在 Web 右上角（架构图按钮旁）

## 范围边界

**包含**：
- 文件产物扫描器 + 阶段推断引擎
- NodeTemplate / WorkflowDefinition / WorkflowRun / WorkflowEvent 四对象模型
- 预置模板 + 用户手动绑定
- JSON 文件持久化
- Web 看板只读展示
- 可配扫描间隔

**不包含**：
- 拖拽式工作流编辑器（v2 规划）
- Web 驱动 skill 执行（v2 规划）
- 节点间自动流转（v2 规划）
- "进行中"实时状态检测（v1 只判断"跑过/没跑过"）
- skill 代码任何改动
- verify / qa-gate 报告的 pass/fail 解析（v1 只判断是否跑过）

## 关键约束

- **技术栈**：后端 FastAPI（已有）+ 前端 React + Zustand（已有）
- **存储**：JSON 文件存 `.kongming/workflows/`，跟 cron 模块同级
- **不污染 git**：运行时状态不写入 `dev-pipeline/` 或 `docs/`，扫描器只读
- **单用户**：本地部署，不考虑多用户并发
- **skill 零感知**：flow 系统完全独立于 skill 实现

## DoD ↔ 模块追溯矩阵

| DoD 条目 | 需要哪些模块 | 需要哪些 task | 状态 |
|---------|------------|-------------|------|
| D1 自动发现 | Scanner | workflow-dashboard-backend | 待实现 |
| D2 阶段推断 | Scanner | workflow-dashboard-backend | 待实现 |
| D3 树形关系 | Scanner | workflow-dashboard-backend | 待实现 |
| D4 绑定模板 | Workflow Core + REST API | workflow-dashboard-backend | 待实现 |
| D5 预置模板 | Workflow Core | workflow-dashboard-backend | 待实现 |
| D6 多 task 展示 | Dashboard UI | workflow-dashboard-frontend | 待实现 |
| D7 可配间隔 | Scanner（ConfigLoader 扩展） | workflow-dashboard-backend | 待实现 |
| D8 入口位置 | Dashboard UI | workflow-dashboard-frontend | 待实现 |
