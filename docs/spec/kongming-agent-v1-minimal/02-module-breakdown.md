# 模块拆分

## 模块总览

| 模块 | 职责 | 依赖 | 状态 | 备注 |
|---|---|---|---|---|
| Core Runtime | 定义单 agent run loop、turn 推进、run state 边界 | 无 | 可进入 x-req | v1 主轴 |
| Tool Runtime | 提供统一 tool 协议、注册、执行回填 | Core Runtime | 可进入 x-req | 只做最小 builtin tool |
| Session / Context | 管理本轮可见上下文和会话历史 | Core Runtime | 可进入 x-req | 不包含长期 memory |
| Model Executor | 接模型 provider 并把结果转回内部协议 | Core Runtime | 可进入 x-req | v1 先只落一个 provider |
| Host Bridge + CLI Shell | 把宿主输入输出和 agent 事件流接起来 | Core Runtime, Tool Runtime, Model Executor | 可进入 x-req | CLI 只是第一个宿主 |
| Safety Baseline | 做最小 guardrails、approval、capability policy | Tool Runtime, Model Executor, Host Bridge + CLI Shell | 可进入 x-req | 只保留最小安全闭环 |
| Observability Baseline | 做 `EventSink` + 一个 JSONL trace sink | Core Runtime, Tool Runtime | 可进入 x-req | usage / audit 延后到 v0.2+，从 trace JSONL 派生 |

## 模块详情

## 工程约束与测试基线

这套模块拆分不是只给文档看的，进入实现后要配套最小工程约束，否则边界很快会漂。

`v1-mini` 建议从第一批实现开始就同时建立：

- 代码格式化
- lint
- 类型检查
- 最小 CI
- 依赖方向检查，优先约束 `core` 不反向依赖 sibling 模块

测试也不要后置。

- 每个模块至少要有对应的单元测试，验证本模块职责和边界
- 每个进入实现的功能模块，至少要有一条 e2e 用例，覆盖它在主调用链里的真实工作方式
- 单元测试负责守模块边界，e2e 负责守系统闭环；两者都不能省

对这份 `v1-mini` 来说，至少应覆盖这类 e2e 主链路：

- CLI 输入 → host bridge → runner → model → 最终文本输出
- model 发出 tool call → safety 链（capability → permission → approval）→ tool 执行 → 结果回填
- 事件经 `runner` 的 `list[EventSink]` fan-out → `trace_sink.py` JSONL 落盘

如果没有这些最小 e2e，用再漂亮的模块边界文档，也不能证明这套骨架真的可运行。

### 模块 1：Core Runtime

**职责**：定义 v1 最小 agent 的核心运行语义，让系统能自己推进一轮又一轮，而不是一次性 prompt 调用。

**包含范围**：

- `core/contracts.py`
- `core/agent_spec.py`
- `core/runner.py`
- `core/run_state.py`
- `core/session.py`
- `core/lifecycle.py`
- `core/message.py`
- `core/result.py`
- `core/errors.py`

**不包含范围**：

- 宿主输入输出
- provider SDK 细节
- tool 具体实现
- platform/game/app 状态本体
- session 持久化 / 恢复
- 历史压缩
- 指令 / 规则加载
- 输入组装

**参考项目**（原则：自己定义，参考源只做边界对照，不照抄）：

- 骨架对照：`other/openai/` — 借 `Agent / Runner / RunState` 的边界切分，实现自己收口；`run_state.py` 可直接参考其可序列化设计
- 长生命周期对照：`other/hermes-agent/` — 提醒 loop 从第一天就支持可中断、可恢复

**为什么选它**：

OpenAI 的 `Agent / Runner / RunState` 边界最干净，适合拿来定义最小闭环的骨架。Hermes 的价值不在于整套照抄，而在于提醒这里从第一版开始就要考虑长生命周期、可中断、可恢复。

**第一批最小 session 约束**：

- 第一批必须在 `core/contracts.py` 里定义最小 `Session` 协议
- 第一批必须提供一个 in-memory session 实现，负责保存当前 run 的 history
- 这个最小 session 只解决“闭环能跑、多轮不丢历史”，不承担持久化、压缩、规则加载
- 第二批 `Session / Context` 模块是在这个接口之上升级，不是另起一套 session 语义

**风险与讨论点**：

- 如果这里一开始就掺进 CLI 或游戏事件，后面很难抽离
- 如果只按 SDK 风格写成一个 `run(prompt)`，后面会不够像真正的 agent loop

**task 建议**：

- 建议 task 名：`v1-core-runtime`
- 是否进入 x-req：是
- 原因：没有这层，其它模块都只是零件，拼不成 agent

### 模块 2：Tool Runtime

**职责**：给 agent 一套最小但通用的工具协议，让模型不只是生成文本，而能发起工具调用并拿回结果继续推理。

**包含范围**：

- `tools/base.py`
- `tools/registry.py`
- `tools/approval.py`
- 一小组 builtin tool，建议先保留：
  - `tools/file_tools.py`
  - `tools/shell_tool.py`

**不包含范围**：

- MCP
- workflow/skill tool
- web tool
- domain tool
- plugins

**参考项目**（原则：自己定义，参考源只做边界对照）：

- 最小闭环对照：`other/Mini-Agent/` — 借 `Tool.execute()` 的最简协议形状
- 协议边界对照：`other/openai/` — 借 tool context / tool origin / approval boundary 思路
- 产品实现对照：`other/claude-code-main/` — approval 链路与工具注册表聚合方式（v0.2+ 真实主抄源）

**为什么选它**：

Mini-Agent 证明了最小工具闭环可以很轻，适合 v1 起步。OpenAI 适合借 tool context 和统一协议边界，Claude Code 适合后面增强 approval 和真实工具运行语义。

**`tools/base.py` 的角色**：

- `Tool` 这条跨模块协议的唯一真定义仍然放在 `core/contracts.py`
- `tools/base.py` 不是第二份 `Tool` Protocol 定义
- `tools/base.py` 只承载 tool runtime 内部会复用的 concrete 内容，例如：
  - builtin tool 的基类
  - 默认元数据结构
  - 本模块内部共用的 helper / mixin / result 包装
- 如果某个接口会被 `core`、`tools`、`executors`、`host` 这类多个模块共同消费，它就不能定义在这里，必须回到 `core/contracts.py`

**approval 两阶段边界**：

- 第一批 `Tool Runtime` 负责把 approval 接进工具执行链
- `tools/approval.py` 在第一批只做两件事：
  - 承接 `core/contracts.py` 里的 `ApprovalProvider` 协议
  - 提供默认 `InteractiveApproval`，支持最小 `y/n` 人工确认
- 第二批 `Safety Baseline` 不改 approval 接口形状，只新增策略驱动实现

**与 Safety 的接法**：

- `Tool Runtime` 不直接依赖 `CapabilityPolicy` / `PermissionPolicy` 这两个内部组件
- `Tool Runtime` 只消费一条已经装配好的高层安全链路，或者只拿到最终判定结果
- 换句话说，tool 执行链不应该自己理解“先 capability、再 permission”分别长什么接口；这层顺序由装配层和 safety 模块共同保证

**风险与讨论点**：

- 如果一上来把 MCP、skill、workflow 都塞进来，v1 会失控
- 如果只做“函数调用 schema”，没有本地执行语义，后面又要重写

**task 建议**：

- 建议 task 名：`v1-tool-runtime`
- 是否进入 x-req：是
- 原因：这是最小 agent 与外部能力连接的核心层

### 模块 3：Session / Context

**职责**：管理 agent 当前这次运行能看到的上下文，而不是做长期记忆系统。

**包含范围**：

- `context/session_store.py`
- `context/history_compactor.py`
- `context/instruction_loader.py`
- `context/input_assembler.py`

**不包含范围**：

- `memory/` 长期记忆
- 自动事实抽取
- team sync
- skill 执行

**参考项目**（原则：自己定义，参考源只做边界对照）：

- session 存储对照：`other/openai/` 的 `sqlite_session.py` — agent 会话历史，不含宿主状态
- 指令与输入组装对照：`other/claude-code-main/` — CLAUDE.md 加载与 attachment 组装模式
- 历史压缩分阶段对照：`other/Mini-Agent/` v0.1 起步，`other/claude-code-main/` `services/compact/` v0.2+ 对齐

**为什么选它**：

v1 只需要保证 agent 有”当前会话上下文”，不需要同时背上长期 memory。OpenAI 的 session 层适合做干净边界，Claude Code 适合参考规则加载和输入组装。

**与 `core/session.py` 的边界**：

- `context/session_store.py` 是 `core/contracts.py` 中 `Session` 协议的工程化实现
- 它只增加持久化、恢复和存取管理，不重新定义新的 Session 抽象
- `history_compactor.py`、`instruction_loader.py`、`input_assembler.py` 都消费既有 session 语义，不拥有 Session 协议定义权

**风险与讨论点**：

- 很容易把 memory 和 context 混成一层
- 很容易把 project-only/coding-only 假设写死在这里

**task 建议**：

- 建议 task 名：`v1-session-context`
- 是否进入 x-req：是
- 原因：没有这层，run 很快就会丢历史或上下文失控

### 模块 4：Model Executor

**职责**：把内部统一请求转成真实模型调用，并把返回结果重新转回内部消息协议。

**包含范围**：

- `executors/llm/base.py`
- `executors/llm/openai_responses.py`
- 只保留一个 `agent_runtime/session_engine.py`

**不包含范围**：

- `llm/anthropic_messages.py`
- `llm/local_openai_compat.py`
- `agent_runtime/external_runtime_adapter.py`

**参考项目**（原则：`llm/base.py` 只定义 executor 模块内部复用的 concrete base / helper，`session_engine.py` 是装配层，参考源只做边界对照）：

- Provider 适配对照：`other/openai/` — `llm/openai_responses.py` 可直接对接 Responses API；`llm/base.py` 只承载 provider 实现侧共用基类与 helper，不继承 OpenAI SDK，也不重复定义 `LLMProvider` 协议
- 长运行态对照：`other/hermes-agent/` — 提醒 runtime 以后会长出中断 / 恢复 / 超时问题

**为什么选它**：

v1 的关键是先跑通，不是先把 provider 做全。所以这里只保留一个最稳的 provider 落地，再配一个进程内 runtime。OpenAI 适合当第一份标准实现，Hermes 只用来提醒这层以后会长出中断、恢复、长运行态问题。

**`executors/llm/base.py` 的角色**：

- `LLMProvider` 这条跨模块协议的唯一真定义仍然放在 `core/contracts.py`
- `executors/llm/base.py` 不是第二份 provider interface 定义文件
- `executors/llm/base.py` 只放 executor 模块内部复用的 concrete base / helper，例如：
  - provider 适配器基类
  - 重试、超时、流式处理的共用封装
  - 请求 / 响应转换时的内部辅助函数
- 这里可以抽“实现基类”，但不能抽“新的跨模块协议”；凡是 `core` 要直接依赖的 provider 语言，都必须收口到 `core/contracts.py`

**与 `core/runner.py` 的边界**：

- `core/runner.py` 是唯一的 run loop 真身，负责 turn 推进、状态迁移、tool 回填、停止条件和结果收口
- `executors/llm/*` 只负责 provider 调用与协议转换
- `executors/agent_runtime/session_engine.py` 只能做装配层：
  - 组装 model provider、tool registry、session 实现、event sink
  - 组装 tool 执行前的高层安全链路，把 `CapabilityPolicy` / `PermissionPolicy` / `ApprovalProvider` 接成一条稳定执行链
  - 调用 `core/runner.py` 暴露的统一入口
  - 处理进程内运行时的启动参数和依赖注入
- `session_engine.py` 不允许重新实现 turn loop，不允许自己维护第二份 run state，不允许复制一套 tool orchestration

**与 `cli/main.py` 的边界**：

- `session_engine.py` 是进程内运行时库，不处理 CLI 概念
- `cli/main.py` 只负责参数解析和启动入口
- `cli/main.py` 调用 `session_engine.py` 完成装配，不自己拼 provider / tools / session
- 环境变量解析、命令行参数和终端模式选择都留在 CLI 层，不回流到 runtime 层

**风险与讨论点**：

- 如果 v1 同时落 OpenAI、Anthropic、本地兼容层，工程面会直接膨胀
- 如果把宿主桥接也塞进 runtime，这层会迅速失控
- 如果 `session_engine.py` 长成第二个 runner，后面一定会出现双核心

**task 建议**：

- 建议 task 名：`v1-model-executor`
- 是否进入 x-req：是
- 原因：这是第一个“真正把 agent 跑起来”的执行落地点

### 模块 5：Host Bridge + CLI Shell

**职责**：把同一套 core 接到第一个真实宿主上，并让人能够真正和它对话。

**包含范围**：

- `host/base.py`
- `host/session_bridge.py`
- `host/cli_adapter.py`
- `cli/main.py`
- `cli/repl.py`

**不包含范围**：

- `host/http_adapter.py`
- `host/game_adapter.py`
- `host/macos_adapter.py`
- 桌面 UI

**参考项目**（原则：`host/base.py` 和 `host/session_bridge.py` 只定义 host 模块自己的 concrete 组件，参考源只做边界对照）：

- CLI 最小实现对照：`other/Mini-Agent/` — 起一个最轻 CLI
- 双向协议对照：`other/cc-agent-sdk/` — subprocess + control protocol 模式，`host/session_bridge.py` 的关键参考
- 多宿主分层对照：`other/hermes-agent/` — 提醒 host 最后一定会多样化

**为什么选它**：

v1 需要一个真实宿主来验证最小闭环，但这个宿主只能是“验证载体”，不能反向定义系统架构。Mini-Agent 适合帮你先起一个轻 CLI，cc-agent-sdk 适合帮助你把双向 bridge 的心智建立起来，Hermes 则说明 host 最后一定会多样化。

**`host/base.py` 的角色**：

- `host/base.py` 不能再被理解成“宿主协议真定义文件”
- 如果未来存在会被 `core`、`host`、`executors` 共同消费的 `HostBridge` / `HostAdapter` 协议，它的真定义必须放回 `core/contracts.py`
- `host/base.py` 当前只承载 host 模块内部自己的 concrete base / helper，例如：
  - adapter 基类
  - 事件桥接辅助对象
  - 宿主侧默认实现会复用的公共逻辑
- 换句话说，`host/base.py` 可以定义“怎么实现一个宿主适配器”，但不能自己成为跨模块共享语言的真源

**`host/` 与 `cli/` 的边界**：

- `host/` 是宿主抽象与桥接层
- `host/base.py` 只放 host 模块内部复用的 concrete base / helper，不承担跨模块协议真定义
- `host/session_bridge.py` 负责 agent 事件流与宿主事件流的翻译
- `host/cli_adapter.py` 只是 CLI 这一类宿主的适配器
- `cli/` 是具体 CLI 应用入口：`main.py` 负责启动，`repl.py` 负责交互循环
- 将来新增 `http`、`game`、`macOS` 宿主时，应该新增新的 host adapter，而不是改 CLI 目录的核心语义

**风险与讨论点**：

- 最容易犯的错，就是把 CLI 写成半个 core
- 如果没有 `session_bridge.py`，以后 HTTP、游戏、桌面都会各自长出一套事件流

**task 建议**：

- 建议 task 名：`v1-host-cli-shell`
- 是否进入 x-req：是
- 原因：没有真实宿主，v1 只能停留在库层，不算最小可运行

### 模块 6：Safety Baseline

**职责**：给 v1 最小闭环加上最基本的安全边界，避免工具调用完全裸奔。

**包含范围**：

- `safety/capability_policy.py`
- `safety/permission_policy.py`
- `tools/approval.py` 的默认交互实现与策略接入配合

**不包含范围**：

- `safety/guardrails.py`
- classifier
- sandbox 正式落地
- prompt injection 独立模块
- computer use 细粒度安全策略

**参考项目**（原则：`capability_policy.py` 和 `permission_policy.py` 自己定义；`ApprovalProvider` 协议仍然以 `core/contracts.py` 为真源；其他文件参考源只做边界对照）：

- 权限链路对照：`other/claude-code-main/` — permission mode、规则来源、session/local/project 覆盖关系（这块可直接借语义）
- capability 边界自己定义 — 参考 `other/claude-code-main/` + `other/hermes-agent/` 的能力分层思路

**为什么选它**：

v1-mini 第一版不需要一整套成熟安全平台，先把“工具调用不要裸奔”这件事做对更重要。所以这一版先收住三层：能力门禁、具体调用判定、人工确认链路。Claude Code 适合参考权限链路，Hermes 适合提醒能力边界以后会跟宿主一起扩展。

**v1-mini 第一版的 Safety 范围**：

- 第一版只先做 `CapabilityPolicy + PermissionPolicy + ApprovalProvider`
- `ApprovalProvider` 的协议真定义仍然在 `core/contracts.py`
- `tools/approval.py` 提供默认 `InteractiveApproval`
- `CapabilityPolicy` 和 `PermissionPolicy` 先留在 `safety/` 内部，不提前升级成跨模块 Protocol
- `Guardrail` 明确后置；等工具安全链路稳定后，再补 model input / output / tool I/O 的语义拦截面
- `safety/` 对外优先表现为一条已经装配好的高层安全链路，而不是把内部 policy 组件接口直接暴露给 `Tool Runtime`

**`permission` 与 `capability` 的边界**：

- `capability_policy.py` 是粗粒度能力门禁，判断这次运行是否允许某类能力
- `permission_policy.py` 是细粒度规则判断，决定某次具体调用是 allow / deny / ask
- 一次工具调用的顺序固定为：先过 capability，再过 permission，最后才进入 approval / execute

**与 `tools/approval.py` 的边界**：

- 模块 6 不重新定义 approval 协议
- `permission_policy.py` 负责决定某次具体调用是否进入 `ask`
- `tools/approval.py` 在第一批负责默认交互实现，在第二批继续承接策略实现，不改变对外接口形状
- 换句话说：`permission` 决定要不要问，`approval` 负责真的去问

**与 Tool Runtime 的边界**：

- `CapabilityPolicy` 和 `PermissionPolicy` 是 `safety/` 内部组件，不是给 `Tool Runtime` 直接编程依赖的公共接口
- `Tool Runtime` 不直接 import 这两个 policy 的接口
- 运行时装配层负责把这两个内部判定子层和 `ApprovalProvider` 串成一条稳定安全链，再接回 tool 执行链

**风险与讨论点**：

- 如果完全不做这层，v1 虽能跑，但很快就会变成危险 demo
- 如果把 guardrail、classifier、sandbox、prompt injection 一次做全，v1 又会失焦

**task 建议**：

- 建议 task 名：`v1-safety-baseline`
- 是否进入 x-req：是
- 原因：这是最小能用和“只是能跑”之间的分界线

### 模块 7：Observability Baseline

**职责**：让 v1 至少能被看见、能被调试，不是黑箱跑。usage 聚合和 audit 审计延后到 v0.2+，从 trace JSONL 派生。

**包含范围**：

- `observability/trace_sink.py`（唯一的 `EventSink` 实现，JSONL 落盘，所有事件都进这里）

**不包含范围**（都延后到 v0.2+）：

- `observability/usage_meter.py`：从 trace JSONL 派生 token / cost / latency 聚合
- `observability/audit_log.py`：从 trace JSONL 派生 approval / guardrail / 拒绝审计
- `observability/event_log.py`：若后续要做独立结构化事件流再拆
- `otel_adapter.py` / `telemetry_redaction.py` / 完整 analytics

**参考项目**（原则：只做一个 trace sink，trace 抽象可直接借用）：

- trace 对照：`other/openai/` — `tracing/` 的 span / processor / provider 抽象可直接借用

**为什么选它**：

v0.1 阶段"最小可观测性"的定义是"能回看一轮 run 发生了什么"，一个 JSONL trace 就够了。OpenAI 的 tracing 抽象足够薄，适合做 v0.1 基线；usage 和 audit 的能力在 v0.2 按需从同一条 trace 流派生，不提前拆成三个文件。

**fan-out 单 sink 设计**：

- `EventSink` 是唯一跨模块事件入口 Protocol，定义在 `core/contracts.py`
- `core/runner.py` 持有 `list[EventSink]`，事件发生时 fan-out 到所有注册的 sink
- v0.1 只注册一个 `JsonlTraceSink`（本模块的唯一实现），所有事件（`llm.start` / `tool.call` / `approval.decision` / `usage` / `error` 等）都进它
- v0.2+ 追加 `UsageSink` / `AuditSink` 时，走同一条 `EventSink` Protocol，不改 runner 的 list 结构；也不替换 `JsonlTraceSink`，而是并列注册

**为什么不在 v0.1 就拆三个文件**：

- usage 和 audit 的"价值兑现"前提是 agent 真有非平凡使用量 / 非平凡安全事件；v0.1 是单用户本地 demo，两者都未触发
- 三个文件在 v0.1 阶段的实际内容会退化成"过滤 + 写文件"的重复代码
- 从一个 JSONL 派生多个视图是廉价的（小时级脚本），从三个独立 sink 合并回统一事件流是昂贵的（需要 schema 协调）

**风险与讨论点**：

- 如果 v0.1 就要求 audit 独立落地，得接受额外的代码量和 schema 成本
- 如果一上来就做 OTEL / export / redaction，全局复杂度会上来太快

**task 建议**：

- 建议 task 名：`v1-observability-baseline`
- 是否进入 x-req：是
- 原因：这是让 v1 可调试、可复盘、可演进的最小工程底座
