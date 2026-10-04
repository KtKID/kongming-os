# 数据与状态

## 推荐目录

```text
SiTianRecords/
├── config.snapshot.json
├── observations.jsonl
├── workspace_state.json
├── latest_suggestions.json
├── latest_summary.md
├── latest_analysis.md
├── work_items/
│   ├── work-item-001.json
│   └── work-item-002.json
└── scans/
    ├── scan-20260509T120000Z.json
    └── scan-20260509T120500Z.json
```

推荐把配置源独立成：

```text
sitian.config.yaml
```

## SiTianConfig

```ts
type SiTianConfig = {
  version: "v1"
  scanIntervalSec: number
  sources: SiTianSource[]
}

type SiTianSource = {
  id: string
  kind: "workspace_path" | "thread_path" | "board_path"
  path: string
  label: string
  include?: string[]
  exclude?: string[]
  freshnessWindowSec?: number
  tags?: string[]
}
```

推荐原则：

- v1 由配置显式声明观察源
- source 必须有稳定 id
- source 支持标签，便于后续归并 work item

## Observation

```ts
type SiTianObservation = {
  id: string
  sourceId: string
  sourceKind: "workspace_path" | "thread_path" | "board_path"
  observedAt: string
  entityType: "thread" | "artifact" | "status" | "approval" | "note" | "work_item_hint"
  entityKey: string
  payload: Record<string, unknown>
  evidenceRefs: string[]
}
```

Observation 记录“看到的事实”。它保存原始信号，不保存大段推理结论。

## Work Item

```ts
type SiTianWorkItem = {
  id: string
  title: string
  status: "active" | "blocked" | "waiting" | "done" | "uncertain"
  priority: "high" | "medium" | "low"
  sourceIds: string[]
  threadIds: string[]
  projectPaths: string[]
  blockers: string[]
  artifacts: string[]
  nextActions: string[]
  risks: string[]
  updatedAt: string
}
```

## Workspace State

```ts
type SiTianWorkspaceState = {
  version: "v1"
  updatedAt: string
  sources: {
    total: number
    active: number
  }
  workItems: SiTianWorkItem[]
  blockers: {
    workItemId: string
    summary: string
    severity: "high" | "medium" | "low"
  }[]
  pendingApprovals: {
    threadId: string
    summary: string
  }[]
  risks: {
    category: string
    summary: string
    evidenceRefs: string[]
  }[]
}
```

## 命名建议

公共入口与关键函数统一使用 `SiTian` 前缀：

- `SiTianLoadConfig`
- `SiTianScan`
- `SiTianScanSource`
- `SiTianRecordObservation`
- `SiTianMaterializeState`
- `SiTianSuggest`
- `SiTianReadState`

这个命名方式会把系统边界收得很清楚，也方便后续扩展到 `SiTian v2`。
