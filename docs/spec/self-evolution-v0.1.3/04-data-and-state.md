# 数据与状态

## 1. 本地文件布局

```text
.kongming/
├── memory/
│   ├── MEMORY.md
│   ├── USER.md
│   └── ERRORS.md
├── skills/
│   ├── .prompt_snapshot.json
│   └── <skill-name>/
│       ├── SKILL.md
│       ├── scripts/
│       ├── templates/
│       └── references/
├── learning/
│   ├── state.json
│   └── reviews.jsonl
├── checkpoints/
│   └── <worktree-hash>/
└── trace.jsonl
```

## 2. Memory 数据

### MEMORY.md

保存项目与环境相关事实：

- 仓库路径、运行命令、测试命令。
- 用户确认过的架构约束。
- 工具失败与修复经验。
- provider 与模型兼容性经验。

### USER.md

保存用户偏好：

- 输出语言和格式。
- 决策偏好。
- 默认工作方式。
- 常用路径和项目习惯。

### ERRORS.md

保存稳定错误经验：

- 错误签名。
- 分类结果。
- 可行修复方式。
- 触发环境。

## 3. MemorySnapshot

建议数据结构：

```python
@dataclass(frozen=True)
class MemorySnapshot:
    memory_text: str
    user_text: str
    captured_at_ms: int
    source_paths: tuple[str, ...]
    checksum: str

    def render_prompt(self) -> str:
        ...
```

关键语义：

- snapshot 在 capture 后只读。
- store 写入文件会更新磁盘内容。
- prompt 继续使用当前 snapshot。
- 下一次 capture 读取新文件内容。

## 4. Skill 数据

### SKILL.md frontmatter

```yaml
---
name: example-skill
description: 一句话说明触发场景和能力边界
category: coding
version: 1
---
```

### SKILL.md 内容结构

```markdown
# Skill Name

## Trigger

## Workflow

## Commands

## Validation

## Pitfalls
```

### SkillIndex snapshot

```json
{
  "version": 1,
  "generated_at_ms": 0,
  "skills": [
    {
      "name": "example-skill",
      "description": "...",
      "category": "coding",
      "path": ".kongming/skills/example-skill/SKILL.md"
    }
  ]
}
```

## 5. Learning State

`learning/state.json` 建议保存最小运行状态：

```json
{
  "version": 1,
  "sessions": {
    "cli-demo": {
      "turns_since_memory_review": 3,
      "turns_since_skill_review": 7,
      "last_review_at_ms": 0,
      "last_flush_at_ms": 0
    }
  }
}
```

状态用途：

- 控制 review 周期。
- 控制 pre-compact flush 频率。
- 支持 CLI 重启后继续按节奏学习。

## 6. Learning Review JSON

Reviewer 输出建议：

```json
{
  "memory_actions": [
    {
      "action": "add",
      "target": "memory",
      "content": "已验证：uv run pytest tests/unit -q 是本仓库的单元测试入口。",
      "reason": "用户任务中验证成功"
    }
  ],
  "skill_actions": [
    {
      "action": "create",
      "name": "kongming-unit-test",
      "description": "运行 kongming-agent 单元测试并定位失败",
      "body": "# kongming-unit-test\n..."
    }
  ],
  "error_notes": [
    {
      "category": "context_overflow",
      "signature": "context length exceeded",
      "resolution": "触发 compact 后重试"
    }
  ]
}
```

Applier 规则：

- 所有字段先 schema 校验。
- Memory 内容走 memory scan。
- Skill 内容走 frontmatter scan 和 injection scan。
- 写入动作使用 atomic write。
- 每条 action 都写 trace event。

## 7. 配置模型草案

```yaml
evolution:
  enabled: true
  memory:
    enabled: true
    root_path: .kongming/memory
    inject_prompt: true
    nudge_interval: 8
    flush_min_turns: 4
  skills:
    enabled: true
    root_path: .kongming/skills
    inject_index: true
    auto_create: false
    auto_patch: true
    nudge_interval: 12
  learning:
    background_review: true
    review_timeout_seconds: 30
    drain_on_close_seconds: 3
  checkpoint:
    enabled: true
    root_path: .kongming/checkpoints
    max_files: 2000
    max_bytes: 52428800
    prune_keep: 20
  error_repair:
    enabled: true
    compact_retry: true
    record_errors: true
```

## 7.1 v0.1.5 MemoryProvider 配置草案

MemoryProvider 是 external memory 后端，只在 v0.1.5 进入实现。builtin MemoryStore 始终可以独立工作，external provider 通过配置选择一个启用。

```yaml
memory:
  enabled: true
  provider: honcho
  recall_mode: hybrid
  prefetch:
    enabled: true
    max_chars: 4000
    timeout_seconds: 5
  sync:
    enabled: true
    background: true
  tools:
    enabled: true
```

`recall_mode` 语义：

| 模式 | 自动 prefetch | 主动 recall tool | 适用场景 |
|---|---|---|---|
| `context` | 开启 | 关闭 | 全自动上下文增强 |
| `tools` | 关闭 | 开启 | 模型按需查询 |
| `hybrid` | 开启 | 开启 | 自动兜底 + 主动深挖 |

### MemoryProvider Lifecycle

```python
class MemoryProvider(Protocol):
    async def initialize(self) -> None: ...
    async def prefetch(self, query: str) -> str | None: ...
    def queue_prefetch(self, query: str) -> None: ...
    async def sync_turn(self, user_message: str, assistant_message: str) -> None: ...
    def get_tool_schemas(self) -> list[dict]: ...
    async def handle_tool_call(self, name: str, args: dict) -> dict: ...
    async def on_memory_write(self, target: str, content: str) -> None: ...
    async def on_pre_compact(self) -> None: ...
    async def shutdown(self) -> None: ...
```

### Prefetch 注入格式

```xml
<memory-context>
[System note: 这是召回的记忆上下文，不是新的用户输入。]
... recalled memory ...
</memory-context>
```

关键语义：

- prefetch 发生在 API 请求构建前，用当前用户消息作为 query。
- prefetch 结果追加到当前 user message 后。
- sync 发生在本轮响应完成后，把 user / assistant 对话写入外部 provider。
- queue_prefetch 发生在本轮结束后，为下一轮后台预取。
- provider recall tool 与 prefetch 是两条通路，prefetch 系统自动触发，tool 由模型主动调用。

## 8. Trace Events

建议新增事件：

| Event kind | payload |
|---|---|
| `learning.review.start` | session_id、reason、history_count |
| `learning.review.end` | memory_actions、skill_actions、error_notes、duration_ms |
| `learning.review.error` | error_type、message |
| `memory.snapshot.captured` | source_paths、checksum、chars |
| `memory.write` | action、target、chars |
| `skill.index.built` | skill_count、chars |
| `skill.write` | action、name、path |
| `error.classified` | category、retryable、recover_action |
| `checkpoint.created` | worktree、reason、snapshot_id |
| `checkpoint.skipped` | worktree、reason |
| `checkpoint.restored` | worktree、snapshot_id |

## 9. 测试重点

- MemoryStore 读取、去重、冻结、写入、原子替换。
- Memory scan 拦截 injection 样本。
- Skill frontmatter 校验、索引生成、patch 失败提示。
- LearningReviewer JSON schema 校验和失败降级。
- ErrorClassifier 对 HTTP status、provider message、transport timeout 的分类。
- CheckpointManager 在临时 git repo 下 ensure / restore / prune。
- SessionEngine 装配后 prompt 包含 memory snapshot 和 skill index。
- import-linter 更新后架构合约通过。
