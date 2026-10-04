# Workflow Run Viewer v0.1

> 状态：可进入 x-req
> 目标：在 Web 中为具体 thread 提供 Agent Workflow Viewer，精确查看 workflow 流程、不同模式的专属产物、子 agent 完整对话和 token 消耗。

## 系统目标

Workflow Run Viewer 面向正在排查或复盘 agent workflow 的用户。它以 thread 为入口，读取 `session.file_store_path/<thread_id>/agent-workflows/<workflow_id>` 下的运行产物，生成只读投影，并在 Web 前端展示公共流程、模式专属面板、子 agent 报告摘要、完整会话和 token 口径。

## 最小可用路径

用户在 Web 选中 thread，进入该 thread 的 workflow viewer，页面请求 `hosts/web` 新增 viewer API，后端扫描该 thread 的 `agent-workflows/` 目录并按 adapter registry 投影 `parallel`、`map_reduce`、`roundtable_review` 或未知 mode，前端展示列表、流程图、专属产物、子 agent 会话懒加载和 workflow 内 usage，同时 thread 总 usage 继续读取 `GET /api/threads/{thread_id}/usage`。

## 范围边界

**包含**

- thread 级 workflow 列表、详情、报告摘要、artifact 面板和完整子 agent 对话。
- 后端 adapter registry：公共投影 DTO + per-mode panels/artifacts。
- 内置 `parallel`、`map_reduce`、`roundtable_review` adapters，未知 mode 使用 fallback adapter。
- 子 agent 完整对话优先从 `subagent.json.child_session_log_path` 指向的 FileSession JSONL 读取，路径失效时按 `session_id` 回落到 session store。
- token 展示同时覆盖 thread 总 usage 和 workflow 内子 agent usage。
- E2E 验证使用 `C:\km-e2e\test_minimax_parent_runs-ea22a9df` 的 sessions 数据复制到目标 thread workflow 目录。

**边界外职责**

- workflow 执行、审计写入和产物 schema 变更。
- Web 写回 workflow 目录。
- 已有 `/api/workflow` dev-pipeline dashboard 语义维护。
- 自动补齐缺失产物、自动重跑 workflow、自动修复子 agent 会话日志。

## 模块导航

| 模块 | 状态 | 文档 | 是否可进 task | 说明 |
|------|------|------|---------------|------|
| WorkflowRunViewerManager | 可进入 x-req | [02-module-breakdown.md](./02-module-breakdown.md) | 是 | `hosts/web` 只读投影门面，负责路径解析、adapter 分发和 DTO 组装 |
| Viewer Router | 可进入 x-req | [02-module-breakdown.md](./02-module-breakdown.md) | 是 | 新增 thread-scoped viewer API，`/api/workflow` 继续归属 dev-pipeline dashboard |
| Adapter Registry | 可进入 x-req | [02-module-breakdown.md](./02-module-breakdown.md) | 是 | 注册内置 mode adapter 和未知 mode fallback |
| Conversation Loader | 可进入 x-req | [03-core-workflows.md](./03-core-workflows.md) | 是 | 从 `child_session_log_path` 和 session store fallback 懒加载 FileSession JSONL |
| Usage Projector | 可进入 x-req | [04-data-and-state.md](./04-data-and-state.md) | 是 | 汇总 workflow 内 usage 并保留 provider 字段差异 |
| Web Viewer UI | 可进入 x-req | [02-module-breakdown.md](./02-module-breakdown.md) | 是 | `web/src` 页面、store、components 渲染列表、流程图、panel 和 token |

## 文档导航

- [架构图](./architecture.html)
- [目标与边界](./01-goals-and-boundaries.md)
- [模块设计、接口和数据结构](./02-module-breakdown.md)
- [核心流程](./03-core-workflows.md)
- [数据模型与状态](./04-data-and-state.md)
- [验证策略与演进](./05-validation-and-evolution.md)
- [Task 映射](./90-task-map.md)

## 当前建议

该 spec 可以进入 x-req。第一轮实现优先打通只读 API、公共 DTO、`parallel` fallback 级展示、`roundtable_review` review board、`map_reduce` artifact panel、子 agent 会话懒加载和 usage 渲染，E2E 使用既有 sessions fixture 验证真实产物读取。
