结论：**你这个项目的内核方向是对的，外围目录需要从“技术分层名”升级成“业务归属名 + 用例名”。**

## 0. 2026-06-08 决策修订

以下早期建议已归档为废弃迁移项：

* `src/kongming_agent/` namespace 包：当前继续使用 `src/` 下单层 package 布局，保留 `core` / `tools` / `web` / `cli` 等顶层 import。
* `core -> kernel` 包名迁移：当前继续保留 `core` 顶层包名，`core.contracts` package 已承担协议真源职责。

下一轮迁移聚焦三项：`safety/` 二级拆分、`application/` 用例层、`hosts/` 顶层宿主目录。执行计划见 [safety-application-hosts-migration-0608.md](safety-application-hosts-migration-0608.md)。

现在 `core/` 的定位已经清楚：README 写明它负责 agent loop、turn 推进、tool orchestration、run state 和跨模块协议，并且保持宿主无关；CLI、桌面、游戏、HTTP 之类差异放到 host adapter。这个方向值得保留。([GitHub][1])

真正影响“人脑一眼形成架构图”的问题在外围：`src/` 下现在同时有 `core / tools / context / executors / host / safety / memory / prompts / web` 等同级目录，`web/` 又包含 thread、workspace、whiteboard、ws、auth、cron、usage、approval 等大量职责。([GitHub][2]) ([GitHub][3])

## 1. 当前结构评价

你的项目已经有几个好基础：

* `core/runner.py` 是唯一 run loop，`core/contracts.py` 做协议真源，这个判断很强。README 也明确写了 Runner、LLM provider、tools、安全链、session、trace、config、CLI 宿主这些主能力。([GitHub][1])
* `.importlinter` 已经约束了依赖方向：`core` 禁止依赖 sibling 模块，跨模块协议来自 `core/contracts.py`，tools 也限制直接依赖 safety 内部 policy。([GitHub][4])
* `safety/` 已经具备较清晰的安全域对象，例如 `approval_manager.py`、`approval_rules.py`、`boundary_resolver.py`、`capability_policy.py`、`permission_policy.py`、`grant_store.py`。([GitHub][5])

主要问题也很明显：

* `context/` 这个名字太宽，里面同时有 `file_session.py`、`history_compactor.py`、`input_assembler.py`、`instruction_loader.py`、`session_store.py`、`skill_loader.py`、`sitian_context.py`，它已经混合了 session、prompt、skill、SiTian 上下文等多个概念。([GitHub][6])
* `tools/` 同时放了 tool 基类、registry、approval、file/shell/memory/schedule/evolution write 等实现，目录名能说明“这里和工具有关”，但看文件仍然需要猜“运行时、内置工具、审批适配”谁归谁。([GitHub][7])
* `web/` 是当前最散的地方。它同时承担 API app、认证、WebSocket、thread 管理、workspace、whiteboard、cron、usage、approval、Claude Code、Codex、dashboard、workflow 等职责。([GitHub][3])

## 2. 建议的命名原则

你现在最需要的规则是：

**目录用领域名，脚本用职责名，用例文件用动词短语。**

具体规则：

```txt
领域对象：agent_run / agent_session / tool_call / approval_grant / workspace
用例流程：start_agent_run.py / approve_tool_call.py / resume_thread.py
端口接口：llm_provider.py / session_store.py / tool_executor.py / event_sink.py
适配实现：openai_compatible_provider.py / sqlite_session_store.py / web_socket_event_sink.py
宿主入口：cli_host / web_host / tauri_host / game_host
```

少用这些名字：

```txt
manager.py
utils.py
helper.py
common.py
service.py
base.py
types.py
run.py
app.py
```

这些名字可以存在，但只能作为很薄的入口或协议文件。核心业务文件尽量用领域名。

## 3. 我建议的目标目录

第一版建议这样改，目标是“一眼知道归属”：

```txt
src/
  kongming_agent/                   # 已废弃：当前保留 src/ 单层 package 布局
    kernel/                         # 已退出：当前保留 core/ 顶层包名
      agent_run/
        runner.py                   # 原 core/runner.py
        run_state.py
        result.py
        lifecycle.py
      messaging/
        message.py
        tool_call.py
      contracts/
        llm_provider.py
        tool_runtime.py
        session.py
        approval.py
        event_sink.py
      agent_spec.py
      errors.py

    application/                    # 用例层：人类最容易审核
      agent_runs/
        start_agent_run.py
        resume_agent_run.py
        cancel_agent_run.py
      tool_calls/
        approve_tool_call.py
        execute_tool_call.py
      prompts/
        assemble_agent_prompt.py
        compact_message_history.py
      sessions/
        create_session.py
        load_session_history.py

    safety/                         # 安全域
      approval/
        approval_manager.py
        approval_rules.py
        decision_engine.py
      boundaries/
        boundary_resolver.py
        path_trie.py
      grants/
        grant_store.py
        grant_persister.py
      policies/
        capability_policy.py
        permission_policy.py
      guards/
        hard_block.py
        consent.py
        trust.py

    tools/
      runtime/
        tool_registry.py
        tool_base.py
      builtin/
        file_tool.py
        shell_tool.py
        memory_tool.py
        schedule_tool.py
        evolution_write_tool.py

    sessions/                       # 从 context 拆出来
      memory_session.py
      file_session.py
      sqlite_session_store.py
      session_discovery.py
      session_bootstrap.py

    prompts/                        # 从 context/prompts 拆出来
      instruction_loader.py
      prompt_source_loader.py
      input_assembler.py
      history_compactor.py
      skill_loader.py

    memory/
      memory_store.py
      memory_write_guard.py

    infrastructure/                 # 外部实现
      llm_providers/
        openai_compatible_provider.py
        anthropic_messages_provider.py
      tracing/
        jsonl_trace_sink.py
      config/
        config_models.py
        config_loader.py
        config_paths.py

    hosts/
      cli/
        cli_main.py
        cli_repl.py
        cli_approval_prompt.py
        cli_stream_sink.py
      web/
        api_app.py
        auth/
        websocket/
        threads/
        workspace/
        whiteboard/
        approvals/
        usage/
        workflow/
      claude_code/
      codex/
```

这版结构的关键变化是：**`context/` 消失，`web/` 下沉，`executors/` 拆成 infrastructure + application，`core/` 改成更明确的 kernel。**

## 4. 现有文件怎么对应

可以按这个迁移表来做：

说明：表中的 `kernel/*` 与 `src/kongming_agent/*` 是早期候选目标，2026-06-08 决策已归档；当前继续保留 `core/` 和 `src/` 单层 package 布局。

| 现在                              | 建议                                                   | 理由                     |
| ------------------------------- | ---------------------------------------------------- | ---------------------- |
| `core/runner.py`                | `kernel/agent_run/runner.py`                         | 明确它是 AgentRun 的推进器     |
| `core/run_state.py`             | `kernel/agent_run/run_state.py`                      | 归属到 agent_run          |
| `core/message.py`               | `kernel/messaging/message.py`                        | 消息模型独立成 messaging      |
| `core/contracts.py`             | `kernel/contracts/*.py`                              | 一个大 contracts 文件拆成多个端口 |
| `context/file_session.py`       | `sessions/file_session.py`                           | session 归 session      |
| `context/session_store.py`      | `sessions/session_store.py`                          | 存储归 session            |
| `context/history_compactor.py`  | `prompts/history_compactor.py`                       | 历史压缩服务 prompt 组装       |
| `context/input_assembler.py`    | `prompts/input_assembler.py`                         | 输入组装属于 prompt          |
| `context/instruction_loader.py` | `prompts/instruction_loader.py`                      | 指令来源属于 prompt          |
| `context/skill_loader.py`       | `prompts/skill_loader.py` 或 `skills/skill_loader.py` | 看 skill 是否会独立成体系       |
| `tools/registry.py`             | `tools/runtime/tool_registry.py`                     | 工具注册归 runtime          |
| `tools/base.py`                 | `tools/runtime/tool_base.py`                         | 基类归 runtime            |
| `tools/file_tools.py`           | `tools/builtin/file_tool.py`                         | 内置工具归 builtin          |
| `tools/shell_tool.py`           | `tools/builtin/shell_tool.py`                        | 内置工具归 builtin          |
| `executors/llm/`                | `infrastructure/llm_providers/`                      | LLM provider 是外部适配     |
| `executors/agent_runtime/`      | `application/agent_runs/` 或 `runtime_assembly/`      | 装配逻辑和用例逻辑分开            |
| `config_loader/`                | `infrastructure/config/`                             | 配置加载是基础设施              |
| `observability/`                | `infrastructure/tracing/`                            | trace sink 是基础设施       |
| `host/cli_adapter.py`           | `hosts/cli/cli_host_adapter.py`                      | 具体宿主归 hosts            |
| `cli/main.py`                   | `hosts/cli/cli_main.py`                              | CLI 入口归宿主              |
| `web/thread_manager.py`         | `hosts/web/threads/thread_manager.py`                | thread 是 web 子域        |
| `web/workspace.py`              | `hosts/web/workspace/workspace_service.py`           | workspace 是 web 子域     |
| `web/whiteboard_store.py`       | `hosts/web/whiteboard/whiteboard_store.py`           | whiteboard 是 web 子域    |
| `web/ws.py`                     | `hosts/web/websocket/websocket_routes.py`            | WebSocket 归 websocket  |
| `web/ws_event_sink.py`          | `hosts/web/websocket/websocket_event_sink.py`        | 事件推送归 websocket        |
| `web/auth.py`                   | `hosts/web/auth/web_auth.py`                         | auth 归 auth            |

## 5. 迁移顺序

先改 3 个地方，收益最大。

### 第一步：拆 `context/`

`context` 是最应该先处理的目录，因为名字已经容纳太多概念。直接拆成：

```txt
sessions/
prompts/
skills/        # skill 未来独立时再建
```

迁移后人脑会立刻知道：

```txt
sessions/ 负责历史与持久化
prompts/ 负责模型输入构造
skills/ 负责能力注入
```

### 第二步：重组 `web/`

把 `web/` 改成子域结构：

```txt
hosts/web/
  app/
  auth/
  websocket/
  threads/
  workspace/
  whiteboard/
  approvals/
  usage/
  workflow/
  integrations/
    claude_code/
    codex/
```

你现在 `web/` 的文件数量和职责宽度已经到了“必须分区”的程度。现有 `web/` 目录列出的 thread、workspace、whiteboard、ws、approval、usage、workflow、Claude Code、Codex 等模块天然适合按子域拆。([GitHub][3])

### 第三步：拆 `contracts.py`

`core/contracts.py` 作为单一协议真源是好设计，但后续会变成“协议垃圾桶”。README 已经把 Session、Tool、ApprovalProvider、LLMProvider、EventSink 都列为共享协议。([GitHub][1])

建议拆成：

```txt
kernel/contracts/   # 已退出：当前保留 core/contracts/
  llm_provider.py
  tool_runtime.py
  session.py
  approval.py
  event_sink.py
  prompt_assembly.py
```

然后保留一个兼容导出：

```python
# kernel/contracts/__init__.py  # 已退出：当前保留 core/contracts/__init__.py
from .llm_provider import LLMProvider, LLMRequest, LLMResponse
from .tool_runtime import Tool, ToolCall, ToolResult, ToolLookup
from .session import Session
from .approval import ApprovalProvider, ApprovalRequest
from .event_sink import Event, EventSink
```

这样既保留“协议真源”，又让文件名可读。

## 6. AI 开发规则也要同步改

你可以加一个 `ARCHITECTURE_RULES.md`，直接约束 AI：

说明：以下 `ARCHITECTURE_RULES.md` 是早期草稿，`kernel/` 与 `src/kongming_agent/` 相关条目已归档。下一轮执行以 [safety-application-hosts-migration-0608.md](safety-application-hosts-migration-0608.md) 的 `safety/`、`application/`、`hosts/` 分阶段计划为准。

```md
# Architecture Rules

## Ownership
- `kernel/` 只放 Agent 内核语义：run loop、message、result、state、contracts。
- `application/` 只放用例编排：start / resume / cancel / approve / execute。
- `sessions/` 只放 session 历史、持久化、发现、恢复。
- `prompts/` 只放 prompt assembly、instruction loading、history compaction。
- `tools/runtime/` 只放工具协议、注册、调度。
- `tools/builtin/` 只放内置工具实现。
- `safety/` 只放审批、权限、边界、grant、guard。
- `hosts/` 只放 CLI / Web / Tauri / Game 入口和宿主适配。
- `infrastructure/` 只放外部 provider、config、trace、storage adapter。

## Naming
- 用例文件必须用动词短语：`start_agent_run.py`、`approve_tool_call.py`。
- 领域文件必须用名词：`agent_session.py`、`approval_grant.py`。
- 禁止新增 `utils.py`、`helper.py`、`common.py`。
- `manager.py` 只能作为门面类，内部必须委托给明确子模块。

## Import Direction
- `kernel` 可以被所有层依赖。
- `kernel` 只依赖标准库和自身子模块。
- `application` 可以依赖 `kernel`、`sessions`、`prompts`、`tools/runtime`、`safety`。
- `hosts` 只能调用 `application` 用例。
- `tools/builtin` 不能直接访问 `hosts`。
```

这类文件对 AI 很有用，因为它把“品味”变成了可检查约束。

## 7. 最小改造版

你现在可以先做一个小 PR，别一次性全仓搬家：

```txt
src/
  context/                  -> 暂时保留
  sessions/                 -> 新建
  prompts/                  -> 新建
  tools/
    runtime/                -> 新建
    builtin/                -> 新建
```

第一批移动：

```txt
context/file_session.py          -> sessions/file_session.py
context/session_store.py         -> sessions/session_store.py
context/session_discovery.py     -> sessions/session_discovery.py
context/history_compactor.py     -> prompts/history_compactor.py
context/input_assembler.py       -> prompts/input_assembler.py
context/instruction_loader.py    -> prompts/instruction_loader.py
tools/registry.py                -> tools/runtime/tool_registry.py
tools/base.py                    -> tools/runtime/tool_base.py
tools/file_tools.py              -> tools/builtin/file_tool.py
tools/shell_tool.py              -> tools/builtin/shell_tool.py
```

然后更新 import-linter，把 `sessions`、`prompts` 加入 root packages，并把旧 `context` 标记为 deprecated。

最具体的下一步：**先拆 `context/`，因为它的命名收益最大、风险最小、改完后 AI 最容易判断 session / prompt / skill 的归属。**
