# Task Map

## 建议任务

| task | 模块 | 内容 | 优先级 | 状态 |
|---|---|---|---|---|
| `log-reader-api` | `LogSourceRegistry` / `LogReadService` / `ManageLogsRouter` | 后端 source 列表、尾部读取、DTO、路径白名单 | P0 | 可进入 x-req |
| `log-viewer-shell` | `LayoutLogEntry` / `LogViewerOverlayHost` | 右上按钮、页面级弹出层、主区域保持挂载 | P0 | 可进入 x-req |
| `log-viewer-ui` | `LogViewerOverlay` / `LogViewerStore` / `LogAPI` | 左侧 tab、右侧内容、刷新、空态错误态 | P0 | 可进入 x-req |
| `log-formatters` | `LogFormatter` / `LogContentPane` | JSONL、plain、traceback 格式化展示 | P1 | 可进入 x-req |
| `log-viewer-tests` | pytest + Vitest | API、formatter、overlay 挂载语义测试 | P1 | 可进入 x-req |
| `log-tail-v0.3` | 增量读取 | cursor、自动刷新、滚动保持 | P2 | 留在方案层 |

## 推荐实施顺序

1. `log-reader-api`
2. `log-viewer-shell`
3. `log-viewer-ui`
4. `log-formatters`
5. `log-viewer-tests`

理由：后端 source 与读取边界是日志页的数据契约；前端壳层依赖 source DTO；formatter 可在基础 UI 跑通后独立增强。

## x-req 输入摘要

任务名建议：`full-log-v0.2-log-viewer`

核心需求：

- 在右上“管理”按钮右侧增加“日志”按钮。
- 点击打开页面级弹出层。
- 弹出层不卸载当前主区域。
- 左侧 tab 是日志类型。
- 右侧是格式化日志内容。
- 后端只读、白名单、尾部读取。

验收命令建议：

```bash
uv run pytest tests/unit/test_web_log_registry.py tests/unit/test_web_log_read_service.py tests/unit/test_manage_logs_router.py -q
cd web
npm run test -- LogViewer
npm run build
```

后续进入 x-dev 时按真实 test script 调整命令。
