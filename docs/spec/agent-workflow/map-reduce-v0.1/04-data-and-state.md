# 数据模型与状态

## `MapReduceWorkflowSpec`

主 agent 发起 `map_reduce` 时的顶层输入。

```python
@dataclass(frozen=True)
class MapReduceWorkflowSpec:
    # workflow 模式，固定为 map_reduce。
    mode: Literal["map_reduce"]
    # 高层目标，用于 planner、mapper prompt 和 reducer 报告标题。
    objective: str
    # 输入来源，描述分析对象从哪里来。
    input_source: MapReduceInputSource
    # 分片策略，描述如何把输入拆成同构 shard。
    shard_strategy: ShardStrategy
    # 输出契约，第一版固定为 code_findings。
    output_contract: Literal["code_findings"]
    # mapper 子 agent 配置。
    mapper: MapperSpec
    # reducer 归并配置。
    reducer: ReducerSpec
    # workflow 资源限制。
    limits: MapReduceLimits
    # 审计标签，用于关联 task、spec、用户请求或运行来源。
    audit_tags: tuple[str, ...]
```

## `MapReduceInputSource`

描述大工程代码分析的输入范围。

```python
@dataclass(frozen=True)
class MapReduceInputSource:
    # 输入类型，v0.1 支持 path_glob、file_list；module_map 和 dependency_graph 后续增强。
    kind: Literal["path_glob", "file_list"]
    # 仓库根目录，所有相对路径基于该目录解析。
    root_dir: str
    # include glob 列表，用于收集候选文件。
    include: tuple[str, ...]
    # exclude glob 列表，用于排除构建产物、缓存和第三方目录。
    exclude: tuple[str, ...]
    # 显式文件列表，kind=file_list 时使用。
    files: tuple[str, ...]
    # 索引提供者名称，v0.1 仅支持 rg / pathlib；xcodeatlas、codedb 进入 v0.2 provider 扩展。
    index_provider: str | None
    # 输入快照摘要，用于复跑和审计比对。
    input_digest: str | None
```

## `ShardStrategy`

描述 planner 的分片方式。

```python
@dataclass(frozen=True)
class ShardStrategy:
    # 分片策略名称，v0.1 支持 by_directory、by_file_count；by_module 后续增强。
    kind: Literal["by_directory", "by_file_count"]
    # 每个 shard 的最大文件数。
    max_files_per_shard: int
    # 每个 shard 的估算 token 上限。
    max_estimated_tokens_per_shard: int
    # 最小 shard 数，用于保证并发利用率。
    min_shards: int
    # 最大 shard 数，用于控制成本。
    max_shards: int
    # 是否保持目录边界，避免同一目录被拆到多个 shard。
    preserve_directory_boundary: bool
    # 是否使用依赖图把强相关文件放进同一 shard；v0.1 固定为 False。
    prefer_dependency_cohesion: bool
```

## `MapperSpec`

mapper 子 agent 的运行配置。

```python
@dataclass(frozen=True)
class MapperSpec:
    # mapper 名称前缀，用于子 agent name 和 report 展示。
    name_prefix: str
    # mapper 系统提示模板 ID。
    prompt_template: str
    # mapper 可见工具白名单，v0.1 默认 read_file、list_dir、write_file。
    tool_names: tuple[str, ...]
    # mapper 可见 skill 白名单。
    skill_names: tuple[str, ...]
    # mapper 权限模式，v0.1 固定 scoped_workdir，通过输入物化读取 shard 内容。
    permission_mode: Literal["scoped_workdir"]
    # mapper 单 shard 最大 turn 数。
    max_turns: int
    # mapper 输出最大字符数。
    max_output_chars: int
```

## `ReducerSpec`

reducer 的合并配置。

```python
@dataclass(frozen=True)
class ReducerSpec:
    # reducer 类型，v0.1 使用 deterministic；agent_assisted 后续增强。
    kind: Literal["deterministic"]
    # 去重策略，v0.1 支持 exact_dedupe_key、file_line_title；semantic_title 后续增强。
    dedupe_strategy: Literal["exact_dedupe_key", "file_line_title"]
    # 排序策略，支持 severity_first、confidence_first、impact_first。
    ranking_strategy: Literal["severity_first", "confidence_first", "impact_first"]
    # 最终报告保留的 finding 数量上限。
    max_findings: int
    # 是否把失败 shard 放入最终报告。
    include_failed_shards: bool
    # reducer agent 使用的 prompt 模板 ID。
    reducer_prompt_template: str | None
```

## `MapReduceLimits`

workflow 层资源限制。

```python
@dataclass(frozen=True)
class MapReduceLimits:
    # mapper 最大并发数。
    max_concurrency: int
    # workflow 总超时时间秒数。
    workflow_timeout_seconds: int
    # 单个 mapper 超时时间秒数。
    mapper_timeout_seconds: int
    # reducer 超时时间秒数。
    reducer_timeout_seconds: int
    # mapper 重试次数。
    mapper_retries: int
    # mapper 输出校验失败后的修复重试次数。
    validation_repair_retries: int
```

## `MapShard`

planner 生成的单个 mapper 输入。

```python
@dataclass(frozen=True)
class MapShard:
    # shard 在 workflow 内的稳定 ID。
    shard_id: str
    # shard 展示名称。
    shard_name: str
    # shard 稳定排序序号。
    display_order: int
    # shard 包含的文件路径。
    files: tuple[str, ...]
    # shard 关联模块提示。
    module_hint: str | None
    # shard 生成原因。
    shard_reason: str
    # shard 估算 token 数。
    estimated_tokens: int
    # shard 输入摘要，用于复跑比对。
    shard_digest: str
    # mapper prompt 的 shard 专属上下文。
    context: str
```

## `MapperOutputEnvelope`

mapper 子 agent 必须输出的顶层结构。

```python
@dataclass(frozen=True)
class MapperOutputEnvelope:
    # 输出契约名称，第一版固定为 code_findings。
    output_contract: Literal["code_findings"]
    # mapper 处理的 shard ID。
    shard_id: str
    # mapper 运行状态，completed、partial 或 failed。
    status: Literal["completed", "partial", "failed"]
    # shard 级摘要。
    summary: str
    # 实际检查过的文件路径。
    files_seen: tuple[str, ...]
    # mapper 产出的 finding 列表。
    findings: tuple[CodeFinding, ...]
    # shard 覆盖率统计。
    coverage: MapperCoverage
    # mapper 过程中遇到的结构化错误。
    errors: tuple[MapperError, ...]
```

## `MapperInputManifest`

mapper 输入物化清单，写入 `agents/<task_run_id>/work/input_manifest.json`。

```python
@dataclass(frozen=True)
class MapperInputManifest:
    # shard ID。
    shard_id: str
    # mapper 运行 ID，对应 agents/<task_run_id>/。
    task_run_id: str
    # 输入物化目录，位于 mapper workdir 内。
    input_dir: str
    # 物化文件列表。
    files: tuple[MaterializedInputFile, ...]
    # 物化时间，UTC ISO8601。
    materialized_at: str
```

## `MaterializedInputFile`

单个物化输入文件。

```python
@dataclass(frozen=True)
class MaterializedInputFile:
    # 原始文件路径，相对 input_source.root_dir。
    original_path: str
    # mapper 可读取的物化路径，相对 workdir。
    materialized_path: str
    # 原始文件内容摘要。
    content_digest: str
    # 是否发生截断。
    truncated: bool
    # 截断说明，未截断时为 None。
    truncation_reason: str | None
```

## `CodeFinding`

`code_findings` 契约的核心 finding。

```python
@dataclass(frozen=True)
class CodeFinding:
    # finding 稳定去重 key，由 mapper 根据标题、文件和行号生成。
    dedupe_key: str
    # finding 标题。
    title: str
    # finding 类别。
    category: Literal["bug", "architecture", "security", "test_gap", "performance", "maintainability"]
    # 严重级别。
    severity: Literal["P0", "P1", "P2", "P3"]
    # 置信度，取值 0.0 到 1.0。
    confidence: float
    # 涉及代码位置列表。
    locations: tuple[CodeLocation, ...]
    # 代码证据，必须可回到具体文件或符号。
    evidence: str
    # 风险原因，说明该问题为什么成立。
    rationale: str
    # 修复建议，要求可执行。
    recommendation: str
    # 影响范围，例如 runtime、test、docs、api、data。
    impact_area: tuple[str, ...]
    # 来源 shard ID。
    source_shard_id: str
```

## `CodeLocation`

代码证据位置。

```python
@dataclass(frozen=True)
class CodeLocation:
    # 文件路径，相对 repo root。
    path: str
    # 起始行号，未知时为 None。
    line_start: int | None
    # 结束行号，未知时为 None。
    line_end: int | None
    # 符号名，未知时为 None。
    symbol: str | None
    # 证据摘录，保持短句。
    excerpt: str
```

## `MapperCoverage`

mapper 覆盖率。

```python
@dataclass(frozen=True)
class MapperCoverage:
    # shard 输入文件总数。
    files_assigned: int
    # mapper 实际查看文件数。
    files_seen_count: int
    # mapper 实际查看符号数。
    symbols_seen_count: int
    # 跳过文件列表。
    skipped_files: tuple[str, ...]
    # 跳过原因列表。
    skip_reasons: tuple[str, ...]
```

## `MapperError`

mapper 结构化错误。

```python
@dataclass(frozen=True)
class MapperError:
    # 错误类型，例如 tool_error、validation_error、timeout、model_error。
    error_type: str
    # 人类可读错误信息。
    message: str
    # 关联文件路径，未知时为 None。
    file_path: str | None
    # 是否建议补跑该 shard。
    retryable: bool
```

## `ReducerOutput`

reducer 最终输出。

```python
@dataclass(frozen=True)
class ReducerOutput:
    # reducer 运行状态，completed、partial 或 failed。
    status: Literal["completed", "partial", "failed"]
    # workflow ID。
    workflow_id: str
    # 输出契约名称。
    output_contract: Literal["code_findings"]
    # shard 总数。
    total_shards: int
    # 成功 shard 数。
    completed_shards: int
    # 失败 shard 数。
    failed_shards: int
    # 去重后的 finding 列表。
    deduped_findings: tuple[CodeFinding, ...]
    # 按排序策略选出的重点 finding。
    top_findings: tuple[CodeFinding, ...]
    # 覆盖率汇总。
    coverage_summary: CoverageSummary
    # 失败 shard 汇总。
    failed_shard_reports: tuple[FailedShardReport, ...]
    # 建议后续任务。
    followups: tuple[str, ...]
    # reducer 生成时间，UTC ISO8601。
    reduced_at: str
```

## `CoverageSummary`

最终覆盖率汇总。

```python
@dataclass(frozen=True)
class CoverageSummary:
    # 输入总文件数。
    total_files_assigned: int
    # 实际查看总文件数。
    total_files_seen: int
    # 实际查看总符号数。
    total_symbols_seen: int
    # 按 shard 汇总的覆盖率条目。
    per_shard: tuple[MapperCoverage, ...]
    # 覆盖率说明。
    notes: str
```

## `FailedShardReport`

失败 shard 汇总。

```python
@dataclass(frozen=True)
class FailedShardReport:
    # shard ID。
    shard_id: str
    # shard 展示名称。
    shard_name: str
    # 失败阶段，mapper、validation 或 reducer。
    failed_stage: Literal["mapper", "validation", "reducer"]
    # 失败原因。
    reason: str
    # 是否建议补跑。
    retryable: bool
    # 补跑建议。
    retry_hint: str
```

## 文件布局

```text
<workflow_dir>/
  audit.jsonl
  workflow.json
  result.json
  map_reduce/
    spec.json
    shards.json
    mapper_outputs/
      <shard_id>.json
    validation/
      <shard_id>.json
    reducer/
      result.json
  reports/
    index.json
  agents/
    <task_run_id>/
      work/
        input_manifest.json
        input/
          <materialized files>
```
