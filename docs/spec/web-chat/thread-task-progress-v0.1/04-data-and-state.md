# 数据模型与状态

## 文件位置

任务进度文件固定保存到当前 session 同目录：

```text
<resolved_session_file_store_path>/<session_id>/task_progress.json
```

`resolved_session_file_store_path` 只由 `SessionTaskProgressRepository` 解析。该仓储调用 `resolve_kongming_path(config.session.file_store_path)`，API、LLM 工具和 workflow 桥接都通过同一仓储读写，避免不同模块把相对路径解析到不同位置。默认 file session 已使用 `<session_root>/<session_id>/manifest.json` 和 `<session_root>/<session_id>/<session_id>.jsonl`，本 spec 在同一目录增加 `task_progress.json`。

## JSON schema

```json
{
  "schema_version": 1,
  "session_id": "thread-abc",
  "updated_at_ms": 1781190000000,
  "source": "llm",
  "tasks": [
    {
      "id": "wf-20260612T101500-1a2b3c4d:001-reviewer",
      "orchestration_task_id": "wf-20260612T101500-1a2b3c4d:001-reviewer",
      "workflow_id": "wf-20260612T101500-1a2b3c4d",
      "task_id": "reviewer",
      "task_run_id": "001-reviewer",
      "desc": "梳理接口合同",
      "status": "in_progress",
      "source_status": "running",
      "error_message": null,
      "display_order": 0,
      "updated_at_ms": 1781190000000
    }
  ],
  "counts": {
    "pending": 0,
    "in_progress": 1,
    "completed": 0,
    "total": 1
  }
}
```

## 字段定义

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `schema_version` | `1` | 是 | 当前 schema 版本 |
| `session_id` | `string` | 是 | 当前 thread/session ID |
| `updated_at_ms` | `number` | 是 | 快照更新时间，Unix 毫秒 |
| `source` | `llm \| workflow \| api` | 是 | 最近写入来源 |
| `tasks` | `TaskProgressItem[]` | 是 | 当前任务列表 |
| `counts` | `TaskProgressCounts` | 否 | 服务端可计算字段，前端可直接使用 |

### TaskProgressItem

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | `string` | 是 | 当前 session 内稳定 ID，等于 `orchestration_task_id` |
| `orchestration_task_id` | `string` | 是 | 展示稳定 ID，由后端派生；workflow 桥接使用 `<workflow_id>:<task_run_id>`，LLM 工具使用 `<workflow_id>:<step_id>` |
| `workflow_id` | `string` | 否 | 所属 workflow ID |
| `task_id` | `string` | 是 | 编排原始任务 ID，例如 `SubAgentTask.task_id` |
| `task_run_id` | `string` | 是 | 编排运行任务 ID，例如 `metadata.task_run_id` |
| `desc` | `string` | 是 | Web checklist 展示文本 |
| `status` | `pending \| in_progress \| completed` | 是 | 任务状态 |
| `source_status` | `string` | 否 | 编排原始状态，例如 `assigned` / `running` / `completed` / `failed` |
| `error_message` | `string` | 否 | 失败或异常说明 |
| `display_order` | `number` | 是 | compact checklist 展示顺序，从 0 开始 |
| `updated_at_ms` | `number` | 否 | 该任务最近更新时间 |

## 展示 view model

前端从快照映射出展示模型。组件测试直接使用该模型或从 fixture 快照生成该模型，避免测试依赖文件路径、轮询时钟和后端实现细节。

```json
{
  "title": "进度",
  "variant": "compact_checklist",
  "items": [
    {
      "key": "wf-20260612T101500-1a2b3c4d:001-reviewer",
      "orchestration_task_id": "wf-20260612T101500-1a2b3c4d:001-reviewer",
      "task_id": "reviewer",
      "desc": "梳理现有 thread/session 路径与顶部工具栏结构",
      "status": "completed",
      "status_label": "已完成",
      "icon_variant": "check_circle",
      "order": 0,
      "aria_label": "已完成：梳理现有 thread/session 路径与顶部工具栏结构"
    },
    {
      "key": "wf-20260612T101500-1a2b3c4d:002-implementer",
      "orchestration_task_id": "wf-20260612T101500-1a2b3c4d:002-implementer",
      "task_id": "implementer",
      "desc": "实现 session task progress 文件模型、REST API、LLM 工具注册",
      "status": "pending",
      "status_label": "未完成",
      "icon_variant": "ring",
      "order": 1,
      "aria_label": "未完成：实现 session task progress 文件模型、REST API、LLM 工具注册"
    }
  ],
  "empty": {
    "title": "暂无任务进度"
  }
}
```

展示规则：
- `key` 使用派生 progress key；旧快照缺少 `workflow_id` 时，前端从 `wf-*` 前缀 key 兜底识别当前 workflow。
- `desc` 是 Web checklist 的展示文本，长文本允许换行。
- `status_label` 固定为未完成、进行中、已完成。
- `icon_variant` 固定为 `check_circle`、`ring`、`active_ring`，组件测试可以直接断言视觉 token。
- `aria_label` 使用中文状态前缀，组件测试优先按 role/name 查询。
- `items` 按 `display_order` 升序排列。

### TaskProgressCounts

| 字段 | 类型 | 说明 |
|------|------|------|
| `pending` | `number` | 未完成数量 |
| `in_progress` | `number` | 进行中数量 |
| `completed` | `number` | 已完成数量 |
| `total` | `number` | 总数 |

## 状态枚举

| 后端值 | 前端标签 | 语义 |
|--------|----------|------|
| `pending` | 未完成 | 已列入计划，尚未开始或等待执行 |
| `in_progress` | 进行中 | 当前正在处理或等待外部动作 |
| `completed` | 已完成 | 当前任务已经完成 |

## 数据来源

MVP 数据来源暂定为 agent workflow 的编排任务信息：

1. 编排层产生 `SubAgentTask.task_id`，运行前绑定 `metadata.task_run_id`。
2. 进度桥接读取 `workflow_id`、`task_id`、`task_run_id`、`desc`、顺序和状态。
3. 仓储写入 `task_id`、`task_run_id`、`desc`、`orchestration_task_id`、`display_order` 和状态。
4. 前端用派生 progress key 作为展示 key 和测试稳定 ID。

LLM 工具写入任务时只需要提交 `workflow_id`、`step_id`、`desc`、`status`。后端派生 `id/orchestration_task_id`，并把 `task_id` 和默认 `task_run_id` 归一为 `step_id`。临时任务省略 `workflow_id` 时，内部 key 使用 `manual:<step_id>`。

## workflow 事件映射

现有 agent workflow 以并行子任务为主，进度同步使用事件模型：

| workflow 事件 | status | source_status | 说明 |
|---------------|--------|---------------|------|
| `workflow_started` / `agent_assigned` | `pending` | `assigned` | 初始任务列表 |
| 子 agent 开始运行 | `in_progress` | `running` | 单个任务执行中 |
| `agent_completed` | `completed` | `completed` | 单个任务完成 |
| `agent_failed` | `pending` | `failed` | 三态合同保持未完成，错误写入 `error_message` |
| `workflow_completed` | 按最终结果重算 | 最终 run/report 状态 | 覆盖当前快照 |

## 状态流转

状态流转图见 [diagrams.md](./diagrams.md#状态流转)。

允许流转：
- `pending -> in_progress`
- `in_progress -> completed`
- `in_progress -> pending`，用于编排回退或等待用户补充信息
- `completed -> in_progress`，用于返工

第一版采用快照覆盖模型，后续若需要审计，再追加 `task_progress_events.jsonl`。

## 一致性策略

- 单个快照文件是 session 级任务进度事实源。
- `orchestration_task_id` 是展示项稳定 key。workflow bridge 映射编排运行实例，LLM tool 映射 plan step。
- 写入采用临时文件 + rename 的原子替换。
- `counts` 由服务端写入时重新计算，读取旧文件时也可重新计算。
- 前端只展示服务端返回内容，不在本地持久化任务状态。
- 并发写入使用最后写入胜出，编排桥接和 LLM 工具需要避免高频交替写同一 session。
