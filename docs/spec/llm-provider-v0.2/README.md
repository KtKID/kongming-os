# LLM Provider v0.2 增强方案

> 状态：方案确认中
> 目标：把"已经从 raw dump 里看到"的厂商扩展字段、成本信号、延迟短板，逐步接进 LLM provider 层，让项目从"黑箱调用模型"升级到"可观测、可调优、可控成本"。

## 来源与动机

2026-04-21 接入 `KONGMING_TRACE_RAW_LLM` opt-in dump 后，实测 3 份 glm-5.1 响应发现：

- 项目当前 `LLMResponse` 只存 `finish_reason` + `has_tool_calls` + 3 个 usage 字段 —— **provider 返回的其他字段全丢**（`reasoning_content` / `cached_tokens` / `reasoning_tokens` / `request_id` / `model`）
- 简单 "hi" 也能花 **475 completion tokens**，其中 **87% 是 reasoning**（415 tokens 纯思考链没被存下来）
- 每轮对话 tools schema 占 prompt 的 95%+（500/524 tokens）
- httpx 客户端每次 `_do_complete` 都新开，**没复用 keep-alive**，每次 TLS 握手 100-300ms

这组现象组成一个明确的优化系统：**可观测性 → 成本控制 → 延迟改善**。

## 系统目标

在保持 v1-mini 架构边界（core 零依赖、协议单一真源、import-linter 合约）的前提下，把 LLM 层做到：

1. **可观测**：响应原文能还原为结构化指标（token 细分、缓存命中、推理链）
2. **可调优**：用户能按对话复杂度控制 reasoning 深度、是否压缩 schema、是否流式
3. **成本可控**：prompt/completion tokens 的消耗能被量化、能被显式减少
4. **延迟改善**：首字响应时间从秒级改善到毫秒级（流式）、连接复用省 TLS 握手

## 范围边界

**包含**：

- `LLMResponse` 协议扩展（增 `provider_metadata` 字段）
- OpenAI-compatible provider 的 request payload 新增参数支持（reasoning_effort / thinking）
- tools schema 生成策略（压缩 + 动态筛选）
- httpx 连接层复用（provider 级单例 client + 生命周期）
- 非流式 → 流式的切换能力（provider + runner + host 三层链路）

**不包含**：

- 多 provider 并行路由（留给 v0.3+）
- 账单自动核算 / 月度 usage 报表（业务层，留给 observability 独立任务）
- tool 级别的 "usage metering"（哪个工具消耗多少 tokens）
- LLM-based 的 tool 动态筛选（模块 E 初版只做规则引擎）
- 本方案**不修改** `core.contracts.LLMProvider` Protocol 形状 —— 兼容现有 anthropic provider

## 模块导航

| 模块 | 状态 | 文档 | 优先级 | 是否可进 task | 说明 |
|---|---|---|---|---|---|
| A · provider_metadata 接入 | 方案确认 | [02-module-breakdown.md#A](./02-module-breakdown.md#模块-a) | **P0** | 是 | 其他模块的数据基础 |
| B · reasoning 等级控制 | 方案确认 | [02-module-breakdown.md#B](./02-module-breakdown.md#模块-b) | **P1** | 是 | 独立，依赖 A 反馈验证 |
| C · tools schema 压缩 | 方案确认 | [02-module-breakdown.md#C](./02-module-breakdown.md#模块-c) | **P1** | 是 | 独立，可量化验证 |
| D · httpx client 复用 | 方案确认 | [02-module-breakdown.md#D](./02-module-breakdown.md#模块-d) | **P1** | 是 | 独立性能优化 |
| E · tools 动态筛选 | 探索中 | [02-module-breakdown.md#E](./02-module-breakdown.md#模块-e) | **P2** | 否 | 依赖 C 完成后再设计 |
| F · 流式响应 + TTFT | 探索中 | [02-module-breakdown.md#F](./02-module-breakdown.md#模块-f) | **P3** | 否 | 架构改动大，最后做 |

## 优先级与阶段路线

### 阶段 1：打地基（P0）

**必须最先做**。没有模块 A 的数据，其他模块无法衡量效果（例如"tools schema 压缩真的省了多少 tokens"需要 provider_metadata 里的细分字段才能验证）。

- 模块 A：`llm-provider-metadata`

### 阶段 2：并行收益（P1）

3 个模块**独立互不依赖**，可以并行或任意顺序做。每一个单独都能带来可量化收益。

- 模块 B：`reasoning-effort-control` —— 简单对话省 5-10x reasoning tokens
- 模块 C：`tools-schema-compaction` —— prompt tokens 省 30-50%
- 模块 D：`httpx-client-reuse` —— 每会话省 1-3 秒 TLS 握手

### 阶段 3：智能优化（P2）

- 模块 E：`tools-dynamic-selection` —— 依赖 C 的 schema 拆分能力做完之后规则引擎才有可操作性

### 阶段 4：架构改造（P3）

- 模块 F：`llm-streaming` —— 涉及 runner/host/cli adapter 多层改造，风险最大，放在最后做

## 文档导航

- [模块拆分](./02-module-breakdown.md) — 6 个模块的职责、边界、依赖、风险
- [Task 映射](./90-task-map.md) — 模块 → task 名 → 是否可进 x-req
- [Reasoning Adapter V1 补充方案](./spec-reasoning-adapter-v1.md) — 统一 reasoning 语义、模型能力表、adapter 设计
- [Reasoning Adapter V1 模块拆分](./spec-reasoning-adapter-v1-modules.md) — 第一版仅支持 gemma / glm / MiniMax
- [Reasoning Adapter V1 Task Map](./spec-reasoning-adapter-v1-task-map.md) — V1 的 task 拆分与推进顺序
- [LLM Streaming V1 子方案](./streaming/README.md) — 模块 F 的独立 x-spec，参考 Hermes 实现方式（5 份文档：README / 模块拆分 / 数据与状态 / 验证与演进 / Task 映射）
- [Reasoning Adapter V2 子方案](./reasoning-adapter-v2/README.md) — 正交双字段（开关 + 档位），覆盖 GLM-5.2 / DeepSeek / MiniMax M3，修复 V1 单字段 none 设计缺陷

## 当前建议

### 用户指定执行路径：A → B → F（2026-04-22 决定）

**确认的顺序**：

1. **第 1 步**：A · `llm-provider-metadata`（`x-req` → `x-plan` → `x-dev`）
2. **第 2 步**：B · `reasoning-effort-control`（`x-qdev`）
3. **第 3 步**：F · `llm-streaming`（**必须先独立跑一次 `x-spec`**，然后 `x-req` → `x-plan` → `x-dev`）

### 关于这个选择

**C / D / E 被有意后推**。正常的数据驱动路径会建议 A → B/C/D 并行 → 看数据决定 E → 最后 F，
但用户选择把"体感收益最大的 F"提前，原因是"流式打字机效果"值得优先。代价：

- **C 被跳过** → prompt tokens 的节省没做，但 B 已经能压 reasoning tokens，大概率仍能看到账单下降
- **D 被跳过** → 每次 TLS 握手浪费 100-300ms，**在流式场景这个损失会被放大**：TTFT 本来就是流式的核心指标，但 TLS 握手会吃掉 TTFT 的一半
- **建议插入**：F 启动前先把 D 快速做了（3-5 文件的 `x-qdev`），否则流式测出的 TTFT 会被 TLS 握手拖慢而误判为"流式实现的问题"

### 默认原则

1. **不一次做完**：6 个 task 合并实施容易触发跨模块 regression；逐个 ship 逐个验证是本方案的核心原则
2. **F 之前暂停一次** 做 `x-spec` 独立方案规划 —— F 是唯一涉及 Protocol 形状变更的模块，详细改动面见 [模块 F 拆分](./02-module-breakdown.md#模块-f)
3. **暂缓 E**：停留在方案层，等 C（或替代方案）完成 + 2 周真实使用数据后再评估

## 验证 & 度量

每个模块完成后，应能在 `.kongming/debug/raw-llm-*.json` 的数据基础上回答：

- A 完成 → `jq '.response.body.usage.prompt_tokens_details.cached_tokens'` 能从 trace 事件里读到
- B 完成 → 对比同 prompt 在 `reasoning_effort=low` vs `high` 的 reasoning_tokens 差距
- C 完成 → prompt_tokens 直方图显著左移
- D 完成 → `date` header 之间的间隔稳定低于 100ms（cold 除外）
- E 完成 → 不同意图请求的 tools 数量呈阶梯分布
- F 完成 → `llm.chunk.first` 事件距离 `llm.request` 在 500ms 内
