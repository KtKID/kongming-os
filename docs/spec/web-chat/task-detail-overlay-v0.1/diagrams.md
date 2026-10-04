# Task Detail Overlay v0.1 图集

> 查看建议：GitHub / VS Code Mermaid 预览支持缩放。单图保持小节点数，细节分到模块节。

## 目录

- [总览](#总览)
- [E2E 测试链路](#e2e-测试链路)
- [Task Detail Overlay](#task-detail-overlay)
- [Thread Artifact Reader](#thread-artifact-reader)
- [Structured Record Renderer](#structured-record-renderer)
- [Workflow Viewer Embed](#workflow-viewer-embed)

## 总览

```mermaid
flowchart TD
  CHAT["ChatPage<br/>父路由常驻<br/>类/函数：ChatPage + Outlet"]:::p0
  OVERLAY["Task Detail Overlay<br/>覆盖页和 tab 编排<br/>类/函数：TaskDetailManager"]:::p0
  FILES["Thread File Browser<br/>文件列表和预览<br/>类/函数：ThreadFileBrowserManager"]:::p1
  READER["Thread Artifact Reader<br/>thread 文件只读投影<br/>类/函数：ThreadArtifactManager"]:::p0
  RENDERER["Structured Record Renderer<br/>JSONL 字段级渲染<br/>类/函数：StructuredRecordRenderer"]:::p1
  WF["Workflow Viewer Embed<br/>复用现有 viewer<br/>类/函数：WorkflowViewerEmbed"]:::p0
  API["Agent Workflow API<br/>现有 workflow API<br/>类/函数：WorkflowRunViewerManager"]:::p2

  CHAT --> OVERLAY
  OVERLAY --> FILES
  FILES --> READER
  FILES --> RENDERER
  OVERLAY --> WF
  WF --> API

  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px
```

## E2E 测试链路

```mermaid
flowchart LR
  FIXTURE["准备 file session fixture<br/>manifest/jsonl/trace/workflow"]:::p1
  CHAT["打开 /chat/{threadId}<br/>ChatPage 已挂载"]:::p0
  OPEN["点击任务详情<br/>进入 child route"]:::p0
  FILE["选择 thread jsonl<br/>右侧字段级渲染"]:::p1
  WF["点击 Workflows<br/>复用 workflow viewer"]:::p0
  CLOSE["关闭覆盖页<br/>回到 Chat"]:::p1
  ASSERT["断言<br/>Chat DOM 保留 + 内容正确"]:::p0

  FIXTURE --> CHAT --> OPEN --> FILE --> WF --> CLOSE --> ASSERT

  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px
```

## Task Detail Overlay

```mermaid
flowchart TD
  subgraph TASK["Task Detail Overlay 模块"]
    ROUTE["TaskDetailRoute<br/>解析 thread/tab/file/workflow"]:::p0
    MANAGER["TaskDetailManager<br/>tab 和关闭行为"]:::p0
    SHELL["TaskDetailShell<br/>左 tab + 内容区"]:::p1
  end
  CHAT["ChatPage<br/>父 route + Outlet"]:::p0
  FILES["ThreadFileBrowser"]:::p1
  WF["WorkflowViewerEmbed"]:::p1

  CHAT --> ROUTE
  ROUTE --> MANAGER
  MANAGER --> SHELL
  SHELL --> FILES
  SHELL --> WF

  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px
```

## Thread Artifact Reader

```mermaid
flowchart TD
  subgraph READER["Thread Artifact Reader 模块"]
    ROUTER["ThreadArtifactRouter<br/>/api/threads/{id}/artifacts"]:::p1
    MANAGER["ThreadArtifactManager<br/>只读门面和路径校验"]:::p0
    ARTIFACT["ThreadArtifactReader<br/>JSON/JSONL/text 读取"]:::p0
    DTO["ThreadArtifact DTO<br/>list/content/diagnostics"]:::p1
  end
  ROOT["session_root/{thread_id}<br/>manifest + jsonl + trace"]:::p2

  ROUTER --> MANAGER
  MANAGER --> ARTIFACT
  ARTIFACT --> ROOT
  MANAGER --> DTO

  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px
```

## Structured Record Renderer

```mermaid
flowchart LR
  subgraph RENDERER["Structured Record Renderer 模块"]
    RECORD["JsonlRecordList<br/>record 分组"]:::p0
    CLASSIFY["FieldClassifier<br/>字段分类"]:::p0
    MD["MarkdownFieldRenderer<br/>content/text/message"]:::p1
    JSON["JsonFieldViewer<br/>object/array"]:::p1
    META["MetadataFieldRow<br/>role/type/action/time"]:::p2
  end

  RECORD --> CLASSIFY
  CLASSIFY --> MD
  CLASSIFY --> JSON
  CLASSIFY --> META

  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px
```

## Workflow Viewer Embed

```mermaid
flowchart TD
  subgraph WF["Workflow Viewer Embed 模块"]
    EMBED["WorkflowViewerEmbed<br/>嵌入式入口"]:::p0
    LIST["WorkflowListPanel<br/>现有列表组件"]:::p1
    DETAIL["WorkflowDetailContent<br/>现有详情主体"]:::p1
    STORE["useAgentWorkflowViewerStore<br/>现有状态"]:::p0
  end
  PAGE["WorkflowRunViewerPage<br/>独立页面包装"]:::p2
  OVERLAY["TaskDetailShell<br/>Workflows tab"]:::p0

  PAGE --> EMBED
  OVERLAY --> EMBED
  EMBED --> STORE
  EMBED --> LIST
  EMBED --> DETAIL

  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px
```
