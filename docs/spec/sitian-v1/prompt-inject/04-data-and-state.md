# 数据模型与状态

## 数据流

本 spec 不产生新的持久化数据。它是一个**只读消费者**——读 sitian 已有产物，格式化后注入 system prompt。

```
workspace_state.json（sitian 产出）
       ↓ 只读
build_sitian_context_text()
       ↓ 格式化文本
InstructionSource(origin="sitian")
       ↓ render
system prompt 的 # sitian 段
```

## 输入：workspace_state.json

已有数据结构（来自 `src/sitian/models.py::SiTianWorkspaceState`）：

```python
{
  "version": "v1",
  "updatedAt": "2026-05-10T12:00:00Z",
  "sources": { "total": 3, "active": 3 },
  "workItems": [
    {
      "id": "claude-workspace:kongming-agent",
      "title": "kongming-agent",
      "status": "active",           # active | blocked | waiting | done | uncertain
      "priority": "low",            # high | medium | low
      "sourceIds": ["claude-ws"],
      "threadIds": ["abc123"],
      "projectPaths": ["/path/to/project"],
      "blockers": [],
      "artifacts": [],
      "nextActions": ["查看最新线程并决定下一步"],
      "risks": [],
      "updatedAt": "2026-05-10T11:50:00Z"
    }
  ],
  "blockers": [
    { "workItemId": "...", "summary": "...", "severity": "high" }
  ],
  "pendingApprovals": [
    { "threadId": "...", "summary": "..." }
  ],
  "risks": [
    { "category": "stale_activity", "summary": "...", "evidenceRefs": [] }
  ]
}
```

## 输入：latest_summary.md（可选）

已有数据（来自 `src/sitian/suggestions.py::SiTianBuildSummaryMarkdown`）：

```markdown
# SiTian Summary

- Updated: 2026-05-10T12:00:00Z
- Sources: 3/3 active
- Work items: 10

## Next Actions
- [low] kongming-agent: 查看最新线程并决定下一步
...
```

## 输入：latest_analysis.md（可选）

已有数据（来自 `src/sitian/analyzer.py::report_to_markdown`）：

```markdown
# 司天巡检 2026-05-10T12:00:00Z

## 总结

...
```

## 输出格式

`build_sitian_context_text()` 返回的文本，直接作为 `InstructionSource.content`：

```markdown
## 工作区态势（司天观察）

数据采集于 2026-05-10T12:00:00Z（{相对时间}前）
观察源：{active}/{total} 活跃，{len(workItems)} 个项目

| # | 项目 | 状态 | 优先级 | 最近活跃 | 下一步 |
|---|------|------|--------|---------|--------|
| 1 | kongming-agent | active | low | 10 分钟前 | 查看最新线程并决定下一步 |
| 2 | x-memo | active | low | 2 小时前 | 补充最近进展 |
...（最多 MAX_ITEMS 条）

### 阻塞项
- {blocker.summary}（严重度：{blocker.severity}）

### 风险项
- {risk.summary}

#### 最近摘要
{latest_summary.md 原文}

#### 最近分析
{latest_analysis.md 原文}

以上数据由司天自动扫描产出，可能存在延迟。如需最新状态请运行 `./sitian.sh scan`。
```

## 格式化规则

| 规则 | 说明 |
|------|------|
| 相对时间 | `updatedAt` 与当前时间差转为"N 分钟前 / N 小时前 / N 天前" |
| 表格截断 | work_items 超过 `MAX_ITEMS=15` 时截断，末尾加"...及 N 个更多项目" |
| 空段省略 | blockers 为空不输出"### 阻塞项"段；risks 同理 |
| status 中文映射 | active→活跃, blocked→阻塞, waiting→等待中, done→完成, uncertain→未知 |
| freshness 警告 | 数据超过 1 小时加"（可能已过期）"标注 |

## 不持久化

本 spec 不写任何文件、不改任何 JSON。纯读取 + 格式化 + 内存注入。
