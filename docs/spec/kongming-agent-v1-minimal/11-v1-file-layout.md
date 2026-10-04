# v1-mini 文件布局

这份文档只回答一个问题：

> `v1-mini` 第一版真正需要落哪些脚本，它们放在哪，每个脚本负责什么。

它不重复模块边界，也不重复接口契约。

- 模块怎么拆，看 [02-module-breakdown.md](./02-module-breakdown.md)
- 哪些东西是跨模块共享协议，看 [10-contracts.md](./10-contracts.md)

这里关心的是**文件级实现骨架**。

## 适用范围

下面这棵树只列 `v1-mini` 当前需要的脚本。

- 包含：第一版要真正落地的最小可运行骨架
- 不包含：`v0.2+` 及以后的增强项，完整清单见文末“**不在 `v1-mini` 当前文件树中的脚本**”

## 目录树

```text
core/
  contracts/
    __init__.py
    approval.py
    event_sink.py
    llm_provider.py
    prompt_assembly.py
    session.py
    streaming.py
    tool_runtime.py
  agent_spec.py
  runner.py
  run_state.py
  session.py
  lifecycle.py
  message.py
  result.py
  errors.py

tools/
  runtime/
    base.py
    registry.py
    approval.py
  builtin/
    file_tool.py
    shell_tool.py
    memory_tool.py
    schedule_tool.py
    evolution_write_tool.py
    skill_tool.py

sessions/
  session_store.py
  file_session.py
  session_bootstrap.py
  session_discovery.py

prompting/
  assembly/
    input_assembler.py
    runtime_context.py
  instructions/
    instruction_loader.py
    prompts_loader.py
  compaction/
    history_compactor.py
  skills/
    skill_loader.py
  context_sources/
    sitian_context.py

infrastructure/
  llm_providers/
    base.py
    openai_responses.py
    anthropic_messages.py
    reasoning.py
    sse_reader.py
    openai_compat_stream_parser.py
    raw_dump.py
  config/
    loader.py
    models.py
    errors.py
    paths.py
  tracing/
    trace_sink.py
    prompt_debug_dump.py

runtime_assembly/
    session_engine.py

host/
  base.py
  session_bridge.py
  cli_adapter.py

cli/
  main.py
  repl.py

safety/
  capability_policy.py
  permission_policy.py
  chain.py

memory/
  store.py
  safety_write.py

prompts/
  templates/
    AGENT.md
    TOOLS.md
    USER.md

```

## 按目录说明

### `core/`

`core/` 只放宿主无关的 agent 运行语义。它定义系统内部通用语言，但不承接宿主、provider SDK 或 tool 具体实现。

`core/contracts/`
定义跨模块共享协议真源。`v1-mini` 里只放 `Session`、`Tool`、`ApprovalProvider`、`LLMProvider`、`EventSink` 这种公共语言。

`core/agent_spec.py`
定义 agent 的静态规格描述，比如默认模型、默认工具集、运行参数入口。它是“这个 agent 是什么”，不是“这次 run 发生了什么”。

`core/runner.py`
唯一的 run loop 真身。负责 turn 推进、tool 回填、停止条件、结果收口。不能再有第二个 runner。

`core/run_state.py`
定义一次运行的可序列化状态对象，承接暂停、恢复、状态迁移这类运行态信息。

`core/session.py`
提供第一版默认的 in-memory session 实现，让最小闭环先能保存多轮 history。

`core/lifecycle.py`
承接 core 内部生命周期事件或默认 hooks 机制，但不是第二份跨模块协议真源。

`core/message.py`
定义系统内部统一消息结构，承接用户消息、assistant 消息、tool call、tool result 等运行中间产物。

`core/result.py`
定义 run 结束时的统一结果对象，负责把运行结果从中间消息流里收口出来。

`core/errors.py`
定义核心错误模型，至少区分 core 自身错误、tool 执行错误、provider 错误、审批中断等不同失败类型。

### `tools/`

`tools/` 负责最小工具总线，让模型能真正发起工具调用并拿回结果。

`tools/runtime/base.py`
只放 tool runtime 内部复用的 concrete base / helper，不是 `Tool` Protocol 真源。它可以承载 builtin tool 基类、共用辅助函数、默认元数据封装。

`tools/runtime/registry.py`
管理工具注册、查找和分发。它决定一次 tool call 最后路由到哪个具体 tool 实现。

`tools/runtime/approval.py`
提供 `ApprovalProvider` 的默认实现。第一版先落 `InteractiveApproval`，在 `ask` 时完成最小人工确认。

`tools/builtin/file_tool.py`
承载第一批文件类 builtin tool，比如读取、写入、编辑等最小文件能力。

`tools/builtin/shell_tool.py`
承载第一批 shell builtin tool，作为最强兜底工具存在，但不代表整个系统以后都围绕 CLI / shell 展开。

### `sessions/`

`sessions/` 负责当前 run 可见的会话历史持久化、恢复和发现，不承担长期 memory。

`sessions/session_store.py`
提供 `Session` 协议的工程化实现，负责持久化、恢复和存取管理。它是 `core/session.py` 的升级版实现，不是新的 session 抽象。

`sessions/file_session.py`
`Session` 协议的文件持久化实现（v0.1.2）。append-only JSONL 文件存储，每次 `append()` 将消息以 JSONL 行追加到磁盘，支持进程重启后恢复续写。延迟 materialize：首次 `append()` 才触发落盘。

`sessions/session_bootstrap.py`
定义 file backend 首次 materialize 写入 manifest 的稳定元数据。

`sessions/session_discovery.py`
提供启动前 session 发现能力，支持 file / sqlite 后端的可恢复 session 列表、最近活跃选择和显式 session_id 校验。

### `prompting/`

`prompting/` 负责 system prompt、多来源指令、历史压缩、skill listing 和运行时上下文组装。

`prompting/compaction/history_compactor.py`
负责最小历史压缩策略，在上下文过长时把旧 history 压成可继续运行的摘要。

`prompting/instructions/instruction_loader.py`
负责加载规则、指令和宿主传入的静态说明，不把语义锁死在 coding project。

`prompting/assembly/input_assembler.py`
负责把 history、规则、附件引用、宿主临时上下文组装成模型真正看到的输入。

`prompting/instructions/prompts_loader.py`
System prompt 三段模板装配器（v0.1.3）。启动时把 `src/prompts/templates/{AGENT,TOOLS,USER}.md` 物化到 `<home>/prompts/`，读取 + 去 HTML 注释 + 裸拼。不设 Python 字符串 fallback，不 import `core`，纯函数。

`prompting/assembly/runtime_context.py`
生成 cwd / kongming_home 运行时上下文文本，作为 `InstructionSource(origin="runtime")` 前置注入。

`prompting/context_sources/sitian_context.py`
从司天 state/summary 生成额外上下文来源。

`prompting/skills/skill_loader.py`
扫描 home / workspace 双源 SKILL.md，解析 frontmatter 为 `SkillSpec`，并向装配期 EventSink 发出 skill 发现事件。

### `infrastructure/llm_providers/`

`infrastructure/llm_providers/` 负责 LLM provider 外部适配，不负责宿主 UI，也不复制 core loop。

`infrastructure/llm_providers/base.py`
只放 provider 实现侧的 concrete base / helper，不是 `LLMProvider` Protocol 真源。它承载重试、超时、流式处理等共用封装。

`infrastructure/llm_providers/openai_responses.py`
提供第一版 OpenAI Responses adapter，把内部请求转换成真实模型调用，再把结果转回内部消息协议。

`infrastructure/llm_providers/anthropic_messages.py`
Anthropic Messages API provider。走 `{base_url}/v1/messages` 端点（原生 Anthropic Messages API），处理系统消息提取、tool_use/tool_result content block 格式转换、SSE 流式响应解析。

`infrastructure/llm_providers/reasoning.py`
Reasoning adapter 层。把统一语义 effort 枚举解析为 `ResolvedReasoningPlan`，provider 消费该结构注入 payload。adapter 不感知厂商，provider 不自持 model 前缀白名单。

`infrastructure/llm_providers/sse_reader.py`
共享 SSE 行缓冲 + JSON 解包。OpenAI Chat Completions 与 Anthropic Messages 两种流都走 Server-Sent Events 协议，此模块提供唯一的 `iter_sse_events` 函数，返回 `(event_name, data)` 二元组。

`infrastructure/llm_providers/openai_compat_stream_parser.py`
OpenAI-compatible Chat Completions stream parser。把 OpenAI / GLM / DeepSeek / Kimi / Qwen / LM Studio / Ollama / vLLM 等 OpenAI-compatible 流式响应的 chunk 序列归一化为 provider-agnostic 的 `LLMStreamChunk` 序列。

`infrastructure/llm_providers/raw_dump.py`
Provider 原始 HTTP 交互的 opt-in 落盘工具。env `KONGMING_TRACE_RAW_LLM=1` 开启后，把 request payload + response body + status + headers 打包写到 `.kongming/debug/`，API key 自动脱敏。

### `runtime_assembly/`

`runtime_assembly/` 是全局 composition root，负责把外部适配、session、tool registry、trace sink 和安全链装成可运行 runtime。

`runtime_assembly/session_engine.py`
进程内运行时装配层。它负责把 provider、tool registry、session、event sink 以及高层安全链组装起来，再调用 `core/runner.py`。它负责装，不负责跑第二套 loop。

### `host/`

`host/` 是宿主抽象与桥接层，解决“谁在和 agent 对话”。

`host/base.py`
只放 host 模块内部复用的 concrete base / helper，不承担跨模块协议真定义。它描述“宿主适配器怎么实现”，不是“系统公共语言定义在哪里”。

`host/session_bridge.py`
把"读输入 / 写输出"这一对宿主都会反复写的胶水逻辑集中到一处，让 runtime 本身对宿主完全无感。观测事件通过 `EventSink` 从 runtime 内部 fan-out，不走 bridge；宿主想看 UI 级别进度，通过 `CLIEventSink` 等注册到 `SessionEngine.build(event_sinks=[...])` 即可。

`host/cli_adapter.py`
CLI 这一类宿主的适配器，把终端输入输出接到统一宿主桥接层里。

### `cli/`

`cli/` 是第一个真实宿主产品入口，但不是系统核心。

`cli/main.py`
负责启动入口、参数解析和进程启动模式选择，不复制装配逻辑。

`cli/repl.py`
负责交互式会话壳，包括流式输出、等待审批、用户中断、继续对话等 CLI 交互语义。

### `safety/`

`v1-mini` 第一版先只把工具安全链路做对，不提前把所有安全概念铺满。

`safety/capability_policy.py`
粗粒度能力门禁，先判断这次运行是否允许某类能力，例如 `shell`、`file_write`、`host_control`。

`safety/permission_policy.py`
细粒度规则判断，决定某次具体调用是 `allow`、`deny` 还是 `ask`。

`safety/chain.py`
高层安全链装配核心。提供 `SafetyGatedApproval`（`ApprovalProvider` 实现，v0.1.4 起改为薄壳：构造 `RuntimeBoundaryContext` → 调 `SafetyDecisionEngine` → 兼容字段装饰后返回）和 `build_safety_chain`（装配入口，串接 HardBlock / BoundaryResolver / TrustResolver / ConsentResolver + SafetyDecisionEngine + EventSink fan-out）。

这一层要特别强调一件事：

- `CapabilityPolicy` 和 `PermissionPolicy` 是 `safety/` 内部组件
- `Tool Runtime` 不直接 import 它们
- `session_engine.py` 负责把 capability / permission / approval 串成一条高层安全链
- tool 执行链只消费装配后的最终判定结果

### `infrastructure/tracing/`

`v1-mini` 第一版先只保留一个最小事件落地能力，不把 usage 和 audit 同时做满。

`infrastructure/tracing/trace_sink.py`
提供第一版唯一的 `EventSink` 实现，把 run、tool、approval、error 等事件落到一份 JSONL trace 里，作为后续 usage / audit 的上游事实源。

`infrastructure/tracing/prompt_debug_dump.py`
`PromptDebugSink` 实现（v0.1.3）。把每个 LLM turn 的 prompt build 快照写成 JSON 到 `.kongming/debug/`，用于调试模型看到的真实输入。

### `memory/`

`memory/` 负责本地长期记忆的读写、冻结快照与内容安全扫描（v0.1.3+）。

`memory/store.py`
`MemoryStore`：多文件读取（MEMORY / USER / ERRORS）、冻结态 snapshot + 活态 entries 双分区、prompt 渲染。`load_from_disk()` 是唯一冻结态刷新入口，`format_for_system_prompt()` 只读冻结态保证 turn 间 prompt 稳定。

`memory/safety_write.py`
Memory 安全写入内核。提供内容扫描（prompt injection / secret / 不可见 Unicode 拦截）、entry 级去重、原子写入（临时文件 + `os.replace()`）能力，供 MemoryTool 和 LearningLoop 共用。

### `prompts/`

`prompts/` 是纯模板包（v0.1.3），只含模板 `.md` 文件 + 空 `__init__.py`，不导出 Python 符号，不 import 任何 sibling。

`prompts/templates/{AGENT,TOOLS,USER}.md`
三段内置 system prompt 模板。启动时由 `prompting/instructions/prompts_loader.py` 物化到 `.kongming/prompts/`，已存在的文件不覆盖，用户手动编辑一律保留。

### `infrastructure/config/paths.py`

`infrastructure/config/paths.py`
`get_kongming_home()` 统一 `.kongming/` 运行数据根入口。优先级：环境变量 `KONGMING_HOME` > `Path.home() / ".kongming"`。`resolve_kongming_path()` 负责把 `.kongming/*` 配置字段派生到 `kongming_home`。两个函数只返回 Path 对象，由调用方按需创建目录。

## 文件之间的主调用链

把第一版主链路说人话，大致就是：

1. `cli/main.py` 启动进程，进入 `cli/repl.py`
2. `cli/repl.py` 通过 `host/cli_adapter.py` 把用户输入交给宿主桥
3. `host/session_bridge.py` 把宿主事件翻译成 agent 运行输入
4. `runtime_assembly/session_engine.py` 装配 provider、session、tool registry、trace sink 和安全链
5. `core/runner.py` 驱动主循环
6. `sessions/*` 负责保存会话历史，`prompting/*` 负责准备模型输入
7. `infrastructure/llm_providers/openai_responses.py` 发起模型调用
8. 如果出现 tool call，`tools/runtime/registry.py` 分发到具体 tool
9. tool 执行前先经过装配好的 safety 链：capability → permission → approval
10. 事件统一经 `core/runner.py` 持有的 `list[EventSink]` fan-out 给所有注册 sink；`v1-mini` 当前唯一注册的是 `infrastructure/tracing/trace_sink.py`
11. 最终结果由 `core/result.py` 收口，再通过 host / cli 回给用户

## 不在 `v1-mini` 当前文件树中的脚本

下面这些不算当前第一版必需脚本，不要混进上面的目录树：

- `safety/guardrails.py`
- `infrastructure/tracing/usage_meter.py`
- `infrastructure/tracing/audit_log.py`
- `infrastructure/tracing/event_log.py`
- `prompting/context_engine.py`
- `prompting/skills/skill_loader.py`
- `host/http_adapter.py`
- `host/game_adapter.py`
- `host/macos_adapter.py`

它们不是不要，而是明确留到 `v0.2+` 或后续分阶段进入。

## v1-mini 早期就应补齐的工程基础设施

这份文档的主目录树只列语义层脚本，但 `v1-mini` 真正进入实现时，工程底座不应该后置。像 lint、类型检查、测试和最小 CI，越早建立越好，不然后面返工成本更高。

建议从第一批实现开始就补齐下面这些工程文件和目录：

- `pyproject.toml`：统一 Python 依赖、工具配置入口
- `__init__.py`：必要的包结构声明
- `tests/`：测试根目录，至少区分单元测试和 e2e 测试
- 格式化配置：保证代码风格稳定
- lint 配置：尽早拦住明显坏味道和依赖漂移
- 类型检查配置：优先覆盖 `core/contracts/`、`core/runner.py`、`tools/runtime/approval.py` 这类边界文件
- 最小 CI 配置：至少能跑 format / lint / typecheck / test
- 依赖方向检查：这个项目尤其建议尽早接入 `import-linter` 一类规则，防止 `core` 反向依赖 sibling 模块

推荐的最小工程目录可以理解成：

```text
pyproject.toml
tests/
  unit/
  e2e/
```

测试要求也应该从第一版就写死：

- 每个核心模块至少有对应的单元测试
- 每个进入实现的功能模块，至少有一条覆盖主调用链的 e2e 用例
- e2e 重点不是覆盖所有分支，而是验证最关键闭环真的能跑通

换句话说，这些工程文件不在上面的“语义层目录树”里，不是因为它们不重要，而是因为它们属于另一层同样必须尽早建立的工程底座。
