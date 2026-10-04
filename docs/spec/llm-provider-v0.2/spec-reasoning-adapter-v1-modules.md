# Reasoning Adapter V1 Modules

## 模块总览

| 模块 | 职责 | 依赖 | 状态 | 是否可进 task |
|---|---|---|---|---|
| A. 统一语义与能力表 | 建立 `ReasoningConfig` 与 `reasoning_profiles` | 无 | 方案确认 | 是 |
| B. OpenAI-compatible 适配 | 支持 `gemma-4-e4b-it` 与 `glm*` 的 payload 翻译 | A | 方案确认 | 是 |
| C. Anthropic-compatible 适配 | 支持 `MiniMax-M2.7*` 的 payload 翻译 | A | 方案确认 | 是 |
| D. 契约测试补强 | 补齐失配路径、trace、bootstrap 集成断言 | A/B/C | 方案确认 | 是 |

## 模块 A：统一语义与能力表

**职责**

- 定义统一的 `ReasoningConfig`
- 在配置层引入 `reasoning_profiles`
- 提供基于最终模型名的 profile 匹配与 effort 归一化

**包含范围**

- `config_loader.models.ModelConfig` 增加 `reasoning_profiles`
- 新增 `ReasoningProfile` / `ResolvedReasoningPlan`
- 新增匹配函数：`exact` 优先，`prefix` 次之
- 新增 `normalize_effort()`，将请求档位约束到 profile 支持集合

**不包含范围**

- 不直接生成任何厂商 payload
- 不做 cheap-model routing

**风险与讨论点**

- `minimal/xhigh` 是否现在就对外暴露
  - V1 建议内部结构支持，外部配置可以先继续文档化为 `low|medium|high`
- env 覆盖不适合承载复杂 map
  - `reasoning_profiles` 只走 YAML

**task 建议**

- task 名：`reasoning-adapter-v1-foundation`
- 是否进入 x-req：是
- 原因：这是后续两个 provider adapter 的公共底座

## 模块 B：OpenAI-compatible 适配

**职责**

- 对 `gemma-4-e4b-it` 显式不发 reasoning 参数
- 对 `glm*` 发 `thinking` 参数

**包含范围**

- `openai_responses.py` 不再使用硬编码前缀常量
- 根据 `payload["model"]` 匹配 reasoning profile
- `adapter=none` 路径覆盖 `gemma-4-e4b-it`
- `adapter=glm_thinking_budget` 路径覆盖 `glm*`

**不包含范围**

- 不在 V1 支持 OpenAI o-series / GPT-5
- 不做 provider 自动探测

**风险与讨论点**

- `glm*` 的预算映射建议保持配置驱动，避免继续散落硬编码
- `gemma-4-e4b-it` 必须有显式 profile，不能靠“没命中就跳过”掩盖配置遗漏

**task 建议**

- task 名：`reasoning-adapter-v1-openai`
- 是否进入 x-req：是
- 原因：改动集中，收益直接，能立即消除当前 review 问题

## 模块 C：Anthropic-compatible 适配

**职责**

- 通过现有 `AnthropicMessagesProvider` 支持 `MiniMax-M2.7*`
- 用白名单模型 gate 控制 reasoning 参数发送

**包含范围**

- `anthropic_messages.py` 引入 reasoning adapter 调用点
- `MiniMax-M2.7*` profile 命中后生成 Anthropic-compatible reasoning patch
- 仅对明确白名单模型发送 reasoning 字段

**不包含范围**

- 不新增 `minimax` provider 枚举
- 不覆盖所有 Anthropic-compatible 第三方厂商

**风险与讨论点**

- MiniMax 实际接受的 reasoning 字段需要真机验证
- V1 允许 adapter 在不兼容时降级为 `none`，优先保证主链路稳定

**task 建议**

- task 名：`reasoning-adapter-v1-anthropic`
- 是否进入 x-req：是
- 原因：第一版的第三方厂商支持点，边界清楚

## 模块 D：契约测试补强

**职责**

- 补齐当前 CR 已经指出的两个测试缺口
- 把新架构的关键约束固化成回归测试

**包含范围**

- `request.model != model_config.name` 的 reasoning 单测
- `llm.response.payload.provider_metadata` 的 trace e2e
- `instruction_sources` / `instruction_text_hash` 走真实 `build_session()` + manifest persistence 的集成断言
- `gemma/glm/MiniMax` 三类 profile 的契约测试

**不包含范围**

- 不做全厂商矩阵
- 不做真实远端网络测试

**风险与讨论点**

- trace 测试必须使用真实 event payload，不要重复构造“手工对象”
- bootstrap/hash 测试必须经过 `FileSession` 落盘

**task 建议**

- task 名：`reasoning-adapter-v1-contract-tests`
- 是否进入 x-req：是
- 原因：这是 V1 能否长期稳定演进的质量底座
