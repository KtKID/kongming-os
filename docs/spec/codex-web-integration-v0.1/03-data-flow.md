# 03 · 数据流

## 1. 一次完整的 Codex 对话链路

```mermaid
sequenceDiagram
    autonumber
    participant FE as Frontend (CodexView)
    participant WS as /ws/codex
    participant Route as src/web/integrations/codex/route.py
    participant Svc as src/web/integrations/codex/service.py
    participant Mgr as SessionManager (_shared)
    participant Proc as codex exec --json (subprocess)
    participant FS as ~/.codex/sessions/

    FE->>WS: WebSocket connect (?thread_id=t-001)
    WS->>Route: accept
    FE->>Route: {type: "codex-command", command, options:{cwd, permissionMode:"default"}}
    Route->>Svc: query(session_id, command, cwd, permission_mode, ...)
    Svc->>Mgr: register(session_id, proc_handle)
    Svc->>Proc: spawn ["codex","exec","--json","--skip-git-repo-check","--cd",cwd,"--sandbox","workspace-write","--config","approval_policy=\"untrusted\""]
    Svc->>Proc: stdin command + close
    Note over Proc,FS: codex 启动 + 写新 rollout-*.jsonl

    Proc-->>Svc: stdout: {"type":"thread.started","thread_id":"019dee..."}
    Svc->>Route: NormalizedMessage{kind:"session_created", newSessionId:"019dee...", provider:"codex"}
    Route->>FE: ws.send_json(...)
    Note over FE: thread metadata persisted (schema v6): codex_thread_id="019dee..."

    Proc-->>Svc: stdout: {"type":"turn.started"}
    Note over Svc: 不发出（v0.1 砍）

    loop 多个 item
        Proc-->>Svc: stdout: {"type":"item.completed","item":{"type":"reasoning",...}}
        Svc->>Route: NormalizedMessage{kind:"thinking", content:"..."}
        Route->>FE: ws.send_json
        Proc-->>Svc: stdout: {"type":"item.started","item":{"type":"command_execution",...}}
        Svc->>Route: NormalizedMessage{kind:"tool_use", toolName:"shell", toolInput:{command}}
        Route->>FE: ws.send_json
        Proc-->>Svc: stdout: {"type":"item.completed","item":{"type":"command_execution",...}}
        Svc->>Route: NormalizedMessage{kind:"tool_result", content:output, isError:exit_code!=0}
        Route->>FE: ws.send_json
        Proc-->>Svc: stdout: {"type":"item.completed","item":{"type":"agent_message","text":"..."}}
        Svc->>Route: NormalizedMessage{kind:"text", role:"assistant", content:"..."}
        Route->>FE: ws.send_json
    end

    Proc-->>Svc: stdout: {"type":"turn.completed","usage":{...}}
    Svc->>Route: NormalizedMessage{kind:"complete", tokenBudget:usage, exitCode:0}
    Route->>FE: ws.send_json
    Proc-->>Svc: process exit (code=0)
    Svc->>Mgr: unregister(session_id)
```

## 2. 续话流程

```mermaid
sequenceDiagram
    participant FE as Frontend
    participant Route as route.py
    participant Svc as service.py
    participant Proc as codex exec resume

    FE->>Route: {type:"codex-command", command:"go on", options:{sessionId:"019dee...", resume:true}}
    Route->>Svc: query(session_id="019dee...", resume=True, ...)
    Svc->>Proc: spawn ["codex","exec","--json","--skip-git-repo-check","--cd",cwd,...,"resume","019dee..."]
    Svc->>Proc: stdin "go on" + close
    Note over Proc: codex 读旧 rollout 重建上下文，继续在同一 jsonl 追加
    Proc-->>Svc: stdout 事件流（同 §1 后半段，但 thread.started 不再发出）
```

**关键点**：续话时 `thread.started` 不再发出，前端不应等这个事件——应该用前端已持有的 `sessionId` 即可。

## 3. 历史回放流程（页面刷新 / 跨设备打开）

```mermaid
sequenceDiagram
    participant FE as CodexView
    participant REST as /api/codex/sessions/{sid}/history
    participant Hist as jsonl_history.py
    participant FS as ~/.codex/sessions/.../rollout-*.jsonl
    participant WS as /ws/codex

    FE->>REST: GET /api/codex/sessions/019dee.../history
    REST->>Hist: parse_jsonl_history(rollout_path, session_id)
    Hist->>FS: aiofiles.open + line-by-line
    loop 每行
        Hist->>Hist: json.loads
        alt type == "session_meta"
            Note over Hist: skip（projects_scanner 已用过）
        else type == "turn_context"
            Note over Hist: 提取 metadata（可选）
        else type == "event_msg"
            Hist->>Hist: normalizer.normalize(payload, session_id)
        else type == "response_item"
            Note over Hist: skip（不参与回放）
        end
    end
    Hist-->>REST: list[NormalizedMessage]
    REST-->>FE: { messages: [...] }
    FE->>FE: 渲染历史
    FE->>WS: 建立 ws，准备接力新消息
```

**实测数据规模**：1 turn ≈ 77 KB rollout（约 50 行 jsonl）。10 turn 会话 ≈ 770 KB。流式逐行处理，**不一次性 read 全文**（实测有 16 MB 单文件 rollout）。

## 4. 项目浏览流程

```mermaid
sequenceDiagram
    participant FE as CodexProjectList
    participant REST as /api/codex/projects
    participant PS as projects_scanner.py
    participant IDX as ~/.codex/session_index.jsonl
    participant FS as ~/.codex/sessions/<Y>/<M>/<D>/

    FE->>REST: GET /api/codex/projects
    REST->>PS: list_projects()
    PS->>IDX: 读 session_index.jsonl 全部行
    PS->>PS: 解析 {id, thread_name, updated_at}
    PS->>FS: 兜底扫盘（覆盖 session_index 没收录的最近会话）
    loop 每个 rollout
        PS->>FS: open + read 第一行
        PS->>PS: parse session_meta.payload → {id, cwd, originator, started_at}
    end
    PS->>PS: 按 cwd 分组聚合 → ProjectSummary[]
    PS-->>REST: 返回
    REST-->>FE: { projects: [...] }
```

**性能**：ccui 实测 100+ rollout 文件扫盘约 200ms，可接受。可选优化：异步扫 + 给前端流式进度（`/api/codex/projects/refresh`）。

## 5. abort 流程

```mermaid
sequenceDiagram
    participant FE as Frontend
    participant Route as route.py
    participant Mgr as SessionManager
    participant Svc as service.py
    participant Proc as codex subprocess

    FE->>Route: {type:"abort-session", sessionId:"019dee...", provider:"codex"}
    Route->>Mgr: get(session_id) → proc_handle
    Mgr-->>Route: ok
    Route->>Svc: abort(session_id)
    Svc->>Proc: SIGTERM
    Note over Svc: 等 2s
    alt proc 仍存活
        Svc->>Proc: SIGKILL
    end
    Svc->>Mgr: unregister(session_id)
    Svc->>Route: NormalizedMessage{kind:"complete", aborted:true}
    Route->>FE: ws.send_json
```

**注意**：codex 子进程被 kill 后，rollout jsonl 是**不完整的**（最后 turn 没有 turn.completed）。下次 resume 时 codex 自己会处理这种 partial 状态（实测：codex resume 能从未完成 turn 续起）。我们后端不需要额外清理。

## 6. 异常路径汇总

| 场景 | 触发 | 行为 |
|---|---|---|
| codex CLI 未安装 | spawn 时 FileNotFoundError | 立刻发 `kind:error` "codex CLI not installed" |
| codex 未登录 | stderr "Not authenticated" | 立刻发 `kind:error` "run `codex login`"，子进程会 exit non-zero |
| stdout 行 parse 失败 | json.loads 抛 | 单行 skip + trace log + 发 `kind:error` 含 raw line |
| 子进程 hang（如 untrusted 卡审批） | 默认无 timeout | route 层提供 abort 按钮；可选 v0.2 加 5min 超时 |
| 网络问题 / API 限流 | codex 内部已处理（错误事件 `item.completed (error)`） | normalizer 转 `kind:error` |
| stderr 噪音（mcp 错误 / skill 加载错） | codex_core 日志 | 全部 trace 落盘，不上前端 |
| ws 断连 | route 层 finally 触发 | session 标记为 disconnected；codex 子进程**不杀**（继续在后台跑写 rollout）；用户重连时 check-session-status 重接 |

## 7. 与桌面端的并发安全

**红线再强调**：用户**正在用桌面端**。web 后端跑 codex 子进程时：

- ✅ 各自创建新 rollout 文件（thread_id 不冲突，UUIDv7 + ISO timestamp）
- ✅ 各自写 `session_index.jsonl`（codex 内部应有锁——未实测，但桌面端长期稳定使用证明可并发）
- ✅ 共用 `auth.json`（只读）
- ❌ web 后端**不主动写**任何既有文件（包括索引）

**冲突场景**：用户在桌面端 resume session A，**同时**前端也对 session A 发 codex-command。两个 codex 子进程同时写同一份 rollout-*.jsonl —— **有数据竞争风险**。

**v0.1 处置**：route 层在 query 前查 SessionManager，如该 session_id 已被 web 这边占用，**拒绝**新请求；但**不感知桌面端占用**（codex 不暴露 lockfile 给我们），所以这个冲突我们抓不住。

**v0.1 文档警告**：前端 UI 在 session card 上提示"该 session 可能正被桌面端使用，建议另开新 session"。

**v0.2+ 升级**：探索 codex 是否提供 session lock API。
