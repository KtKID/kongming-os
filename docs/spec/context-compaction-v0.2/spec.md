> spec_version: 3
> adversarial_risk_version: 3
> complexity: 5
> importance: 4
> risk_average: 4.5
> review_budget: full
> adversarial_review: complete

# context-compaction-v0.2

## 任务目标

- 用新的 `ContextCompactionManager` 完整替换现有按消息数 FIFO 裁剪模块；run-start 自动触发、工具结果批次结束自动触发和用户 `/compact` 主动触发共用同一条 LLM 摘要与 checkpoint 提交链路。
- 自动触发阈值由当前 thread 已选择模型在 `config/model-providers.yaml` 中的 `context_window_tokens` 与 `context_compaction.auto_trigger_ratio` 相乘得到；比例默认 `0.90`，测试目录通过临时 model catalog 与临时 setting 提供小窗口/比例，生产目录保留各模型真实最大窗口。
- `setting.yaml` 新增独立 `context_compaction` 配置，包含总开关 `enabled`、自动触发比例 `auto_trigger_ratio` 和 checkpoint 中保留最近真实 user 消息条数 `keep_recent_user_messages`；默认值分别为 `true`、`0.90`、`3`。
- 摘要调用使用当前 thread 的 provider、模型与 reasoning 配置，只发送当前完整 model-visible context 加一条系统所有的压缩指令，`tools=()`；摘要成功后以 append-only checkpoint 替换后续 LLM 的 active context，原始 transcript 保持完整可审计。
- 仅 FileSession 实现 checkpoint 快照与 compare-and-swap 提交契约；checkpoint 作为 append-only JSONL record 持久化，进程重启、thread fork、并发输入和失败重试均得到可判定结果。
- 开发验收按“主动 `/compact` 假 LLM E2E并校验 session 格式 → MiniMax-M3 真实 LLM 并校验重启后的 session → 两个自动触发 E2E → 全量静态与架构门禁”推进。

## 非目标

- 本规格不为旧 `CompactorConfig`、`MessageCompactor`、`HistoryCompactor`、`InputAssembler.compactor` 或旧 FIFO 行为保留 shim、兼容分支和弃用包装。
- 本规格不接入 provider 专属远程压缩 API，也不改变 Claude Code/Codex transport 自有 session 格式；主实现范围是 `generic_chat` 的 CLI 与 Web thread。
- 本规格不新增压缩设置页或按钮；配置入口保持 `setting.yaml`，用户操作入口保持共享 slash command `/compact`。
- 本规格不新增 provider/preset 级比例覆盖；所有模型共享 `context_compaction.auto_trigger_ratio`，每个模型仍用自身 `context_window_tokens` 计算独立 token 触发线。
- 本规格不改变长期 memory 的内容模型、写入策略或 prompt 刷新语义；新 checkpoint 事件只携带上下文压缩事实。
- 本规格不以 LLM 摘要替代原始 transcript、trace、usage 或审计记录。
- 本规格不扩展 InMemorySession、SQLiteSession 与通用 `Session` Protocol；这些 backend 保持原始 raw-history 行为，Runner 跳过自动压缩，主动 `/compact` 返回 backend 不可用。

## 风险评分依据

- 模式：full。修改跨越统一配置合同、SessionEngine 装配、Manager 算法、Runner/command 入口、FileSession checkpoint 字段和正式 Web E2E；预判 task risk 为 Q3。
- 剃刀检查：只新增 `ContextCompactionConfig` 及用户明确要求的三个字段；比例复用现有模型窗口真源，最近 user 复用现有 replacement 构造，开关复用三个既有触发入口。设置 UI、provider 级覆盖、热更新和旧 FIFO 字段兼容均不进入本任务。
- 复杂度：5。该能力包含三类触发时序、LLM 外部交互、FileSession 多阶段“快照 → 摘要 → CAS checkpoint”提交、并发输入与崩溃恢复；命中多阶段持久化提交和幂等/竞态锚点。
- 重要性：4。`generic_chat` 的所有 CLI/Web 用户都依赖该核心 LLM 续写链路；错误会导致上下文丢失、重复压缩、超窗请求或 thread 无法继续。
- 预算升级：平均分 4.5 对应 `full`，复杂度 5 也独立要求 `full`。

## 影响边界与不变量

| 模块 | 角色 | 本次影响 | 主要风险 | 必须保持的不变量 | 依据 |
|---|---|---|---|---|---|
| `config/setting.yaml`、`config/xspace/setting.yaml`、`infrastructure.config.models.Config` | 上游/目标 | 新增 strict `ContextCompactionConfig(enabled, auto_trigger_ratio, keep_recent_user_messages)` 并由 SessionEngine 读取不可变运行快照 | 配置漏接、非法比例或旧字段残留 → 正式服务启动失败或运行仍使用硬编码 | 两份版本化 setting 字段一致；比例满足 `0 < ratio < 1`，保留条数 `>= 0`；旧 `compactor` 键保持退役 | `J19`、`J21` |
| `config/model-providers.yaml`、`infrastructure.config.model_provider_catalog` | 上游 | 每个可选 preset 必须声明正整数 `context_window_tokens`；resolver 把当前 preset 的值交给压缩链路 | 缺值或读取 provider 默认值 → 阈值失真 → 过早压缩或 provider 拒绝超窗请求 | 当前 thread 的 `preset_id` 是模型与窗口的唯一选择坐标；测试值只存在临时 catalog | `J2`、`J12` |
| `core.contracts` | 目标 | 定义 frozen checkpoint 值对象、`CompactionTrigger(StrEnum)`、token estimator 与 session checkpoint Protocol | 多处自定义 dict/裸字符串 → 字段和触发值漂移 | 跨模块合同只在 `core.contracts` 定义；有限取值使用 `StrEnum` | `J5`、`J6` |
| `sessions.FileSession` | 目标 | 保留 raw message append，新增 JSONL active context 投影、checkpoint CAS、clear/restart/fork 语义 | checkpoint 半写、revision 竞态或恢复顺序错误 → 新输入丢失或摘要覆盖新消息 | `history()` 永远返回完整 raw transcript；active context 由最新有效 checkpoint 加其后消息确定；一次 source revision 最多一个有效 checkpoint | `J5`、`J6`、`J15` |
| `InMemorySession`、`SQLiteSession` | 边界 | 保持现有 Session 合同与持久化格式 | 能力判断误放到普通 run 门户 → 既有 backend 无法聊天 | 普通 run/continue 继续读取 raw history；checkpoint 方法、SQLite 表和迁移保持零新增 | `J5`、`J11` |
| `prompting.compaction.ContextCompactionManager` | 目标门户 | 消费 immutable `ContextCompactionConfig`，统一开关/阈值判断、完整 prompt 组装、摘要请求校验、最近 user 选择、replacement history 构造和 CAS 提交 | 不同入口复制配置判断或消息保留逻辑 → trigger、prompt、失败处理或持久化格式分叉 | 三类 trigger 调同一公开方法；摘要请求始终是完整 model-visible context + 单条压缩指令，且不暴露普通 tools | `J1`、`J3`、`J4`、`J19`、`J20` |
| `prompting.assembly.InputAssembler` | 下游 | 只组装 system/instructions、references、attachments；移除所有 compact 职责 | 旧 compactor fallback 残留 → 新旧压缩叠加 | 对同一 active context 的普通请求与压缩请求使用同一组装真源 | `J3`、`J11` |
| `core.Runner` | 上游 | 在首轮正常采样前和完整 tool-result 批次落盘后调用 Manager；关闭配置时两个入口都以 disabled 原因跳过；普通请求读取 active context | 触发点过早、插入 tool batch 中间或单入口漏读开关 → 新 user 遗漏、tool_use/tool_result 失配或关闭后仍调用 summary | run-start 检查包含本轮已持久化 user；tool trigger 发生在同一 assistant 的全部 tool_result 落盘后；一次 revision 单次触发；关闭后 provider/checkpoint 副作用为零 | `J7`、`J8`、`J20` |
| `commands`、CLI/Web host | 上游 | 注册 host_visibility=`both` 的 `/compact` action，经共享 action executor 调 Manager 的 force 路径；关闭配置时两宿主返回同一 disabled 结果 | 命令被当作普通 user prompt或两宿主开关语义分叉 → transcript 污染、额外 agent run 或错误成功提示 | `/compact` 不带参数/附件/引用，不写 raw user message；成功/失败/disabled 通过统一 `CommandResult` 返回 | `J9`、`J20` |
| 当前 LLM provider | 下游 | 接收摘要请求；返回 summary 与 usage | 返回空文本、tool call、超时或限流 → checkpoint 不可恢复或 active context 被破坏 | 校验成功响应后才提交；失败时 active context 与 raw transcript 均保持原值 | `J3`、`J10` |
| thread restart/fork | 相关 | restart 重放最新 checkpoint；fork 按所选 raw history prefix 构造独立 active context | 复用包含 fork 点之后事实的摘要 → 子 thread 获得未来信息 | restart 结果确定；fork 只消费目标 prefix 可证明覆盖的 checkpoint，历史 fork 不继承越界摘要 | `J15` |
| trace/event/usage | 下游 | 新事件和 checkpoint 记录 trigger、revision、窗口、比例、最近 user 条数、估算 token、checkpoint id、状态与 summary usage | 只按消息数或事件次数判断成功 → 同长度 replacement、错误配置或失败被误报成功 | completed 事件只在 checkpoint CAS 成功后发出；disabled/stale/failed/insufficient_reduction 可区分 | `J10`、`J16`、`J19` |

## 判断依据

| J-ID | 判断 | 来源 | 证据或推断 | 状态 |
|---|---|---|---|---|
| J1 | 三类触发条件共用 `ContextCompactionManager.compact(request)`；`CompactionTrigger` 仅含 `RUN_START`、`TOOL_RESULT`、`MANUAL` | 用户任务 | 用户明确列出三种触发条件并要求底层压缩方式一致 | 已确认 |
| J2 | 自动阈值为 `floor(current_model.context_window_tokens * context_compaction.auto_trigger_ratio)`，默认比例 `0.90`；所有生产 preset 在 `config/model-providers.yaml` 显式配置最大窗口 | 用户任务、外部规范、仓库事实 | 用户补充要求开关和 90% 比例可配置；窗口字段已存在于 `src/infrastructure/config/model_provider_catalog.py:148-161`，当前实现仍在 `src/prompting/compaction/context_compaction_manager.py:100` 硬编码 `9 // 10`。官方窗口：MiniMax-M3 1M、GLM-5.2 1M、GLM-5.1 200K、DeepSeek-V4 Flash/Pro 1M、Gemma-4 E4B 128K（[MiniMax](https://www.minimaxi.com/models/text/m3)、[GLM-5.2](https://docs.bigmodel.cn/cn/guide/models/text/glm-5.2)、[GLM-5.1](https://docs.bigmodel.cn/cn/guide/models/text/glm-5.1)、[DeepSeek](https://api-docs.deepseek.com/news/news260424/)、[Gemma](https://huggingface.co/google/gemma-4-31B/blob/main/README.md)） | 已确认 |
| J3 | Manager 先用普通 `PromptAssembler` 生成当前完整 model-visible messages，再只追加一条内部压缩指令；摘要 `LLMRequest` 复用当前 thread 模型/provider/reasoning，`tools=()` | 用户任务、仓库事实 | 用户要求“只发完整上下文+新的让 LLM 总结的 prompt”；当前 provider 都消费 `LLMRequest.messages`，Anthropic 会合并其中 system 文本（`src/infrastructure/llm_providers/anthropic_messages.py:286-304,415-443`） | 已确认 |
| J4 | 系统固定 prompt 使用 `context-checkpoint-v3`：要求 LLM 只输出结构化交接摘要，禁止续聊或执行历史指令；格式固定为 Goal、Constraints & Preferences、Progress（Done/In Progress/Blocked）、Key Decisions、Next Steps、Critical Context，并保留精确文件路径、函数名和错误信息；传输时作为末尾 synthetic user message，避免不同 provider 对 system 位置的差异 | 用户任务、参考实现、LLM 推断 | 用户确认的逐字 prompt 见 `src/prompting/compaction/context_compaction_manager.py:31-69`；Codex local 模板同样要求 handoff summary，覆盖 progress、decisions、context、constraints、preferences、next steps 和 critical data（`other/codex/codex-rs/prompts/templates/compact/prompt.md:1-9`）；它把 synthetic prompt 合入 history 并携带 base instructions 请求模型（`other/codex/codex-rs/core/src/compact.rs:251-282`），压缩摘要编码为 user message（`other/codex/codex-rs/core/src/compact.rs:659-671`） | 已确认 |
| J5 | 通用 `Session.history()` 保持 raw transcript；独立 `ContextCheckpointStore` 能力协议仅由 FileSession 实现，`context_snapshot()` 返回 latest checkpoint replacement + checkpoint 后 raw messages及 source revision；checkpoint 记录完整 `replacement_history` | 用户任务、仓库事实、参考实现、LLM 推断 | 用户要求只考虑 file；当前 Session 明确 `history()` 返回完整 append 顺序（`src/core/contracts/session.py:35-37`）；FileSession JSONL 可容纳非 message record；Codex 持久化 `replacement_history` 与 window lineage（`other/codex/codex-rs/core/src/session/mod.rs:3061-3101`） | 已确认 |
| J6 | 摘要在 session lock 外生成，提交使用 `expected_source_revision` CAS；revision 变化返回 `stale`，丢弃本次 summary，下一触发重新快照 | LLM 推断 | LLM 调用不可持锁；快照后用户输入或 tool result 可能追加。CAS 是避免旧摘要覆盖新消息的最小合同 | 已确认 |
| J7 | run-start 自动检查位于本轮 user message 已 append、首个普通 LLMRequest 发送前；判断对象包含新 user 和本轮动态 instructions | 用户任务、参考实现、仓库事实 | 当前 user 在 `src/core/runner.py:814-871` 入 session，普通请求在 `src/core/runner.py:925-999` 组装；Codex 当前 pre-turn 检查早于新 user，并在 `other/codex/codex-rs/core/src/session/turn.rs:155-158` 标注这一缺口 | 已确认 |
| J8 | tool-result 检查发生在同一 assistant 的全部 tool calls 串行完成并落盘后、下一次普通 LLMRequest 前 | 用户任务、仓库事实 | 当前 batch 在 `src/core/runner.py:1162-1171,1619-1678` 完整执行；该边界保持 interrupt-run 的 tool_use/tool_result 配对不变量 | 已确认 |
| J9 | enabled 时 `/compact` 强制执行，低于配置的自动触发线也生成 checkpoint；CLI/Web 都消费同一个 action executor；命令文本不进入 session | 用户任务、仓库事实 | 当前内建命令仅 `/evolve`、`/hello`（`src/commands/builtins.py:7-28`），CommandService 对 action 返回 unsupported（`src/commands/service.py:37-97`），Web 另有 `/evolve` 特判（`src/hosts/web/websocket/routes.py:590-608,825-858`） | 已确认 |
| J10 | summary 调用异常、空 content、返回 tool_calls、CAS stale 或 replacement 估算仍达到配置触发线时不提交；MANUAL 返回明确失败，AUTO 在普通 provider 请求前终止当前 run 并返回 `context_compaction_failed` | LLM 推断 | 原样继续发送已达到配置触发线的请求会放大超窗失败；checkpoint 失败后保持旧 active context提供可重试事实 | 已确认 |
| J11 | 删除旧压缩实现与所有 wiring/tests：`history_compactor.py`、`MessageCompactor`、配置 `CompactorConfig` 与两份 setting 的 `compactor`、`InputAssembler` compact 分支、Runner `_prepare_messages`/双路径、`SessionEngine` noop/HistoryCompactor 装配和旧 FIFO 测试 | 用户任务、仓库事实 | 旧配置默认关闭且按消息数裁剪（`src/infrastructure/config/models.py:204-222`）；核心算法见 `src/prompting/compaction/history_compactor.py:47-160`；装配重复分布在 `src/runtime_assembly/session_engine.py:351-400` 和 `src/core/runner.py:945-993` | 已确认 |
| J12 | token 判断只读取当前 resolved preset 的 window；token 数由单一 `ContextTokenEstimator` 对即将发送的完整普通 request（messages + tool schemas）估算，生产 estimator 采用保守确定性算法，测试注入精确 fake | 用户任务、LLM 推断 | provider 间缺少统一 count-tokens API；单一可注入 estimator 让阈值逻辑可复现并允许未来替换 tokenizer。窗口来源仍由 catalog resolver 固定 | 已确认 |
| J13 | replacement history 按稳定原顺序保留最近 `context_compaction.keep_recent_user_messages` 条真实、非 internal user messages，并在末尾追加 `[Context checkpoint summary]\n<summary>` synthetic user message；默认保留 3 条，配置为 0 时只保留 summary；完整 tool batch与 assistant 事实由 summary 承载 | 用户任务、参考实现、仓库事实 | 用户补充要求配置最近 user 消息条数；当前实现 `src/prompting/compaction/context_compaction_manager.py:265-269,410-433` 只按 `min(20_000, window/10)` token 预算保留不定条数。replacement 仍由既有阈值复核拦截过大结果 | 已确认 |
| J14 | 真实 MiniMax 验收使用 `minimax-m3` 和真实 FileSession；先手动 compact，再重启读取、发送追问，检查原始三次回复都可由新上下文回答 | 用户任务、参考样本 | 用户要求真实 MiniMax 检查 session；Codex 参考 rollout 在第 29 行压缩前最后请求 34,118 tokens、第 32 行写 `compacted.replacement_history`、第 33 行压缩后 4,683 tokens，第 45 行回忆漏掉第三次回复，形成摘要完整性反例 | 已确认 |
| J15 | restart 选择 latest valid checkpoint；fork 到历史 prefix 时只复用 `source_revision <= prefix` 且 replacement 未概括 prefix 之外消息的 checkpoint，否则从 raw prefix 建 active context | 仓库事实、LLM 推断 | 当前 fork 只复制 raw history prefix（`src/hosts/web/threads/manager.py:1014-1039,1076-1081`）；checkpoint 引入后必须显式防止未来信息泄漏 | 已确认 |
| J16 | FileSession checkpoint JSONL 必含 `schema_version`、`record_type=context_checkpoint`、`checkpoint_version=1`、`session_id`、`checkpoint_id`、`parent_checkpoint_id`、`source_revision`、`trigger`、`model_preset_id`、`model_name`、`context_window_tokens`、`auto_trigger_ratio`、`keep_recent_user_messages`、`estimated_input_tokens`、`threshold_tokens`、`prompt_version`、`replacement_history`、`usage`、`created_at`；同一 source revision 最多一个有效 record | 用户任务、仓库事实、LLM 推断 | 用户要求先验证保存 session 格式并只考虑 file；配置快照字段使阈值与 replacement 选择可审计；FileSession 每条 record flush+fsync，sidecar file lock 提供跨实例 CAS | 已确认 |
| J17 | 完整待压缩 request 已超过当前模型最大窗口时，Manager 返回 `context_overflow_before_compaction`，不发送必然超窗的 summary request、不提交 checkpoint；AUTO run 终止并保留 raw/active 证据 | LLM 推断 | 单个超大 tool result 可让估算值从阈值下直接跳到窗口外；用户要求 summary 看见完整 context，系统无法通过静默裁剪绕过物理窗口 | 已确认 |
| J18 | checkpoint durable commit 成功后即成为 source revision 的唯一有效结果；进程在返回 completed/event 前崩溃时，restart 恢复该 checkpoint，重试返回 already_compacted 并复用 checkpoint_id | LLM 推断 | FileSession append+fsync 与调用方收到回执之间存在崩溃窗口；以 durable JSONL record 为提交真源可阻止重复 summary 和重复 checkpoint | 已确认 |
| J19 | 新配置合同为 frozen `ContextCompactionConfig(enabled: bool=True, auto_trigger_ratio: float=0.90, keep_recent_user_messages: int=3)`；比例严格满足 `0 < value < 1`，条数满足 `value >= 0`；SessionEngine 在 build 时把同一快照传给所有 compact 入口 | 用户任务、仓库事实、LLM 推断 | 用户明确要求开关、模型窗口比例和最近 user 条数可配置；现有 `Config` 使用 strict Pydantic 模型且运行装配集中在 SessionEngine，复用该路径新增概念最少 | 已确认 |
| J20 | `enabled=false` 同时关闭 RUN_START、TOOL_RESULT 和 MANUAL；两个 AUTO 入口返回/记录 disabled skip 并继续普通 run，CLI/Web `/compact` 返回同一可见 disabled 结果，三条路径均不调用 summary provider、不写 checkpoint | 用户任务、LLM 推断 | “开关”控制完整功能可避免宿主或触发入口分叉；AUTO 保持普通聊天可用，MANUAL 给出显式状态 | 已确认 |
| J21 | 旧 `compactor` FIFO 字段不映射到新配置；版本化 `config/setting.yaml` 与 `config/xspace/setting.yaml` 直接新增新块，正式 `/Users/kid/.kongming/setting.yaml` 在 real E2E 前由获授权的操作迁移为新块；`retry` 保持独立 LLM provider 重试配置 | 用户任务、仓库事实 | 用户要求删除旧模块后仍保留新的 checkpoint 配置；旧 `max_messages/keep_recent/keep_system/tool_result_max_chars` 与新语义不等价，自动兼容会重新引入旧行为 | 已确认 |

## 建模覆盖声明

| 维度 | 覆盖位置或具体不适用理由 |
|---|---|
| 数据流 | `J3`、`J5`、`J16`、`J19` 与 `SC_01`、`SC_06`、`SC_19`、`SC_22`：setting snapshot + active context → summary request → replacement checkpoint → next request |
| 状态 | `J5`、`J6`、`J10`、`J20` 与 `SC_07`、`SC_08`、`SC_09`、`SC_21`：disabled、raw、active、pending summary、committed/stale/failed |
| 时序 | `J7`、`J8`、`J9`、`J20` 与 `SC_01`、`SC_02`、`SC_03`、`SC_10`、`SC_21` |
| 资源 | `J3`、`J6`、`J16` 与 `SC_07`、`SC_11`：LLM client 生命周期、FileSession fsync/file lock、锁外网络等待 |
| 不变量 | `影响边界与不变量` |
| 故障 | `J10`、`J15`、`J17`、`J18`、`J19`、`J20` 与 `SC_08`、`SC_09`、`SC_12`、`SC_13`、`SC_17`、`SC_18`、`SC_19`、`SC_21`、`SC_24` |

## 验收清单

### 单元测试

- [ ] `ContextCompactionConfig` 解析默认值和显式值；拒绝比例 `<=0`、`>=1` 与负保留条数，顶层仍拒绝退役的 `compactor` 键。
- [ ] catalog validation 拒绝缺失/零值窗口；生产 YAML 的五个 preset 分别解析为 1M、1M、200K、1M、1M、128K 对应值。
- [ ] 当前 preset、provider fallback、旧 checkpoint 与配置比例各放冲突哨兵，阈值只读取当前 preset window × 当前 config ratio，并断言 estimator 收到完整 messages 与 tool schemas。
- [ ] Manager 对三种 trigger 复用同一 compact 方法；enabled 时 AUTO 只在 `estimated_tokens >= floor(window*ratio)` 执行，MANUAL 绕过比例；disabled 时三种 trigger 的 provider/checkpoint 副作用均为零。
- [ ] summary request 精确等于 assembler 产出的完整 messages 加 `J4` 单条指令，模型/reasoning 与当前 thread 一致，tools 为空。
- [ ] FileSession 的 raw history、active projection、CAS completed/stale、clear、重复 source revision 和损坏 checkpoint 跳过语义正确；通用 Session/InMemory/SQLite 源码无 checkpoint 扩展。
- [ ] replacement 精确保留最近 N 条真实非 internal user、N=0、稳定顺序、summary synthetic user、tool batch 事实承载和压缩后阈值复核符合 `J13`；配置要求保留的消息使 replacement 过大时显式 insufficient reduction。
- [ ] 空 summary、summary tool_calls、provider exception、stale commit 和 insufficient reduction 都不改变 active context。
- [ ] 完整 request 已超过 max window 时不调用 summary provider，返回 `context_overflow_before_compaction` 并保留 raw/active 状态。
- [ ] durable checkpoint 写入后回执丢失，restart 与重试复用同一 checkpoint_id，summary provider 不重复调用。
- [ ] `/compact` 拒绝参数/附件/引用，且 CLI/Web action executor 收到同一 session_id、当前 preset 与 MANUAL trigger。
- [ ] 旧压缩符号、`compactor` 配置键、实现文件、导入和 FIFO 测试全部消失；新 `context_compaction` 块只含 `J19` 三个字段；InputAssembler 只保留 prompt assembly。

### Smoke 测试

- [ ] SessionEngine 使用与 `Config` 冲突的哨兵注入 Manager，证明三个入口读取同一 `ContextCompactionConfig` 快照；CLI/Web disabled 结果一致。
- [ ] 使用临时 `context_window_tokens=100` catalog、真实 SessionEngine/Runner/ContextCompactionManager/FileSession 和仅替换外部 LLM 的 recording fake，跑通手动 `/compact`，解析 JSONL checkpoint 全字段，重建 runtime 后断言下一次普通请求读取 replacement history。
- [ ] 同一真实内部链路覆盖 run-start 与 tool-result 触发，fake 记录触发点、summary request、下一次普通 request 和事件顺序。
- [ ] FileSession contract 覆盖 JSONL 全字段、flush/restart、并发 stale/idempotent CAS 与损坏尾行恢复；InMemory 普通 continuation 回归保持可用。
- [ ] 运行 focused pytest、mypy、ruff、lint-imports 与 `git diff --check`，并检查旧模块路径与导出零命中。

### E2E 测试

- 决策：需要
- 依据：三类用户/runner入口、真实 session 持久化、provider 调用、进程重启和 MiniMax 外部服务共同决定可观察正确性；用户明确要求三种 E2E 触发方式与真实 MiniMax session 证据。
- [ ] E2E-1 MANUAL：CLI 或共享 command 公共入口发送 `/compact`，低于阈值仍完成；命令不进入 raw history，FileSession 写一个 checkpoint，restart 后下一请求消费 replacement。
- [ ] E2E-2 RUN_START：临时窗口 100、比例 0.90，新增 user 使估算值从 89 上升到 90；首个普通 LLMRequest 前恰好压缩一次，summary 看见该 user，正常 LLM 看见 replacement。
- [ ] E2E-3 TOOL_RESULT：临时窗口 100、比例 0.90，首个 LLM 返回同一 assistant 的多个 tool calls，全部 tool_result 落盘使估算值达到 90；完整 batch 后恰好压缩一次，下一普通 LLMRequest 中每个 tool_use/tool_result 事实可由 summary 延续。
- [ ] E2E-4 MiniMax live：真实 `minimax-m3`、真实 FileSession、真实 provider 先跑 MANUAL 链路，保存脱敏 request/usage/checkpoint 证据；重启后追问压缩前的三个回答，断言三项均被回答，再执行一次普通续写确认 session 可继续。
- [ ] E2E-5 正式 GLM：迁移正式 setting 的旧 `compactor` 块并保留独立 `retry`，60000 runtime 使用 `bigmodel-glm5-1m` 与 dump 启动；主动 `/compact` 的 checkpoint 记录 ratio/keep-count，压缩后继续对话且环境恢复。

## 测试驱动开发

1. `SC_01`、`SC_06`、`SC_07` → 先写会失败的共享 `/compact` + FileSession checkpoint E2E 和 backend contract tests。
2. 删除 `J11` 列出的旧模块、配置、wiring 与旧测试；运行新测试保留缺少 Manager/Session checkpoint 的 RED 证据。
3. 实现 frozen contracts、FileSession checkpoint store、ContextCompactionManager 与 MANUAL action 的最小链路；跑通假 LLM 主动 compact，并逐字段检查保存的 JSONL。
4. `SC_14` → 使用真实 MiniMax 跑主动 compact、restart、追问和 session 检查；该门禁通过后进入自动触发实现。
5. `SC_02`、`SC_03`、`SC_04`、`SC_05`、`SC_10` → 先写两个自动触发 E2E 与当前 preset/阈值/完整 tool batch 的冲突哨兵测试。
6. 在 Runner 两个固定边界接入同一 Manager，满足最小实现后复跑 MANUAL、RUN_START、TOOL_RESULT 三条 E2E。
7. `SC_08`、`SC_09`、`SC_11`、`SC_12`、`SC_13`、`SC_15`、`SC_16`、`SC_17`、`SC_18` → 补齐并发、失败、fork、配置、删除哨兵、物理越窗和 commit 回执丢失；重构后复跑 unit、smoke、E2E、mypy、ruff、lint-imports 与 diff checks。
8. `SC_19`、`SC_20`、`SC_21`、`SC_22`、`SC_24` → 先写配置默认/校验、比例冲突哨兵、全入口开关、最近 N 条与 oversized replacement 的 RED tests，再实现 frozen 配置与单一 Manager wiring。
9. `SC_23` → 更新两份版本化 setting 和 `kongming-compact-test`，获授权后迁移正式配置，用 GLM-5.2 在 60000 dump runtime 完成真实 E2E，最后复跑全门禁。

## 对抗性审查记录

| Review | 预算 | 风险来源 | 查询 | 召回 ID | 复用 Scenario | 新增 Scenario | CLI |
|---|---|---|---|---|---|---|---|
| ARV-1 | full | assumption:oversized-tool-delta；assumption:commit-ack-loss | 无 RAG 经验集 | 无 | SC_09、SC_11、SC_12 | SC_17、SC_18 | skipped:no-corpus |
| ARV-2 | full | assumption:disabled-command-divergence；assumption:retained-user-oversize | 无 RAG 经验集 | 无 | SC_21 | SC_24 | skipped:no-corpus |

## Scenarios 模板

### Scenario SC_01: 主动 compact 共用底层链路并持久化

- **GIVEN** generic_chat thread 使用 FileSession、当前 preset 窗口 100、active context 估算 20，CLI/Web 共享命令注册 `/compact`
- **WHEN** 用户从公共 command 入口执行一次无参数 `/compact`
- **THEN** Manager 以 MANUAL trigger 调当前 LLM 一次、提交一个格式符合 `J16` 的 checkpoint、返回 completed；raw history 不含 `/compact`，restart 后 active context 等于 replacement history
- 测试层：e2e
- 依据：用户任务、`J1`、`J9`、`J16`
- 来源：initial-spec

### Scenario SC_02: run-start 在新 user 入库后达到默认 90% 自动压缩

- **GIVEN** 临时 catalog 当前 preset 窗口 100、配置 ratio=0.90，旧 active context 估算 89，本轮 user append 后完整普通 request 估算 90
- **WHEN** Runner 准备发送本 run 的首个普通 LLMRequest
- **THEN** RUN_START 只触发一次；summary request 包含本轮 user，checkpoint 成功后普通 LLM 第一次看到 replacement history
- 测试层：e2e
- 依据：用户任务、`J2`、`J7`
- 来源：initial-spec

### Scenario SC_03: 完整 tool-result 批次达到默认 90% 后自动压缩

- **GIVEN** 配置 ratio=0.90，assistant 同时返回两个 tool calls，两个真实 tool result 全部 append 后 request 估算从阈值下变为阈值上
- **WHEN** Runner 完成该 assistant 的整个 tool batch
- **THEN** TOOL_RESULT 在第二个 result 落盘后只触发一次；summary 能看到两个 call/result，下一普通 request 使用 replacement 且不存在未配对 tool_use
- 测试层：e2e
- 依据：用户任务、`J8`
- 来源：initial-spec

### Scenario SC_04: 自动触发低于阈值保持 active context

- **GIVEN** 当前 preset 窗口 100、配置 ratio=0.90，完整普通 request 估算 89
- **WHEN** RUN_START 或 TOOL_RESULT 执行阈值判断
- **THEN** summary LLM 调用次数、checkpoint 数和 compact completed 事件数均为 0，普通 request 使用原 active context
- 测试层：unit
- 依据：`J2`
- 来源：initial-spec

### Scenario SC_05: 当前 preset 是窗口唯一真源

- **GIVEN** 同一请求设置当前 preset window=100、provider 默认 window=1000、latest checkpoint window=200、配置 ratio=0.90，estimator 返回 90
- **WHEN** Manager 处理 RUN_START
- **THEN** 阈值为 90 并执行压缩；spy 记录 resolver 查询的 preset_id 等于 thread 当前值，其他两个候选值均未参与决策
- 测试层：smoke
- 依据：`J2`、`J12`
- 来源：initial-spec

### Scenario SC_06: summary 请求只含完整上下文和压缩指令

- **GIVEN** active context 含 system instructions、user/assistant、附件引用、完整 tool call/result，runtime 注册三个普通 tools
- **WHEN** 任一 trigger 调 Manager 生成 summary request
- **THEN** request.messages 精确等于普通 assembler 输出加一条内容等于 `J4` 的 synthetic user；request.tools 为空，model/reasoning/preset 与当前 thread 一致
- 测试层：smoke
- 依据：用户任务、`J3`、`J4`
- 来源：initial-spec

### Scenario SC_07: checkpoint 重启投影与 raw transcript 同时正确

- **GIVEN** FileSession 已有 N 条 message、一个 source_revision=N 的有效 checkpoint 和 checkpoint 后 M 条 message
- **WHEN** 新进程恢复该 session 并分别读取 history 与 context_snapshot
- **THEN** history 按原 append 顺序返回 N+M 条 raw messages；context_snapshot 返回 checkpoint replacement + 后续 M 条，revision 指向最新 raw message
- 测试层：smoke
- 依据：`J5`、`J16`
- 来源：initial-spec

### Scenario SC_08: 快照后并发输入使旧 summary 提交失效

- **GIVEN** Manager 已取得 source_revision=N 的 snapshot 并在锁外等待 LLM，期间另一个输入 append 形成 revision=N+1
- **WHEN** 旧 summary 以 expected_source_revision=N 提交
- **THEN** store 原子返回 stale，不写 checkpoint；raw 与 active context 都包含 N+1 输入，下一触发从 N+1 重新快照
- 测试层：smoke
- 依据：`J6`
- 来源：initial-spec

### Scenario SC_09: 压缩失败保持可恢复状态

- **GIVEN** checkpoint 前 raw/active 状态已保存，summary provider 依次出现异常、空 content、tool_calls 或压缩后估算仍达到配置触发线
- **WHEN** Manager 处理一次 compact
- **THEN** 四种输入分别返回 failed 或 insufficient_reduction，checkpoint 数不增加，active context 字节等值；AUTO run 在普通 LLM 前以 context_compaction_failed 结束，MANUAL 返回可见错误
- 测试层：unit
- 依据：`J10`
- 来源：initial-spec

### Scenario SC_10: 取消发生在 tool batch 中时保持配对且不压缩

- **GIVEN** assistant 有多个 tool calls，第一个执行期间 run 被取消
- **WHEN** Runner 为当前与未执行 calls 写 interrupted 占位结果并退出 tool batch
- **THEN** 每个 tool_use 都有一个 tool_result，TOOL_RESULT compact 不启动，cancelled Result 语义保持现有约束
- 测试层：smoke
- 依据：`J8`、`src/core/runner.py:1619-1678`
- 来源：initial-spec

### Scenario SC_11: 相同 revision 的并发主动请求幂等

- **GIVEN** CLI 与 Web 对同一 session、同一 source_revision 并发执行 `/compact`
- **WHEN** 两个 summary 都尝试提交 checkpoint
- **THEN** backend 至多接受一个 checkpoint；另一个返回 stale/already_compacted，不产生重复 replacement 或 compact completed 事件
- 测试层：smoke
- 依据：`J6`
- 来源：initial-spec

### Scenario SC_12: 损坏或半写 checkpoint 不污染恢复

- **GIVEN** FileSession JSONL 已有一个有效 checkpoint，尾部又出现截断或字段损坏的 checkpoint 行
- **WHEN** session 重启读取 active context
- **THEN** FileSession 跳过损坏尾行并选择前一个有效 checkpoint；raw messages 保持可读
- 测试层：smoke
- 依据：`J5`、`J16`
- 来源：initial-spec

### Scenario SC_13: 历史 fork 不继承越界摘要

- **GIVEN** source thread 在 raw revision=20 生成概括 1..20 的 checkpoint，用户选择 history_index 对应 revision=10 创建 fork
- **WHEN** ThreadManager seed target session
- **THEN** target raw history 只含 1..10，active context 不含 source checkpoint summary；target 后续 compact 仅概括 1..10 及新消息
- 测试层：e2e
- 依据：`J15`
- 来源：initial-spec

### Scenario SC_14: MiniMax 真实主动压缩后可恢复三项事实

- **GIVEN** 真实 minimax-m3 thread 以用户日常语言声明“压缩摘要必须保留新的事实”，依次形成三个带唯一标记的 user/assistant 回合并使用真实 FileSession
- **WHEN** 用户执行 `/compact`、进程重启并追问三个 assistant 唯一标记
- **THEN** JSONL 只有一个有效 MANUAL checkpoint，usage/model/window 字段来自真实调用；直接读取 summary 可见用户日常语言与三个标记，重启回答包含三个标记，随后普通续写成功
- 测试层：e2e
- 依据：用户任务、`J14`
- 来源：initial-spec

### Scenario SC_15: 生产与测试窗口配置各守边界

- **GIVEN** 加载生产 `config/model-providers.yaml` 与测试临时 catalog
- **WHEN** resolver 枚举所有可选 preset
- **THEN** 生产 preset 均有 `J2` 对应正整数最大窗口，测试 preset 使用小值且未修改生产 YAML；缺字段 fixture 在 catalog validation 阶段失败
- 测试层：unit
- 依据：用户任务、`J2`
- 来源：initial-spec

### Scenario SC_16: 旧压缩模块完整退役

- **GIVEN** 新 Manager、FileSession checkpoint store 与三个 trigger 已接通
- **WHEN** 运行源码导入/配置/测试清单哨兵和 lint-imports
- **THEN** `J11` 所列旧文件、符号、设置键、fallback、双路径和 FIFO 测试均为零命中，普通 InputAssembler 与 Runner 仅消费 active context
- 测试层：smoke
- 依据：用户任务、`J11`
- 来源：initial-spec

### Scenario SC_17: 单个 tool result 跳过物理窗口时显式终止

- **GIVEN** tool batch 前完整 request 估算为窗口的 89%，一个不可裁剪的真实 tool result 使完整 model-visible request 估算达到窗口的 120%
- **WHEN** Runner 在完整 tool batch 后调用 TOOL_RESULT compact
- **THEN** Manager 返回 `context_overflow_before_compaction`，summary provider 调用次数和 checkpoint 数均为 0；AUTO run 在下一普通 LLMRequest 前结束，raw/active context 完整保留该 tool result
- 测试层：smoke
- 依据：`J17`
- 来源：adversarial-review (assumption:oversized-tool-delta)

### Scenario SC_18: checkpoint 落盘后回执丢失保持幂等

- **GIVEN** FileSession 已原子追加 source_revision=N 的 checkpoint 并完成 fsync，进程在返回 completed 与发送事件前崩溃
- **WHEN** session restart 后对同一 source revision 重试 MANUAL compact
- **THEN** active context 恢复已提交 replacement，重试返回 already_compacted 和原 checkpoint_id；summary provider 不再次调用，completed 事件可按 checkpoint_id 去重
- 测试层：smoke
- 依据：`J18`
- 来源：adversarial-review (assumption:commit-ack-loss)

### Scenario SC_19: 新压缩配置具有严格默认值与边界

- **GIVEN** strict `Config` 分别读取缺省 `context_compaction`、显式合法值、ratio 为 0/1 和负 keep-count 的 setting fixture
- **WHEN** 配置加载器构造 `ContextCompactionConfig`
- **THEN** 缺省值解析为 `enabled=true`、`auto_trigger_ratio=0.90`、`keep_recent_user_messages=3`；显式合法值原样保存；三个非法 fixture 均在装配前返回字段级校验错误
- 测试层：unit
- 依据：用户任务、`J19`
- 来源：initial-spec

### Scenario SC_20: 当前模型窗口与配置比例共同决定自动触发线

- **GIVEN** 当前 thread preset window=100、另一 preset window=1000、`auto_trigger_ratio=0.80`、旧 checkpoint threshold=90，完整 request 估算为 80
- **WHEN** Manager 处理 RUN_START
- **THEN** threshold_tokens 精确为 80 并执行一次压缩；resolver spy 只读取当前 preset，checkpoint/event 记录 ratio=0.80，其他窗口和旧 threshold 均未参与决策
- 测试层：smoke
- 依据：用户任务、`J2`、`J12`、`J16`、`J19`
- 来源：initial-spec

### Scenario SC_21: 关闭配置统一阻断三个压缩入口

- **GIVEN** `enabled=false`、FileSession active context 已超过自动触发线，CLI 与 Web 均注册共享 `/compact`
- **WHEN** 分别执行 RUN_START、完整 TOOL_RESULT batch 后检查和 MANUAL `/compact`
- **THEN** 两个 AUTO 入口以 disabled 原因继续普通 run，CLI/Web MANUAL 返回相同 disabled 结果；summary provider 调用、checkpoint、completed event 和 raw `/compact` message 数均为 0
- 测试层：smoke
- 依据：用户任务、`J20`
- 来源：initial-spec

### Scenario SC_22: checkpoint 精确保留最近 N 条真实 user 消息

- **GIVEN** active context 依次包含五条真实 user、两条 internal synthetic user、assistant/tool 消息，配置 `keep_recent_user_messages=3`
- **WHEN** summary 成功并构造 replacement history
- **THEN** replacement 按原顺序包含第 3、4、5 条真实 user，排除两条 internal user，并以唯一 checkpoint summary 结尾；checkpoint 记录 keep-count=3；配置为 0 的参数化用例只保留 summary
- 测试层：unit
- 依据：用户任务、`J13`、`J16`、`J19`
- 来源：initial-spec

### Scenario SC_23: 正式配置迁移后 GLM Web compact 可运行

- **GIVEN** 两份版本化 setting 已声明新 `context_compaction`，正式 home 获授权后把旧 `compactor` 块替换为新块并保留独立 `retry`，GLM-5.2 catalog window=1,000,000
- **WHEN** 60000 Web runtime 以 dump 模式启动并通过浏览器执行一次主动 `/compact` 和一次压缩后追问
- **THEN** 配置校验与 health 成功，FileSession 新增一个 MANUAL checkpoint 且记录 ratio/keep-count，raw dump 的压缩前后普通请求保留相同 system prompt，追问成功，测试后的服务状态按初始状态恢复
- 测试层：e2e
- 依据：用户任务、`J16`、`J19`、`J21`
- 来源：initial-spec

### Scenario SC_24: 配置保留的超大 user 消息导致显式压缩失败

- **GIVEN** `keep_recent_user_messages=3`，最近三条真实 user 单独加 summary、system 与 tools 后仍达到配置自动触发线以上，checkpoint 前 raw/active 状态已保存
- **WHEN** Manager 完成 summary 并复核 replacement token
- **THEN** 返回 `insufficient_reduction`，checkpoint 与 completed event 数均不增加，三条 user 不被静默丢弃，active context 保持字节等值
- 测试层：unit
- 依据：`J10`、`J13`、`J19`
- 来源：adversarial-review (assumption:retained-user-oversize)
