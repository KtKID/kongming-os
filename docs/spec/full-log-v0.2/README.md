# Full Log v0.2 - Web 日志查看器与多日志入口

> 状态：方案确认  
> 上一版：[`docs/full-log-v0.1/README.md`](../full-log-v0.1/README.md)  
> 目标 task：`full-log-v0.2-log-viewer`

## Spec 目标

在右上角“管理”按钮右侧增加“日志”按钮，打开一个页面级弹出层。弹出层保留当前主区域的 React 挂载状态，左侧展示日志类型 tab，右侧格式化展示日志内容，用于开发期排查 Web 服务、全量通信、trace、网络心跳、审批审计、定时任务和 evolution 链路。

## 最小可用路径

用户点击右上角“日志”按钮，`Layout` 打开 `LogViewerOverlay`，后端返回日志类型列表与尾部内容，前端按日志类型解析 JSONL / plain text / traceback，并在右侧按时间、级别、字段和原文格式化展示。

## 文档导航

| 文档 | 内容 |
|---|---|
| [01-goals-and-boundaries.md](./01-goals-and-boundaries.md) | 目标、边界、DoD |
| [02-module-breakdown.md](./02-module-breakdown.md) | 前端、后端、日志 registry、formatter 拆分 |
| [03-core-workflows.md](./03-core-workflows.md) | 打开弹层、切换日志、读取尾部、刷新与过滤流程 |
| [04-data-and-state.md](./04-data-and-state.md) | DTO、前端状态、日志游标、格式化模型 |
| [05-validation-and-evolution.md](./05-validation-and-evolution.md) | 测试策略、性能边界、演进路线 |
| [90-task-map.md](./90-task-map.md) | task 拆分与实施顺序 |
| [architecture.html](./architecture.html) | 模块依赖图 |

## 设计结论

日志入口放在全局 `Layout` 层，与 `SchedulerDrawerHost`、`SitianReportDialog` 同级挂载。打开方式使用本地状态或 URL search 参数，主 `Outlet` 持续挂载，聊天页、管理页和其他当前页面保持原状态。

日志读取 API 挂在 `/api/manage/logs/*`，复用现有鉴权与管理 router。后端维护白名单日志 registry，只允许读取 `.kongming/`、配置指定 trace/full_log 路径和项目内 web server log，前端只能传 `log_type`。

首批日志类型：

| 类型 | 默认路径 | 格式 |
|---|---|---|
| `web_server` | `.kongming/web/server.log` | plain text + Python logging |
| `full_log` | `cfg.web.full_log.path` | JSONL |
| `trace` | `cfg.trace.output_path` | JSONL |
| `heartbeat` | `.kongming/logs/heartbeat/heartbeat.log` | plain text |
| `evolution` | `.kongming/logs/evolution.log` | plain text |
| `cron_audit` | `.kongming/cron/audits.jsonl` | JSONL |
| `auto_approval_audit` | `.kongming/auto_approval/audit.jsonl` 或 registry 实测路径 | JSONL |

当前 spec 可直接进入 x-req。建议先做“只读尾部查看 + 手动刷新 + 类型 tab + 格式化渲染”，搜索、高亮、实时 tail 作为后续增强。
