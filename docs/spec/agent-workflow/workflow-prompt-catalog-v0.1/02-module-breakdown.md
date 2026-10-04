# 模块拆分

## 模块总览

| 模块 | 职责 | 依赖 | 状态 | 备注 |
|------|------|------|------|------|
| `WorkflowPromptCatalogManager` | 读取全量 workflow strategy description，输出 prompt listing entries | `AgentWorkflowManager`、`AgentWorkflowStrategyManager` | 方案确认 | catalog 边界类，新增 workflow 通过 registry 自动出现 |
| `WorkflowPromptListingFormatter` | 把 entries 渲染成稳定、短小、可缓存的 system prompt 段 | `WorkflowPromptCatalogManager` | 方案确认 | CLI/Web 共用 |
| `InstructionAssemblyIntegration` | 在公共 instruction assembly 中注入 workflow prompt source | `prompting.instructions`、CLI/Web host | 方案确认 | 注入点早于文件/env/skills/memory |
| `WorkflowToolDiscovery` | 保证 listing 到 describe/run 工具的模型可见路径 | `repo:src/tools/agent_workflow_tool.py` | 方案确认 | 文案和测试合同 |
| `PromptCacheStability` | 管理 listing hash、template version、snapshot 与 Web cache key | formatter、Web shared assets | 方案确认 | 重点约束 `_instructions_cache` |

## 模块 1：WorkflowPromptCatalogManager

**职责**：workflow prompt catalog 的唯一读取入口，循环读取 strategy registry 中的全部 workflow，按 mode 获取 description，并输出 prompt entries。

**包含范围**

- 读取默认 workflow registry，支持 CLI/Web 装配期 catalog-only 场景。
- 读取运行期 manager，支持已绑定 runtime 的 listing 生成场景。
- 对每个 mode 调用 `describe_workflow_strategy(mode)`，读取 `WorkflowStrategyDescription.when_to_use`。
- 输出只含 prompt listing 所需字段的 entries。
- 对未知、重复、空 mode 等异常给出可测试错误。

**范围外职责**

- 格式化最终 prompt 文本。
- 保存缓存。
- 修改 strategy 自身 description。
- 解析或校验 workflow payload schema。

**依赖**

- 复用 `repo:src/application/agent_workflows/manager.py::AgentWorkflowManager.list_default_workflow_strategies()` 的 catalog-only 默认策略读取能力。
- 复用 `repo:src/application/agent_workflows/manager.py::AgentWorkflowManager.list_workflow_strategies()` 和 `repo:src/application/agent_workflows/manager.py::AgentWorkflowManager.describe_workflow_strategy(mode)` 的运行期入口。
- 复用 `repo:src/application/agent_workflows/strategies/description.py::WorkflowStrategyDescription`。

**边界类**：`WorkflowPromptCatalogManager`

**数据结构/接口草案**

```python
@dataclass(frozen=True)
class WorkflowPromptCatalogEntry:
    mode: str  # workflow 策略 ID，来自 strategy description 的 mode，按去空白后的字符串排序。
    title: str  # workflow 中文标题，来自 strategy description 的 title。
    usage_scenarios: tuple[str, ...]  # 使用场景列表，逐条来自 strategy description 的 when_to_use。

@dataclass(frozen=True)
class WorkflowPromptCatalogSnapshot:
    entries: tuple[WorkflowPromptCatalogEntry, ...]  # 规范化后的全量 workflow listing entries。
    source_version: str  # catalog 读取协议版本，用于诊断 registry 读取语义。
    listing_hash: str  # formatter 输入 hash，基于 template_version 和 entries 计算。

class WorkflowPromptCatalogManager:
    def snapshot_default_workflows(self) -> WorkflowPromptCatalogSnapshot: ...
    def snapshot_from_manager(self, manager: AgentWorkflowManager) -> WorkflowPromptCatalogSnapshot: ...
```

**风险等级**：中

**风险说明**：装配期可能只有 catalog-only helper，listing 又需要 `when_to_use`。task 需要明确 catalog-only description 读取入口，推荐在 manager 内部复用同一套默认 strategy registry，避免 CLI/Web 各自重建 strategy 分支。

**task 建议**

- 建议 task 名：`workflow-prompt-catalog-core`
- 对应 DoD：DoD#2、DoD#3
- 是否进入 x-req：是

## 模块 2：WorkflowPromptListingFormatter

**职责**：把 catalog snapshot 渲染为稳定文本模板，并输出 hash、template version 和 origin label。

**包含范围**

- 固定 section 标题和指令文案。
- 固定排序：按规范化 `mode` 升序。
- 固定字段：`mode`、`title`、`使用场景`。
- 固定工具指引：参数格式查询走 `describe_agent_workflow_strategy(mode="xx")`，执行走 `run_agent_workflow`。
- hash 计算：template version + normalized entries。
- 空列表输出：返回空字符串或显式 diagnostic，由 assembly 决定是否注入。

**范围外职责**

- 读取 registry。
- 调用 describe/run 工具。
- 将 payload schema、examples、warnings、inputs、outputs 写进 listing。

**依赖**：`WorkflowPromptCatalogManager`

**边界类**：`WorkflowPromptListingFormatter`

**数据结构/接口草案**

```python
@dataclass(frozen=True)
class WorkflowPromptListingRender:
    text: str  # 最终注入 system prompt 的稳定文本。
    template_version: str  # formatter 模板版本，例如 workflow-prompt-catalog-v1。
    listing_hash: str  # 基于模板版本和规范化 entries 的短 hash。
    origin: str  # instruction source origin，固定为 workflow_catalog。

class WorkflowPromptListingFormatter:
    def render(self, snapshot: WorkflowPromptCatalogSnapshot) -> WorkflowPromptListingRender: ...
```

**文本模板要求**

```text
# workflow catalog
你可以使用下列 workflow。需要具体调用参数格式时调用 describe_agent_workflow_strategy(mode="xx")；执行时调用 run_agent_workflow。

- mode: <mode>
  title: <title>
  使用场景:
    - <when_to_use item>
```

**风险等级**：中

**风险说明**：formatter 一旦混入 payload schema 或动态运行信息，会扩大 prompt 前缀变化面。测试需要断言禁用字段清单，保证 listing 只承担发现职责。

**task 建议**

- 建议 task 名：`workflow-prompt-listing-formatter`
- 对应 DoD：DoD#3、DoD#4、DoD#5、DoD#7、DoD#8
- 是否进入 x-req：是

## 模块 3：InstructionAssemblyIntegration

**职责**：把 workflow catalog prompt 作为公共 instruction source 注入 assembly 顺序，保证它早于读取文件和动态来源。

**包含范围**

- 在公共 assembly 层接入 workflow prompt source。
- 输出 origin 顺序，方便 CLI/Web 和测试断言。
- CLI `_assemble_instructions()` 接入共享 render 结果。
- Web `_ensure_shared_assets()` 接入共享 render 结果。
- 保持 skills、memory 等 host 特有动态来源追加在后段。

**范围外职责**

- 生成 strategy description。
- 设计 Web UI。
- 修改 memory 或 skills listing 内容。

**依赖**

- `repo:src/prompting/instructions/instruction_loader.py::assemble_instructions()`
- `repo:src/hosts/cli/main.py::_assemble_instructions()`
- `repo:src/hosts/web/run.py::_ensure_shared_assets()`

**边界类**：`InstructionAssemblyIntegration`

**接口草案**

```python
@dataclass(frozen=True)
class InstructionAssemblyWorkflowCatalog:
    source: InstructionSource  # workflow catalog instruction source，origin 固定为 workflow_catalog。
    render: WorkflowPromptListingRender  # formatter 输出，包含 text/hash/template_version。
    position: str  # 注入位置说明，固定为 before_file_sources。
```

**组装顺序**

| 顺序 | source | 来源 | 稳定性目标 |
|------|--------|------|------------|
| 1 | `runtime` | `repo:src/prompting/assembly/runtime_context.py` | 当前已有运行上下文 |
| 2 | `workflow_catalog` | `WorkflowPromptListingFormatter` | 短 listing，稳定排序和 hash |
| 3 | `agent_spec/prompts` | materialized prompts | 读取文件 |
| 4 | `extra_files` | `InstructionLoader.extra_files` | 动态文件 |
| 5 | `env` | `KONGMING_EXTRA_INSTRUCTIONS` | 动态环境 |
| 6 | `sitian` | optional context source | 动态上下文 |
| 7 | `skills` | host 追加 | 动态能力 |
| 8 | `memory` | CLI 追加 | 动态事实 |

**风险等级**：高

**风险说明**：注入位置会影响 prompt 优先级和 cache 前缀。测试需要同时覆盖 `origins` 顺序和最终文本片段顺序。

**task 建议**

- 建议 task 名：`workflow-prompt-assembly-integration`
- 对应 DoD：DoD#1、DoD#6
- 是否进入 x-req：是

## 模块 4：WorkflowToolDiscovery

**职责**：保证 LLM 从 listing 进入具体 schema 和执行工具的路径清晰、可测试。

**包含范围**

- listing 文案明确 describe/run 工具名。
- describe 工具返回 `inputs`、`outputs`、`examples`、`warnings` 等详细字段。
- run 工具继续只执行 `mode + payload`。
- 测试覆盖 listing 中的工具指引和工具注册存在性。

**范围外职责**

- 新增工具形态。
- 在 listing 中复制 describe 的详细内容。

**依赖**

- `repo:src/tools/agent_workflow_tool.py::RunAgentWorkflowTool`
- `repo:src/tools/agent_workflow_tool.py::build_run_agent_workflow_tool()`
- 旧 spec `multi-strategy-orchestration-v0.1` 定义的 list/describe/run 三段式。

**边界类**：`WorkflowToolDiscovery`

**数据结构/接口草案**

```python
@dataclass(frozen=True)
class WorkflowToolDiscoveryHint:
    describe_tool_name: str  # 参数详情查询工具名，固定为 describe_agent_workflow_strategy。
    run_tool_name: str  # workflow 执行工具名，固定为 run_agent_workflow。
    instruction_text: str  # 注入 listing 的工具发现文案。
```

**风险等级**：低

**风险说明**：主要风险是文案漂移，导致 LLM 看得到 mode 却找不到 schema。将工具名作为测试常量即可收口。

**task 建议**

- 建议 task 名：`workflow-tool-discovery-contract`
- 对应 DoD：DoD#4、DoD#8
- 是否进入 x-req：是

## 模块 5：PromptCacheStability

**职责**：定义 workflow listing 的 cache key、hash、版本和 Web `_instructions_cache` 失效语义。

**包含范围**

- listing hash 规则：template version + sorted normalized entries。
- snapshot 规则：空白折叠、mode/title trim、usage scenarios 保持顺序。
- Web `_instructions_cache` 绑定 `instructions_hash`、`workflow_listing_hash`、`workflow_template_version`。
- CLI/Web 共享同一个 render 结果类型。
- 测试重复装配稳定性和 strategy description 变更失效。

**范围外职责**

- 修改 provider 级 prompt cache 参数。
- 持久化 cache 到磁盘。
- 给每个用户消息生成独立 workflow listing。

**依赖**

- `WorkflowPromptListingFormatter`
- `repo:src/hosts/web/run.py::_instructions_cache`

**边界类**：`PromptCacheStability`

**数据结构/接口草案**

```python
@dataclass(frozen=True)
class WorkflowPromptCacheKey:
    base_instructions_hash: str  # workflow listing 注入前的公共 instructions hash。
    workflow_template_version: str  # workflow listing formatter 模板版本。
    workflow_listing_hash: str  # workflow entries 和模板生成的稳定 hash。

@dataclass(frozen=True)
class WebInstructionCacheRecord:
    rendered: str  # 已注入 workflow listing 的最终 system prompt。
    origins: tuple[str, ...]  # instruction source origin 顺序，包含 workflow_catalog。
    cache_key: WorkflowPromptCacheKey  # Web shared assets 的稳定 cache key。
```

**风险等级**：高

**风险说明**：Web `_instructions_cache` 当前只有 rendered/origins 缓存。接入 listing 后需要把 hash/version 作为语义字段，避免 registry 更新后继续复用旧 prompt。

**task 建议**

- 建议 task 名：`workflow-prompt-cache-tests`
- 对应 DoD：DoD#5、DoD#6、DoD#7
- 是否进入 x-req：是
