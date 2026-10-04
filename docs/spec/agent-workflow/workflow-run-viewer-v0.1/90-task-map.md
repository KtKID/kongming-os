# 90 Task Map

## 可进入 x-req 的任务

| Task | 优先级 | 目标 | 验收 |
|------|--------|------|------|
| `workflow-viewer-backend-readonly-v0.1` | P0 | 新增 viewer manager/router/artifact reader，完成 thread-scoped workflow list/detail API | 单元测试覆盖列表、详情、路径约束、缺失文件 diagnostics |
| `workflow-viewer-adapters-v0.1` | P0 | 实现 adapter registry 和 `parallel`、`map_reduce`、`roundtable_review`、unknown adapters | 三个内置 mode 和未知 mode fixture 投影通过 |
| `workflow-viewer-conversation-v0.1` | P0 | 从 `subagent.json.child_session_log_path` 或 `session_id` fallback 懒加载 FileSession JSONL | 子 agent report 行能打开完整 conversation |
| `workflow-viewer-usage-v0.1` | P0 | 实现 workflow 内 usage projector，前端并列展示 thread 总 usage | OpenAI/Claude 字段口径测试通过 |
| `workflow-viewer-web-ui-v0.1` | P0 | 新增页面、store、components，渲染列表、流程图、panels、reports、conversation drawer、usage | 前端测试和 Playwright smoke 通过 |
| `workflow-viewer-e2e-fixture-v0.1` | P1 | 用 `C:\km-e2e\test_minimax_parent_runs-ea22a9df` sessions 数据做端到端验证 | E2E 覆盖列表、流程图、review board、子 agent 会话、token |

## 模块到 task 映射

| 模块 | Task |
|------|------|
| WorkflowRunViewerManager | `workflow-viewer-backend-readonly-v0.1` |
| Viewer Router | `workflow-viewer-backend-readonly-v0.1` |
| WorkflowArtifactReader | `workflow-viewer-backend-readonly-v0.1` |
| Adapter Registry | `workflow-viewer-adapters-v0.1` |
| Parallel Adapter | `workflow-viewer-adapters-v0.1` |
| MapReduce Adapter | `workflow-viewer-adapters-v0.1` |
| Roundtable Adapter | `workflow-viewer-adapters-v0.1` |
| Unknown Adapter | `workflow-viewer-adapters-v0.1` |
| Conversation Loader | `workflow-viewer-conversation-v0.1` |
| Usage Projector | `workflow-viewer-usage-v0.1` |
| Viewer Store | `workflow-viewer-web-ui-v0.1` |
| Viewer Page | `workflow-viewer-web-ui-v0.1` |
| Viewer Components | `workflow-viewer-web-ui-v0.1` |
| E2E Harness | `workflow-viewer-e2e-fixture-v0.1` |

## 推荐顺序

1. `workflow-viewer-backend-readonly-v0.1`
2. `workflow-viewer-adapters-v0.1`
3. `workflow-viewer-conversation-v0.1`
4. `workflow-viewer-usage-v0.1`
5. `workflow-viewer-web-ui-v0.1`
6. `workflow-viewer-e2e-fixture-v0.1`

## 风险优先级

| 风险 | 先验处理 |
|------|----------|
| 子 agent JSONL 路径解析跨 thread/session 根 | 后端第一轮写路径约束测试 |
| usage 字段多来源重复统计 | Usage Projector 明确来源优先级并输出 diagnostics |
| `roundtable_review` 和 `map_reduce` 产物在历史运行中字段漂移 | Adapter 使用缺失字段 diagnostics 和 fallback panel |
| 大 conversation 导致详情接口过大 | 详情接口只返回 availability，conversation 接口分页 |
| `/api/workflow` 语义混淆 | 新 router 使用 `/api/threads/{thread_id}/agent-workflows` |

## 当前结论

该 spec 的后端只读投影、adapter registry、conversation loader、usage projector 和 Web UI 都可以进入 x-req。跨 workflow 对比、adapter 插件化和 artifact 大文件高级浏览留在后续 spec 或 v0.2+ 演进。
