# v1-minimal 边界与定义位置对齐审查（v2 校准版）

> 本版为 93 重写（方案 B）。旧版把 v2（文件级粒度）和 v1-minimal（模块级粒度）混在一起比对，得出多处错判，并漏了 `10-contracts.md` 的内容。本版重新钉住三个维度：**定义位置 / 模块边界 / 参考源粒度**，逐模块核对。
>
> 相关文档：
> - `docs/模块拆分借鉴-v2.md`（文件级参考源）
> - `02-module-breakdown.md`（模块级拆分，已应用方案 A）
> - `10-contracts.md`（SSOT 契约位置说明）
> - `README.md`（边界硬规则）

---

## 0. 审查三原则

### 0.1 原则 1：定义位置（SSOT）

每个类型只应该有一处"真定义"：

| 类型 | 定义位置 | 消费方 |
|---|---|---|
| **跨模块共享 Protocol**（interface） | `core/contracts.py` | 所有模块 |
| **核心数据模型**（concrete dataclass） | `core/message.py` / `core/run_state.py` / `core/result.py` 等 | 所有模块 |
| **模块内 concrete**（类/函数） | 模块自己的文件 | 只本模块 + 其 DI 下游 |

`10-contracts.md` 目前列了 5 个 Protocol 进 `core/contracts.py`：`Session` / `Tool` / `ApprovalProvider` / `LLMProvider` / `EventSink`。

### 0.2 原则 2：模块边界

模块之间通过 Protocol 或 concrete model 通信，**不互相 import 内部 concrete 类**。判断边界清不清，看两件事：

1. 本模块对外暴露的只是 Protocol/model，不是实现细节
2. 本模块消费的也只是 Protocol/model，不 import 别的模块的内部类

### 0.3 原则 3：参考源粒度

v2 的参考源是**文件级**（每个文件单独标注参考源）；v1-minimal 是**模块级**（整个模块用同一组参考源）。

模块级表述**不是错**，但在 v2 的"大部分文件自己定义 + 借边界对照"语境下，需要在"包含范围"或模块正文里**为每个关键文件单独点明**借用粒度，不能只写"主参考 X"了事。

Option A 已经统一改成"XX 对照：YY"的措辞，避免"主参考"误导。但**文件层面的精细度**仍待补全。

---

## 1. 全局问题清单

### 🔴 问题 G1：把 Safety 和 Host 的关键概念一股脑全 Protocol 化，结论过重

`10-contracts.md` 目前的 Protocol 清单：`Session` / `Tool` / `ApprovalProvider` / `LLMProvider` / `EventSink`。

旧判断把下面这些概念都直接推成“必须进 `core/contracts.py` 的 Protocol”：

| Protocol | 谁定义语义？ | 谁实现？ | 目前归属 |
|---|---|---|---|
| `RunHooks` / `Lifecycle` | Core Runtime | Observability、Safety（挂钩监听） | v2 提到 `core/lifecycle.py`，但 10-contracts.md 没列进 contracts.py |
| `Guardrail` | Core Runtime | Safety（`guardrails.py`） | 同上，无明确定义位置 |
| `PermissionPolicy` | Tool Runtime 消费 | Safety（`permission_policy.py`） | 没列进 contracts.py |
| `CapabilityPolicy` | Tool Runtime + Model Executor 消费 | Safety（`capability_policy.py`） | 没列进 contracts.py |
| `HostBridge` / `HostAdapter` | Core Runtime + Runner 要向它发事件 | Host（`host/base.py` / `session_bridge.py`） | 没列进 contracts.py |

但按现在的 `v1-mini` 方案，不能这样一刀切：

- `ApprovalProvider` 继续保留为跨模块 Protocol，这条没问题
- `CapabilityPolicy` 和 `PermissionPolicy` 先作为 `safety/` 模块内部判定子层存在，先固定职责和调用顺序，不急着放进 `core/contracts.py`
- `Tool Runtime` 不应该直接 import 这两个内部 policy；运行时装配层把 capability / permission / approval 串成高层安全链，tool 执行链只消费装配后的判定结果
- `Guardrail` 已经明确后置，不属于 `v1-mini` 第一版强制范围
- `RunHooks / Lifecycle` 是否要升成跨模块 Protocol，取决于后面是否真的形成多模块共同消费的稳定 hooks 面，当前只能算待定
- `HostBridge` 仍然是这里面最强的候选项，因为它确实涉及 core 和 host 的共享边界

**真正的风险**：不是“少了 5 个 Protocol”，而是如果不先分清“跨模块稳定入口”和“模块内判定子层”，实现阶段会把所有重要概念都过早冻结成公共语言。

**建议**：保留 `ApprovalProvider` 的 Protocol 地位；把 `CapabilityPolicy` / `PermissionPolicy` 明确写成 `safety/` 内部子层；把 `Guardrail` 标成后置；单独继续追 `HostBridge` 是否需要进入 `core/contracts.py`。

### 🔴 问题 G2：`EventSink` vs `TraceSink` 命名分叉

- `10-contracts.md` 列 `EventSink`（Protocol，放 contracts.py）
- `02-module-breakdown.md` 模块 7 列 `observability/trace_sink.py`（concrete 文件）

这两个是同一个东西？如果 `trace_sink.py` 是 `EventSink` 的实现，命名应该统一（要么都叫 event，要么都叫 trace），或者在文档里写明关系。

目前的分叉有可能导致：

- 有人新建 `TraceSink` Protocol 在 `observability/` 里（和 contracts.py 的 `EventSink` 冲突）
- 或者有人以为两者无关，分别定义

### 🔴 问题 G3：Tool 和 LLMProvider 的 "base.py" 角色模糊

- `10-contracts.md` 说 `Tool` Protocol 在 `contracts.py`
- `02` 模块 2 列 `tools/base.py`

`tools/base.py` 到底是什么？三种可能：

1. **`Tool` Protocol 的第二份定义** —— 违反 SSOT，错误
2. **concrete 基类**，给 builtin tool 复用（retry、logging 等共通逻辑） —— 合理
3. **ToolCall / ToolResult 等配套数据结构** —— 合理

同样问题：`executors/llm/base.py` vs `contracts.py` 里的 `LLMProvider`。

**建议**：在 `10-contracts.md` 或 `02` 模块 2/4 里明确这些 `base.py` 的角色，防止开发者误写成 Protocol 第二次定义。

### 🟡 问题 G4：v2 点到但 v1-minimal 仍缺的模块

| 模块 | v2 定位 | v1-minimal 当前状态 |
|---|---|---|
| `context/context_engine.py` | 新增，v0.1 就该留薄接口，参考 Hermes | **没列进模块 3** |
| `context/skill_loader.py` | 调整，Mini-Agent v0.1 | **没列进模块 3**（只在 v2 第 3 周才补） |
| `observability/event_log.py` | 调整，自己定义，参考 Claude analytics + Hermes hooks | **没列，也没在"不包含范围"排除** |

### 🟡 问题 G5：`core/lifecycle.py` 既是 Protocol 又是实现？

v2 说：`lifecycle.py` 是 run-level 生命周期钩子的"纯协议"。

v1-minimal 模块 1 把它列进"包含范围"，和 `runner.py`、`run_state.py` 平级。但根据 10-contracts.md 的原则，**Protocol 应该进 contracts.py**。那 `core/lifecycle.py` 应该：

- 要么是 `RunHooks` Protocol 的定义文件，但这样违反 10-contracts.md 的 SSOT 原则
- 要么是一个配套实现文件（例如默认的 no-op hooks），Protocol 本体应该进 contracts.py

---

## 2. 按模块逐个审查

每个模块按"**文件 × 定义位置 × 邻接边界**"三列看。状态图例：✅ 清晰 / ⚠️ 待澄清 / ❌ 有 SSOT 或边界问题。

### 模块 1 Core Runtime

**文件与定义位置**：

| 文件 | 应有角色 | 现状 | 状态 |
|---|---|---|---|
| `core/contracts.py` | SSOT 跨模块 Protocol 集合 | 10-contracts 列了 5 个 | ✅ v1-mini 保持 5 个；safety 通过方式 A（装配层注入 callable）消化，不新增 Protocol |
| `core/agent_spec.py` | concrete dataclass（AgentSpec） | 未澄清是否含 Protocol | ✅ 预期清晰 |
| `core/runner.py` | concrete 主循环 | 唯一真 runner（依 module 4 边界声明） | ✅ |
| `core/run_state.py` | concrete dataclass（可序列化） | ✅ | ✅ |
| `core/session.py` | `Session` Protocol 的 `InMemorySession` 实现 | 10-contracts.md 已明确 | ✅ |
| `core/lifecycle.py` | Protocol OR 实现？ | ❌ 见 G5 | ❌ |
| `core/message.py` | concrete dataclass | ✅ | ✅ |
| `core/result.py` | concrete dataclass | ✅ | ✅ |
| `core/errors.py` | 异常类集合 | ✅ | ✅ |

**与邻接模块的边界**：

- vs 模块 2：`Tool` Protocol 来自 `contracts.py`，core 只消费；✅
- vs 模块 3：`Session` Protocol 来自 `contracts.py`；`core/session.py` 提供 `InMemorySession`；`context/session_store.py` 提供持久化实现；两边都实现同一 Protocol，不重定义；✅（10-contracts.md 已钉死）
- vs 模块 4：`core/runner.py` 是唯一 runner，`executors/agent_runtime/session_engine.py` 是装配层；02 模块 4 里已经专门画了边界；✅
- vs 模块 5：`HostBridge` 仍是 contracts.py 的候选，但 v1-mini 先用 `host/base.py` concrete 基类 + `session_bridge.py` 完成；待多宿主真正落地时再收口；⚠️（待定）
- vs 模块 6：v1-mini 选方式 A（装配层注入 safety gate callable），Tool Runtime 不反向 import safety；guardrail / RunHooks 后置，不在本版本阻塞；✅
- vs 模块 7：`EventSink` Protocol 已在 contracts.py，单 sink fan-out 设计已定；仅剩命名分叉；⚠️（G2）

**参考源粒度**：
Option A 之后已经按"骨架对照 openai / 长生命周期对照 hermes"表述，粒度对齐了 v2 精神。✅

**模块状态**：⚠️ 主要剩 G2（命名分叉）和 G5（`lifecycle.py` 文件角色待澄清）；G1 已通过"方式 A 注入 callable + 延后非阻塞项"收口

---

### 模块 2 Tool Runtime

**文件与定义位置**：

| 文件 | 应有角色 | 现状 | 状态 |
|---|---|---|---|
| `tools/base.py` | concrete 基类 OR 配套类型？ | ❌ 见 G3 | ❌ |
| `tools/registry.py` | concrete Registry 实现 | ✅ | ✅ |
| `tools/approval.py` | `ApprovalProvider` 的 `InteractiveApproval` 实现 | 10-contracts 已钉 | ✅ |
| `tools/file_tools.py` | concrete `Tool` 实现 | ✅ | ✅ |
| `tools/shell_tool.py` | concrete `Tool` 实现 | ✅ | ✅ |

**与邻接模块的边界**：

- vs 模块 1：消费 `Tool` Protocol、`ApprovalProvider` Protocol；✅
- vs 模块 6：第一批只做 `InteractiveApproval`，第二批继续沿同一 `ApprovalProvider` 协议加策略实现；✅
- vs 模块 6 的 `PermissionPolicy` / `CapabilityPolicy`：当前文档已经收口成 safety 内部判定子层，Tool Runtime 只按固定顺序消费判定结果，不要求它们先变成公共 Protocol；✅

**参考源粒度**：Option A 后已经"最小闭环对照 Mini-Agent / 协议边界对照 openai / 产品实现对照 claude-code-main"，✅

**模块状态**：⚠️ 主要剩 G3 已澄清后的同步问题

---

### 模块 3 Session / Context

**文件与定义位置**：

| 文件 | 应有角色 | 现状 | 状态 |
|---|---|---|---|
| `context/session_store.py` | `Session` Protocol 的持久化实现 | 10-contracts 明确 | ✅ |
| `context/history_compactor.py` | concrete compactor | 无 Protocol（只是本模块内实现） | ✅ |
| `context/instruction_loader.py` | concrete loader | ✅ | ✅ |
| `context/input_assembler.py` | concrete assembler | ✅ | ✅ |
| `context/context_engine.py` | **v2 要求，v1-minimal 缺** | ❌ G4 | ❌ |
| `context/skill_loader.py` | v2 提到，v1-minimal 缺 | ❌ G4 | ⚠️（可延后到第 3 周，但应在文档说清） |

**与邻接模块的边界**：

- vs 模块 1：双方都实现 `Session`，无重定义；10-contracts.md 明确；✅
- vs 模块 7：如果 `history_compactor.py` 的 compact 事件要 emit 到 trace，要走 `EventSink`；目前未明说；⚠️
- vs 未来 memory 模块：context vs memory 边界在 02 里已经写"不包含长期 memory"；✅

**参考源粒度**：Option A 后 ✅

**模块状态**：❌ 有 G4 的两个文件缺失 + G2 的 event 命名分叉待确认

---

### 模块 4 Model Executor

**文件与定义位置**：

| 文件 | 应有角色 | 现状 | 状态 |
|---|---|---|---|
| `executors/llm/base.py` | ❓ 见 G3 | ❌ 待澄清 | ❌ |
| `executors/llm/openai_responses.py` | `LLMProvider` 的 OpenAI 实现 | 10-contracts 里 `LLMProvider` 在 contracts.py | ✅ |
| `executors/agent_runtime/session_engine.py` | concrete 装配层 | 02 模块 4 已经画清边界，不重实现 runner | ✅ |

**与邻接模块的边界**：

- vs 模块 1：`LLMProvider` Protocol 在 contracts.py，runner 消费 Provider；02 已明确 "runner 负责跑，session_engine 负责装"；✅
- vs 模块 5：`session_engine.py` 不处理 CLI 概念，CLI 层调用它；02 已明确；✅
- vs 模块 6：`v1-mini` 第一版已把 guardrail 明确后置，这里当前只需保证 model executor 不提前绑定第二套安全接口；✅

**参考源粒度**：Option A 后 ✅

**模块状态**：⚠️ 主要是 G3 的角色澄清同步

---

### 模块 5 Host Bridge + CLI

**文件与定义位置**：

| 文件 | 应有角色 | 现状 | 状态 |
|---|---|---|---|
| `host/base.py` | host 模块内部 concrete base / helper，不是协议真源 | 02 已明确 | ⚠️ 仍待 HostBridge 最终收口 |
| `host/session_bridge.py` | concrete 双向事件桥 | ✅ | ✅ |
| `host/cli_adapter.py` | concrete CLI adapter | ✅ | ✅ |
| `cli/main.py` | 入口 | ✅ | ✅ |
| `cli/repl.py` | 交互循环 | ✅ | ✅ |

**与邻接模块的边界**：

- vs 模块 1：`host/base.py` 已明确不能承担协议真源；后续如果确认 `HostBridge` 是跨模块稳定入口，应回到 `core/contracts.py`。这仍是待收口项；⚠️
- vs 模块 4：`session_engine` 和 `cli/main` 的分工 02 已经画清；✅

**参考源粒度**：Option A 后 ✅

**模块状态**：⚠️ 核心待定项是 `HostBridge` 是否进入 `core/contracts.py`

---

### 模块 6 Safety Baseline

**文件与定义位置**：

| 文件 | 应有角色 | 现状 | 状态 |
|---|---|---|---|
| `safety/guardrails.py` | 后续增强项 | 已移出 v1-mini 第一版范围 | ✅ |
| `safety/permission_policy.py` | safety 内部细粒度规则判定层 | 10-contracts 已明确不急着 Protocol 化 | ✅ |
| `safety/capability_policy.py` | safety 内部粗粒度能力门禁层 | 10-contracts 已明确不急着 Protocol 化 | ✅ |
| `tools/approval.py`（策略版） | `ApprovalProvider` 的 `PolicyApproval` 实现 | 10-contracts 已明确 | ✅ |

**与邻接模块的边界**：

- vs 模块 2：`ApprovalProvider` 仍是跨模块唯一稳定入口；`permission` 决定 ask，`approval` 负责真的去问；`Tool Runtime` 不直接 import 内部 policy；✅
- vs 模块 1：guardrail 已后置，不再作为第一版阻塞项；✅
- vs 模块 7：audit_log 要记录 approval/deny 事件——需要走 `EventSink`；目前 02 模块 7 说三者互不依赖，可能没挂通；⚠️

**参考源粒度**：Option A 后 ✅

**模块状态**：✅ 第一版边界已收口；后续只需在 guardrail 真进入主路径时再决定是否 Protocol 化

---

### 模块 7 Observability Baseline

**文件与定义位置**（02 已收口为单 sink fan-out 设计）：

| 文件 | 应有角色 | 现状 | 状态 |
|---|---|---|---|
| `observability/trace_sink.py` | `EventSink` Protocol 的唯一实现 `JsonlTraceSink` | 02 已明确，所有事件都进同一份 JSONL | ⚠️ G2（命名分叉待收口） |

**已延后到 v0.2+**：`usage_meter.py` / `audit_log.py` / `event_log.py` / `otel_adapter.py` / `telemetry_redaction.py`——都从同一份 trace JSONL 派生或按需再拆。

**与邻接模块的边界**：

- 所有需要订阅运行时事件的模块，都通过 `core/runner.py` 注册 `EventSink`；sink 内部自行过滤关心的事件 kind；跨模块订阅入口只有 `EventSink`；✅（Fan-out 方案已定）
- 命名分叉（`EventSink` Protocol vs `trace_sink.py` 文件名）仍在；❌（G2）

**参考源粒度**：Option A 后 ✅

**模块状态**：⚠️ 仅剩 G2 命名分叉

---

## 3. 7 个模块状态汇总

| 模块 | 定义位置清晰度 | 邻接边界清晰度 | 参考源粒度 | 综合 |
|---|---|---|---|---|
| 1 Core Runtime | ✅ contracts 5 个已收口 | ⚠️ G2 + G5 | ✅ | ⚠️ |
| 2 Tool Runtime | ⚠️ G3 | ✅ 方式 A（注入 callable）已选定 | ✅ | ⚠️ |
| 3 Session / Context | ❌ G4 两文件缺 | ⚠️ G2 | ✅ | ❌ |
| 4 Model Executor | ⚠️ G3 | ✅ | ✅ | ⚠️ |
| 5 Host + CLI | ⚠️ `HostBridge` 仍待多宿主落地再收口 | ⚠️ core-host 共享语言仍待钉死 | ✅ | ⚠️ |
| 6 Safety | ✅ 第一版收口 | ⚠️ G2（audit 跨模块订阅待明示） | ✅ | ⚠️ |
| 7 Observability | ⚠️ G2 命名分叉 | ✅ 单 sink fan-out 已定 | ✅ | ⚠️ |

**共性根因**：旧审查看到概念重要，就倾向于把它们全部提升成 `core/contracts.py` 中的 Protocol。v1-mini 的正确口径是：**先区分“跨模块稳定入口”和“模块内部子层”——只有跨模块稳定入口进 contracts.py，其他通过装配层注入 callable（方式 A）消化**。

---

## 4. 建议的后续动作

按影响面排序：

### 🔴 动作 1：v1-mini 的 Protocol 清单定为 5 个，safety 用方式 A 注入

v1-mini `core/contracts.py` 保持 5 个 Protocol：`Session` / `Tool` / `ApprovalProvider` / `LLMProvider` / `EventSink`。**不再追加 5 个 Protocol**，原因见下：

| 原拟增加 | v1-mini 落地方式 | 是否 Protocol 化 |
|---|---|---|
| `PermissionPolicy` | 留在 `safety/permission_policy.py` 内部，Tool Runtime 不直接看见 | ❌ 不 Protocol 化 |
| `CapabilityPolicy` | 留在 `safety/capability_policy.py` 内部，Tool Runtime 不直接看见 | ❌ 不 Protocol 化 |
| `Guardrail` | 明确后置，v1-mini 第一版范围外 | 🕒 v0.2+ 再决定 |
| `RunHooks` / `Lifecycle` | 待定——看后续是否真出现多模块订阅同一 hook 面 | 🕒 暂不收口 |
| `HostBridge` | 仍是候选——v1-mini 先用 `host/base.py` concrete 基类 + `session_bridge.py` 完成；多宿主真正落地再升 | 🕒 暂不升 |

**safety 的接入方式**：**方式 A（装配层注入 callable）**。

```python
# executors/agent_runtime/session_engine.py（装配层）
from safety.pipeline import build_safety_pipeline
safety_gate = build_safety_pipeline(capability=..., permission=..., approval=...)
registry = ToolRegistry(safety_gate=safety_gate)
```

- `tools/registry.py` 只收一个 `Callable[[ToolCall], Decision]`，不 import safety
- `safety/` 内部怎么拆 capability / permission 都是私有实现细节
- `core/contracts.py` 不因此增加新 Protocol

理由：Tool Runtime 只需要"已判定结果"，不需要看见 safety 内部的 capability 和 permission 各自长什么接口。符合 Interface Segregation Principle——只把"会被多个模块直接消费、需要稳定替换实现"的抽成公共 Protocol，其他保持私有。

### 🔴 动作 2：统一 `EventSink` vs `TraceSink` 命名

选一条：

- 方案 a：`contracts.py` 里 `EventSink` 改名 `TraceSink`，`observability/trace_sink.py` 保留现名
- 方案 b：保留 `EventSink`，`observability/trace_sink.py` 改名 `observability/event_sink.py`（或保留文件名，把 class 命名 `EventTraceSink`/`TraceEventSink` 等）

然后在 10-contracts.md 加一行："`EventSink` 是跨模块唯一事件通道 Protocol；`trace_sink.py` / `usage_meter.py` / `audit_log.py` 都是它的不同实现"。

### 🟡 动作 3：澄清 `base.py` 的角色

在 02 模块 2/4/5 的"包含范围"里，为每个 `base.py` 加一句说明：

- `tools/base.py`：concrete Tool 基类（提供 retry / logging / Tool 元数据默认值），**不是** Protocol 定义
- `executors/llm/base.py`：concrete Provider 基类（提供共通 retry / timeout / stream 逻辑），**不是** Protocol 定义
- `host/base.py`：见动作 1（应该只放 concrete 基类，Protocol 进 contracts.py）

### 🟡 动作 4：补齐模块 3 的 G4 文件

- `context/context_engine.py`：v2 已经强调 v0.1 就该有薄接口——在 02 模块 3"包含范围"加进去，明确"只是薄接口，不实现策略"
- `context/skill_loader.py`：明示安排在第 3 周（v2 已经这么说）——在 02 模块 3 加一条或在 90-task-map 的第一批备注里点出
- `observability/event_log.py`：要么列进模块 7，要么在模块 7"不包含范围"明确后置

### 🟢 动作 5：在 10-contracts.md 加一节"定义位置对应表"

给一张**全局速查表**，把 v1-minimal 7 个模块涉及的所有"可能跨模块的类型"和它们的定义位置列清，比如：

| 类型 | 类别 | 定义位置 |
|---|---|---|
| `Session` | Protocol | `core/contracts.py` |
| `Message` | dataclass | `core/message.py` |
| `RunState` | dataclass | `core/run_state.py` |
| `Tool` | Protocol | `core/contracts.py` |
| `ToolCall` / `ToolResult` | dataclass | `core/message.py`（作为 Message 内容类型）还是 `tools/base.py`？→ 需要决定 |
| `AgentSpec` | dataclass | `core/agent_spec.py` |
| ... | ... | ... |

这张表一建，所有"定义位置模糊"的隐患都一次性透明化。

---

## 5. 与 93 旧版的差异

| 条目 | 旧版（已作废） | 本版 |
|---|---|---|
| 审查维度 | 只看"主参考 X"措辞 | 定义位置 / 模块边界 / 参考源粒度 三维度 |
| 数据错误 | "v2 80% 模块降级为自己定义"夸大 | 去掉百分比，按文件清单点到为止 |
| 对照表 | 多处"漏了 X"是错判（X 其实在模块级列了） | 重建按"定义位置"和"邻接边界"逐条检查 |
| 10-contracts.md 的地位 | 没考虑 | 作为 SSOT 基准文档纳入审查 |
| 结论 | 建议 Option A（已落地） | 动作 1 定为"方式 A 注入 callable + contracts.py 保持 5 个"，不扩 Protocol；其余动作针对 G2/G3/G4 等具体问题 |

---

## 6. 一句话总结

**v1-mini 的 SSOT 契约清单定为 5 个，不再扩充**。Safety 通过装配层注入 callable（方式 A）消化 capability / permission，避免把所有安全概念过早冻结成公共 Protocol。剩余待修的是 G2（`EventSink` vs `trace_sink.py` 命名分叉）、G3（`base.py` 角色模糊）、G4（`context_engine` / `skill_loader` 缺位）——都是局部文件级同步，不影响主路径开工。
