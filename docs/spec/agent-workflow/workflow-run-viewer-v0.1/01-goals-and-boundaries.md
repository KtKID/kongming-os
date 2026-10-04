# 01 Goals And Boundaries

## 目标

Workflow Run Viewer v0.1 目标是在 Web 中给每个 thread 增加 workflow 运行查看器。查看器跟随具体 thread，读取该 thread 下的 workflow 产物，展示 workflow 列表、执行流程、模式专属产物、子 agent 报告摘要、完整子 agent 对话和 token 消耗。

## 完成标准

| ID | DoD | 支撑模块 | 验证方式 |
|----|-----|----------|----------|
| D1 | thread 页面能列出该 thread 下所有 `agent-workflows/<workflow_id>` | Viewer Router + WorkflowRunViewerManager | 单元测试 + E2E |
| D2 | workflow 详情返回公共 DTO：metadata、status、mode、timeline、reports、artifacts、usage | Projection DTO + Adapter Registry | 单元测试 |
| D3 | `parallel`、`map_reduce`、`roundtable_review` 都有内置 adapter，未知 mode 有 fallback 投影 | Adapter Registry | 单元测试 |
| D4 | `roundtable_review` 页面展示 `review_board/*`，包含 claims、rebuttals、consensus、final report | Roundtable Adapter + Web Panels | E2E |
| D5 | `map_reduce` 页面展示 `map_reduce/*`，包含 shards、mapper index、reducer result、validation 信息 | MapReduce Adapter + Web Panels | E2E |
| D6 | 报告摘要与完整 conversation 分离加载，打开子 agent 时才读取 FileSession JSONL | Conversation Loader + Web Store | 单元测试 + E2E |
| D7 | 子 agent 完整对话来源为 `subagent.json.child_session_log_path` 或同 session store 内的 `session_id` fallback，并按 FileSession JSONL 格式解析 | Conversation Loader | 单元测试 |
| D8 | thread 总 usage 继续使用 `GET /api/threads/{thread_id}/usage`，workflow 内 usage 由 workflow 产物投影 | Usage Projector + Web Store | 单元测试 + E2E |
| D9 | Web API 和 UI 保持只读，任何请求都只读 workflow 产物和 FileSession JSONL | Viewer Router + Manager | 单元测试 |
| D10 | E2E 使用 `C:\km-e2e\test_minimax_parent_runs-ea22a9df` 的 sessions 数据覆盖列表、流程图、review board、子 agent 会话、token 渲染 | E2E Harness | Playwright |

## 范围

### 后端范围

- 在 `src/hosts/web/` 新增 workflow viewer manager 和 router。
- API 路径采用 thread-scoped 语义，例如 `GET /api/threads/{thread_id}/agent-workflows`、`GET /api/threads/{thread_id}/agent-workflows/{workflow_id}`、`GET /api/threads/{thread_id}/agent-workflows/{workflow_id}/subagents/{task_run_id}/conversation`。
- manager 从 thread 的 `session.file_store_path/<thread_id>/agent-workflows/` 读取产物。
- adapter registry 根据 `workflow.json` 或 `result.json` 中的 mode 分发投影。
- 投影读取公共文件：`workflow.json`、`audit.jsonl`、`result.json`、`reports/index.json`、`reports/*.json`。
- mode adapter 读取专属目录：`roundtable_review` 的 `review_board/*`，`map_reduce` 的 `map_reduce/*`。

### 前端范围

- 在 `web/src` 新增页面、store 和 components。
- 页面跟随当前 thread，提供 workflow 列表、详情主视图、流程图、mode panel、reports panel、conversation drawer、usage panel。
- 前端调用现有 thread usage endpoint 获取 thread 总 usage。
- 前端调用 viewer API 获取 workflow 内 usage 和子 agent 对话。

### 执行层边界

- `application/agent_workflows` 继续负责 workflow 执行、审计写入、公共产物和 mode 专属产物写入。
- `hosts/web` viewer manager/router 只负责读取和投影。
- `web/src` 只负责渲染和交互状态。

## 边界外职责

- `application/agent_workflows` 继续拥有写入职责。
- Web viewer manager/router 只读 workflow 产物。
- 已有 `/api/workflow` 保持 dev-pipeline dashboard 语义。
- workflow 执行入口归属现有 agent workflow tool 和 application 层。
- 自动重跑、报告编辑、review board 修改进入后续独立 spec。
- 子 agent 完整会话由 conversation API 懒加载。
- provider usage 字段保持 provider 原生口径和分组展示。

## 约束

- Web 读取路径必须被 thread 根目录约束，防止通过 artifact path 读取 thread 外文件。
- 路径字段可以展示为相对 workflow_dir 的相对路径，API 内部解析使用绝对路径。
- DTO 保持向前兼容：缺失专属产物时返回 `available=false` 和缺失原因。
- adapter registry 允许新增 mode 时独立扩展 panel，不影响公共 DTO。
- 大 conversation 使用懒加载和分页或截断元信息，避免详情接口一次返回大型 JSONL。

## DoD 追踪矩阵

| DoD | 后端只读投影 | Adapter | Conversation | Usage | Web UI | E2E |
|-----|--------------|---------|--------------|-------|--------|-----|
| D1 | 是 |  |  |  | 是 | 是 |
| D2 | 是 | 是 |  | 是 | 是 | 是 |
| D3 |  | 是 |  |  | 是 | 是 |
| D4 |  | 是 |  |  | 是 | 是 |
| D5 |  | 是 |  |  | 是 | 是 |
| D6 | 是 |  | 是 |  | 是 | 是 |
| D7 | 是 |  | 是 |  | 是 | 是 |
| D8 | 是 |  |  | 是 | 是 | 是 |
| D9 | 是 |  |  |  |  | 是 |
| D10 | 是 | 是 | 是 | 是 | 是 | 是 |
