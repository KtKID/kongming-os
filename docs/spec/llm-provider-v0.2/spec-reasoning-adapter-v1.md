# Reasoning Adapter V1

> 状态：方案确认
> 目标：把当前基于 `model_config.name` 的硬编码 reasoning 参数映射，升级为“统一 reasoning 语义 + 模型能力表 + provider adapter 翻译”的结构化方案。第一版只覆盖 `gemma-4-e4b-it`、`glm`、`MiniMax` 三类模型。

## 背景

当前 reasoning 参数控制已经落地，但存在两个结构性问题：

1. 是否发送 reasoning 参数、发送哪种参数格式，绑定在 provider 内部硬编码前缀上
2. 判断依据使用 `model_config.name`，与真实请求模型 `request.model` 存在失配风险

这会让“切模型”和“推理强度”耦合在一起，也让多厂商接入难以演进。

## 方案目标

V1 只解决三件事：

1. 建立统一内部语义：`ReasoningConfig(enabled, effort)`
2. 建立模型能力表：以“模型名字 / 模型族”为 key，声明是否支持 reasoning 以及采用哪种 adapter
3. 建立 provider adapter：按最终生效模型名，把统一 reasoning 语义翻译成真实 API payload

## 范围边界

**包含**

- 引入统一的 `ReasoningConfig`
- `ModelConfig` 增加 `reasoning_profiles`
- provider 在构造 payload 时按最终模型名匹配 profile
- 新增 reasoning adapter 层
- 第一版支持以下模型族
  - `gemma-4-e4b-it`
  - `glm*`
  - `MiniMax-M2.7*`
- 补齐与此结构直接相关的单测和集成测试

**不包含**

- 自动 cheap-model routing
- delegation / sub-agent 的独立 reasoning 继承策略
- `/reasoning` 命令或交互式切换
- 任意厂商全量覆盖
- 基于远端目录动态拉模型能力

## 第一版支持矩阵

| 模型族 | Provider 路径 | Reasoning 支持 | V1 adapter |
|---|---|---|---|
| `gemma-4-e4b-it` | `openai_compatible` | 关闭 | `none` |
| `glm*` | `openai_compatible` | 开启 | `glm_thinking_budget` |
| `MiniMax-M2.7*` | `anthropic` 兼容端点 | 开启 | `anthropic_compatible_reasoning` |

说明：

- `gemma-4-e4b-it` 在 V1 中明确声明为“无 reasoning 能力”，用于验证配置驱动的 `adapter=none` 路径
- `glm*` 走当前项目已经验证过的 OpenAI-compatible `thinking` 参数映射
- `MiniMax-M2.7*` 在 V1 中复用现有 `AnthropicMessagesProvider` 路径承载，理由是 Hermes 本地实现已经长期把 MiniMax 识别为 Anthropic-compatible endpoint

## 核心设计

### 1. 统一内部语义

对外配置仍保留一个统一档位字段，V1 推荐升级到：

```python
ReasoningConfig(
    enabled: bool,
    effort: Literal["minimal", "low", "medium", "high", "xhigh"] | None,
)
```

V1 兼容现有 `low|medium|high`，内部结构先一次到位，为后续扩展 `minimal/xhigh` 预留空间。

### 2. 模型能力表

建议把能力表放进 `model.reasoning_profiles`，key 就是模型名字或模型族：

```yaml
model:
  name: gemma-4-e4b-it
  reasoning_effort: medium
  reasoning_profiles:
    gemma-4-e4b-it:
      match: exact
      adapter: none

    glm:
      match: prefix
      adapter: glm_thinking_budget
      effort_map:
        low: 1024
        medium: 8192
        high: 32768

    MiniMax-M2.7:
      match: prefix
      adapter: anthropic_compatible_reasoning
      supported_efforts: [low, medium, high]
```

匹配规则：

1. 先拿最终请求模型名
2. `exact` 优先于 `prefix`
3. profile 未命中时，视为 `adapter=none`

### 3. Provider adapter

provider 不再自己写前缀判断，只消费一个统一计划：

```python
ResolvedReasoningPlan(
    model_name: str,
    send_reasoning: bool,
    normalized_effort: str | None,
    adapter_name: str,
    payload_patch: dict[str, Any],
)
```

adapter 的职责只有一个：根据 profile 和 effort 产出 payload patch。

### 4. 判断基于最终模型名

V1 的关键约束：

- 一律用 `request.model` 或最终写入 `payload["model"]` 的值匹配 profile
- 不再用 `model_config.name` 决定参数格式

这条规则直接修复当前 review 中的失配问题。

## MiniMax 在 V1 的处理原则

MiniMax 采用保守接入：

1. 复用现有 `anthropic` provider 路径，不新增第三种 provider 枚举
2. 只对白名单模型 `MiniMax-M2.7*` 发送 reasoning 参数
3. 参数翻译由 `anthropic_compatible_reasoning` adapter 负责
4. 如果真实端点对某个字段不接受，允许 profile 将 adapter 降为 `none`，主链路保持可用

这样 V1 可以先完成架构落地和厂商隔离，再按真实验证结果收紧 MiniMax 参数细节。

## 验证原则

V1 交付后必须能回答：

1. `request.model != model_config.name` 时，是否按实际模型名命中 profile
2. `gemma-4-e4b-it` 是否稳定不发送 reasoning 参数
3. `glm*` 是否稳定发送 `thinking`
4. `MiniMax-M2.7*` 是否只在 Anthropic-compatible 路径下发送白名单字段
5. `provider_metadata` 是否真实落到 `llm.response` trace
6. `instruction_sources` / `instruction_text_hash` 是否通过真实 `build_session()` 路径落盘

## 当前建议

1. 先把 reasoning profile registry 和 adapter 层落地
2. 第一版只做 `gemma-4-e4b-it + glm + MiniMax`
3. MiniMax 参数保持白名单 gate，先保证主链路稳定，再扩细档位映射
4. 本方案完成后，再进入 `x-req` / `x-plan` / `x-dev`
