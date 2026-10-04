# 接口契约

这份文档不是再发明一套抽象，而是把 v1 最容易漂移的跨模块边界先钉死。

## 目标

v1 从第一天开始就遵守一个简单原则：

- 跨模块共享的协议只有一个代码真源：`core/contracts/`
- 其他模块只能 `import` 这些协议，不能在自己的目录里重定义一份同名接口

这样做不是为了“架构好看”，而是为了防止最常见的返工：`core`、`sessions`、`prompting`、`tools` 在不同时间各自长出一份 `Session`、`Tool`、`Approval` 抽象，最后整合时全都要重写。

## 单一代码真源

`core/contracts/` 只做一件事：定义跨模块共享的协议。调用方统一通过 `from core.contracts import ...` 消费公共入口。

v1 建议先把下面这些协议收进去：

- `Session`
- `Tool`
- `ToolLookup`（runner 只依赖这一层，不依赖具体 `tools/registry.py`）
- `ApprovalProvider`
- `LLMProvider`
- `SupportsLLMStream`（流式能力 Protocol，与 `LLMProvider` 正交；具备该能力的 provider 必须同时满足 `LLMProvider`）
- `EventSink`
- `MessageCompactor`（runner 在每个 turn 把 history 送给 LLM 之前的加工钩子）
- `PromptAssembler`（prompt build 统一入口协议，runner 对 `InputAssembler` 的视图）
- `PromptDebugSink`（prompt debug dump 输出协议）

以及以下数据结构 / 类型别名：

- `ToolContext`、`ToolResult`（工具执行上下文与结果）
- `ApprovalRequest`、`ApprovalDecision`、`ApprovalAction`（审批三件套）
- `LLMRequest`、`LLMResponse`（runner ↔ provider 的统一请求/响应）
- `LLMStreamChunk`、`StreamChunkKind`、`FinishReason`（流式增量事件）
- `AssembledInput`（`InputAssembler.assemble()` 的返回类型契约）
- `PromptSource`（指令来源的最小 Protocol）
- `Event`、`EventKind`（统一事件结构 + 事件类型枚举）

这里故意不把所有核心数据结构都塞进去。像 `Message`、`RunState`、`Result` 这类核心模型，仍然保留在 `core/message.py`、`core/run_state.py`、`core/result.py` 这样的唯一真定义文件里，只要项目里没有第二份定义就可以。

## 依赖方向

这条规则后面应该变成 CI 约束，但文档里先写死：

- 所有模块都可以 import `core`
- `core` 不允许 import 任何 sibling 模块
- `sessions / prompting / tools / infrastructure / runtime_assembly / safety / host / cli` 只能消费 `core` 暴露的协议和核心模型

可以把它理解成一句更工程化的话：

> `core` 决定语言；其他模块提供实现。

## Session 边界

Session 相关约束最重要，因为这一层最容易重复定义。

- `core/contracts/session.py` 定义 `Session` 协议，并由 `core/contracts/__init__.py` 统一导出
- `core/session.py` 提供第一批默认的 `InMemorySession` 实现
- `sessions/session_store.py` 是第二批工程化实现，职责是持久化、恢复和存取管理
- `sessions/session_store.py` 必须实现 `core.contracts` 里的 `Session` 协议，不能重新定义新的 Session 接口

换句话说，第二批做的是“新增实现”，不是“新增抽象”。

## Approval 边界

approval 也必须两阶段分清。

- 第一批 `Tool Runtime` 负责接 approval 协议，并提供默认交互实现
- `ApprovalProvider` 是当前唯一先明确 Protocol 化的 safety 入口，因为 `Tool Runtime` 会直接消费它
- 第二批 `Safety Baseline` 在不改协议形状的前提下，增加策略驱动实现

建议落地方式：

- `core/contracts/approval.py` 定义 `ApprovalProvider`
- `tools/runtime/approval.py` 提供默认 `InteractiveApproval`
- `safety/permission_policy.py` 决定哪些调用进入 `ask`
- `tools/runtime/approval.py` 在 `ask` 时真的去拿人工确认结果

这样第一批和第二批操作的是同一条接口，不会出现“先做一版 approval，后面再推翻”的情况。

## Capability 与 Permission

这两个词必须从一开始就分开。

- 它们在 `v1-mini` 里先作为 `safety/` 模块内部的判定子层存在，**不急着放进 `core/contracts/`**
- `capability_policy.py` 是粗粒度能力门禁，回答“这次运行是否允许使用这类能力”
- `permission_policy.py` 是细粒度规则判断，回答“这个具体工具调用是否允许 / 拒绝 / 需要确认”
- `Tool Runtime` 不需要直接依赖它们的抽象协议，也不应该直接 import 这两个内部 policy 组件
- 运行时装配层负责把 capability / permission / approval 串成一条稳定安全链，`Tool Runtime` 只消费装配后的高层判定结果

调用顺序固定为：

1. 先过 capability
2. 再过 permission
3. 最后才进入 approval / execute

如果一开始不把这层顺序定死，后面很容易把两者揉成一个大文件。

## Safety 分层规则

`v1-mini` 里先不要把所有 safety 概念都 Protocol 化。

- 先区分三类东西：
  - 跨模块稳定入口
  - `safety/` 内部判定子层
  - `safety/` 内部实现机制
- 只有“会被多个模块直接消费，而且需要稳定替换实现”的对象，才进入 `core/contracts/`
- 目前先满足这个条件的，是 `ApprovalProvider`
- `CapabilityPolicy` 和 `PermissionPolicy` 先留在 `safety/` 内部，先固定职责和调用顺序，不提前冻结接口形状
- `Guardrail` 先视为后续增强项；在真正需要 core / executors / observability 共同依赖同一个 guardrail 插件面之前，不先提升为跨模块 Protocol

一句话说，`v1-mini` 现在先固定的是 **安全链路顺序**，不是把所有安全概念都抽成公共语言。

## Native Runtime 边界

`session_engine.py` 不是第二个 runner，它只是运行时装配层。

- `core/runner.py` 是唯一的 run loop 真身
- `runtime_assembly/session_engine.py` 负责把 provider、tool registry、session、event sink 装起来，再调用 `core/runner.py`
- `cli/main.py` 只负责 CLI 参数解析和启动入口，不能复制装配逻辑

一句话说清楚就是：

> `runner` 负责跑，`session_engine` 负责装，`cli/main` 负责进。

## Host 与 CLI

这条虽然不是契约接口，但属于重要边界。

- `host/` 是宿主抽象与桥接层
- `cli/` 是 CLI 这个具体产品入口
- `cli/` 依赖 `host/cli_adapter.py`
- 将来新增 `http`、`game`、`macOS` 宿主时，不应该改 `cli/` 的核心语义

## Observability / EventSink 边界

v1 用"单 Protocol + fan-out 多 sink"模式，不提前拆出多个事件协议。

- `core/contracts/event_sink.py` 定义唯一的 `EventSink` 协议，方法只有一个 `emit(event) -> None`
- `core/runner.py` 持有 `list[EventSink]`，事件发生时 fan-out 到所有注册的 sink
- v1（第二批 `v1-observability-baseline`）只实现一个 sink：`infrastructure/tracing/trace_sink.py` 的 `JsonlTraceSink`，所有事件（`llm.start` / `tool.call` / `approval.decision` / `usage` / `error` 等）都进同一份 JSONL
- v0.2+ 追加 `UsageSink`（从 JSONL 派生 token/cost 聚合）/ `AuditSink`（派生 approval / guardrail 审计）时，走同一个 `EventSink` Protocol，**不新增事件协议**，也不替换 `JsonlTraceSink`——它们是并列注册

换句话说，`EventSink` 是跨模块唯一事件入口协议；`trace_sink.py` / `usage_meter.py`（v0.2）/ `audit_log.py`（v0.2）都是它的并列实现类。

`EventKind` 是 `Literal` 类型别名，v1 基础事件为 `run.start` / `run.end` / `turn.start` / `turn.end` / `llm.request` / `llm.response` / `tool.call.start` / `tool.call.end` / `approval.request` / `approval.decision` / `error`。后续版本按模块扩展：

- v0.2 流式（llm-streaming-v1）：`content.delta` / `reasoning.delta` / `llm.chunk.first` / `llm.stream.end`
- v0.1.3 memory：`memory.write.success` / `memory.write.rejected` / `memory.write.error` / `memory.snapshot.refreshed`
- v0.1.4 safety：`tool.denied` / `tool.approval_required` / `tool.silently_allowed`
- v0.1.6 skill：`skill.discovered` / `skill.shadowed` / `skill.parse_failed` / `skill.skipped` / `skill.invoked` / `skill.completed`

新增 `EventKind` 不改 `EventSink` Protocol，只扩展 `Literal` 联合类型。

**不要做的事**：

- 在 `infrastructure/tracing/` 或 `safety/` 里新定义 `TraceSink` / `AuditSink` / `UsageSink` Protocol——它们是 `EventSink` 的具体实现类，不是独立协议
- 把"fan-out"做成某个 sink 的内部职责——fan-out 是 runner 持有 list 的事

## 建议的最小 CI 约束

v1 不需要一口气做满，但至少建议有三条：

1. `core` 不允许 import sibling 模块
2. `sessions` 不允许新定义 `Session` 协议
3. 跨模块共享协议只能来自 `core/contracts/`

文档约束只是第一层。真正稳妥的做法，是后续把这三条接进 `import-linter` 一类工具，让违规直接在 CI 里变红。
