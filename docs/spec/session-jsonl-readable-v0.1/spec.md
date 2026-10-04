> spec_version: 3
> adversarial_risk_version: 3
> complexity: 3
> importance: 3
> risk_average: 3.0
> review_budget: deep
> adversarial_review: skipped:no-corpus

# session-jsonl-readable-v0.1

## 任务目标

- 新建 session materialize 时，把完整 system prompt 作为 `record_type="system_prompt"` 记录写入 `<tid>.jsonl` 首行，使 jsonl 自包含、单文件可读（对标 Codex rollout 的 `session_meta`）。
- assistant message 落盘时，若模型返回了 reasoning，把**完整原文**（不截断、不摘要）作为 record 顶层 `reasoning_content` 字段持久化；若无 reasoning 则完全不写该字段（不写 null）。
- 读取层（history / context_snapshot）不得返回 system_prompt record，避免 system prompt 被重复注入 LLM。

## 非目标

- 不动 raw-llm dump（碎片化问题另行处理）。
- 不改 Message dataclass / core.contracts（reasoning 不进 message.content）。
- 不改 web wire 协议 / 前端（存储层可读性优化，对前端透明）。
- 不删 `system_prompt.json`（保留，恢复链路依赖，jsonl 内 system_prompt 是冗余副本）。
- 不自动回填老 session（老 session 继续按现状工作，读取层兼容缺失首行）。
- 不做 turn_context record（cwd/model/effort 已在 manifest，本轮不扩）。
- 不让 LLM 在下一轮看到自己上一轮的 reasoning（reasoning 仅落盘供阅读，不进 history）。
- 不修 Anthropic provider 的 reasoning 落盘（J6：本 spec 仅记为已知限制）。

## 风险评分依据

- 模式：full；complexity=3（跨 `sessions/file_session.py` + `core/runner.py` + `infrastructure/llm_providers/openai_compat_stream_parser.py` 三模块协作），review_budget=deep，task risk=Q1（持久化变更但完全向后兼容），目标模块=`sessions/file_session.py`（主）+ `core/runner.py`（上游调用方）+ `openai_compat_stream_parser.py`（reasoning 真源），允许修改=append 签名 / materialize 写首行 / parser 去截断，禁止波及=`core.contracts.Message` / web wire 协议 / `anthropic_messages` provider。升级信号=跨 3 模块协作。
- 剃刀检查：保留 system_prompt 首行记录（服务目标 1，SC_01/SC_03 承接）；保留 reasoning_content 顶层字段（服务目标 2，SC_04 承接）；保留 `_extract_reasoning_content` helper（服务目标 2，SC_07 承接）；保留 stream parser 去截断改动（服务目标 2「完整不省略」硬约束，SC_06 承接）。删除/延后：turn_context record（无当前消费者）、老 session 回填脚本（无当前验收需要）、reasoning 注入下一轮 LLM（非目标）。
- 复杂度：3 —— 跨 3 模块加字段+去截断，无新状态机/锁/并发协议；stream parser 的 `_reasoning_parts` 已累积完整碎片（`openai_compat_stream_parser.py:74,157`），去截断是单行改动；`FileSession._read_records` 已按 record_type 分流（`file_session.py:326-335`），新增 system_prompt record 天然被忽略。
- 重要性：3 —— 全用户非核心功能增强（jsonl 可读性），不涉资金/隐私/合规；持久化变更但向后兼容（老 session 读取零迁移）。
- 预算升级：平均 3.0 → deep；无单维 4/5，无资金/合规生命线。

## 影响边界与不变量

| 模块 | 角色 | 本次影响 | 主要风险 | 必须保持的不变量 | 依据 |
|---|---|---|---|---|---|
| `sessions/file_session.py` | 目标 | `_materialize` 新增写 system_prompt 首行；`append` 新增 `reasoning_content` 可选参数；新增 `_write_system_prompt_to_jsonl` 私有方法 | system_prompt record 漏进 history → system prompt 重复注入 LLM → 上下文膨胀/行为异常 | `_read_records` 只返回 `record_type=="message"` 的记录；system_prompt record 永不进 `history()`/`context_snapshot()` | 用户任务 / `J1` |
| `core/runner.py` | 上游 | assistant message 落盘点调用 append 时传 reasoning_content；新增 `_extract_reasoning_content(response)` 私有 helper | reasoning 提取字段路径错误 → 写空串或漏写 | assistant message 落盘时若有 reasoning 必须完整写入 | 用户任务 / `J2` / `J3` |
| `infrastructure/llm_providers/openai_compat_stream_parser.py` | 上游（reasoning 真源） | `_build_provider_metadata` 去掉 `[:500]` 截断 | 改动影响 trace.jsonl 里 `llm.response` 事件的 provider_metadata 体积 | stream parser 产出的 reasoning_content 必须是完整原文 | 用户任务硬约束「不能省略」/ `J3` |
| `core/contracts/llm_provider.py` | 相关（禁改） | 零改动 | — | `LLMResponse.provider_metadata: dict[str, Any]` 契约不变 | `J4` |
| `system_prompt.json` | 相关 | 保留不删，jsonl 内 system_prompt 是冗余副本 | — | 恢复链路（`_recover`）继续从 manifest 读取 instruction_text_hash | `J5` |

## 判断依据

| J-ID | 判断 | 来源 | 证据或推断 | 状态 |
|---|---|---|---|---|
| J1 | `_read_records` (`file_session.py:326-335`) 按 record_type 严格分流，只处理 `"message"`/`"context_checkpoint"`，新增 `"system_prompt"` record 天然被忽略，无需改读取层 | 仓库事实 | line 327 `if record_type == "message"` / line 335 `elif record_type == "context_checkpoint"` | 已确认 |
| J2 | runner 落盘点作用域内 `response.provider_metadata` 可直接访问，类型为 `dict[str, Any]`（`llm_provider.py:104`） | 仓库事实 | 落盘点 `assistant_message = response.message` 后紧接 `dict(response.provider_metadata)` | 已确认 |
| J3 | 流式 parser `openai_compat_stream_parser.py:344` `provider_metadata["reasoning_content"] = full[:500]` 把 reasoning 截断到 500 字；非流式 `openai_responses` 路径根本不写 reasoning_content。要「完整不省略」必须去截断 | 仓库事实 | `openai_compat_stream_parser.py:341-345` / `openai_responses.py` 无 reasoning_content 写入 / `anthropic_messages.py:656-662` provider_metadata 不写 thinking | 已确认 |
| J4 | Message 是 `core.contracts` 的 dataclass（frozen 语义），改其 schema 影响跨模块契约；reasoning 放 record 顶层不污染契约 | 仓库事实 | `core/contracts/llm_provider.py` Message 定义 / AGENTS.md「数据模型不可变优先」 | 已确认 |
| J5 | `system_prompt.json` 被 `_recover` 通过 manifest 间接依赖（manifest 记录 instruction_text_hash），删除会破坏恢复链路 hash 校验 | 仓库事实 | `file_session.py:405` manifest 存 instruction_text_hash / `_recover` 恢复时读 manifest | 已确认 |
| J6 | Anthropic 流式 thinking 在 stream parser 里已合并到 `LLMStreamChunk(kind="reasoning.delta")`，但 `message.done` 的 provider_metadata 不写 thinking 字段（与 OpenAI 风格不一致）。本 spec 不修，仅记为已知限制 | 仓库事实 | `anthropic_stream_parser.py:267-275` yield reasoning.delta / `anthropic_messages.py:656-662` provider_metadata 不写 thinking | 已确认 |

## 建模覆盖声明

| 维度 | 覆盖位置或具体不适用理由 |
|---|---|
| 数据流 | `SC_01`（system_prompt 写入 jsonl 首行）/ `SC_04`（reasoning 从 response → append → record 顶层） |
| 状态 | 不适用：FileSession 是 append-only 存储，无状态机；`_materialized` 标志已有，本次不新增状态 |
| 时序 | `SC_01`：materialize 顺序 = 写 manifest → 写 system_prompt snapshot → touch jsonl → 写 system_prompt 到 jsonl 首行（必须在 touch 之后、首次 append 之前） |
| 资源 | 不适用：无新资源生命周期，复用现有 `_append_record` 的 open/flush/fsync 路径 |
| 不变量 | `影响边界与不变量`（`_read_records` 只返回 message record / `system_prompt.json` 保留） |
| 故障 | `SC_02`（老 session 无 system_prompt 首行仍能加载）/ `SC_08`（materialize 重复调用幂等） |

## 验收清单

### 单元测试

- [ ] `test_materialize_writes_system_prompt_to_jsonl_first`：materialize 后 jsonl 第 1 行 `record_type=="system_prompt"`，content 与 instruction_text 完全一致
- [ ] `test_history_excludes_system_prompt_record`：materialize + append message 后 `history()` 返回列表不含 system_prompt record
- [ ] `test_context_snapshot_excludes_system_prompt_record`：`context_snapshot().messages` 不含 system_prompt
- [ ] `test_append_with_reasoning_content`：append 传 reasoning_content 后 record 顶层有该字段且为完整原文
- [ ] `test_append_without_reasoning_content_omits_field`：不传 reasoning_content 时 record 不含该 key（不写 null）
- [ ] `test_old_session_without_system_prompt_jsonl_still_loads`：构造无 system_prompt 首行的老 jsonl，`history()`/恢复正常
- [ ] `test_materialize_system_prompt_idempotent`：重复调用 materialize 不重复写 system_prompt 首行
- [ ] `test_extract_reasoning_content_openai_style`：mock LLMResponse 带 provider_metadata.reasoning_content，helper 返回完整字符串
- [ ] `test_stream_parser_reasoning_not_truncated`：构造 reasoning 长 800 字的 chunk 序列，parser 产出的 provider_metadata.reasoning_content 长度==800（非 500）

### Smoke 测试

- [ ] 跑 `make smoke` 或最小 e2e：发起一轮对话，读 `<tid>.jsonl` 断言：① 首行 `record_type=="system_prompt"` 且 content 非空 ② assistant record 若模型返回 reasoning 则带 reasoning_content 完整原文 ③ `history()` 不含 system_prompt

### E2E 测试

- 决策：省略
- 依据：本任务是存储层可读性增强，无跨进程/跨服务/真实基础设施新链路；smoke 已覆盖「对话 → 落盘 → 读取」完整链路

## 测试驱动开发

1. `SC_01` → 先写会失败的 `test_materialize_writes_system_prompt_to_jsonl_first`。
2. `SC_02` → 先写 `test_old_session_without_system_prompt_jsonl_still_loads`（应直接通过，回归防线）。
3. `SC_03` → 先写 `test_history_excludes_system_prompt_record`（应直接通过，回归防线）。
4. `SC_04` → 先写会失败的 `test_append_with_reasoning_content`。
5. `SC_05` → 先写会失败的 `test_append_without_reasoning_content_omits_field`。
6. `SC_06` → 先写会失败的 `test_stream_parser_reasoning_not_truncated`。
7. `SC_07` → 先写会失败的 `test_extract_reasoning_content_openai_style`。
8. `SC_08` → 先写 `test_materialize_system_prompt_idempotent`。
9. 实现满足测试的最小代码（FileSession → runner → stream parser），重构后复跑全部单元 + smoke。

## 对抗性审查记录

| Review | 预算 | 风险来源 | 查询 | 召回 ID | 复用 Scenario | 新增 Scenario | CLI |
|---|---|---|---|---|---|---|---|
| ARV-1 | deep | skipped:no-corpus | 无（无 RAG 语料） | 无 | 无 | 无 | skipped:no-corpus |

## Scenarios

### Scenario SC_01: materialize 时 system_prompt 写入 jsonl 首行
- **GIVEN** 一个带 `instruction_text="完整 system prompt 原文"` 的 SessionBootstrap，FileSession 首次 materialize
- **WHEN** 调用 `_materialize()` 完成后
- **THEN** `<tid>.jsonl` 第 1 行是 `record_type=="system_prompt"`，其 content 字段与 instruction_text 完全相等，且后续 message append 在第 2 行起
- 测试层：unit
- 依据：用户任务 / `J1`
- 来源：initial-spec

### Scenario SC_02: 老 session 无 system_prompt 首行仍能正常加载
- **GIVEN** 一个 jsonl 首行直接是 `record_type=="message"`（无 system_prompt record）的老格式 session 目录
- **WHEN** FileSession 初始化走 `_recover()` 并调用 `history()`
- **THEN** `history()` 正常返回所有 message，不报错，不把任何 message 误判为 system_prompt
- 测试层：unit
- 依据：`J1` / `J5`
- 来源：initial-spec

### Scenario SC_03: history/context_snapshot 不返回 system_prompt record
- **GIVEN** 一个已 materialize 且 jsonl 含 system_prompt 首行 + 若干 message record 的 session
- **WHEN** 调用 `history()` 和 `context_snapshot()`
- **THEN** 两者返回的 messages 列表中没有任何 system_prompt 内容（即 system prompt 不会被重复注入下一轮 LLM 请求）
- 测试层：unit
- 依据：`J1`
- 来源：initial-spec

### Scenario SC_04: append 带 reasoning_content 时 record 顶层写入完整原文
- **GIVEN** 一个已 materialize 的 session，一条 assistant Message，`reasoning_content="一段完整思考链原文（含中文/标点/换行）"`
- **WHEN** 调用 `append(message, reasoning_content=reasoning_content)`
- **THEN** jsonl 新增 record 顶层有 `"reasoning_content"` 字段，值与传入字符串完全相等（逐字符一致，不截断）
- 测试层：unit
- 依据：用户任务硬约束「不能省略」/ `J2` / `J3`
- 来源：initial-spec

### Scenario SC_05: append 不传 reasoning_content 时不写该字段
- **GIVEN** 一个已 materialize 的 session，一条 user Message，不传 reasoning_content
- **WHEN** 调用 `append(message)`（reasoning_content 默认 None）
- **THEN** jsonl 新增 record 中**不存在** `reasoning_content` key（不是 null，不是空串）
- 测试层：unit
- 依据：用户任务 / `J2`
- 来源：initial-spec

### Scenario SC_06: stream parser 产出的 reasoning_content 不被截断
- **GIVEN** 一个 OpenAI 风格流式 chunk 序列，其 `delta.reasoning_content` 拼接后总长 800 字
- **WHEN** `OpenAICompatStreamParser.parse()` 消费完所有 chunk 产出 message.done
- **THEN** message.done 的 `provider_metadata.reasoning_content` 长度==800（完整原文，非 500 字截断）
- 测试层：unit
- 依据：用户任务硬约束「不能省略」/ `J3`
- 来源：initial-spec

### Scenario SC_07: _extract_reasoning_content 从 LLMResponse 提取完整 reasoning
- **GIVEN** 一个 LLMResponse，`provider_metadata={"reasoning_content": "完整推理原文..."}`
- **WHEN** 调用 runner 的 `_extract_reasoning_content(response)`
- **THEN** 返回值与 provider_metadata.reasoning_content 完全相等；若 provider_metadata 无该字段或为空串则返回 None
- 测试层：unit
- 依据：`J2` / `J3`
- 来源：initial-spec

### Scenario SC_08: materialize 重复调用不重复写 system_prompt 首行
- **GIVEN** 一个已 materialize 的 session（jsonl 首行已是 system_prompt）
- **WHEN** 由于边缘情况 `_materialize` 被再次调用
- **THEN** jsonl 首行仍是单条 system_prompt record，不出现第二条 system_prompt
- 测试层：unit
- 依据：`J1`
- 来源：initial-spec
