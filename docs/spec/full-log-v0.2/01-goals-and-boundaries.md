# 目标与边界

## 背景

full-log v0.1 已实现开发期前后端通信日志落盘，核心能力集中在 `src/devtools/full_logger.py`、`cfg.web.full_log` 和少量 WS 接入点。当前排查问题时仍需要手动找路径、打开文件、识别 JSONL 字段和日志级别。v0.2 补齐 Web 端统一日志查看入口，让运行时问题可以在同一个弹出页内完成第一轮定位。

## 目标

1. 右上角“管理”按钮右侧增加“日志”按钮，使用日志图标与文字。
2. 点击后打开页面级弹出层，弹出层覆盖当前界面，当前主区域保持挂载。
3. 弹出层左侧是日志类型 tab，右侧是日志内容。
4. 日志内容按类型格式化展示：JSONL 展开关键字段，plain text 按时间/级别/原文分段，traceback 保持堆栈可读。
5. 后端提供只读日志发现与读取 API，前端通过 `log_type` 访问，后端负责路径白名单。
6. 首版支持尾部读取、手动刷新、错误态、空文件态、文件缺失态。

## 范围

包含：

- `Layout` 右上角新增 `LogViewerEntryButton`。
- 新增 `LogViewerOverlay`，页面级 dialog 或 fixed overlay，关闭后恢复到原页面。
- 新增 `web/src/modules/logs/` 前端模块，包含 API、store/hook、formatter、组件。
- 新增 `/api/manage/logs/sources` 和 `/api/manage/logs/read`。
- 新增后端日志 registry，集中声明可读日志类型、路径解析、格式提示。
- 日志读取限制最大行数与最大字节数，默认取尾部。
- 前端格式化 JSONL、Python logging 文本、traceback 和无法解析的原文。

暂缓：

- 实时 tail WebSocket。
- 跨文件全文搜索。
- 下载日志文件。
- 修改日志配置或清空日志。
- 任意路径读取。
- HTTP body 展示。

## DoD

| DoD | 支撑模块 | task |
|---|---|---|
| 右上角出现“日志”按钮，位于“管理”右侧 | `LayoutLogEntry` | `log-viewer-shell` |
| 弹出层打开后当前聊天/管理主区域状态保持 | `LogViewerOverlayHost` | `log-viewer-shell` |
| 左侧 tab 能列出后端返回的日志类型 | `LogSourceRegistry` + `LogViewerStore` | `log-reader-api` / `log-viewer-ui` |
| 右侧能读取并展示选中日志尾部内容 | `LogReadService` + `LogContentPane` | `log-reader-api` / `log-viewer-ui` |
| JSONL 日志展示关键字段和格式化 JSON | `LogFormatter` | `log-formatters` |
| 文本日志展示时间、级别、消息和堆栈 | `LogFormatter` | `log-formatters` |
| 文件缺失、空文件、超限截断都有明确 UI 状态 | `LogReadService` + `LogViewerStore` | `log-viewer-ui` |
| 后端拒绝 registry 之外的路径读取 | `LogSourceRegistry` | `log-reader-api` |
| 测试覆盖 API、formatter、overlay 挂载语义 | tests | `log-viewer-tests` |

## 关键约束

- 前端按钮只传 `log_type`，后端解析路径。
- 弹出层挂在 `Layout` 的 `main` 之后，与现有 drawer/dialog host 同级。
- 日志读取默认尾部 500 行或 512 KiB，返回 `truncated=true` 表示前部被截断。
- JSONL 逐行容错，一行解析失败只影响该行展示。
- 所有验证写入 pytest 或前端测试文件，验证命令可重复运行。
