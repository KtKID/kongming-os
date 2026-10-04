# 目标与边界

## 系统目标

`claude-sidecar` 是 kongming-agent 项目下的**独立 Python 子进程子系统**，目的是把已收口的 XSpace ↔ kongming-agent sidecar JSONL 协议落地实现，让 XSpace 桌面应用能通过子进程模型驱动 Claude Code。

它的任务很单一：

- 接收 stdin 上的 5 类 `SidecarRequest`
- 内部用 `claude_agent_sdk` 控制 Claude Code
- 把 SDK 的 Python Message 对象翻译成 15 类 `SidecarEvent`，按 JSONL 格式写到 stdout
- 把 SDK 的 `can_use_tool` 异步回调跟 stdin 的 `resolve_approval` 命令对接起来
- 把 SDK 的几个非显然行为（流式开关 / hook 噪声 / deny 后双发）封装在内部，XSpace 只看产品级稳定事件

## 核心问题

当前必须解决的问题有四个：

1. **进程隔离**：XSpace 是 Tauri Rust 桌面应用，没法在自己进程内跑 Python `claude_agent_sdk`，必须靠子进程
2. **协议翻译**：SDK 的 Python Message 类型 ≠ XSpace 想消费的 SidecarEvent 类型，需要翻译层
3. **实现陷阱吸收**：SDK 的几个细节（`include_partial_messages` 默认关 / `SystemMessage(hook_*)` 噪声 / deny 后自动 ToolResult / `responseId` 取 `message_id` 不取 `StreamEvent.uuid`）必须封装在 sidecar 内部，不能让 XSpace 那侧每次接入都踩一遍
4. **多 backend 演进留位**：将来 codex / gemini 等其他 backend 接入时，本方案的目录结构和模块边界要能直接复制成姊妹方案

## 关键约束

### 上游契约约束

- 所有 wire 协议字段、事件 type 字符串、状态机、命名空间已在 [05-kongming-sidecar-contract.md](../../plugins/client/XSpace/docs/claude-code-runtime/05-kongming-sidecar-contract.md) 敲死
- 协议层任何变更走 [discussion-kongming-sidecar-contract.md](../../plugins/client/XSpace/docs/claude-code-runtime/discussion-kongming-sidecar-contract.md) 第 7 轮讨论，不在本方案内调整

### 项目架构约束（继承 CLAUDE.md）

- **第 2 条「core 零 sibling 依赖」继续有效**：sidecar 不依赖 core，core 不依赖 sidecar
- **第 6 条「跨层 import 白名单」不放宽**：sidecar 是新 sibling 模块，不向白名单加新条目
- **第 8 条「本地模型 api_key 可空」不适用**：sidecar 用 SDK，凭证由 Claude CLI 自己管（macOS Keychain / `~/.claude/`），不走 `KONGMING_MODEL_*` env

### 实施约束

- 第一阶段只支持 **`backendKind='claude'`**，对应 Claude Code SDK
- 第一阶段固定 **一进程一 thread**（不做单进程多 thread 隔离）
- 第一阶段固定 **`claude_agent_sdk` 版本锁定到 0.1.72**（smoke 实测的版本，不跟随 PyPI latest）
- sidecar 不做产品状态持久化（thread-events.jsonl 是 XSpace 那侧的事）

## 包含项

### 包含 1：协议翻译主链路

XSpace stdin 命令 → sidecar 处理 → SDK 调用 → SDK Message → sidecar 翻译 → stdout 事件 → XSpace 消费。具体链路见 [03-core-workflows.md](./03-core-workflows.md)。

### 包含 2：5 类请求处理

`start` / `resolve_approval` / `interrupt` / `reconnect` / `shutdown`。每类有明确的语义和后续事件输出预期。

### 包含 3：15 类事件输出

`claude_sidecar_ready` / `claude_session_created` / `claude_assistant_delta` / `claude_assistant_final` / `claude_assistant_thinking_delta` / `claude_assistant_thinking_final` / `claude_tool_started` / `claude_tool_finished` / `claude_approval_requested` / `claude_approval_resolved` / `claude_approval_denied` / `claude_run_finished` / `claude_run_failed` / `claude_run_interrupted` / `claude_transport_error`。

### 包含 4：状态身份跟踪

- `runId`（XSpace 给的，sidecar 透传）
- `runtimeSessionId`（SDK 给的 session_id，sidecar 回填到 `claude_session_created`）
- `responseId`（取自 SDK `AssistantMessage.message_id`）
- `toolCallId`（取自 SDK `ToolUseBlock.id`）
- `requestId`（取自 SDK `can_use_tool` 回调的 `ctx.tool_use_id`）

### 包含 5：去重与过滤

- deny 后 SDK 自动产生的 ToolResult 必须丢弃（不重发 `claude_tool_finished`）
- 非 init 的 `SystemMessage`（`hook_started` / `hook_response` / `task_*`）默认丢弃
- `StreamEvent.uuid` 不进入产品事件层，只用作 sidecar 内部调试

### 包含 6：sidecar 进程级日志

- 走 stderr 或 `.kongming/sidecar/<pid>.log`
- 跟 stdout 的产品事件流分离
- 用于 sidecar 自身故障定位（不是 XSpace 那侧消费）

## 不包含项

### 不包含 1：ThreadEvent 真相层

XSpace 自己持有 `ThreadEvent` 真相层（[04-data-and-state.md](../../plugins/client/XSpace/docs/claude-code-runtime/04-data-and-state.md)）。sidecar 只产生 `SidecarEvent`，从不持有也从不读取 `ThreadEvent`。

### 不包含 2：approval UI 与策略

XSpace 自己持有 approval UI 和决策策略。sidecar 只把 SDK 的 `can_use_tool` 回调暴露成 `claude_approval_requested` 事件，等 XSpace 回 `resolve_approval`。

### 不包含 3：multi thread 并发

第一阶段一进程一 thread。如果 XSpace 同时有 N 个 thread，应该启 N 个 sidecar 进程。这条约束写在 [05 §4 进程关系](../../plugins/client/XSpace/docs/claude-code-runtime/05-kongming-sidecar-contract.md#4-进程关系)。

### 不包含 4：与现有 kongming-agent CLI / Web 的合并入口

sidecar 是独立 `python -m claude_sidecar` 入口，**不进 `src/cli/main.py`**。理由：sidecar 的输入输出形态（stdin/stdout JSONL）跟现有 CLI 的 prompt_toolkit REPL 完全不同，合并只会污染两边职责。

### 不包含 5：generic_chat / codex backend

generic_chat 走现有 `src/web/` FastAPI 服务，跟 sidecar 协议无关。codex backend 留给将来同结构姊妹方案（如 `docs/codex-sidecar-v0.1/`）。

### 不包含 6：自动跑真 SDK 的回归测试

smoke 阶段已经跑过一次真 SDK，把字段细节摸清写进了 [smoke-report.md](../../dev-pipeline/tasks/claude-sidecar-v0.1/smoke-report.md)。回归测试套件用 mock SDK，不持续烧 API 配额。CI 上不跑 smoke。

## 与现有基础设施的边界（详细版）

```mermaid
flowchart TB
    subgraph SC["src/claude_sidecar/<br/>新 sibling 模块"]
        SC_CODE[sidecar 代码]
    end

    subgraph EXIST["现有 src/ 基础设施"]
        CORE[src/core/]
        EXEC[src/executors/llm/]
        CLI[src/cli/main.py]
        SAFETY[src/safety/]
        OBS[src/observability/]
        TOOLS[src/tools/]
        CTX[src/context/]
        CFG_PATHS[src/config_loader/paths.py]
        CFG_LOAD[src/config_loader/loader.py]
    end

    SC_CODE -.->|轻度复用<br/>get_kongming_home| CFG_PATHS
    SC_CODE -.X.->|不复用| CORE
    SC_CODE -.X.->|不复用<br/>不同 SDK 技术栈| EXEC
    SC_CODE -.X.->|不复用<br/>独立进程入口| CLI
    SC_CODE -.X.->|不复用<br/>XSpace 自己做| SAFETY
    SC_CODE -.X.->|不复用<br/>走 stdout 不走 EventSink| OBS
    SC_CODE -.X.->|不复用<br/>SDK 自己执行 tool| TOOLS
    SC_CODE -.X.->|不复用<br/>SDK 自己管 session| CTX
    SC_CODE -.X.->|不复用<br/>无 yaml 配置| CFG_LOAD

    style SC fill:#e1f5ff,stroke:#0277bd,stroke-width:2px
    style EXIST fill:#f5f5f5,stroke:#999
    style CFG_PATHS fill:#fff8e1,stroke:#f57c00
```

唯一的复用点是 `config_loader.paths.get_kongming_home()`——把 `.kongming/sidecar/` 日志目录定位到统一位置。**不引入完整 Config 加载，不引入 yaml 解析**。

## 第一性原理结论

sidecar 子系统的核心**不是「跑 Claude Code」**——SDK 已经把 Claude Code 跑起来这件事完全包好了。sidecar 的核心是**「把 SDK 的 Python 对象语义翻译成 XSpace 想消费的 wire 协议语义」**。

所以本方案重心放在：

- **翻译层**（Message Translator）的字段映射规则
- **去重 / 过滤逻辑**的实现陷阱处理
- **状态身份跟踪**的边界一致性

不放在：

- 重新设计 agent 循环（SDK 已有）
- 重新设计 tool 执行（SDK 已有）
- 重新设计 session resume（SDK 已有）
- 重新设计安全策略（XSpace 已有）

**最稳的落地方式**：保持现有 `src/` 树结构不动，在 `src/claude_sidecar/` 下长出独立子进程子系统，对外只通过 stdin/stdout JSONL 协议跟 XSpace 通信。
