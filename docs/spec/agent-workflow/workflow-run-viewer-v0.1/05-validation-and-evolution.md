# 05 Validation And Evolution

## 验证目标

验证重点是只读边界、真实产物解析、mode adapter 覆盖、完整 conversation 懒加载和 token 渲染口径。测试使用真实 workflow 目录形态，避免只验证手写 DTO。

## 单元测试

| 测试主题 | 目标 |
|----------|------|
| workflow 列表扫描 | thread 下多个 workflow 能按创建时间、mode、status 输出列表 |
| 路径约束 | workflow_id、task_run_id、artifact_id 始终解析在 thread/session 根目录内 |
| 公共投影 | `workflow.json`、`audit.jsonl`、`result.json`、`reports/index.json` 缺失时返回 diagnostics |
| adapter registry | `parallel`、`map_reduce`、`roundtable_review` 命中内置 adapter，未知 mode 命中 fallback |
| roundtable adapter | `review_board/*` 被投影为 claims、rebuttals、consensus、final report panel |
| map_reduce adapter | `map_reduce/*` 被投影为 shards、mapper index、reducer result panel |
| conversation loader | `subagent.json.child_session_log_path` 指向 FileSession JSONL 时返回分页 messages |
| usage projector | OpenAI 子集字段和 Claude cache 字段按各自口径展示 |

## 前端测试

| 测试主题 | 目标 |
|----------|------|
| store 加载 | 列表、详情、conversation 三类请求状态独立 |
| mode panel 渲染 | 不同 `panel.kind` 映射到对应组件 |
| usage panel | thread 总 usage 与 workflow usage 并列展示 |
| conversation drawer | 打开子 agent 行时再请求 conversation |
| 空态和诊断 | 缺文件、未知 mode、无 conversation 时给出可操作错误 |

## E2E 验证

E2E 必须覆盖真实 Web 服务和真实 workflow 目录。

### 数据准备

1. 启动 web：

```bash
./start.sh web start --build
```

2. 在 Web 选择或创建一个 thread，记录 `thread_id`。
3. 找到该 thread 对应 session 目录。
4. 将 `C:\km-e2e\test_minimax_parent_runs-ea22a9df\sessions\live-agent-role-us-iran-roundtable\agent-workflows\<workflow_id>` 复制到该 thread 对应 workflow 目录：

```text
<session.file_store_path>/<thread_id>/agent-workflows/<workflow_id>
```

5. 将 fixture 中 `sessions\subagent-*` 子会话目录同步复制到同一个 `<session.file_store_path>/` 根目录。
6. Conversation Loader 优先读取安全的 `child_session_log_path`，路径失效时按 `session_id` fallback 到 `<session.file_store_path>/<session_id>/<session_id>.jsonl`。

### 检查项

| 场景 | 检查 |
|------|------|
| 列表 | viewer 能列出复制后的 workflow，展示 mode、status、报告数、usage 摘要 |
| 流程图 | 公共 flow_nodes/flow_edges 渲染为流程图，节点状态与 reports/audit 对齐 |
| Review Board | `roundtable_review` 展示 claims、rebuttals、consensus、final report |
| Map Reduce | `map_reduce` 展示 shards、mapper index、reducer result |
| 子 agent 会话 | 点击 report 行后懒加载完整 conversation，消息来自 FileSession JSONL |
| Token | thread 总 usage 和 workflow 内 usage 同屏展示，OpenAI/Claude 字段口径正确 |

## 回归命令建议

```bash
uv run pytest tests/unit/web/test_workflow_viewer_manager.py -v
uv run pytest tests/unit/web/test_workflow_viewer_adapters.py -v
uv run pytest tests/unit/web/test_workflow_viewer_conversation.py -v
uv run pytest tests/unit/web/test_workflow_viewer_usage.py -v
cd web && npm test -- workflow-viewer
```

E2E 使用 Playwright，并在报告中记录：

- web server URL
- thread_id
- workflow_id
- fixture 根路径
- 列表截图
- review board 截图
- conversation drawer 截图
- usage panel 截图

## 演进路径

### v0.1

- 只读 API、公共 DTO、内置 adapters、完整 conversation 懒加载、usage panel、E2E fixture。

### v0.2

- artifact 内容分页、JSONL 大文件虚拟列表、flow graph 更细粒度状态。

### v0.3

- workflow mode adapter 插件化，让新增 workflow mode 只补 adapter 和前端 panel 映射。

### v0.4

- 支持跨 workflow 对比：同 thread 多个 workflow 的 token、耗时、失败点和最终报告差异。

## 主流程审查关注点

- API 路径命名与现有 thread router 风格保持一致。
- `child_session_log_path` 的绝对路径、相对路径和跨 session store 解析策略。
- usage 字段来源优先级和 OpenAI/Claude 口径展示。
- 大型 JSONL conversation 的分页和前端性能。
- 只读边界通过测试固定，Web manager 只调用 artifact reader 和 projection adapter。
