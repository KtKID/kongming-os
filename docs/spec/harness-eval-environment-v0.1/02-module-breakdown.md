# 模块拆分

## 模块总览

| 模块 | 职责 | 边界类 / 入口 | 依赖 | 状态 | 风险 |
|---|---|---|---|---|---|
| Eval Environment Setup | 解释依赖、配置、密钥、preset、运行命令 | `EvalEnvironmentGuide` | config / README / uv | 可进入 x-req | 低 |
| Runtime Profile Control | 把 baseline-min / full 装配成显式运行切片 | `EvalProfileManager` | SessionEngine / AgentSpec / Session | 可进入 x-req | 中 |
| Approval Control | 选择底层 approval provider 和 case 级开关 | `EvalApprovalManager` | tools.runtime.approval / task YAML | 可进入 x-req | 中 |
| Artifact Metadata | 在产物中记录环境快照和 profile 差异 | `EvalArtifactManager` | summary / trajectory / report | 可进入 x-req | 低 |
| Automation Recipe | 固化 CI、nightly、手动对比命令 | `EvalAutomationGuide` | README / pytest | 可进入 x-req | 低 |
| Business Code Change Plan | 标注脚本层无法配置时的最小代码方案 | `EvalChangePlanner` | SessionEngine / config schema | 方案确认 | 中 |

## Eval Environment Setup

**职责**：给评测者提供一条从环境准备到产物分析的稳定路径。

**包含范围**：

- `uv sync --all-extras` 或 `make install`。
- `.env` 中的 preset key，例如 `MINIMAX_API_KEY`、`GLM_API_KEY`、`DEEPSEEK_API_KEY`。
- `repo:config/setting.yaml` 中 `web.llm_presets` 的字段解释。
- fixture 和真实模型两类 run 命令。
- 输出目录与排错顺序。

**对外入口**：`repo:evals/harness-runtime-v0.1/README.md`。

**建议文档片段**：

```bash
make install

# 仓库根 .env
MINIMAX_API_KEY=...
GLM_API_KEY=...

uv run python scripts/run_kongming_harness_eval.py --mode fixture
uv run python scripts/run_kongming_harness_eval.py --preset minimax-m3 --profile full --approval-mode auto_allow
```

## Runtime Profile Control

**职责**：把运行时变量拆成可比较 profile。

**profile 定义**：

| profile | instructions | session | compactor | 适用场景 |
|---|---|---|---|---|
| `baseline-min` | 空 system prompt，使用显式 `AgentSpec(instructions="")` | `InMemorySession` | 脚本侧 Noop compactor | 测基础模型输出能力 |
| `full` | 当前 eval system instructions | file session + bootstrap | 跟随 config，默认 Noop | 测 Kongming runtime 装配增益 |

**边界类**：`EvalProfileManager`。

**拟议接口**：

```python
class EvalProfileManager:
    def build_runtime_kwargs(self, profile: str, config: Config, registry: ToolRegistry) -> dict[str, object]:
        """返回 SessionEngine.build 的 profile 相关参数。"""
```

**关键硬编码点**：

- 当前脚本把 instructions 写死在 `run_task`。
- 当前脚本把 session factory 固定为 file backend。
- `instructions=""` 会触发 `SessionEngine.build` 默认 prompt，baseline-min 要走显式 `AgentSpec`。

## Approval Control

**职责**：让 eval 能表达无人值守和 case 级人工审批。

**模式定义**：

| mode | 行为 | 用途 |
|---|---|---|
| `auto_allow` | 底层 approval provider 使用 `AutoAllowApproval()` | 默认自动化评测 |
| `interactive` | 底层 approval provider 使用 CLI interactive prompt | 整套 approval 体验验证 |
| `case` | 读取 task YAML 的 `runtime.approval_mode` | 只让特定题走审批 |

**case YAML 结构**：

```yaml
runtime:
  approval_mode: interactive
```

**边界类**：`EvalApprovalManager`。

**拟议接口**：

```python
class EvalApprovalManager:
    def resolve_provider(self, suite_mode: str, task_runtime: dict[str, object]) -> ApprovalProvider:
        """根据 CLI mode 和 case runtime 字段选择底层 approval provider。"""
```

**主业务边界**：

`SafetyGatedApproval` 始终保留，eval 控制的是 ConsentResolver 末端调用的底层 provider。

## Artifact Metadata

**职责**：让每个 run 和每个 task 都能解释“这次怎么跑的”。

**新增字段建议**：

```json
{
  "profile": "full",
  "approval_mode": "auto_allow",
  "instructions_mode": "eval_default",
  "session_backend": "file",
  "compactor_mode": "config",
  "config_path": "config/setting.yaml",
  "preset": "minimax-m3"
}
```

**写入位置**：

- `summary.json`：suite 级字段。
- `tasks.json`：每题记录字段。
- `tasks/<task_id>/trajectory.json`：`runtime.metadata`。
- `report.md`：运行信息区域。

## Automation Recipe

**职责**：给 CI、nightly 和人工对比提供命令模板。

**自动化默认命令**：

```bash
uv run python scripts/run_kongming_harness_eval.py --suite evals/harness-runtime-v0.1 --preset minimax-m3 --profile full --approval-mode auto_allow
```

**profile 对比命令**：

```bash
uv run python scripts/run_kongming_harness_eval.py --suite evals/harness-runtime-v0.1 --preset minimax-m3 --profile baseline-min --approval-mode auto_allow --run-id v1-baseline-min
uv run python scripts/run_kongming_harness_eval.py --suite evals/harness-runtime-v0.1 --preset minimax-m3 --profile full --approval-mode auto_allow --run-id v1-full
```

## Business Code Change Plan

**职责**：当脚本层表达力不足时，给出主业务代码最小改动方案。

| 问题 | 首选方案 | 备选主业务修改 |
|---|---|---|
| 空 instructions 被默认 prompt 替换 | 脚本传显式 `AgentSpec(instructions="")` | 给 `SessionEngine.build` 增加 `allow_empty_instructions` |
| case 级审批需要真实 CLI prompt | 脚本构造 `InteractiveApproval` | 复用 CLI approval prompt builder 的公开函数 |
| profile 需要强制 Noop compactor | 脚本内实现 `_ScriptNoopCompactor` | 暴露 `NoopCompactor` 为公共测试工具 |
| 报告需要 config 快照 | 脚本写 metadata | 增加通用 runtime metadata sink |

当前建议采用脚本层方案，主业务代码保持稳定。
