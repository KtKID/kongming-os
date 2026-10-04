# 模块拆分

## 模块总览

| 模块 | 职责 | 位置 | 状态 | 风险 |
|---|---|---|---|---|
| `LayoutLogEntry` | 右上角按钮与打开状态入口 | `web/src/components/Layout.tsx` | 可进入 x-req | 低 |
| `LogViewerOverlay` | 页面级弹出层、左右布局、关闭与刷新动作 | `web/src/modules/logs/components/` | 可进入 x-req | 中 |
| `LogViewerStore` | 当前日志类型、加载状态、内容、错误、刷新 | `web/src/modules/logs/store.ts` | 可进入 x-req | 低 |
| `LogFormatter` | JSONL/plain text/traceback 格式化 | `web/src/modules/logs/formatter.ts` | 可进入 x-req | 中 |
| `LogAPI` | 前端调用 `/api/manage/logs/*` | `web/src/modules/logs/api.ts` | 可进入 x-req | 低 |
| `LogSourceRegistry` | 后端日志类型白名单与路径解析 | `src/web/dashboard/logs/registry.py` | 可进入 x-req | 高 |
| `LogReadService` | 安全读取尾部、行解析、截断元数据 | `src/web/dashboard/logs/service.py` | 可进入 x-req | 中 |
| `ManageLogsRouter` | REST 端点 | `src/web/routers/manage.py` 或子 router | 可进入 x-req | 低 |
| `LogDTO` | 前后端协议类型 | `src/web/protocol` + `web/src/protocol.ts` | 可进入 x-req | 中 |

## 前端模块

### `LayoutLogEntry`

职责：

- 在“管理”按钮右侧渲染“日志”按钮。
- 使用 `lucide-react` 的 `ScrollText` 或 `FileText` 图标。
- 管理 `logViewerOpen` 状态，或通过 `?panel=logs` 同步打开状态。
- 渲染 `LogViewerOverlay`，确保主 `Outlet` 不因打开日志页卸载。

接口草案：

```tsx
<LogViewerEntryButton open={openLogViewer} />
<LogViewerOverlay open={logViewerOpen} onOpenChange={setLogViewerOpen} />
```

### `LogViewerOverlay`

职责：

- 页面级 overlay，宽高接近视口，视觉上是独立 page。
- 左侧固定宽度 tab 列表，右侧内容区域。
- 顶部提供当前文件路径、刷新按钮、读取行数或截断提示。
- 支持 Esc / 关闭按钮 / 浏览器后退关闭。

布局建议：

- 桌面：左 220px，右侧 `minmax(0, 1fr)`。
- 移动：顶部横向 tab 或下拉类型选择，内容区域满宽。
- 内容区使用等宽字体，行高稳定，避免高频刷新引发布局跳动。

### `LogFormatter`

职责：

- 输入后端返回的 `LogLineDTO[]`。
- 输出可渲染 view model。
- JSONL 行提取 `ts` / `level` / `kind` / `dir` / `channel` / `thread_id` / `message` 等常用字段。
- plain text 行识别 Python logging 常见格式。
- traceback 块连续展示，保持缩进。

格式化策略：

| format | 展示 |
|---|---|
| `jsonl` | 摘要行 + 可折叠 pretty JSON |
| `plain` | 时间/级别 badge + message |
| `traceback` | 堆栈块，等宽预格式化 |
| `unknown` | 原文行 |

## 后端模块

### `LogSourceRegistry`

职责：

- 返回可读日志类型列表。
- 从 config 和 `kongming_home` 解析路径。
- 限制路径必须落在允许根目录内。
- 给每个 source 标注格式、说明、默认读取策略。

初始 registry：

```python
LogSource(
    type="full_log",
    label="Full Log",
    path=cfg.web.full_log.path,
    format="jsonl",
    description="前后端通信全量日志",
)
```

路径规则：

- 相对路径按 repo cwd 或 `kongming_home` 的既有配置语义解析。
- 允许根目录包含 `.kongming/`、`cfg.trace.output_path`、`cfg.web.full_log.path`、`.kongming/web/server.log`。
- 解析后使用 `Path.resolve()` 与允许根做父子关系校验。

### `LogReadService`

职责：

- 读取文件尾部，避免一次性加载大文件。
- 返回行数组、总字节数、读取字节数、截断标记、文件 mtime。
- JSONL 解析放在后端只做“可选字段提取”，前端仍保留 pretty JSON 能力。
- 文件缺失返回 `exists=false`，HTTP 仍为 200，便于 UI 展示空态。

读取边界：

| 参数 | 默认 | 上限 |
|---|---:|---:|
| `tail_lines` | 500 | 5000 |
| `max_bytes` | 524288 | 5242880 |
| `query` | 空 | 200 字符 |

### `ManageLogsRouter`

端点：

```text
GET /api/manage/logs/sources
GET /api/manage/logs/read?type=full_log&tail_lines=500&query=
```

返回模型：

```python
class LogSourceDTO(BaseModel):
    type: str
    label: str
    format: Literal["jsonl", "plain", "mixed"]
    description: str
    path: str
    exists: bool
    size_bytes: int | None
    updated_at_ms: int | None

class LogReadResponseDTO(BaseModel):
    source: LogSourceDTO
    lines: list[LogLineDTO]
    truncated: bool
    read_bytes: int
    total_bytes: int | None
```

## 复用点

- `Layout` 已是所有受保护页面的共同壳层，适合作为全局 overlay host。
- `components/ui/dialog.tsx` 可复用 Radix Dialog 语义。
- `modules/dashboard/api.ts` 的 `apiGet` 使用模式可复用。
- `/api/manage` router 已有鉴权上下文与运行管理语义。
- `cfg.web.full_log`、`cfg.trace.output_path`、`get_kongming_home()` 已提供主要路径来源。
