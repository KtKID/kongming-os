# Full Log v0.1 — 前后端通信全量日志

把所有前后端通信消息（WS 双向 + REST）以**组装后的最终格式**写到 `.kongming/logs/full_log.jsonl`（跟 `trace.jsonl` 同 `.kongming/` home），用于离线分析、bug 回溯、链路审计。

## 1. 目的与边界

- **写什么**：3 条 WS 通道的 C2S/S2C 帧 + 所有 REST 请求/响应元数据
- **不写什么**：trace.jsonl 里已有的 LLM 内部事件（避免重复，那份是 core 层的事件流真源，full_log 是 web 层的通信流真源）
- **何时启用**：默认关闭，`KONGMING_FULL_LOG=1` 或 `cfg.web.full_log.enabled=true` 打开
- **是否影响生产**：异步 queue + 后台 writer task，对 event loop 零阻塞；关闭时所有调用走 no-op 分支

## 2. 落盘格式

**路径**：`.kongming/logs/full_log.jsonl`（相对 cwd，可通过 `KONGMING_FULL_LOG_PATH` 覆盖）

**格式**：JSONL，每行一条记录：

```json
{
  "ts": "2026-05-26T22:33:21.123+08:00",
  "dir": "s2c",
  "channel": "ws.threads",
  "thread_id": "thr_abc123",
  "client_id": "ws_conn_42",
  "payload": { /* frame.model_dump() 完整 */ }
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `ts` | str | ISO8601 + UTC+8 固定偏移，毫秒精度 |
| `dir` | str | `c2s` / `s2c` / `http_req` / `http_resp` |
| `channel` | str | `ws.threads` / `ws.cron` / `ws.thread_status` / `rest` |
| `thread_id` | str? | WS 主通道时填，其他通道 null |
| `client_id` | str? | WS 连接唯一 ID，跨帧关联同一连接 |
| `payload` | object | **组装后的最终 frame.model_dump()** 或 REST {method,path,status,latency_ms,body_size} |

**时间戳实现**（按 CLAUDE.md UTC+8 固定偏移规则）：

```python
from datetime import datetime, timezone, timedelta
CN_TZ = timezone(timedelta(hours=8))
ts = datetime.now(CN_TZ).isoformat(timespec="milliseconds")
```

## 3. 消息清单

### 3.1 WS 主通道 `/ws/threads/{thread_id}`

承载主对话流：Native runtime + Claude Code SDK + Codex SDK 三类后端共享同一套帧协议。

#### C2S（浏览器 → 后端，4 种）

| frame_type | 作用 | 触发时机 |
|---|---|---|
| `user.input` | 用户提交一条消息（含 attachments） | 用户在输入框回车 |
| `approval.ack` | 用户对一条审批请求作出 allow/deny 决定 | 审批弹窗点击按钮 |
| `interrupt` | 中断当前正在运行的 turn | 用户点"停止"按钮 |
| `ping` | 心跳保活 | 前端定时器（默认 25s） |

#### S2C（后端 → 浏览器，15 种）

| frame_type | 作用 | 何时触发 |
|---|---|---|
| `turn.start` | 一个 turn 开始（assistant 即将说话） | LLM 调用前 |
| `turn.end` | turn 结束（含 finish_reason） | LLM 调用完成 |
| `content.delta` | 文本流式增量 | LLM 流式输出每个 chunk |
| `reasoning.delta` | 思考内容流式增量（reasoning model） | LLM 思考流 |
| `tool.call.start` | 一次工具调用开始（含 args） | runner 执行 tool 前 |
| `tool.call.end` | 一次工具调用结束（含 result / error） | runner 执行 tool 后 |
| `approval.request` | 后端发起审批请求（需用户决策） | SafetyGatedApproval 触发 Consent |
| `approval.decision` | 审批最终决策结果（含 auto-approve / 用户决策） | 决策完成后 |
| `assistant.final` | assistant 完整消息组装完成 | turn 结束后回灌历史 |
| `usage` | token 使用统计（input/output/cache） | turn 结束后 |
| `error` | 后端错误（LLM 调用失败 / tool 异常） | catch 到 exception 时 |
| `system.notice` | 系统通知（CLI 重启 / 中断结果 / 评论） | 状态变化 |
| `thread.history` | 新连接 / 切换 thread 时下发完整历史 | WS 建连或客户端请求 |
| `pong` | 心跳响应 | 收到 ping |
| `run.interrupted` | 中断流程已生效的回执 | interrupt 处理完成后 |
| `cell.evicted` | 历史 cell 被淘汰（容量管理） | thread 容量超限时 |

#### 转发自 SDK 的命令帧（5 种，仅 claude-code/codex 后端使用）

定义在 `src/web/app_support/llm_protocol.py`，是 SDK 进程内的事件经 normalizer 转出后的协议层封装。

| frame_type | 方向 | 作用 |
|---|---|---|
| `claude-command` | S2C | Claude SDK 输出的指令事件（含 tool_use / permission） |
| `codex-command` | S2C | Codex SDK 输出的指令事件 |
| `claude-permission-response` | C2S | 前端对 Claude SDK 权限请求的回应 |
| `abort-session` | C2S | 主动终止当前 SDK 会话 |
| `check-session-status` | C2S | 查询 SDK 会话状态 |
| `stream_status` | S2C | SDK 流的状态归一化（running/idle/error） |

### 3.2 WS Cron 通道 `/ws/cron`

定时任务跨 tab 推送通道。

| frame_type | 方向 | 作用 |
|---|---|---|
| `cron.run.completed` | S2C | 一次 cron 任务执行完成（含 run_id / status / thread_id） |
| `cron.message.appended` | S2C | cron 触发后向目标 thread 追加了一条消息 |

### 3.3 WS Thread-Status 通道 `/ws/thread-status`

线程生命周期跨 tab 同步通道（用于 inbox / 多 tab 状态一致性）。

| frame_type | 方向 | 作用 |
|---|---|---|
| `thread-status` | S2C | 某个 thread 的状态变化（idle/running/awaiting_approval/cancelled） |
| `stream_status` | S2C | SDK 流状态广播（与主通道同名但语义独立） |
| `ping` | C2S | 心跳保活 |
| `approval.inbox.resolve` | C2S | 前端通知后端某条审批已在另一 tab 解决（去重） |

### 3.4 REST 端点分组

只记录元数据 `{method, path, status, latency_ms, body_size, content_type}`，**不记录 body**（避免日志爆炸 + 安全风险）。如需 body 走 trace。

| 分组 | 路径前缀 | 主要端点 | 作用 |
|---|---|---|---|
| 认证 | `/api/auth/*` | login, logout, me, reset-password | session cookie 鉴权 |
| 线程 | `/api/threads/*` | CRUD, history, usage, workspace-{git,shell}, evolution/reviews | thread 元数据 + 历史 + 工作区状态 |
| 定时任务 | `/api/cron/*` | tasks/*, runs, pause, resume, run_now | cron task 管理 |
| 客户端配置 | `/api/config/client` | GET | 前端启动配置（心跳间隔、feature flags） |
| 健康探活 | `/api/health` | GET | 重启检测 |
| Claude SDK | `/api/claude/projects` | GET | Claude SDK session 浏览 |
| Codex SDK | `/api/codex/*` | projects, sessions/{id}/history, metadata | Codex SDK session 浏览 |
| 上传 | `/api/uploads/*` | images, {asset_id} | 媒体附件 |
| 司天 | `/api/sitian/report` | GET | 工作区观察者报告 |
| 白板 | `/api/threads/{id}/whiteboard/*` | 卡片 CRUD | 白板模块 |

## 4. 实现位置

### 4.1 新增模块

- **`src/devtools/full_logger.py`**：`FullLogger` Manager（单例 + asyncio.Queue + 后台 writer task）
  - `async log(dir, channel, payload, *, thread_id=None, client_id=None)`：入队列，永不阻塞调用方
  - 启动时 lazy-init writer task；进程退出时 flush queue
  - 文件按天滚动：`full_log.jsonl` / `full_log.2026-05-25.jsonl`
- **`src/web/middleware/full_log_http.py`**：FastAPI middleware，抓 method/path/status/latency_ms

### 4.2 接入点（5 处，每处 1 行）

| 文件 | 位置 | 改动 |
|---|---|---|
| `src/web/ws.py` | 抽 `_send_frame(ws, payload, ctx)` 内部函数，5 处 send_json 改用它 | 集中加 logger.log |
| `src/web/ws.py:214` | `_dispatch_frame` 调用前 | logger.log(c2s) |
| `src/web/cron_ws.py:_send_one` | 函数内首行 | logger.log(s2c) |
| `src/web/thread_status_ws.py:_send_one` | 函数内首行 | logger.log(s2c) |
| `src/web/thread_status_ws.py:284` recv loop | dispatch 前 | logger.log(c2s) |
| `src/web/app.py:527` | middleware 注册 | `app.add_middleware(FullLogHTTPMiddleware)` |

### 4.3 配置

`src/config_loader/config.py` 新增 `WebFullLogConfig`：

```python
class WebFullLogConfig(BaseModel):
    enabled: bool = False
    path: str = ".kongming/logs/full_log.jsonl"  # 跟 trace.jsonl / evolution.log 同 home
    rotate_daily: bool = True
    include_http_body: bool = False  # 严禁开
    queue_size: int = 10000          # 满则丢最旧 + 警告；ge=100, le=1_000_000
```

Env 覆盖：`KONGMING_WEB_FULL_LOG_ENABLED=1` / `KONGMING_WEB_FULL_LOG_PATH=/abs/or/relative.jsonl`

## 5. 筛选用法（jq 示例）

```bash
# 只看主通道 S2C 的工具调用
tail -F .kongming/logs/full_log.jsonl | jq 'select(.channel=="ws.threads" and (.payload.frame_type|startswith("tool.")))'

# 只看某个 thread 的所有消息
tail -F .kongming/logs/full_log.jsonl | jq 'select(.thread_id=="thr_abc123")'

# 看所有审批往返
tail -F .kongming/logs/full_log.jsonl | jq 'select(.payload.frame_type|test("approval"))'

# REST 慢请求
tail -F .kongming/logs/full_log.jsonl | jq 'select(.dir=="http_resp" and .payload.latency_ms>500)'

# C2S 用户操作时间线
tail -F .kongming/logs/full_log.jsonl | jq 'select(.dir=="c2s") | "\(.ts) \(.payload.frame_type)"' -r
```

## 6. 不做的事（避免过度设计）

- ❌ 不做 TUI / Web 面板：JSONL + jq 已够用，需要时再做
- ❌ 不抓 HTTP body：太大 + 安全风险（密码 / token 都会进文件）
- ❌ 不抓 trace.jsonl 已有的 LLM 内部事件：那份是真源，full_log 只补 web 层
- ❌ 不做内存 ring buffer：磁盘文件天然有序 + 可回溯，内存方案重复造轮子
- ❌ 不做加密 / 脱敏：本地工具，开关默认关闭，需要分享日志时由用户手动 sed

## 7. 后续扩展（v0.2+）

- 按 thread_id 自动分文件：`log/threads/<thread_id>.jsonl`
- 接入 `make full-log-watch` 简易过滤命令
- 跨 trace.jsonl 时间戳关联（通过 thread_id + ts 窗口 join）
