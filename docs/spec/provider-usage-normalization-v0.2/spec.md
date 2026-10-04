> spec_version: 3
> adversarial_risk_version: 3
> complexity: 4
> importance: 4
> risk_average: 4.0
> review_budget: full
> adversarial_review: complete

# provider-usage-normalization-v0.2

## 任务目标

- 保持现有 `LLMProvider` 为跨 Anthropic/OpenAI 的运行时抽象，在 `core.contracts` 把开放的 `usage` dict 收紧为显式 token usage 合同；`ProviderUsageManager` 是三类 provider family 的唯一归一化门户。
- 每次响应完整保留 provider 原始 `usage` 对象及未知嵌套字段；公共指标逐字段保存数值、来源和推导证据，明确区分 provider 原报、精确推导和未知。
- 流式 provider 先按各自协议时序聚合原始 usage，再执行一次归一化；Anthropic-compatible 的 `message_delta.usage` 按字段使用最新出现值。
- Runner、FileSession、trace、UsageTokenManager 和 Web/CLI 展示消费同一份归一化快照，任何链路都不再按字段名猜 provider family 或重复计算。
- 对缺失字段只执行协议可证明的精确推导；无法证明、类型非法、数值越界或公式冲突的指标保持未知并记录异常，禁止用 `0` 代替未知。
- 用 Anthropic-compatible 与 OpenAI 两类真实 provider E2E 证明 raw dump、终态归一化、Session、trace 和 Web usage 的公共指标一致。

## 非目标

- 本版本不估算金额；token 单价、缓存 TTL 价格、service tier 和 provider 账单对账留给独立 cost spec。
- 本版本不把所有 provider 扩展字段提升为公共字段；audio、prediction、server tool、cache TTL、service tier、iterations 等字段完整保存在 `raw_usage`，公共消费者按需扩展正式合同。
- 本版本不从 prompt 文本重新 tokenize 来替代 provider usage；本地 tokenizer 只能用于诊断，不能成为计量真源。
- 本版本不把 Claude Code JSONL、Codex rollout 的 thread 累计口径强制改成单次 LLM 响应口径；它们通过 adapter 映射到同一指标合同，同时保留 `scope`。
- 本版本不通过 SQLite 新增存储链路；generic chat 的持久化验收继续使用 FileSession。
- 本版本只新增一个 `ProviderUsageManager`；Web 查询继续复用现有 `UsageTokenManager`，后者只读取 canonical snapshot 并投影展示 DTO。
- 本版本不保留旧 `dict[str, Any]` usage 双写兼容层；开发期接口直接迁移到新合同，历史格式处理需另立迁移任务。

## 风险评分依据

- 复杂度：4。改动跨越三类 provider 协议、两种流式状态机、核心 LLM 合同、Runner、FileSession、trace、Web usage 派生与前端展示，并要求同一指标在多组件间保持一致。
- 重要性：4。usage 是所有 generic chat 用户判断上下文、缓存命中、token 成本和故障证据的核心链路；错误的零值或重复计数会直接误导运维和产品判断。
- 预算升级：平均分 4.0 对应 `full`；复杂度与重要性均为 4，执行最多两个不同故障轴的独立对抗性假设。

## 影响边界与不变量

| 模块 | 角色 | 本次影响 | 主要风险 | 必须保持的不变量 | 依据 |
|---|---|---|---|---|---|
| `src/core/contracts/` | 目标 | 新增 family、scope、metric、snapshot 与 anomaly 的不可变公共合同；`LLMResponse`/`LLMStreamChunk` 使用显式类型 | 继续使用开放 dict → 字段拼错和缺失/零值混淆穿透所有消费者 | 有限取值使用 `StrEnum`；每个公共指标始终携带 `value` 与 `origin`；未知值为 `None` | `J1`、`J2`、`J10` |
| Anthropic non-stream/stream adapter | 目标 | 保留完整 raw usage；流式按字段 latest-present 聚合后构造公共 snapshot | `message_start` 的占位值覆盖 `message_delta` 最终值 → cache 拆分错误 | `message_delta.usage` 为累计终态片段；已出现字段只由后续同名字段覆盖，字段之间不互相覆盖 | `J3`、`J5` |
| OpenAI Chat non-stream/stream parser | 上游 | 读取 Chat usage 原形；流式只接受最终非空 usage chunk 为完整计量 | 中间 `usage=null` 或中断时补零 → 伪造完整计量 | `prompt_tokens`/`completion_tokens` 是 inclusive 总量；cached/reasoning 是其子集；缺失最终 usage 时 completeness 明确为 incomplete | `J6`、`J11` |
| OpenAI Responses provider/parser | 上游 | 按 Responses 原生 `input_tokens`/`output_tokens` 与 details 归一化 | 复用 Chat 字段路径 → OpenAI 正式 Responses 数据全丢 | family 由实际 endpoint 与 wire shape 决定；类名、model 名和 base URL 不参与 family 猜测 | `J7`、`J8` |
| `src/core/runner.py`、Session/trace sinks | 下游 | 透传同一 snapshot 序列化结果，不再二次归一化 | Runner 或 sink 重算 total/cache → raw、Session、trace 口径漂移 | 单次响应 snapshot 在 event、Session 与 trace 中逐字段相等；累计只聚合 `value` 已知且 scope 相容的指标 | `J9`、`J12` |
| `UsageTokenManager`、Web wire、CLI | 目标门户 / 下游 | 复用现有无状态查询门户，从 canonical snapshot 投影 channel UI，删除 `_derive_generic` 与 event sink 的重复 token 公式 | 继续用 `provider_kind` 或缓存字段启发式分流 → compatible provider 被误判 | Manager 公共入口仍为 `get_thread_usage`；展示 family 来自 snapshot；未知显示为空态；`0` 只表示 provider 原报或精确推导出的零 | `J9`、`J10`、`J17` |
| raw dump 与真实 E2E 证据 | 相关 | 保存 provider 原始响应并与各下游 snapshot 对账 | 只断言“文件存在/对话完成” → parser 错误继续绿灯 | E2E 对同一 request identity 比较 raw usage、normalized、Session、trace 与 Web；差异必须可定位到 anomaly | `J12`、`J13` |

## 判断依据

| J-ID | 判断 | 来源 | 证据或推断 | 状态 |
|---|---|---|---|---|
| J1 | provider/protocol family 是归一化规则的真源，固定覆盖 `anthropic_messages`、`openai_chat_completions`、`openai_responses` | 用户任务、仓库规范 | 用户要求 Anthropic/OpenAI 抽象；有限集合按 AGENTS 使用 `StrEnum` | 已确认 |
| J2 | 统一合同采用“公共稳定指标 + 完整 raw_usage + 字段级来源/异常”，避免用固定公共字段集合丢弃 provider 扩展 | 用户任务、LLM 推断 | “全量覆盖字段”和“准确性第一”同时要求无损保存与可比较指标；未知扩展无法安全提前建模 | 已确认 |
| J3 | Anthropic 总输入严格等于 `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`，其中三项为互斥组成 | 外部规范 | Anthropic prompt caching 文档给出三个字段的定义与求和公式 | 已确认 |
| J4 | 公共指标至少包含 `input_total_tokens`、`input_uncached_tokens`、`cache_read_tokens`、`cache_write_tokens`、`output_total_tokens`、`reasoning_tokens`、`total_tokens` | 用户任务、LLM 推断 | 这些指标覆盖上下文、cache 读写、输出、reasoning 与总量；各字段允许未知并保留来源 | 已确认 |
| J5 | Anthropic `message_delta.usage` 是累计计数；流式聚合使用每字段 latest-present，随后只归一化一次 | 外部规范、真实 raw 证据 | 官方文档声明 message_delta usage 为 cumulative；MiniMax M3 raw 显示 input/cache 可在 final delta 出现 | 已确认 |
| J6 | OpenAI Chat 的 `prompt_tokens`/`completion_tokens` 是总输入/总输出；`prompt_tokens_details.cached_tokens` 和 `completion_tokens_details.reasoning_tokens` 分别是其子集 | 外部规范 | OpenAI Chat API Reference 明确字段及 details 语义 | 已确认 |
| J7 | OpenAI Responses 的公共路径是 `input_tokens`、`input_tokens_details.cached_tokens`、`output_tokens`、`output_tokens_details.reasoning_tokens`、`total_tokens` | 外部规范 | OpenAI Responses API Reference 定义该 usage 对象 | 已确认 |
| J8 | 当前 `openai_responses.py` 实际请求 `/chat/completions`，当前实现应归类为 Chat family；真实 Responses family 需要独立 endpoint/wire adapter | 仓库事实 | 文件头与 `_ENDPOINT_PATH` 明确为 `/chat/completions` | 已确认 |
| J9 | `LLMProvider` adapter 收集 raw，统一调用 `ProviderUsageManager` 生成公共 snapshot；Runner、Session 和 trace 只透传；现有 `UsageTokenManager` 负责查询与展示投影 | 架构规范、仓库事实 | provider 协议差异由单一归一化门户收敛；Web 保留唯一无状态查询门户 | 已确认 |
| J10 | 缺失、非法与真实零值是三种不同状态；公共 metric 使用 `value: int | None` 和 `origin: provider_reported | derived_exact | unavailable` 表达 | 用户任务、仓库事实 | 当前多处 `.get(..., 0)` 会把缺失变成零；该行为已经让 trace 错报未命中缓存 | 已确认 |
| J11 | OpenAI Chat streaming 的完整 usage 位于启用 `include_usage` 后的最后附加 chunk；流被中断时该 chunk 可能缺失 | 外部规范 | OpenAI Chat API Reference 明确最后 usage chunk 与中断风险 | 已确认 |
| J12 | provider 报告的 inclusive/total 值优先保留；可精确计算的值用于补缺和校验，冲突记录 anomaly，禁止静默覆盖 provider 值 | 用户任务、LLM 推断 | 准确性要求保留真源；公式冲突可能来自 compatible provider 的语义差异或解析错误 | 已确认 |
| J13 | 真实 LLM E2E 必须对同一 request 的多层持久证据做数值对账 | 用户任务、仓库事实 | 现有 live E2E 只验证完成和文件存在，之前因此没有发现 raw 与 trace 字段漂移 | 已确认 |
| J14 | OpenAI 新出现或 provider-compatible 私有的 cache write 字段在 raw 中全量保留；只有 endpoint 官方合同或受版本控制 fixture 明确字段路径与包含关系后，才提升为 canonical `cache_write_tokens` | 用户任务、外部规范、LLM 推断 | 当前官方模型指南要求跟踪 `cache_write_tokens`，现有 Chat/Responses usage reference 的稳定公共字段路径仍以 cached read 为主；准确性要求避免猜路径或默认 0 | 已确认 |
| J15 | OpenAI 的 `input_uncached_tokens` 仅在已知 cache 子集集合完整时推导；只有 cache read 已知时可提供 `input_non_cache_read_tokens` 诊断扩展，不能冒充 uncached billing metric | LLM 推断 | 新 cache write 计量会破坏 `input_total - cache_read` 等于普通 uncached 的前提 | 已确认 |
| J16 | raw_usage 的“全量”指 provider 返回 usage JSON 的深拷贝；HTTP headers、正文、tool content 与 reasoning 文本继续由 raw dump 管理 | 仓库事实、LLM 推断 | usage snapshot 只承载计量对象；把完整响应塞入 Session 会扩大敏感数据和存储边界 | 已确认 |
| J17 | 仓库已经实现 `LLMProvider` 跨 provider 抽象和 `UsageTokenManager` Web 查询抽象，本任务属于合同收紧与重复映射收敛 | 仓库事实、用户反馈 | `LLMResponse.usage`/`LLMStreamChunk.usage` 当前为 dict；`UsageTokenManager.get_thread_usage()` 已是唯一公共查询方法 | 已确认 |

## 建模覆盖声明

| 维度 | 覆盖位置或具体不适用理由 |
|---|---|
| 数据流 | provider raw response/stream fragments → `LLMProvider` family adapter → `ProviderUsageManager` → `ProviderUsageSnapshot` → Runner/Event/Session/trace → UsageTokenManager/Web/CLI，见 `SC_01`、`SC_05`、`SC_10` |
| 状态 | stream fragment 的未见/已见/被后续覆盖状态；metric 的 provider_reported/derived_exact/unavailable；snapshot 的 complete/incomplete，见 `SC_03`、`SC_06`、`SC_08` |
| 时序 | Anthropic 多个 cumulative delta 的字段级覆盖；OpenAI Chat 最终 usage chunk；Responses terminal event，见 `SC_03`、`SC_06`、`SC_07` |
| 资源 | Manager 无 IO/缓存；raw dump 与 FileSession 保持既有资源 owner；真实 E2E 使用现有 provider 配置，见 `SC_10`、`SC_13` |
| 不变量 | `影响边界与不变量`、`SC_02`、`SC_08`、`SC_09`、`SC_11` |
| 故障 | 缺失终态 usage、非法/负数、subset 越界、provider total 冲突、未知新增字段、下游重复计算，见 `SC_06`、`SC_08`、`SC_09`、`SC_12` |

## 验收清单

### 单元测试

- [ ] 三类 family 使用独立 fixture 映射到同一 snapshot；raw usage 深层字段和值完整保留（`SC_01`、`SC_04`、`SC_05`）。
- [ ] 缺失值保持 `None/unavailable`，provider 原报零保持 `0/provider_reported`，精确推导值标记 `derived_exact` 并记录输入路径或公式（`SC_02`）。
- [ ] Anthropic `message_start` 与一个或多个 `message_delta` 的同名字段按 latest-present 覆盖，未出现字段保持既有值，最终只归一化一次（`SC_03`）。
- [ ] OpenAI Chat final usage chunk 缺失或 stream 中断时 snapshot 标记 incomplete，禁止生成伪零（`SC_06`）。
- [ ] Responses adapter 使用 Responses 字段路径；当前 `/chat/completions` provider 被识别为 Chat family（`SC_07`）。
- [ ] provider total 与精确求和冲突、cache/reasoning 子集大于 inclusive、负数或非整数时保留 raw、优先 provider 值并生成稳定 anomaly（`SC_08`、`SC_09`）。
- [ ] cache write 字段只有在 family policy 定义字段路径与关系时进入 canonical；其余情况完整保留 raw 并让 canonical 保持 unknown（`SC_12`）。

### Smoke 测试

- [ ] fake Anthropic、OpenAI Chat、OpenAI Responses 仅替换外部 HTTP，从真实 `LLMProvider` adapter → Runner → FileSession → trace → 现有 UsageTokenManager → Web wire 贯穿，断言相同 request identity 的 snapshot 相等（`SC_10`）。
- [ ] 冲突哨兵让 raw provider total 与本地可计算 total 不同，断言所有下游保留 provider total 和 anomaly，证明下游没有二次计算（`SC_11`）。
- [ ] 运行 core/provider/Web 目标 pytest、mypy、ruff、import-linter、协议 round-trip 与 `git diff --check`。

### E2E 测试

- 决策：需要
- 依据：compatible provider 的真实 SSE 字段位置、OpenAI 最终 usage chunk 和多层持久化只有真实服务链路能证明；fake 只能固定仓库内合同。
- [ ] Anthropic-compatible 真实 Web 对话执行 source → fork → 目标第一轮，按 request identity 对账 raw SSE final usage、snapshot、FileSession、trace 和 Web usage；cache hit 结论只读取 canonical `cache_read_tokens` 的已知值（`SC_13`）。
- [ ] OpenAI Chat Completions 或 Responses 真实 Web 对话执行同一路径，依据实际 endpoint 断言 family，逐字段对账 raw usage 与 canonical 指标；缺失 cache write/reasoning 时 UI 显示未知，真实零时显示零（`SC_14`）。

## 测试驱动开发

1. `SC_01`、`SC_02`、`SC_04`、`SC_05` → 先写三类 raw fixture、未知/零值区分和 raw 深层 round-trip 红灯测试。
2. `SC_03`、`SC_06`、`SC_07` → 先写 Anthropic cumulative delta、OpenAI Chat final usage 缺失和 Responses 字段路径红灯测试。
3. `SC_08`、`SC_09`、`SC_12` → 先写 total 冲突、subset 越界、非法数值和 cache write 未知路径的对抗红灯测试。
4. 收紧 `core.contracts.LLMResponse/LLMStreamChunk.usage` 的显式类型，迁移三类现有 provider adapter，并复用现有 `UsageTokenManager`。
5. `SC_10`、`SC_11` → 先写穿过真实 Runner、FileSession、trace、UsageTokenManager 和 Web wire 的 smoke；迁移下游并删除重复公式。
6. `SC_13`、`SC_14` → 运行两类真实 provider E2E，保存 raw、session、trace、Web 对账报告。
7. 重构后复跑 unit、Smoke、E2E、mypy、ruff、import-linter、协议漂移测试与 `git diff --check`。

## 对抗性审查记录

| Review | 预算 | 风险来源 | 查询 | 召回 ID | 复用 Scenario | 新增 Scenario | CLI |
|---|---|---|---|---|---|---|---|
| ARV-1 | full | assumption:provider-total-conflict | 功能关键词：provider usage、inclusive total、cache subset、reasoning subset、anomaly；Risk：compatible provider 的 raw total 与本地公式冲突时，normalizer 静默用派生值覆盖计量真源 | 无 | SC_08 | SC_11 | skipped:no-corpus |
| ARV-2 | full | assumption:missing-final-usage | 功能关键词：OpenAI Chat streaming、include_usage、final chunk、interrupt、unknown；Risk：流在最终 usage chunk 前中断，parser 把未见字段补成零并持久化成一次完整 cache miss | 无 | SC_06 | 无 | skipped:no-corpus |

## Scenarios

### Scenario SC_01: Anthropic 公共指标与原始字段同时保真

- **GIVEN** Anthropic usage 同时包含 input、output、cache read、cache creation、cache TTL、server tool、service tier 和未知嵌套字段
- **WHEN** Anthropic `LLMProvider` adapter 以 `anthropic_messages` family 构造公共 snapshot
- **THEN** raw usage 与输入逐层值相等；input total 精确等于三项输入之和；input uncached、cache read、cache write 和 output total 使用各自原始字段；reasoning 保持 unknown；total 在全部必要项已知时精确推导
- 测试层：unit
- 依据：`J2`、`J3`、`J4`
- 来源：initial-spec

### Scenario SC_02: 缺失、真实零和精确推导保持可区分

- **GIVEN** 同一 family 的三个 fixture 分别缺少 cache read、原报 cache read 为 0、以及只缺 total 但 input/output 完整
- **WHEN** 分别归一化
- **THEN** 三者对应 metric 依次为 `None/unavailable`、`0/provider_reported`、`sum/derived_exact`，序列化与反序列化后状态不变
- 测试层：unit
- 依据：用户任务、`J10`
- 来源：initial-spec

### Scenario SC_03: Anthropic 流式累计 usage 使用字段级最新值

- **GIVEN** `message_start.usage` 报 input=0、cache_read=0，后续两个 `message_delta.usage` 分别报 cache_read=9000 与 input=194/output=119，后一个 delta 省略 cache_read
- **WHEN** parser 收到 `message_stop`
- **THEN** effective raw usage 为 input=194、output=119、cache_read=9000；后一个 delta 的字段缺失不清空 cache_read；终态 snapshot 只构造一次
- 测试层：unit
- 依据：`J5`
- 来源：initial-spec

### Scenario SC_04: OpenAI Chat inclusive 与子集语义准确映射

- **GIVEN** Chat usage 报 prompt=1000、completion=200、total=1200、cached=800、reasoning=50，并带 audio/prediction details
- **WHEN** 以 `openai_chat_completions` family 归一化
- **THEN** input total=1000、cache read=800、output total=200、reasoning=50、total=1200 且来源均为 provider；raw usage 保留全部 audio/prediction details；cache write 按 raw 合同决定已知或 unknown
- 测试层：unit
- 依据：`J6`、`J14`
- 来源：initial-spec

### Scenario SC_05: OpenAI Responses 使用独立字段路径

- **GIVEN** Responses usage 报 input=700、input details cached=512、output=90、output details reasoning=32、total=790，并带未知 details
- **WHEN** 以 `openai_responses` family 归一化
- **THEN** canonical 指标读取 Responses 路径且 raw 未知 details 保留；结果不依赖任何 `prompt_tokens` 或 `completion_tokens`
- 测试层：unit
- 依据：`J7`
- 来源：initial-spec

### Scenario SC_06: OpenAI Chat 流缺失最终 usage 时保持不完整

- **GIVEN** Chat stream 已输出正文并结束或中断，同时从未收到 `include_usage` 的最终非空 usage chunk
- **WHEN** parser 生成终态或传播中断
- **THEN** usage completeness 为 incomplete，所有未见公共 metric 为 unknown；Session/trace 不出现由默认值生成的零 token 或 cache miss
- 测试层：unit
- 依据：`J10`、`J11`
- 来源：initial-spec

### Scenario SC_07: family 由真实 endpoint 与 wire shape 决定

- **GIVEN** 当前名为 `OpenAIResponsesProvider` 的实现请求 `/chat/completions`，另一个 provider 请求 `/responses`
- **WHEN** 两者分别创建 usage snapshot
- **THEN** 前者 family 为 `openai_chat_completions` 且读取 Chat 字段，后者 family 为 `openai_responses` 且读取 Responses 字段；model 名与 compatible vendor 名不改变 family
- 测试层：unit
- 依据：`J1`、`J8`
- 来源：initial-spec

### Scenario SC_08: provider total 与精确公式冲突时保留真源并报警

- **GIVEN** raw 报 input total=100、output total=20、total=999，且协议公式可计算 total=120
- **WHEN** 对应 `LLMProvider` adapter 构造公共 snapshot
- **THEN** canonical total 保留 `999/provider_reported`，anomalies 包含稳定的 total mismatch、原始路径和计算值 120；任何下游都不把 total 改成 120
- 测试层：unit
- 依据：`J12`
- 来源：initial-spec

### Scenario SC_09: 非法计数和越界子集不进入公共指标

- **GIVEN** raw 同时含负数 token、布尔值、数字字符串、cached 大于 input 或 reasoning 大于 output
- **WHEN** Manager 归一化
- **THEN** 对应公共指标保持 unknown 或保留独立有效的 inclusive provider 值，anomalies 逐项记录非法类型/范围/subset；raw 值原样保留
- 测试层：unit
- 依据：`J2`、`J12`
- 来源：initial-spec

### Scenario SC_10: 单一 snapshot 贯穿内部真实消费者

- **GIVEN** fake 外部 HTTP 返回带唯一 request id 和未知扩展字段的有效 usage，仓库内 LLMProvider adapter、Runner、FileSession、trace、UsageTokenManager 与 Web protocol 全部使用真实实现
- **WHEN** 从 Web generic chat 公共入口完成一次运行并读取 usage
- **THEN** event、Session、trace 与 Web 投影能关联同一 request id；canonical metric 的 value/origin 和 raw usage 在允许投影范围内一致；内部 fake 只存在于外部 HTTP 边界
- 测试层：smoke
- 依据：`J9`、`J13`
- 来源：initial-spec

### Scenario SC_11: 冲突哨兵证明下游没有重新计算 total

- **GIVEN** `SC_08` 的 provider total=999 与 derived candidate=120 作为同一请求的冲突哨兵
- **WHEN** snapshot 穿过 Runner、FileSession、trace、UsageTokenManager 和 Web wire
- **THEN** 每个下游继续输出 total=999 和同一 anomaly，任何消费者出现 120 都使 smoke 失败
- 测试层：smoke
- 依据：`J9`、`J12`
- 来源：adversarial-review (assumption:provider-total-conflict)

### Scenario SC_12: 新增 cache write 字段先保真再提升

- **GIVEN** compatible OpenAI raw usage 出现仓库尚未登记路径的 `cache_write_tokens` 或语义相近未知嵌套字段
- **WHEN** 归一化
- **THEN** raw usage 完整保留该字段，canonical cache write 保持 unknown 并记录 unsupported-path anomaly；加入有官方依据或受版本控制 fixture 的 family policy 后，同一字段才能成为 provider_reported metric
- 测试层：unit
- 依据：`J14`、`J15`
- 来源：initial-spec

### Scenario SC_13: Anthropic-compatible fork 首轮缓存对账

- **GIVEN** 真实 Anthropic-compatible provider、FileSession 和 Web 服务已配置，源 thread 完成对话并 fork
- **WHEN** 目标 thread 发送第一条消息并收到完整响应
- **THEN** 保存同一 request 的 raw SSE、snapshot、Session、trace 与 Web usage；五处已知公共 metric 数值一致；cache hit 只在 canonical cache read 已知且大于 0 时成立
- 测试层：e2e
- 依据：用户任务、`J5`、`J13`
- 来源：initial-spec

### Scenario SC_14: OpenAI fork 首轮协议与零值对账

- **GIVEN** 真实 OpenAI Chat Completions 或 Responses provider、FileSession 和 Web 服务已配置，源 thread 完成对话并 fork
- **WHEN** 目标 thread 发送第一条消息并收到完整响应
- **THEN** family 与实际 endpoint 一致；raw、snapshot、Session、trace 和 Web 的已知指标一致；缺失 metric 显示 unknown，provider 原报 0 显示 0，报告记录实际 cache read 命中状态
- 测试层：e2e
- 依据：用户任务、`J6`、`J7`、`J13`
- 来源：initial-spec
