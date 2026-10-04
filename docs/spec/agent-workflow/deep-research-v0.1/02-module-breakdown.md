# 模块设计、接口和数据结构

## 架构原则

`deep_research` 是 `application.agent_workflows.strategies` 下的独立策略包。公共生命周期由 `AgentWorkflowManager` 负责，策略包负责 payload contract、阶段状态机、prompt 构造、来源访问、事实白板、jury 裁决和最终 result 扩展。组件关系见 [diagrams.md](./diagrams.md)。

## 模块总览

| 模块 | 职责 | 边界类 | 状态 |
|------|------|--------|------|
| `AgentWorkflowTool` | 暴露 `mode="deep_research"` schema，归一化 payload，格式化结果摘要 | `RunAgentWorkflowTool` | 方案确认 |
| `AgentWorkflowManager` | 创建 workflow context、manifest、audit、report index、result，调度子 agent | `AgentWorkflowManager` | 已完成 |
| `DeepResearchStrategy` | 执行六阶段状态机和降级逻辑 | `DeepResearchStrategy` | 方案确认 |
| `DeepResearchContracts` | 定义 payload、limits、phase output、result schema | `DeepResearchContractParser` | 方案确认 |
| `ResearchSourceProvider` | 搜索和读取来源，隐藏具体 WebSearch/WebFetch 或内部实现差异 | `ResearchSourceManager` | 方案确认 |
| `SourceDeduper` | URL canonicalize、fit 排序、source budget 和 overflow 记录 | `SourceDeduper` | 方案确认 |
| `FactBoard` | 管理 source、fact、group、ruling、report 结构化 artifact | `DeepResearchArtifactWriter` | 方案确认 |
| `AdversarialJury` | 并发陪审、投票聚合、弃权和 reject quorum 判定 | `AdversarialJury` | 方案确认 |
| `DeepResearchViewerAdapter` | 专用 viewer 投影，展示阶段、来源、事实、投票和报告 | `DeepResearchWorkflowViewerAdapter` | 探索中 |

## `AgentWorkflowTool`

位置：`src/tools/agent_workflow_tool.py`

职责：
- 在 `RunAgentWorkflowTool.input_schema.properties.mode.enum` 增加 `deep_research`。
- 在 tool description 中给出中文策略用途和 payload 顶层字段。
- 增加 `_normalize_deep_research_payload(payload)`，补默认 `topic`、`objective`、`limits`、`source_policy` 和 `output_contract`。
- 保持 tool 层的公共边界：只归一化 payload 和展示 result。

公开方法：

```python
def _normalize_deep_research_payload(payload: dict[str, Any]) -> dict[str, Any]: ...
```

输入字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `topic` | string | 用户研究问题，必填 |
| `objective` | string | 研究目标，可由 topic 派生 |
| `search_plan` | object | 可选，用户显式给定搜索线 |
| `limits` | object | 预算和并发限制 |
| `source_policy` | object | 来源类型、域名、语言、时间范围和安全边界 |
| `report` | object | 报告语言、格式、最大 findings 数 |

风险：
- LLM 容易把 MiMo 参数名直接写成大写常量；normalize 需要接受 snake_case，并在错误提示中列出推荐字段。
- Web 工具未接入时，tool schema 只能暴露 planned mode 或运行时报前置能力缺失。

## `AgentWorkflowManager`

位置：`src/application/agent_workflows/manager.py`

职责：
- 注册 `DeepResearchStrategy(self)`。
- 为策略创建 `WorkflowExecutionContext`。
- 通过 `run_subagent_task()` 执行 planner、extractor、grouper、juror、reporter 子 agent。
- 统一写 `workflow.json`、`audit.jsonl`、`reports/index.json` 和根目录 `result.json`。
- 为每个子 agent task 生成落地审计日志索引，把 task log 路径、child session 路径、权限、预算和输出 artifact 写入 workflow 产物。

边界：
- 管 workflow 生命周期、审计、manifest、result。
- 保存公共 result 字段和 strategy extra 字段。
- 子 agent task log 是公共审计边界，strategy 只传 task spec 和 phase context。
- 对 Deep Research 的 phase、fact、jury 语义保持透明。

## `DeepResearchStrategy`

位置：`src/application/agent_workflows/strategies/deep_research/strategy.py`

职责：
- `mode = "deep_research"`。
- 实现 `catalog_entry()`、`describe()`、`run(context, payload)`。
- 调度 6 阶段：Plan、Search、Extract、Group、Crosscheck、Report。
- 每阶段写 phase summary 和 audit event。
- 每次派发子 agent 时传入 phase、role、input artifact refs、prompt hash、预算和工具白名单，用于 manager 写落地 task log。
- 捕获降级路径，把 fallback 写入 `FactBoard`。

公开边界：

```python
class DeepResearchStrategy:
    mode = "deep_research"

    def catalog_entry(self) -> WorkflowStrategyCatalogEntry: ...
    def describe(self) -> WorkflowStrategyDescription: ...
    async def run(
        self,
        context: WorkflowExecutionContext,
        payload: Mapping[str, object],
    ) -> AgentWorkflowResult: ...
```

内部文件建议：

| 文件 | 职责 |
|------|------|
| `contracts.py` | dataclass / TypedDict / validator / default limits |
| `prompts.py` | planner、searcher、extractor、grouper、juror、reporter prompt |
| `source_provider.py` | `ResearchSourceProvider` Protocol、工具适配或测试 fake |
| `dedupe.py` | URL canonicalize、fit rank、budget overflow |
| `fact_board.py` | artifact writer 和 phase snapshot |
| `jury.py` | jury task 构造和 vote 聚合 |
| `strategy.py` | 状态机和公共 result 组装 |

风险：
- 阶段多、产物多，策略文件容易膨胀；v0.1 需要把 contracts、source、fact board、jury 拆开。
- Crosscheck 子 agent 数量为 `groups * jury_size`，需要并发闸门和预算闸门。

## `DeepResearchContracts`

位置：`src/application/agent_workflows/strategies/deep_research/contracts.py`

职责：
- 校验输入 topic、search plan、source policy、limits 和 report options。
- 统一 MiMo 参数语义和 Kongming 默认值。
- 定义 phase output 的结构化字段，支撑 artifact、result 和 viewer。

边界类：`DeepResearchContractParser`

公开方法：

```python
class DeepResearchContractParser:
    def parse(self, raw: Mapping[str, object]) -> DeepResearchSpec: ...
```

核心结构：

```python
@dataclass(frozen=True)
class DeepResearchLimits:
    jury_size: int = 3
    reject_quorum: int = 2
    source_budget: int = 10
    fact_cap: int = 20
    search_lines_min: int = 3
    search_lines_max: int = 6
    search_results_per_line: int = 6
    fetch_concurrency: int = 4
    jury_concurrency: int = 6
    workflow_timeout_seconds: int = 2400
```

MiMo 对照：

| 参数 | MiMo 默认 | Kongming v0.1 建议默认 | 含义 |
|------|-----------|------------------------|------|
| `jury_size` | 3 | 3 | 每个事实组的陪审员数量 |
| `reject_quorum` | 2 | 2 | 否决事实所需反对票，也作为有效裁决最低票数 |
| `source_budget` | 15 | 10 | 最多进入 fetch/extract 的去重 URL 数 |
| `fact_cap` | 25 | 20 | 进入 crosscheck 的事实数量上限 |

可配置性：
- payload `limits` 覆盖单次运行默认值。
- 后续 config 可提供全局默认和上限，例如 `KONGMING_DEEP_RESEARCH_SOURCE_BUDGET_MAX`。
- validator 确保 `1 <= reject_quorum <= jury_size`，`source_budget > 0`，`fact_cap > 0`。

## `ResearchSourceProvider`

位置：`src/application/agent_workflows/strategies/deep_research/source_provider.py`

职责：
- 为策略提供统一搜索和读取接口。
- 允许两种接入路线：子 agent 调 WebSearch/WebFetch 工具；strategy 内部调用 `ResearchSourceProvider`。
- 输出结构化 `SearchHit` 和 `FetchedSource`，包含 URL、title、snippet、fit、tier、raw excerpt、fetch status。

边界类：`ResearchSourceManager`

公开边界：

```python
class ResearchSourceManager:
    async def search(self, line: SearchLine, limits: DeepResearchLimits) -> list[SearchHit]: ...
    async def fetch(self, source: SearchSource) -> FetchedSource: ...
```

前置 PoC 验收：
- 搜索返回稳定结构，含 URL、title、snippet、fit。
- fetch 返回正文或可解释失败，含 status、tier、excerpt。
- 每次网络访问写 audit，含 normalized URL、host、elapsed_ms、status、错误摘要。
- 测试可注入 fake provider，完整 e2e 可离线复跑。

## `SourceDeduper`

位置：`src/application/agent_workflows/strategies/deep_research/dedupe.py`

职责：
- 复刻 MiMo `canonURL()` 语义：协议和 host 大小写归一、去 `www.`、去尾部 slash、保留有意义 path/query。
- 先按 fit rank 排序，再按 canonical URL 去重。
- 记录 duplicates 和 budget overflow。
- 在 budget 用尽时只保留 high fit 的策略需要进入 contract；v0.1 可通过 `allow_high_fit_overflow` 显式开关。

边界类：`SourceDeduper`

公开方法：

```python
class SourceDeduper:
    def canonicalize_url(self, url: str) -> str: ...
    def select_sources(
        self,
        hits: Sequence[SearchHit],
        *,
        limits: DeepResearchLimits,
    ) -> SourceSelection: ...
```

## `FactBoard`

位置：`src/application/agent_workflows/strategies/deep_research/fact_board.py`

职责：
- 创建 `deep_research/` artifact 目录。
- 写入 `plan.json`、`sources.jsonl`、`facts.jsonl`、`groups.jsonl`、`rulings.jsonl`、`report.md`、`stats.json`。
- 给每个 phase 生成可审计 snapshot。
- 为 viewer adapter 提供稳定输入。

公开方法：

```python
class DeepResearchArtifactWriter:
    def write_plan(self, plan: ResearchPlan) -> Path: ...
    def append_source(self, source: ResearchSourceRecord) -> None: ...
    def append_fact(self, fact: ExtractedFact) -> None: ...
    def append_group(self, group: FactGroup) -> None: ...
    def append_ruling(self, ruling: JuryRuling) -> None: ...
    def write_report(self, report: ResearchReport) -> Path: ...
    def write_stats(self, stats: ResearchStats) -> Path: ...
```

## `AdversarialJury`

位置：`src/application/agent_workflows/strategies/deep_research/jury.py`

职责：
- 为每个事实组创建 `jury_size` 个 juror 子 agent。
- prompt 明确要求从反证角度审查事实。
- 聚合有效票、反对票、弃权和理由。
- 按 `cast_count >= reject_quorum` 且 `reject_count < reject_quorum` 判定存活。

边界类：`AdversarialJury`

公开方法：

```python
class AdversarialJury:
    async def run_for_group(self, group: FactGroup, *, limits: DeepResearchLimits) -> CheckedFactGroup: ...
```

裁决输出：

| 字段 | 含义 |
|------|------|
| `group_id` | 被审查事实组 |
| `juror_id` | 陪审 agent 编号 |
| `reject` | true 表示反对该事实 |
| `abstain` | true 表示未形成有效裁决 |
| `reason` | 支持或反对理由 |
| `contradicting_evidence` | 发现的矛盾证据 |
| `source_coverage` | 引用支撑力度 |

## `DeepResearchViewerAdapter`

位置：`src/hosts/web/workflow_viewer/adapters/deep_research.py`

职责：
- 在 viewer adapter registry 中注册 `deep_research`。
- 读取公共 result 和 `deep_research/` artifact。
- 展示阶段状态、来源列表、fact group、jury tally、rejected 事实和最终报告。

v0.1 处理：
- 策略先保证 artifact schema 和 root result 可被 Unknown adapter 展示。
- 专用 adapter 放入后续 task，基于稳定 schema 实现。

## 与现有 workflow 的解耦

| 现有模块 | 交互方式 | 边界 |
|----------|----------|------|
| `AgentWorkflowManager` | 注册 strategy、创建 context、运行子 agent、写公共 result | 对 search/fact/jury 语义保持透明 |
| `AgentWorkflowStrategyManager` | 按 mode 分发 | 只知道 strategy 协议 |
| `run_agent_workflow` tool | schema、payload normalize、result 展示 | 执行流程由 strategy 负责 |
| `SubAgentManager` | child session、权限、工具注册、运行目录 | 由 strategy 提供任务和权限需求 |
| `subagents.permissions` | scoped workdir 文件工具白名单 | Web 工具边界需要新 PoC 或 source provider 路线 |
| `workflow_viewer` | mode adapter registry | 专用 adapter 后续读取稳定 artifacts |
