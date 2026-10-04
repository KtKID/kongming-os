# 数据与状态

## 1. 本地文件布局

```text
.kongming/
├── evolution/
│   ├── evolution.state.json
│   ├── evolution-nutrients.jsonl
│   └── reviews/
│       └── <run_id>.json
└── skills/
    └── <skill-name>/SKILL.md
```

布局语义：

- `evolution/reviews/` 保存单次 review 原始结果。
- `evolution/evolution-nutrients.jsonl` 保存统一的进化养料队列。
- `skills/` 继续只承载正式 skill。

第一版存储策略：

- 全部养料都追加写入 `evolution-nutrients.jsonl`，作为内容层资产。
- review 原始结果写入 `reviews/<run_id>.json`，作为调试和回放依据。
- v0.1.9 不写 memory 文件。

## 2. TranscriptWindow

`TranscriptWindow` 是 child reviewer 的唯一输入载体。它从 `Session.history()` 裁出一段紧凑证据窗口。

建议数据结构：

```python
@dataclass(frozen=True)
class TranscriptWindow:
    session_id: str
    run_id: str
    user_turn_count: int
    included_turns: tuple[int, ...]
    messages: tuple[TranscriptMessage, ...]
    final_message: str | None
    tool_call_count: int
    summary: str | None
```

```python
@dataclass(frozen=True)
class TranscriptMessage:
    turn: int
    role: Literal["user", "assistant", "tool", "system"]
    content: str
    tool_name: str | None = None
```

字段含义：

- `session_id`：当前会话标识。
- `run_id`：当前 run 标识。
- `user_turn_count`：当前 session 已累计的 user turn 数。
- `included_turns`：这次证据窗口覆盖的 turn 编号。
- `messages`：实际提供给 child reviewer 的消息片段。
- `final_message`：主任务本轮最终 assistant 输出。
- `tool_call_count`：本轮关键工具调用数。
- `summary`：窗口摘要，控制 prompt 成本。

## 3. EvidenceRef

`evidence_turns` 的作用是把每条判断绑定回原始证据位置。

建议数据结构：

```python
@dataclass(frozen=True)
class EvidenceRef:
    turns: tuple[int, ...]
    excerpt: str | None = None
```

字段语义：

- `turns`：这条结论依赖的 turn 编号。
- `excerpt`：可选短摘录，便于 review 文件排查。

## 4. ReviewResult

child reviewer 输出统一结构：

```python
@dataclass(frozen=True)
class ReviewResult:
    run_id: str
    session_id: str
    reviewed_at_ms: int
    review_summary: str
    nutrients: tuple[EvolutionNutrient, ...]
    skip_reasons: tuple[str, ...]
```

```python
@dataclass(frozen=True)
class EvolutionNutrient:
    nutrient_id: str
    kind: Literal["memory", "workflow", "error"]
    title: str
    content: str
    summary: str
    confidence: float
    evidence_turns: tuple[int, ...]
    source_run_id: str
    source_session_id: str
    suggested_target: Literal["memory", "skill", "errorbook"] | None = None
    tags: tuple[str, ...] = ()
```

设计语义：

- `ReviewResult` 是 child reviewer 准备交给 `evolution_write` 的完整 payload。
- `EvolutionNutrient` 是统一内容层。
- `kind="workflow"` 的养料会留在养料队列，作为后续 skill promote 输入。
- `kind="memory"` 只是养料标签，不在 v0.1.9 直接写 memory。

### 4.1 字段含义

#### `ReviewResult`

- `run_id`：这次 review 对应的 run 标识。
- `session_id`：这次 review 对应的 session 标识。
- `reviewed_at_ms`：review 完成时间戳，单位毫秒。
- `review_summary`：这次复盘的一句话总结。
- `nutrients`：统一的进化养料列表。
- `skip_reasons`：本轮跳过的原因说明。

#### `EvolutionNutrient`

- `nutrient_id`：养料唯一标识，用于去重和后续 promote。
- `kind`：养料类型；`memory` 表示偏事实和偏好，`workflow` 表示流程资产，`error` 表示错误修复经验。
- `title`：养料标题，方便人看和后续筛选。
- `content`：养料正文，保留提纯后的核心内容。
- `summary`：一句话摘要。
- `confidence`：reviewer 对养料价值的置信度。
- `evidence_turns`：支撑这条养料的 turn 编号列表。
- `source_run_id`：来源 run。
- `source_session_id`：来源 session。
- `suggested_target`：后续升级建议目标；`memory` 表示适合进入长期事实，`skill` 表示适合固化为 skill，`errorbook` 表示适合归档成错误经验。
- `tags`：用于筛选和聚合的标签，例如 `workflow`、`preference`、`tooling`。

## 5. LearningSessionState

`evolution.state.json` 保存 review 节奏和控制游标。它属于控制层数据。

```json
{
  "version": 1,
  "sessions": {
    "cli-demo": {
      "run_count": 8,
      "user_turn_count": 14,
      "last_reviewed_run_id": "run-0008",
      "last_review_at_ms": 0,
      "last_nutrient_id": "nutrient-0012",
      "last_nutrient_at_ms": 0,
      "last_review_status": "written"
    }
  }
}
```

字段语义：

- `version`：状态文件版本。
- `sessions`：按 session 聚合的状态表。
- `run_count`：当前 session 已运行次数。
- `user_turn_count`：当前 session 已累计 user turn 数。
- `last_reviewed_run_id`：最近一次成功 review 的 run。
- `last_review_at_ms`：最近一次成功 review 的时间。
- `last_nutrient_id`：最近一次写入的养料 id，用于游标和去重。
- `last_nutrient_at_ms`：最近一次写入养料的时间。
- `last_review_status`：最近一次 review 的结果状态。

### 5.1 `evolution.state.json` 和进化养料的区别

- `evolution.state.json` 是控制层，负责节奏、游标、时间点、去重锚点。
- `evolution-nutrients.jsonl` 是内容层，负责保存真正有价值的养料内容。
- `reviews/<run_id>.json` 是证据层，负责保存单次 review 的原始判断结果。

## 6. Review Record

`reviews/<run_id>.json` 建议保存如下结构：

```json
{
  "version": 1,
  "run_id": "run-0008",
  "session_id": "cli-demo",
  "status": "completed",
  "trigger_reason": "tool_call_threshold",
  "transcript_window": {
    "included_turns": [10, 11, 12, 13, 14]
  },
  "result": {
    "review_summary": "发现 2 条高价值流程经验。",
    "nutrients": [],
    "skip_reasons": []
  }
}
```

## 7. 配置模型草案

```yaml
evolution:
  learning:
    enabled: true
    mode: child_agent
    background: true
    every_n_runs: 5
    min_user_turns: 3
    max_history_messages: 20
    max_nutrients: 2
    nutrient_confidence_threshold: 0.75
    review_timeout_seconds: 10
    drain_on_close_seconds: 3
    root_path: .kongming/evolution
```

## 8. 事件建议

建议新增这些事件：

- `evolution.review.started`
- `evolution.review.completed`
- `evolution.review.failed`
- `evolution.nutrient_written`
- `evolution.review.drain_timeout`
