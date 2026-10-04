> spec_version: 3
> adversarial_risk_version: 3
> complexity: 4
> importance: 3
> risk_average: 3.5
> review_budget: deep
> adversarial_review: complete

# evolution-reviewer-tool-call-guard-v0.1

## 任务目标

- evo child reviewer 对每次 LLM 响应执行工具调用合同校验：允许工具集合以当次 `LLMRequest.tools` 为唯一真源，并要求一条被接受的 reviewer 响应恰好调用一次声明工具。
- evo reviewer run 内当前一次 LLM 请求的 provider 流式响应出现首个未声明工具或第二个工具调用时，立即关闭该 provider 响应流、原子丢弃整条 assistant 响应，并在 `.kongming/logs/evolution.log` 写入一条可定位的 ERROR 日志。
- 首次合同违规后，使用未污染的原始历史发起一次纠错请求；纠错提示明确指出违规种类、当前允许工具和“只调用一次后停止”的要求，提示本身只存在于重试请求。
- 纠错请求再次违规时终止 reviewer，最终只产生一次 `evolution.review.failed` 通知；被拒绝的工具不执行、不写 session、不生成 `tool.call.start/end` 卡片。
- 非流式 provider 在完整响应返回后、任何 assistant/session/tool 副作用发生前执行等价校验。
- reviewer 成功执行一次 `evolution_write` 后结束本次 child run，不再发起写入后的终结性 LLM 请求。

## 非目标

- 不修改 thread 取消、interrupt、Stop 按钮、`CancelledError`、`run.cancelled`、thread status 或主 thread 生命周期逻辑。
- 不把 evo task 绑定主 thread 的取消状态，也不以主 thread 是否活跃作为 reviewer 合同判断条件。
- 不修改普通 Agent 默认的未知工具行为；未显式启用新合同的 run 继续通过现有 `tool_unavailable` 结果收口。
- 不修改 provider 的工具 schema 转换、模型厂商 payload 或全局 `tool_choice` 策略。
- 不新增或修改 Web REST/WS wire 帧，不改前端组件。
- 不改变 `evolution_write` 现有 payload 容错、字段补全、养料过滤和持久化语义；参数执行期校验继续由该 Tool 自己负责。

## 风险评分依据

- 复杂度：4。改动穿过 `core.contracts → Runner 流式/非流式消费 → SessionEngine run 级透传 → evolution reviewer/log sink`，同时约束响应原子性、一次纠错状态、异步流资源释放、session 副作用和事件可见性，属于核心高损失链路与多组件一致性。
- 重要性：3。功能面向所有启用 evolution 的用户，失败会污染后台 review、日志和聊天工具卡展示；evolution 属于全用户可用的非核心能力。
- 预算升级：平均分 3.5 映射为 `deep`；复杂度单维为 4，预算保持 `deep`。

## 影响边界与不变量

| 模块 | 角色 | 本次影响 | 主要风险 | 必须保持的不变量 | 依据 |
|---|---|---|---|---|---|
| `src/core/contracts/` | 目标 | 新增 frozen 的 run 级 LLM 工具调用合同、封闭模式枚举和合同违规错误/事件语义 | 合同字段与 Runner 行为漂移 → evo 看似启用严格模式但实际走默认路径 | 跨模块合同只在 `core.contracts` 定义；允许工具集合始终取当次 `LLMRequest.tools`，不复制第二份名称白名单 | `J2`、`J8` |
| `src/core/errors.py` | 目标 | 新增独立 LLM 工具调用合同错误，供 Runner 失败收口 | 复用取消或通用 ToolError → 协议违规被投影成错误的生命周期状态 | 合同违规错误属于 LLM 响应校验；不继承或转换为取消语义 | `J7`、`J8` |
| `src/core/runner.py` | 目标 | 对显式合同执行流式早停、非流式原子校验、单次纠错和终态错误收口 | 校验发生在 append/execute 之后或逐个边校验边执行 → 未声明调用前的合法调用仍产生副作用 | 被拒绝 assistant 响应整体不进入 session；其中任何工具调用均不执行；整条响应通过合同校验后才允许首个工具执行；协议违规不产生取消事件 | `J3`、`J4`、`J7`、`J11` |
| `src/runtime_assembly/session_engine.py` | 上游 | `SessionEngine.run()` 将可选合同原样透传给唯一 Runner | 装配层自建重试循环 → 复制第二套 turn 推进 | 装配层只透传合同；重试和 turn 推进仍由 Runner 唯一负责 | `J8` |
| `src/evolution/reviewer_runtime.py` | 目标 | reviewer 显式启用“声明工具且恰好一次”合同、一次纠错预算、单 accepted turn；增加协议日志 sink 与工具事件白名单过滤 | 合同漏传或记录器继续接收任意工具名 → 185 个失败卡片仍可回放 | reviewer registry 和 LLM request 都只声明 `evolution_write`；可见工具事件只接受 `evolution_write` | `J2`、`J5`、`J6` |
| `src/evolution/trigger_diagnostics.py` | 下游 | 增加 reviewer 工具合同违规 ERROR 分类，统一写 evolution 日志 | 日志只写笼统失败 → 无法定位模型、call id、违规工具和处置动作 | 每个被拒绝响应只记录首个违规；日志不记录工具参数和 transcript 正文 | 用户任务、`J6` |
| `src/evolution/evolution_manager.py` | 下游 | 消费 reviewer 最终 outcome，保持单条 completed/failed 通知语义 | 纠错尝试被当成多个 review → 重复写状态或重复通知 | 一个 review request 只落一个最终 review 状态和一个终态通知 | `J5` |
| `src/tools/builtin/evolution_write_tool.py` | 相关 | 无行为修改；继续作为 reviewer 唯一写入口 | 合同层重复参数校验 → 破坏既有平铺 payload 和 session fallback 容错 | 参数归一化、过滤、写入与错误结果保持现状 | `J9` |
| `docs/modules/核心/README.md` | 下游 | 记录新增 run 级工具调用合同、默认关闭语义和 Runner 执行顺序 | 文档仍描述响应直接 append/execute → 后续实现绕过合同边界 | 文档中的唯一 run loop、默认普通 Agent 行为和合同启用方式与代码一致 | `J8` |
| `docs/modules/进化/README.md` | 下游 | 记录 reviewer 严格合同、日志、单次纠错和单 accepted turn | 运维调查仍把异常工具气泡归因到 thread 生命周期 → 诊断路径再次漂移 | evo reviewer 的工具面、错误日志和终态通知边界与代码一致 | `J1`、`J2`、`J6` |

## 判断依据

| J-ID | 判断 | 来源 | 证据或推断 | 状态 |
|---|---|---|---|---|
| J1 | 本次故障的模型响应包含大量未声明 `documents` 调用，本地逐个生成 `tool_unavailable` 后形成大量失败气泡 | 调查事实 | `thread-12ac91193ce4` 的 raw SSE 与事件链调查：响应中出现 185 个唯一 `documents` tool block | 已确认 |
| J2 | reviewer 的能力面已经是单工具 registry，合法工具唯一为 `evolution_write` | 仓库事实 | `src/evolution/reviewer_runtime.py:30,64-68,192-220`；`docs/modules/进化/README.md:10-14` | 已确认 |
| J3 | 当前流式 Runner 收到 `tool_call.start` 时只计数，不检查工具名或数量 | 仓库事实 | `src/core/runner.py:1260-1263` | 已确认 |
| J4 | 当前 Runner 在完整响应返回后先 append assistant，再提取并执行 tool calls | 仓库事实 | `src/core/runner.py:997-1000,1037-1065` | 已确认 |
| J5 | reviewer 的 `tool.call.start/end` 会被录制并经 evolution event bus 回放，工具事件可成为聊天气泡 | 仓库事实 | `src/evolution/reviewer_runtime.py:31-35,84-97,210-217`；`src/evolution/evolution_manager.py:994-1002` | 已确认 |
| J6 | evolution 已有独立旋转日志和统一 trigger block 分类器 | 仓库事实 | `src/evolution/evolution_manager.py:94-102`；`src/evolution/logging_setup.py:1-76`；`src/evolution/trigger_diagnostics.py:1-92` | 已确认 |
| J7 | evo reviewer run 内当前一次 LLM 请求的 provider 响应流只能由该 child Runner 本地关闭；纠错内容进入同一个 reviewer run 的下一次 LLM 请求 | LLM 推断 | `SupportsLLMStream.stream()` 是单向 `AsyncIterator`；一次请求没有向正在生成的 provider 响应反向发送新消息的通道；主 thread 不参与该关闭或重试 | 已确认 |
| J8 | 合同校验和纠错属于唯一 run loop；evo 通过 run 级显式合同启用，普通 run 保持默认行为 | 架构规范 | AGENTS 约束“唯一 run loop”“装配与执行分离”“跨模块协议单一真源” | 已确认 |
| J9 | `evolution_write` schema 当前有意保留 payload 容错，执行期由 Tool 做归一化和字段恢复 | 仓库事实 | `src/tools/builtin/evolution_write_tool.py:31-49,96-114`；既有真实模型修复记录明确允许平铺 payload | 已确认 |
| J10 | reviewer 一次语义任务只需要一条被接受的 tool-call 响应；写入结果由 session 中真实 tool result 判定 | 仓库事实 | `src/evolution/reviewer_runtime.py:267-274,282-320`；review instructions 已要求“必须且只能调用一次” | 已确认 |
| J11 | 同一 assistant 响应是合同校验与副作用提交的原子单位；任意位置的违规都会撤销该响应中所有调用的执行资格 | LLM 推断 | 常见错误实现会逐个验证并立即执行，输入 `[evolution_write, documents]` 时会在发现后项违规前写入 review | 已确认 |

## 建模覆盖声明

| 维度 | 覆盖位置或具体不适用理由 |
|---|---|
| 数据流 | `LLMRequest.tools → tool_call.start/message.done → 整体合同判断 → 纠错请求或 evolution_write`，见 `SC_01`、`SC_02`、`SC_04`、`SC_11` |
| 状态 | run 内局部状态包含 accepted turn、当前响应 attempt、首个违规和剩余纠错预算；见 `SC_02`、`SC_03`、`SC_05` |
| 时序 | 校验必须早于 assistant append、tool event、approval 和 execute；见 `SC_01`、`SC_04`、`SC_07` |
| 资源 | 被拒绝的异步响应迭代器必须关闭，provider HTTP/SSE 上下文可释放；见 `SC_09` |
| 不变量 | `影响边界与不变量`、`SC_11` |
| 故障 | 未声明工具、合法前缀后出现非法工具、调用数超限、缺失必需调用、纠错再次违规和非流式错误；见 `SC_01`、`SC_03`、`SC_04`、`SC_06`、`SC_07`、`SC_11` |

## 验收清单

### 单元测试

- [ ] Runner 流式路径在首个未声明 `tool_call.start` 关闭迭代器，发出一条合同违规事件，并证明 session、approval、Tool、`tool.call.*` 均无副作用（`SC_01`）。
- [ ] 首次违规后的第二个 `LLMRequest` 含瞬态纠错提示和原始历史，session 中不含被拒绝 assistant 或纠错提示（`SC_02`）。
- [ ] 第二次违规返回独立合同错误和 `Result.status="failed"`，请求次数固定为 2，未出现 `run.cancelled`（`SC_03`）。
- [ ] 非流式响应在 content event、assistant append、usage/response accepted event 和工具执行前完成等价校验（`SC_04`）。
- [ ] 合法 reviewer 只执行一次 `evolution_write`，child run 不发送写入后的第二个 LLM 请求（`SC_05`）。
- [ ] 零工具响应和第二个工具调用分别命中可区分的合同违规种类（`SC_06`、`SC_07`）。
- [ ] evolution 协议日志每个被拒绝响应只写首个违规，字段包含父 thread/run、child run、attempt、tool name/call id/index、allowed tools、action，且不包含 arguments/transcript（`SC_01`、`SC_03`）。
- [ ] reviewer 可见事件记录器只接受 `tool_name=evolution_write` 的 `tool.call.start/end`（`SC_08`）。
- [ ] 流关闭走协议错误路径并释放异步迭代器，不进入 thread interrupt/cancel 分支（`SC_09`）。
- [ ] 未传合同的普通 Runner 继续把伪造工具调用收口成一个 `tool_unavailable` tool result（`SC_10`）。
- [ ] 同一响应先出现合法 `evolution_write`、后出现非法 `documents` 时，整条响应被丢弃且 `evolution_write` 的 execute/store/event 调用次数均为 0（`SC_11`）。

### Smoke 测试

- [ ] 使用真实 `SessionEngine → Runner → evolution_write`、fake streaming LLM 和临时 evolution store：首次返回未声明 `documents`，纠错响应返回一次合法 `evolution_write`，最终只写一份 review、执行一次 Tool、记录一次违规日志。
- [ ] 运行 `uv run pytest -q` 覆盖新增 Runner/evolution 单元测试及 `tests/e2e/test_self_evolution_e2e.py` 相关回归。
- [ ] 运行 `uv run mypy` 覆盖新增 core contract、Runner、SessionEngine 和 evolution reviewer 文件，并运行 `uv run lint-imports` 验证依赖方向。

### E2E 测试

- 决策：需要
- 依据：故障的可观察结果位于 child reviewer → EvolutionManager event replay → Web 工具卡链路，单测无法证明前端消费前没有 `documents` 工具事件。
- [ ] 使用真实 evolution manager/event bus/Web event sink 与 fake provider 构造“一次响应包含大量 `documents` 调用”的链路，断言 Web 侧收到零个 `documents` tool frame，最终只收到一个 review completed 或 failed 通知。

## 测试驱动开发

1. `SC_01`、`SC_04`、`SC_11` → 先写流式与非流式首个未声明工具及“合法前缀、非法后项”的红灯测试，证明当前代码会 append/执行并产生部分副作用或 `tool_unavailable`。
2. `SC_02`、`SC_03` → 先写一次纠错成功和二次违规终止的红灯测试，固定请求次数、瞬态历史和错误状态。
3. `SC_05`、`SC_06`、`SC_07` → 先写 reviewer 成功单次调用、缺失调用和调用数超限测试。
4. `SC_08` → 先写 reviewer event recorder 工具名过滤测试。
5. `SC_09`、`SC_10` → 先写资源释放、取消隔离和普通 Runner 兼容回归测试。
6. 完成 core contract、Runner、SessionEngine 透传、evolution 日志 sink 和 reviewer 显式装配的最小实现。
7. 增加 E2E 事件链测试，重构后复跑 unit、Smoke、E2E、mypy 和 import-linter。

## 对抗性审查记录

| Review | 预算 | 风险来源 | 查询 | 召回 ID | 复用 Scenario | 新增 Scenario | CLI |
|---|---|---|---|---|---|---|---|
| ARV-1 | deep | assumption:valid-prefix-late-invalid | 功能关键词：evolution reviewer、Runner、streaming tool_call.start、声明工具集合、响应原子性、纠错重试、事件回放、evolution.log；Risk：逐个校验并立即执行会在后续未声明工具被发现前提交合法前缀调用的副作用 | 无 | 无 | SC_11 | skipped:no-corpus |

## Scenarios

### Scenario SC_01: 流式首个未声明工具立即熔断并记录日志

- **GIVEN** evo reviewer 的 `LLMRequest.tools` 只含 `evolution_write`，首次响应的 `tool_call.start` 为 `documents`，并携带 call id 和 index
- **WHEN** Runner 消费到该 `tool_call.start`
- **THEN** Runner 立即关闭本次响应迭代器，只发出一条包含首个违规坐标且不含参数正文的合同违规事件；evolution 日志同步写入一条 ERROR；session、approval、Tool 和 `tool.call.start/end` 均无新增
- 测试层：unit
- 依据：用户任务、`J1`、`J2`、`J3`、`J6`
- 来源：initial-spec

### Scenario SC_02: 首次违规使用干净历史纠错一次

- **GIVEN** evo reviewer run 内第一次 LLM 请求的响应因合同违规被整体拒绝，纠错预算为 1
- **WHEN** Runner 构造下一次 LLM 请求
- **THEN** 同一个 reviewer run 的下一次 LLM 请求由第一次请求的原始消息加一条瞬态纠错提示组成，提示列出违规种类和当次声明工具并要求只调用一次后停止；被拒绝 assistant、tool result 和纠错提示均不写 session；主 thread 不参与该重试
- 测试层：unit
- 依据：用户任务、`J7`
- 来源：initial-spec

### Scenario SC_03: 纠错响应再次违规后 reviewer 单次失败

- **GIVEN** evo reviewer 首次响应已消耗唯一纠错预算，第二次响应再次出现未声明工具
- **WHEN** Runner 发现第二次响应的首个违规
- **THEN** 第二个响应流被关闭并记录一条对应 ERROR，Runner 返回独立合同错误且 `Result.status="failed"`，总 LLM 请求数为 2，EvolutionManager 最终只发一个 `evolution.review.failed`，全链路不产生 `run.cancelled`
- 测试层：smoke
- 依据：用户任务、`J5`、`J7`、`J8`
- 来源：initial-spec

### Scenario SC_04: 非流式响应执行同一原子合同

- **GIVEN** evo reviewer 使用不支持 stream 的 provider，完整 `LLMResponse` 含未声明 `documents`
- **WHEN** Runner 收到该完整响应
- **THEN** Runner 在 content event、assistant append、accepted `llm.response`/usage、approval 和工具执行之前拒绝整条响应，并进入与流式路径相同的一次纠错流程
- 测试层：unit
- 依据：`J4`、`J8`
- 来源：initial-spec

### Scenario SC_05: 合法 reviewer 只执行一次写入后结束

- **GIVEN** evo reviewer 的被接受响应恰好包含一次参数可执行的 `evolution_write`
- **WHEN** Runner 完成本次 tool execute
- **THEN** session 只新增该 assistant 和对应 tool result，`evolution_write` 执行一次，child run 直接结束且不发起写入后的第二个 LLM 请求，EvolutionManager 发出一个 `evolution.review.completed`
- 测试层：smoke
- 依据：`J2`、`J10`
- 来源：initial-spec

### Scenario SC_06: reviewer 缺失必需工具调用时纠错

- **GIVEN** evo reviewer 的完整响应不含任何 tool call，且仍有纠错预算
- **WHEN** Runner 校验 `message.done` 或非流式完整响应
- **THEN** 整条响应以 `missing_required_tool_call` 拒绝，不写 session，并发起一次要求调用唯一声明工具的纠错请求
- 测试层：unit
- 依据：`J2`、`J10`
- 来源：initial-spec

### Scenario SC_07: 第二个工具调用触发数量熔断

- **GIVEN** evo reviewer 同一响应已经出现一个声明工具，随后又出现第二个工具调用
- **WHEN** Runner 消费到第二个 `tool_call.start` 或在非流式响应中发现调用数大于 1
- **THEN** 整条响应以 `tool_call_limit_exceeded` 原子拒绝，先前出现的第一个工具也不执行、不持久化、不生成工具事件
- 测试层：unit
- 依据：`J3`、`J10`
- 来源：initial-spec

### Scenario SC_08: reviewer 可见事件只回放唯一合法工具

- **GIVEN** reviewer event sink 收到 `evolution_write` 与其他工具名的 `tool.call.start/end`
- **WHEN** sink 生成 `visible_events` 快照
- **THEN** 快照只包含 `tool_name=evolution_write` 的事件，其他工具名事件不进入 evolution event bus 和 Web 工具卡链路
- 测试层：unit
- 依据：`J5`
- 来源：initial-spec

### Scenario SC_09: 协议流关闭与 thread 取消语义隔离

- **GIVEN** evo reviewer run 内当前一次 LLM 请求因未声明工具需要提前终止一个仍可继续产出 chunk 的 provider 异步迭代器
- **WHEN** Runner 执行协议熔断
- **THEN** 迭代器的关闭路径被调用且资源释放完成，Runner 不调用 thread interrupt、不构造 `CancelledError`、不发 `run.cancelled`，最终状态只由合同重试结果决定
- 测试层：unit
- 依据：用户任务、`J7`、`J8`
- 来源：initial-spec

### Scenario SC_10: 普通 Runner 保持现有未知工具收口

- **GIVEN** 普通 Agent run 未传入严格工具调用合同，模型返回一个未注册工具
- **WHEN** Runner 执行该响应
- **THEN** 现有流程仍 append assistant 并生成一个 `reason=tool_unavailable` 的 tool result，默认行为和既有测试保持一致
- 测试层：unit
- 依据：用户任务、`J8`
- 来源：initial-spec

### Scenario SC_11: 合法前缀后出现非法工具时整条响应回滚执行资格

- **GIVEN** evo reviewer 的同一流式或非流式 assistant 响应按顺序包含一个合法 `evolution_write`，随后包含一个未声明 `documents`
- **WHEN** Runner 对该响应执行工具调用合同校验
- **THEN** 整条 assistant 响应被拒绝，前缀中的 `evolution_write` 不执行、不写 review store、不写 session、不发 `tool.call.start/end`，日志只记录首个实际违规 `documents`，随后按剩余预算纠错或失败
- 测试层：smoke
- 依据：`J11`
- 来源：adversarial-review (assumption:valid-prefix-late-invalid)
