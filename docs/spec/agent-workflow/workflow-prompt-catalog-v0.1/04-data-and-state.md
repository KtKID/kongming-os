# 数据模型与状态

## 数据来源

| 来源 | 位置 | 用途 | 更新方式 |
|------|------|------|----------|
| 默认 workflow registry | `repo:src/application/agent_workflows/manager.py::AgentWorkflowManager.list_default_workflow_strategies()` | CLI/Web 装配期读取默认策略集合 | strategy 注册时变化 |
| 运行期 workflow manager | `repo:src/application/agent_workflows/manager.py::AgentWorkflowManager.list_workflow_strategies()` | 已装配 runtime 读取当前策略目录 | runtime 构建时变化 |
| strategy description | `repo:src/application/agent_workflows/manager.py::AgentWorkflowManager.describe_workflow_strategy(mode)` | 读取 `title` 和 `when_to_use` | strategy 自身 description 维护 |
| instruction assembly | `repo:src/prompting/instructions/instruction_loader.py::assemble_instructions()` | 注入 workflow prompt source | 进程装配时变化 |
| Web shared assets cache | `repo:src/hosts/web/run.py::_instructions_cache` | 缓存 rendered instructions | hash/version 改变时失效 |

## 核心数据结构

### WorkflowStrategyDescription

现有 strategy description 是 listing 的上游事实源。prompt listing 只读取其中三个字段。

```python
@dataclass(frozen=True)
class WorkflowStrategyDescription:
    mode: str  # 稳定策略 ID，例如 parallel、map_reduce、task_flow。
    title: str  # 中文策略名，用于 listing 展示。
    status: WorkflowStrategyStatus  # 策略状态，listing hash 可读取但 prompt 文本不展示。
    runnable: bool  # 是否可直接执行，listing 文本不展示。
    summary: str  # 中文摘要，留给 describe 或其他 catalog 展示。
    when_to_use: tuple[str, ...]  # 使用场景列表，直接映射为 listing 的“使用场景”。
    warnings: tuple[str, ...]  # 风险提示，留给 describe。
    inputs: tuple[WorkflowStrategyInputField, ...]  # payload 字段说明，留给 describe。
    outputs: tuple[str, ...]  # 输出说明，留给 describe。
    examples: tuple[dict[str, object], ...]  # 示例 payload，留给 describe。
    depends_on: tuple[str, ...]  # 依赖能力，留给 describe 或错误提示。
```

### WorkflowPromptCatalogEntry

listing entry 是 system prompt 的最小数据单元。

```python
@dataclass(frozen=True)
class WorkflowPromptCatalogEntry:
    mode: str  # workflow 策略 ID，唯一且稳定，来自 WorkflowStrategyDescription.mode。
    title: str  # workflow 中文标题，来自 WorkflowStrategyDescription.title。
    usage_scenarios: tuple[str, ...]  # 使用场景，逐条来自 WorkflowStrategyDescription.when_to_use。
```

字段约束：

| 字段 | 来源 | 进入 prompt | 规范化规则 |
|------|------|-------------|------------|
| `mode` | `WorkflowStrategyDescription.mode` | 是 | trim，空值报错，按该字段排序 |
| `title` | `WorkflowStrategyDescription.title` | 是 | trim，空值报错 |
| `usage_scenarios` | `WorkflowStrategyDescription.when_to_use` | 是 | 每项 trim，空项过滤，保持原 description 顺序 |

### WorkflowPromptCatalogSnapshot

snapshot 是 catalog manager 到 formatter 的稳定交付物。

```python
@dataclass(frozen=True)
class WorkflowPromptCatalogSnapshot:
    entries: tuple[WorkflowPromptCatalogEntry, ...]  # 全量 workflow entries，按 mode 升序。
    source_version: str  # catalog 读取协议版本，用于诊断和测试。
    registry_modes: tuple[str, ...]  # registry 返回的全量 mode，用于验证新增 strategy 自动进入。
    listing_hash: str  # formatter 可复用的稳定 hash。
```

### WorkflowPromptListingRender

render 是注入 assembly 的最终产物。

```python
@dataclass(frozen=True)
class WorkflowPromptListingRender:
    text: str  # system prompt 片段，包含短 listing 和 describe/run 指引。
    origin: str  # instruction origin，固定为 workflow_catalog。
    template_version: str  # formatter 模板版本，例如 workflow-prompt-catalog-v1。
    listing_hash: str  # 基于 template_version 和 normalized entries 计算。
```

### WorkflowPromptCacheKey

cache key 表达 Web `_instructions_cache` 的语义边界。

```python
@dataclass(frozen=True)
class WorkflowPromptCacheKey:
    base_instructions_hash: str  # 公共 instructions 基础文本 hash，覆盖 runtime/prompts/files/env/sitian。
    workflow_template_version: str  # listing formatter 模板版本。
    workflow_listing_hash: str  # workflow entries 规范化 hash。
```

## 状态流转

| 状态 | 触发 | 输入 | 输出 | 失败处理 |
|------|------|------|------|----------|
| `catalog_reading` | CLI/Web 装配 instructions | strategy registry | raw descriptions | registry 异常返回装配错误 |
| `catalog_normalized` | catalog manager 完成读取 | raw descriptions | sorted entries | 空 mode/title 报错 |
| `listing_rendered` | formatter 渲染 | sorted entries | prompt text + hash | 空 listing 可跳过注入并记录 origin diagnostic |
| `instructions_assembled` | assembly 注入 | render + base sources | rendered instructions + origins | 顺序测试覆盖 |
| `web_cache_recorded` | Web shared assets 初始化 | rendered + cache key | `_instructions_cache` record | hash/version 改变触发刷新 |
| `llm_discovered` | LLM 读取 system prompt | listing text | mode 选择 | 需要 schema 时进入 describe |
| `workflow_described` | LLM 调用 describe | mode | payload schema/example/warnings | unknown mode 返回 available modes |
| `workflow_started` | LLM 调用 run | mode + payload | workflow run | run 工具返回策略级错误 |

状态图见 [diagrams.md](./diagrams.md#核心注入顺序图)。

## Prompt 文本稳定规则

| 规则 | 说明 | 测试点 |
|------|------|--------|
| 稳定排序 | entries 按 `mode` 升序 | 两次 registry 顺序打乱，render 文本一致 |
| 稳定模板 | section 标题、工具指引、缩进、换行固定 | snapshot 测试 |
| 短 listing | prompt 只含 `mode/title/使用场景` | 禁用字段断言 |
| 易变内容后置 | skills、memory、extra runtime context 保持在 workflow listing 后段或原有动态段 | origins 顺序断言 |
| hash 规范化 | hash 输入为 template version + normalized entries | 等价空白输入 hash 一致 |
| Web cache 语义 | cache record 包含 listing hash 和 template version | registry 变更后 `_instructions_cache` 刷新 |

## 数据关系

数据关系图见 [diagrams.md](./diagrams.md#数据关系图)。核心关系是 Strategy Registry 拥有多个 Strategy Description，Catalog Manager 投影为 Prompt Entry，Formatter 渲染为 Listing Render，Instruction Assembly 持有 render，Web Cache Record 持有 cache key。
