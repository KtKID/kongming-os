# 验证与演进

## 后端测试

新增 pytest：

| 文件 | 覆盖 |
|---|---|
| `tests/unit/test_web_log_registry.py` | source 列表、路径解析、白名单拒绝、文件缺失元数据 |
| `tests/unit/test_web_log_read_service.py` | 尾部读取、max_bytes 截断、tail_lines 限制、JSONL 容错 |
| `tests/unit/test_manage_logs_router.py` | `/api/manage/logs/sources` 与 `/read` 响应模型 |

重点断言：

- registry 之外的 `type` 返回 400。
- 解析后的路径越界返回 403 或内部安全错误。
- 文件缺失返回 200 + `exists=false`。
- 大文件只读取尾部窗口，`truncated=true`。
- JSONL 单行错误不会让整个响应失败。

## 前端测试

新增 Vitest / Testing Library：

| 文件 | 覆盖 |
|---|---|
| `web/src/modules/logs/__tests__/formatter.test.ts` | JSONL、plain、traceback、parse_error 格式化 |
| `web/src/modules/logs/__tests__/LogViewerOverlay.test.tsx` | source tab、内容区、空态、错误态、刷新 |
| `web/src/components/__tests__/LayoutLogViewer.test.tsx` | 日志按钮在管理按钮右侧，打开后 Outlet 子内容仍存在 |

重点断言：

- 点击“日志”后当前页面文本仍在 DOM 中。
- 切换 tab 调用对应 `log_type`。
- JSONL pretty block 可展开。
- 长行不撑破布局。

## 手工验证

1. 启动 web server。
2. 打开聊天页，输入未发送内容。
3. 点击右上角“日志”按钮。
4. 确认输入框内容仍保留。
5. 选择 `Web Server`、`Trace`、`Full Log`。
6. 确认缺失日志展示空态。
7. 刷新日志，确认内容更新且页面无跳转。

## 性能边界

- 单次响应默认限制 512 KiB。
- 前端最多渲染 500 行，超过行数通过 `tail_lines` 控制。
- 渲染区使用虚拟列表作为 v0.3 选项；首版靠尾部行数限制控制成本。
- JSON pretty 展开默认关闭，避免大量对象初始渲染。

## 安全边界

- 所有日志读取走鉴权后的 `/api/manage/logs/*`。
- 前端不传 path。
- 后端不返回未登记路径的内容。
- 错误响应不包含完整服务器 traceback。
- `full_log` 仍遵守 v0.1 的 body 策略，默认不展示 HTTP body。

## 演进路线

| 版本 | 内容 |
|---|---|
| v0.2 | 只读尾部查看、手动刷新、类型 tab、格式化 |
| v0.3 | 增量 tail、自动刷新、保持滚动到底部 |
| v0.4 | 轻量过滤、高亮、按 thread_id/run_id 快速筛选 |
| v0.5 | 下载、复制上下文、跳转关联 trace/full_log |

当前建议进入 x-req，首个任务锁定 v0.2。
