# 01 · 模块架构

## 总览

```
src/web/integrations/codex/                   ← 新增包（与 src/web/integrations/claude_code/ 平级）
├── __init__.py                  ← 公共入口：router + 复用 SessionManager
├── service.py                   ← spawn codex exec --json + jsonl 行 reader + abort
├── normalizer.py                ← codex jsonl event → NormalizedMessage（14 种 kind）
├── approval.py                  ← permissionMode → {sandbox, approval-policy} 转换
├── projects_scanner.py          ← 扫 ~/.codex/sessions/ + 复用 session_index.jsonl
├── jsonl_history.py             ← 解析 rollout jsonl 还原 NormalizedMessage[]
└── route.py                     ← /ws/codex WebSocket + REST 路由分发

src/web/app_support/llm_protocol.py          ← 既有，扩展（v0.1 已预留 codex provider）
src/web/routers/codex.py         ← 新增 REST 路由（/api/codex/projects 等）
src/web/app.py                   ← 既有，注册新路由

web/src/components/CodexView.tsx ← 新增前端组件（与 ClaudeCodeView 平级）
web/src/components/ProviderTabs.tsx ← 新增 provider 切换器
```

## 与现有抽象的复用关系

| 抽象 | 来源 | 复用方式 | 备注 |
|---|---|---|---|
| `SessionManager` | `src/web/integrations/claude_code/session_manager.py` | **直接复用**，move 到 `src/web/shared/session_manager.py`（v0.1 顺手做） | 进程级会话表，与 provider 无关 |
| `NormalizedMessage` | `src/web/app_support/llm_protocol.py` | **直接复用**，14 种 kind 不动 | provider 字段已枚举 codex |
| `AbortSession` / `CheckSessionStatus` | `src/web/app_support/llm_protocol.py` | **直接复用**，已 provider 中立 | 含 `NotRequired[LLMProvider]` |
| `ClaudeCommand` / `ClaudePermissionResponse` | `src/web/app_support/llm_protocol.py` | **不复用**，新增 `CodexCommand` | 命名不通用；具体决策见下文 [跨 task 决策](#跨-task-决策) |
| 前端 NormalizedMessage 渲染层 | `web/src/components/MessageList.tsx` | **直接复用** | 14 种 kind 通用渲染 |
| 前端 PermissionDialog | `web/src/components/PermissionDialog.tsx` | **不复用**，v0.1 codex 无 per-call 审批 UI | 替代品：三档 dropdown（CodexPermissionMode.tsx） |

## 模块详情

### service

**职责**：spawn `codex exec --json` 子进程、读 stdout jsonl 行、abort。

**核心 API**（参考 `src/web/integrations/claude_code/service.py:131` 的 `query()`）：

```python
async def query(
    self,
    *,
    session_id: str,
    command: str,
    cwd: str,
    permission_mode: Literal["default", "acceptEdits", "bypassPermissions"] = "default",
    model: str | None = None,
    resume: bool = False,
    writer: WebSocketWriter,
) -> None:
    """
    spawn codex 子进程并把事件流回 writer.

    - resume=True 时调用 `codex exec ... resume <session_id>`，否则 `codex exec`
    - permission_mode 通过 approval.py 转成 `--sandbox` + `--config approval_policy=...`
    - stdin 写 prompt 后关闭，避免 codex 等待额外输入
    - stdout 按行读，每行交给 normalizer
    - abort 路径：保存 process 引用到 SessionManager，外部 abort 时 SIGTERM 后 SIGKILL
    """
```

**子进程参数构造**：

```python
args = [
    "codex", "exec", "--json",
    "--skip-git-repo-check",
    "--cd", cwd,
    "--sandbox", sandbox_mode,                    # 来自 approval.py
    "--config", f'approval_policy="{approval_policy}"',
]
if model:
    args += ["--model", model]
if resume:
    args += ["resume", session_id]
if image_args:
    args += image_args
stdin_text = command
```

**关键约束**：

- stdin 必须写入 prompt 后关闭（`stdin=PIPE -> write -> close`），否则 codex 会把 stdin 视作额外输入源
- stdout 按行读 + `json.loads`，**unknown type 走 raw_dump 不抛错**（schema 演进容忍）
- stderr 单独记日志（含 `Reading additional input from stdin...` / mcp 错误等噪音，不影响主流程）
- 子进程退出后 `await proc.wait()` 收 exit_code，转 `complete` 事件

**状态**：方案确认，可进 task。

---

### normalizer

**职责**：codex jsonl event → `NormalizedMessage` 字典。

**事件映射表**（详细映射见 `02-protocol.md`，本节列骨架）：

```python
def normalize(event: dict, session_id: str) -> list[NormalizedMessage]:
    """
    输入：单行 jsonl 解析后的 dict
    输出：0..N 个 NormalizedMessage（一个 codex 事件可能对应多条出站消息）

    核心分发：
    - thread.started     → session_created
    - turn.started       → 不发出（v0.1 砍）
    - turn.completed     → complete + tokenBudget（含 usage）
    - turn.failed        → error
    - item.completed (agent_message)     → text
    - item.completed (reasoning)         → thinking
    - item.{started,completed} (command_execution) → tool_use + tool_result
    - item.completed (file_change)       → tool_use + tool_result（diff）
    - item.completed (mcp_tool_call)     → tool_use + tool_result
    - item.completed (web_search)        → tool_use
    - item.completed (todo_list)         → status (kind="status")
    - item.completed (error)             → error
    - 未知 type                          → raw_dump（kind="error" + raw 字段）
    """
```

**两套输入源同一套 normalizer**：

- 实时 stream：`service.py` 喂 stdout 行
- 历史回放：`jsonl_history.py` 解析 rollout 文件后，**只挑 `event_msg.payload`**（与 stdout 同源）喂入 normalizer

**INTERNAL_CONTENT_PREFIXES 过滤**（参考 `src/web/integrations/claude_code/normalizer.py:56-65`）：codex 也会注入 `<system-reminder>` / `<environment_details>` 等内部块，按 claude_code 同款规则剥离。

**状态**：方案确认，可进 task。

---

### approval

**职责**：permissionMode → codex CLI flag 转换。**v0.1 不做 per-call 审批桥接**。

**核心函数**（直接抄 ccui `openai-codex.js:168-187`）：

```python
def map_permission_mode(mode: Literal["default", "acceptEdits", "bypassPermissions"]) -> tuple[str, str]:
    """返回 (sandbox_mode, approval_policy) 二元组。"""
    if mode == "acceptEdits":
        return ("workspace-write", "never")
    if mode == "bypassPermissions":
        return ("danger-full-access", "never")
    # default
    return ("workspace-write", "untrusted")
```

**为什么没有 ApprovalBridge**：codex `exec --json` 模式下没有 per-call 审批事件流出（实测：`untrusted` policy + curl 命令直接被沙箱拒绝/卡住，stdout 没有任何 approval_request 类事件）。桌面端弹窗是 `app-server` 双向通道特性，不在本方案范围内。

**v0.2+ 升级路径**（不在本 spec）：若官方暴露 jsonl approval 事件，再加一个 `ApprovalBridge` 同 claude_code 那套（参考 `src/web/integrations/claude_code/approval.py:229`）。

**状态**：方案确认，可进 task。

---

### projects_scanner

**职责**：列出 codex 历史会话，供前端项目浏览面板使用。

**两条数据源**：

1. **`~/.codex/session_index.jsonl`**（OpenAI 维护索引，每行 `{id, thread_name, updated_at}`）—— 优先源，**有写入延迟**（实测刚跑完的会话 30s 后还没进索引），所以是兜底前的快通道
2. **`~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-*.jsonl`** —— 兜底扫盘，从 rollout 文件名 + 第一行 `session_meta` 推 `{id, cwd, originator, started_at}`

**核心 API**（参考 `src/web/integrations/claude_code/projects_scanner.py:77-80`）：

```python
async def list_projects(home: Path = Path.home() / ".codex") -> list[ProjectSummary]:
    """
    输出：按 cwd 分组的项目摘要列表，每项含 sessions: list[SessionSummary]
    """

async def list_sessions_in_project(cwd: str, home: Path) -> list[SessionSummary]:
    """单项目下的会话列表，按 last_modified 倒序"""
```

**cwd 真值反推**：直接读 rollout 第一行 `session_meta.payload.cwd` —— 比 claude_code 那边目录名编码反推可靠得多（参考 memory `feedback_sdk_cwd_encoding.md`）。

**红线**：纯只读，不写 `session_index.jsonl` 任何字段。

**状态**：方案确认，可进 task。

---

### jsonl_history

**职责**：解析 rollout jsonl，还原成可回放的 `NormalizedMessage[]`。

**解析策略**：

```python
async def parse_jsonl_history(path: Path, session_id: str) -> list[NormalizedMessage]:
    """
    遍历 rollout-*.jsonl 每一行：
    - session_meta:    跳过（前端已通过 projects_scanner 拿过）
    - turn_context:    提取 model / approval_policy 写入第一条 NormalizedMessage 的 metadata（可选）
    - event_msg:       payload.type 走 normalizer.normalize() 同款路径
    - response_item:   跳过（OpenAI Responses 内部状态，回放不需要）
    """
```

**流式读取**：rollout 单文件可能大于 16MB（实测有 16760579 字节的）。用 `aiofiles` 按行读，**不一次性加载**。

**性能**：claude_code v0.2 的 `jsonl_history.py` 已有现成实现（289 行），照搬骨架即可。

**状态**：方案确认，可进 task。

---

### route

**职责**：`/ws/codex` WebSocket 端点 + 4 类入站消息分发 + REST 端点注册。

**入站消息分发**（参考 `src/web/integrations/claude_code/route.py:160-227`）：

```python
@router.websocket("/ws/codex")
async def codex_websocket(ws: WebSocket, thread_id: str | None = None):
    await ws.accept()
    while True:
        msg = await ws.receive_json()
        match msg.get("type"):
            case "codex-command":
                await service.query(...)
            case "abort-session":
                await session_manager.abort(msg["sessionId"])
            case "check-session-status":
                ...  # 同 claude_code，复用
            case _:
                await ws.send_json({"kind": "error", "error": f"unknown type {msg.get('type')}"})
```

**REST 端点**（在 `src/web/routers/codex.py`，前缀 `/api/codex`）：

- `GET /api/codex/projects` — 项目列表
- `GET /api/codex/projects/refresh` — 流式扫盘进度（与 claude 端点同款）
- `GET /api/codex/sessions/{session_id}/history` — 单会话回放

**状态**：方案确认，可进 task。

---

### frontend（workspace-centric，参考 ccui 统一项目列表）

**职责**：前端 React 组件。**不用 ProviderTabs 切 tab**，改为统一项目列表（同一 workspace 下混显 claude + codex session）。

**核心模型**（对齐 ccui `server/projects.js:383-510`）：
- 项目列表拉两个 REST 源（`/api/claude/projects` + `/api/codex/projects`）按 cwd 归一合并（Union，不是交集——只有 codex 没有 claude 的 cwd 也要显示）
- 每个 session 对象自带 `provider` 字段（claude / codex），前端用 icon/badge 区分
- 新建 thread 时弹 provider 选择器（"用 Claude 还是 Codex？"）
- thread 内部 ws 根据 `provider` 连不同端点（`/ws/claude-code` 或 `/ws/codex`）

**组件清单**：

| 组件 | 路径 | 职责 |
|---|---|---|
| `UnifiedProjectList` | `web/src/components/UnifiedProjectList.tsx` | 统一项目列表（拉两源合并，按 cwd 归一） |
| `ProviderBadge` | `web/src/components/ProviderBadge.tsx` | session 卡片左上角 provider badge（Claude 蓝 / Codex 绿） |
| `ProviderSelector` | `web/src/components/ProviderSelector.tsx` | 新建 thread 时选 provider |
| `CodexPermissionMode` | `web/src/components/CodexPermissionMode.tsx` | 三档 dropdown（仅 Codex thread 显示） |
| `ChatView` 改造 | `web/src/components/ChatView.tsx`（既有） | 根据 thread.provider 连不同 ws + 显示不同 sidebar 控件（Claude 审批按钮 / Codex permission dropdown） |

**WebSocket 连接**：ChatView mount 时根据 `thread.metadata.provider` 决定连 `/ws/claude-code` 还是 `/ws/codex`。

**消息渲染**：直接喂给现有 `MessageList`（14 种 kind 通用渲染），不需要 codex 专属渲染分支。

**状态**：方案确认（已从 ProviderTabs 改为 workspace-centric），可进 task。

---

## 跨 task 决策

### 决策 1：`llm_protocol.py` 入站命令命名

**问题**：`ClaudeCommand` / `ClaudePermissionResponse` 两个 TypedDict 是 Claude 命名。codex 接入要不要：
- A. 新增 `CodexCommand` 平级
- B. 把 `ClaudeCommand` 改成 `ClaudeCodeCommand`，新增 `CodexCommand`，同时把现有 claude_code 代码用 sed 改名
- C. 抽 `AgentCommand` 共享基类，用 `type` 字段（`claude-command` / `codex-command`）区分

**推荐 A**：新增 `CodexCommand`，`ClaudeCommand` 暂不改名（CLAUDE.md 第 12 条"开发期不做过度兼容"反过来用——不动既有代码就是不引入兼容负担；将来 v0.2 再统一）。type 字段用 `codex-command` / `claude-permission-response` 自然区分。

### 决策 2：`SessionManager` 的位置

**问题**：现在 `SessionManager` 在 `src/web/integrations/claude_code/session_manager.py`，但实际是 provider 中立的（registry / abort / status）。codex 也要用。

**推荐**：v0.1 顺手 move 到 `src/web/shared/session_manager.py`，原位置留 re-export（这是唯一允许的"过度兼容"，因为是单文件迁移）。改动一个 import 路径，影响面小。

### 决策 3：thread metadata schema 升级

**问题**：thread metadata 需要同时表达 Kongming thread 和 provider 底层 thread。

**推荐**：当前实现收敛到 `backend_kind + claude_thread_id + codex_thread_id + cwd`。
- `claude_thread_id: str` 表示 Claude 底层 thread/session id
- `codex_thread_id: str` 表示 Codex 底层 thread id

读盘时沿用链式懒升级，最终写回 schema v6。具体格式见 `02-protocol.md#metadata`。

## 模块状态表

| 模块 | 行数预估 | 状态 | 依赖 |
|---|---|---|---|
| service | ~250 | 方案确认 | normalizer / approval / SessionManager |
| normalizer | ~280 | 方案确认 | llm_protocol |
| approval | ~50 | 方案确认 | — |
| projects_scanner | ~200 | 方案确认 | — |
| jsonl_history | ~220 | 方案确认 | normalizer |
| route | ~200 | 方案确认 | service / SessionManager |
| frontend (4 组件) | ~600 | 方案确认 | 既有 MessageList / NormalizedMessage 类型 |
| llm_protocol 扩展 | ~30（新增） | 方案确认 | — |
| schema v4 升级 | ~50 | 方案确认 | 既有 thread metadata 模块 |
| 单元测试 | ~500 | 方案确认 | 各模块 |

后端总新增 ≈ 1500 行，前端 ≈ 600 行，测试 ≈ 500 行。**总规模与 claude-code-web-v0.1 相当**（claude_code 模块共 1913 行）。
