# 数据和状态

## 核心实体

### TaskDetailRouteState

| 字段 | 类型 | 说明 |
|------|------|------|
| `threadId` | string | 当前 thread |
| `activeTab` | `session` / `workflows` | 左侧 tab |
| `artifactId` | string? | 当前选中文件 |
| `workflowId` | string? | 当前选中 workflow |
| `returnTo` | string? | 关闭后回退目标，默认 `/chat/{threadId}` |

### ThreadArtifactRefDTO

| 字段 | 类型 | 说明 |
|------|------|------|
| `artifact_id` | string | base64url 相对路径 |
| `path` | string | thread 目录内相对路径 |
| `kind` | string | json / jsonl / markdown / text / directory |
| `title` | string | 文件名 |
| `size_bytes` | number? | 文件大小 |
| `available` | boolean | 是否可读取 |

### ThreadArtifactContentDTO

| 字段 | 类型 | 说明 |
|------|------|------|
| `artifact_id` | string | 文件 id |
| `path` | string | 相对路径 |
| `kind` | string | 渲染类型 |
| `content` | unknown | 文件内容 |
| `truncated` | boolean | 是否截断 |
| `diagnostics` | DiagnosticDTO[] | 读取诊断 |

### JsonlRecordViewModel

| 字段 | 类型 | 说明 |
|------|------|------|
| `recordIndex` | number | JSONL 行序号 |
| `title` | string | role/type/action/event 派生标题 |
| `time` | string? | ts/created_at/timestamp |
| `markdownFields` | FieldView[] | content/message/text 字符串字段 |
| `metadataFields` | FieldView[] | role/type/action 等短字段 |
| `jsonFields` | FieldView[] | object/array/剩余字段 |
| `diagnostics` | DiagnosticDTO[] | 单行诊断 |

## 状态归属

| 状态 | 所属模块 | 持久性 |
|------|---------|--------|
| active tab | URL route + TaskDetailManager | URL |
| selected artifact | URL path 或 search | URL |
| artifact list cache | ThreadFileBrowserManager | 内存 |
| artifact content cache | ThreadFileBrowserManager | 内存 |
| workflow list/detail | 现有 workflow viewer store | 内存 |
| renderer expand/collapse | Structured Record Renderer | 组件局部状态 |

## artifact_id 编码

`artifact_id` 使用 workflow viewer 已有的 base64url 相对路径编码模型。解码后必须满足：

- 不能是绝对路径。
- path parts 不能包含 `..`。
- resolve 后必须在 `session_root/<thread_id>/` 内。
- 第一版只允许指定后缀：`.json`、`.jsonl`、`.md`、`.txt`，目录只允许展示 entries。

## JSONL 字段分类

字段分类按优先级执行：

1. `message.content`、`content`、`text` 命中 Markdown 字段。
2. `message` 为字符串时命中 Markdown 字段。
3. `role`、`type`、`event`、`action`、`timestamp`、`created_at` 命中 metadata。
4. object / array 命中 JSON 字段。
5. 其他 primitive 命中 metadata。

## 数据流

数据流图见 `./diagrams.md`。
