# 代码坏味道范例

本文记录 repo 内需要警惕的代码坏味道。每条都给出识别信号和推荐落点，方便评审时直接对照。

## Provider 规则散落在 Parser 分支里

### 坏味道

在解析函数里直接写 provider 专属判断：

```python
def _parse_model_spec(raw: object, *, owner: str) -> SubAgentModelSpec:
    provider = raw.get("provider")
    protocol = raw.get("protocol", "openai_compatible")

    if provider not in {"minimax", "glm"}:
        raise ValueError("provider must be minimax or glm")

    if provider == "glm" and protocol != "openai_compatible":
        raise ValueError("protocol for glm must be openai_compatible")

    if provider == "minimax" and protocol == "openai_compatible":
        token_parameter_name = "max_completion_tokens"
    else:
        token_parameter_name = "max_tokens"
```

### 识别信号

- 新增 provider 时需要继续往 parser 里加 `if provider == ...`。
- token 字段名、协议能力、模型 token 上限分散在多个 helper 里。
- parser 同时承担外部 payload 解析和 provider 能力声明。

### 推荐写法

把 provider 能力集中成数据结构，parser 只查表和做通用校验：

```python
@dataclass(frozen=True)
class ProviderRuntimeCapability:
    # provider 支持的协议族。
    protocols: frozenset[ProviderProtocol]
    # 每个协议对应的 token 字段名。
    token_parameter_by_protocol: dict[ProviderProtocol, TokenParameterName]
    # provider 默认输出 token 上限。
    max_output_tokens: int
    # 模型名前缀对应的特殊输出 token 上限。
    model_max_output_tokens: dict[str, int]


PROVIDER_RUNTIME_CAPABILITIES: dict[ProviderName, ProviderRuntimeCapability] = {
    "minimax": ProviderRuntimeCapability(
        protocols=frozenset({"openai_compatible", "anthropic_compatible"}),
        token_parameter_by_protocol={
            "openai_compatible": "max_completion_tokens",
            "anthropic_compatible": "max_tokens",
        },
        max_output_tokens=131_072,
        model_max_output_tokens={},
    ),
    "glm": ProviderRuntimeCapability(
        protocols=frozenset({"openai_compatible"}),
        token_parameter_by_protocol={"openai_compatible": "max_tokens"},
        max_output_tokens=131_072,
        model_max_output_tokens={
            "glm-4.5v": 16_384,
            "glm-4.5": 98_304,
        },
    ),
}
```

parser 使用方式：

```python
capability = PROVIDER_RUNTIME_CAPABILITIES.get(provider)
if capability is None:
    raise ValueError(f"unknown provider: {provider}")

if protocol not in capability.protocols:
    raise ValueError(f"{provider} does not support protocol {protocol}")

expected_token_parameter = capability.token_parameter_by_protocol[protocol]
```

### 判断标准

Provider 差异属于能力声明，适合放在 capability 表或 provider profile。Parser 的职责是把外部 payload 转成强类型对象，并基于能力表做一致性校验。新增 provider 的改动入口应集中在能力声明和对应测试用例。
