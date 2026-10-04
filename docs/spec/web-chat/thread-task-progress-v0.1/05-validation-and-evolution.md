# 验证策略与演进

## 验证策略

### 后端单元测试

- 读取缺失文件返回空快照，`tasks=[]`，`counts.total=0`。
- 读取合法文件返回完整快照并补齐 counts。
- 写入合法 payload 后生成 `<session_dir>/task_progress.json`。
- 非法 status、空 desc、跨 session `session_id` 被拒绝。
- LLM 工具缺失 `step_id/task_id` 或 `desc` 时写入被拒绝；`orchestration_task_id` 和 `task_run_id` 由后端派生。
- JSON 损坏时返回明确错误。
- 路径解析只通过 `SessionTaskProgressRepository.from_config(config)`；测试覆盖默认 `.kongming/sessions` 和绝对临时目录两种落点。

### LLM 工具测试

- 工具只写 `ToolContext.session_id` 对应文件。
- 工具 payload 缺少任务 ID、编排 task id、运行 task id 或 desc 时返回参数错误。
- 工具成功写入后返回 `updated_at_ms` 和 counts。
- 工具写入固定 `source="llm"`，无法通过参数伪装为 `workflow` 或 `api`。
- 安全策略按 x-req 决策验证：静默允许或标准审批二选一。

### 前端组件测试

- 无任务时显示空态。
- 三种状态以中文标签展示。
- compact checklist view model 可由固定 fixture 直接渲染。
- Web 展示文本来自 `desc`，测试断言优先查 `desc`。
- 完成态、进行中、未完成分别有稳定可访问名称，测试按 role/name 查询。
- 图标 token 使用 `icon_variant` 断言：`check_circle` / `ring` / `active_ring`。
- popover 打开后触发首次请求和 2 秒刷新。
- popover 关闭后停止刷新。
- 切换 thread 后读取新 thread 的进度。
- API 错误时显示可恢复错误态。

### 集成验证

- 通过 repository fixture 写入当前 session 进度文件，面板 2 秒内刷新。
- 通过 REST `PUT` 写入测试 payload，面板 2 秒内刷新且快照 `source="api"`。
- 通过 LLM 工具写入任务列表，Web 面板展示一致。
- workflow 事件发生时，读取 `task_id` / `task_run_id` / `desc` 生成快照；正在执行的任务变为进行中，已结束任务变为已完成，失败任务保持未完成并携带错误说明。

## 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| 顶部入口拥挤 | 影响当前工具区扫描效率 | 入口使用图标+短标签，移动端进入工具菜单 |
| 轮询产生额外请求 | 多 thread 打开时增加请求量 | 仅当前 thread、popover 可见时轮询 |
| 文件损坏 | 面板无法展示 | 后端返回诊断错误，写入全程原子替换 |
| LLM 写入频率过高 | UI 闪烁或文件频繁改动 | 工具提示要求阶段性更新，编排桥接按状态变化写入 |
| workflow 粒度不一致 | 展示任务与内部 step 对不上 | 第一版允许 LLM 自定义 task，workflow 桥接仅做明确 step 映射 |
| task id 不稳定 | React key 和测试 fixture 抖动 | workflow bridge 使用 `<workflow_id>:<task_run_id>`，LLM tool 使用 `<workflow_id>:<step_id>`，后端统一派生稳定展示 key |
| 路径解析分叉 | API、工具、workflow 写到不同目录 | 三个入口统一调用 SessionTaskProgressRepository |

## 演进方向

### v0.1：当前 spec 范围

- 当前 thread 顶部进度入口。
- session 同目录进度文件。
- 派生 progress key 作为任务展示稳定来源。
- compact checklist view model。
- REST 读取与写入。
- LLM 工具写入。
- 2 秒轮询。
- workflow 事件薄桥接。

### v0.2：推送更新

- WebSocket 或 thread-status 事件推送。
- 文件写入后主动广播当前 thread 进度更新。
- 轮询作为降级路径。

### v0.3：事件历史

- 增加 `task_progress_events.jsonl`。
- 支持任务变更历史、耗时统计、失败原因。
- 可回放长任务过程。

### v0.4：跨 thread 汇总

- 工作区层面的进度总览。
- 多 session 并行编排状态。
- 任务级过滤与搜索。
