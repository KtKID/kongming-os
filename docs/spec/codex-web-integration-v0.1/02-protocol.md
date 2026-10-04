# 02 · 协议契约

## 1. WebSocket 入站消息（前端 → 后端）

端点：`ws://host/ws/codex?thread_id=<optional>`

| `type` | 用途 | 字段 | provider 中立 |
|---|---|---|---|
| `codex-command` | 发起 Codex run | `command` `options` | ❌ codex 专属 |
| `abort-session` | 中止指定 session 的当前 run | `sessionId` `provider` | ✅ 既有，复用 |
| `check-session-status` | 重连时查询 session 是否仍在跑 | `sessionId` `provider` | ✅ 既有，复用 |

### 1.1 `codex-command`

```typescript
{
  type: "codex-command",
  command: string,                                    // prompt 文本
  options: {
    cwd?: string,                                     // 工作目录绝对路径
    sessionId?: string,                               // 续话时传，新建留空
    resume?: boolean,                                 // sessionId 存在时是否续话
    model?: string,                                   // --model flag
    permissionMode?: "default" | "acceptEdits" | "bypassPermissions",
                                                      // 默认 "default"
  }
}
```

后端处理：

```python
# 1. 提取 options，调 approval.map_permission_mode 拿到 (sandbox, approval_policy)
# 2. 构造 `codex exec ... --sandbox <sandbox> --config approval_policy="<policy>"`
# 3. resume=True 时在 argv 追加 `resume <sessionId>`
# 4. command 通过 stdin 写入并关闭
# 5. stdout 行喂 normalizer，结果通过 ws.send_json() 推回
```

**与 claude_code 命名差异**：

```python
# llm_protocol.py 新增
class CodexCommand(TypedDict, total=False):
    type: Literal["codex-command"]
    command: str
    options: NotRequired[dict[str, Any]]
```

### 1.2 `abort-session` / `check-session-status`

复用既有 TypedDict：

```python
# llm_protocol.py 既有
class AbortSession(TypedDict, total=False):
    type: Literal["abort-session"]
    sessionId: str
    provider: NotRequired[LLMProvider]    # 传 "codex"
```

`check-session-status` 同款，`provider="codex"`。

---

## 2. WebSocket 出站事件（后端 → 前端）

**类型沿用 `NormalizedMessage`**（`src/web/app_support/llm_protocol.py:57-103`），14 种 `kind` 全复用，**不新增 kind**。

### 2.1 codex jsonl event → NormalizedMessage 映射表

| codex 事件 | item.type | NormalizedMessage.kind | 关键字段映射 |
|---|---|---|---|
| `thread.started` | — | `session_created` | `newSessionId = thread_id` |
| `turn.started` | — | *（不发出，砍）* | — |
| `turn.completed` | — | `complete` | `tokenBudget = usage`，`exitCode = 0` |
| `turn.failed` | — | `error` | `error = error.message` |
| `item.completed` | `agent_message` | `text` | `role = "assistant"`，`content = text` |
| `item.completed` | `reasoning` | `thinking` | `role = "assistant"`，`content = text` |
| `item.started` | `command_execution` | `tool_use` | `toolName = "shell"`，`toolInput = {command}` |
| `item.completed` | `command_execution` | `tool_result` | `content = aggregated_output`，`isError = exit_code != 0` |
| `item.completed` | `file_change` | `tool_use` + `tool_result` | `toolName = "edit"`，`toolInput = changes`，`isError = status != "completed"` |
| `item.completed` | `mcp_tool_call` | `tool_use` + `tool_result` | `toolName = f"{server}/{tool}"`，`toolInput = arguments`，`isError = error != null` |
| `item.completed` | `web_search` | `tool_use` | `toolName = "web_search"`，`toolInput = {query}` |
| `item.completed` | `todo_list` | `status` | `content = items` |
| `item.completed` | `error` | `error` | `error = item.message` |
| `*` (unknown) | — | `error` | `error = "unknown codex event"`，`content = raw_event_dict` |

**stream_delta**：v0.1 codex 不发增量（`item.updated` 在大多数 item 上不出现），全是终态 `item.completed`。前端打字机效果 v0.2 再做。

### 2.2 NormalizedMessage 字段填充规则

每条出站消息都带 base 字段：

```python
{
    "id": str(uuid.uuid4()),
    "sessionId": session_id,                # 当前 session_id
    "timestamp": datetime.now(UTC).isoformat(),
    "provider": "codex",
    "kind": "<上表映射>",
    # ...具体字段按 kind 填
}
```

`provider="codex"` 是关键区分位——前端 ProviderTabs 按此过滤。

### 2.3 INTERNAL_CONTENT_PREFIXES 过滤

codex 也会注入内部块（实测 system_meta / system-reminder 类）。normalizer 在写入 `text` / `thinking` 前 strip 这些前缀（参考 `src/web/integrations/claude_code/normalizer.py:56-65` 同款规则）。

---

## 3. REST 端点

前缀：`/api/codex`，模块 `src/web/routers/codex.py`。

| Method | Path | 用途 | Response |
|---|---|---|---|
| GET | `/api/codex/projects` | 项目列表（按 cwd 分组） | `{ projects: ProjectSummary[] }` |
| GET | `/api/codex/projects/refresh` | 流式扫盘进度（async generator） | SSE / chunked |
| GET | `/api/codex/sessions/{session_id}/history` | 单会话历史回放 | `{ messages: NormalizedMessage[] }` |
| GET | `/api/codex/sessions/{session_id}/metadata` | 单会话元数据（cwd / model / token_count） | `{ metadata: SessionMeta }` |

### 3.1 `ProjectSummary` 结构

```typescript
{
  cwd: string,                          // 项目工作目录绝对路径（rollout session_meta.cwd 真值）
  cwdLabel: string,                     // 末段 basename 给前端显示
  sessions: SessionSummary[],
  lastModified: string,                 // ISO8601
}
```

### 3.2 `SessionSummary` 结构

```typescript
{
  sessionId: string,                    // codex thread_id (UUIDv7)
  threadName: string | null,            // 来自 session_index.jsonl，可能没有
  cwd: string,
  startedAt: string,
  lastModified: string,
  rolloutPath: string,                  // ~/.codex/sessions/<...>/rollout-*.jsonl
  cliVersion: string | null,            // session_meta.cli_version
}
```

### 3.3 `SessionMeta` 结构

```typescript
{
  sessionId: string,
  cwd: string,
  model: string | null,                 // 来自 turn_context.model
  modelProvider: string,                // "openai"
  approvalPolicy: string,               // "untrusted" | "never" | ...
  sandboxPolicy: string,                // 序列化的 sandbox config
  tokenCount: { input: number, cached: number, output: number, reasoning: number } | null,
}
```

---

## 4. thread metadata schema 升级（v3 → v6）

### 4.1 现状（v3）

claude_code v0.2 已经定义了 schema v3（参考 `claude-code-history-resume-v0.2/plan.md`）：

```python
{
    "schema_version": 3,
    "thread_id": str,
    "title": str,
    "created_at": str,
    "updated_at": str,
    "backend_kind": Literal["claude_code", "openai", "anthropic"],   # v0.1.6 加
    "sdk_session_id": str | None,                                   # v0.2 加（claude SDK session）
    "cwd": str | None,                                              # v0.2 加
}
```

### 4.2 当前实现（v6）

```python
{
    "schema_version": 6,
    "id": str,
    "name": str,
    "created_at": float,
    "updated_at": float,
    "backend_kind": Literal["generic_chat", "claude_code", "codex"],
    "claude_thread_id": str,   # Claude 底层可恢复 thread/session id
    "codex_thread_id": str,    # Codex 底层可恢复 thread/session id
    "cwd": str,
    "message_count": int,
    "cumulative_prompt_tokens": int,
    "cumulative_completion_tokens": int,
    "cumulative_total_tokens": int,
}
```

### 4.3 懒升级链

读盘时按 `schema_version` 字段触发升级（参考 memory `claude-code-web-v0.2 schema 懒升级链` 思路）：

```
v3 → v4:
- 补累计 usage 字段

v4 → v5:
- 补 `codex_thread_id=""`

v5 → v6:
- 旧 `sdk_session_id` 改名为 `claude_thread_id`

写盘时统一写成 v6
```

**不写一次性迁移脚本**（user 偏好"开发期不做过度兼容"，但单字段加 None 默认是非破坏性的，懒升级即可）。

### 4.4 invariant

- `id` 表示 Kongming thread id
- `claude_thread_id` / `codex_thread_id` 表示 provider 底层 thread id
- 一个 Kongming thread 绑定一个 provider session/thread
- 写入 `claude_thread_id` / `codex_thread_id` 后再次写入不同值会触发绑定冲突错误

---

## 5. 错误码

| 来源 | NormalizedMessage 表现 | 字段 |
|---|---|---|
| codex 子进程 exit_code != 0 | `kind = "complete"` + `exitCode = <code>` | `exitCode`, `aborted = false` |
| 子进程 SIGTERM (abort) | `kind = "complete"` + `aborted = true` | `aborted = true` |
| stdout jsonl 行 parse 失败 | `kind = "error"` | `error = "jsonl parse failed: ..."` |
| codex stderr 含 "ERROR" | 不发到前端，只记 trace 日志 | — |
| codex 未登录（auth.json 缺失） | service.query() 抛 `CodexNotAuthenticatedError` → 前端 `kind = "error"` | `error = "codex not authenticated; run \`codex login\`"` |
| `codex` 命令不在 PATH | spawn 失败 → `kind = "error"` | `error = "codex CLI not installed; npm i -g @openai/codex"` |
| `approval_policy="untrusted"` 且命中需要审批的命令 | 子进程可能停在无 reviewer 状态，最后被 timeout / abort | 前端看到 `complete + aborted`；用户可改用 acceptEdits 模式 |

---

## 6. 跨 task 共享决策（实施细节）

### 决策 1：`llm_protocol.py` 命名

**实施**：v0.1 仅新增 `CodexCommand` TypedDict，不改 `ClaudeCommand`。

```python
# src/web/app_support/llm_protocol.py 新增
class CodexCommand(TypedDict, total=False):
    type: Literal["codex-command"]
    command: str
    options: NotRequired[dict[str, Any]]


# __all__ 加上
__all__ = [
    "AbortSession",
    "CheckSessionStatus",
    "ClaudeCommand",
    "ClaudePermissionResponse",
    "CodexCommand",            # 新增
    "LLMProvider",
    "MessageKind",
    "NormalizedMessage",
]
```

### 决策 2：`SessionManager` 共享

**实施**：v0.1 顺手 move：

```
src/web/integrations/claude_code/session_manager.py  →  src/web/shared/session_manager.py
src/web/integrations/claude_code/__init__.py          ← 改 import
src/web/integrations/codex/__init__.py                ← 直接 from src.web.shared.session_manager import ...
```

`__shared__/__init__.py` 留空（仅作目录）。**不留 re-export shim**（用户偏好"开发期不做过度兼容"），claude_code 那一处 import 直接改。

### 决策 3：schema v4

**实施**：见 §4。一次升级，旧 v3 数据懒升级到 v4，不写迁移脚本。

---

## 7. 与既有 `llm_protocol.py` 的兼容性

`llm_protocol.py` 在 v0.1 编写时已经预留：

```python
LLMProvider = Literal["claude", "codex", "gemini", "cursor"]
```

**不需要扩 Literal**，`provider="codex"` 已经合法。

```python
MessageKind = Literal[
    "text", "tool_use", "tool_result", "thinking",
    "stream_delta", "stream_end",
    "session_created", "permission_request", "permission_cancelled",
    "complete", "error", "status",
    "interactive_prompt", "task_notification",
]
```

**不需要扩 kind**，14 种已覆盖。codex 实际只用其中 9 种（text / thinking / tool_use / tool_result / session_created / complete / error / status / stream_delta v0.2+），其余 5 种留空。
