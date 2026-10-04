# thread-task-progress-v0.1 · 图集

> 本 spec 的唯一图源：所有 mermaid 图集中于此，按模块分节。02/03/04 是文字事实源，本文件是只读视图——增减模块/组件时同步更新对应节。
>
> **查看与缩放**：GitHub 渲染 mermaid 自带缩放/平移控件；VS Code 建议安装 Mermaid Chart（官方）或 Markdown Preview Enhanced 插件以支持缩放。

## 目录

- [总览](#总览)
- [Web Chat 进度入口](#web-chat-进度入口)
- [Session 进度仓储](#session-进度仓储)
- [核心流程](#核心流程)
- [状态流转](#状态流转)

图例：P0 核心/阻塞 · P1 主要/必须 · P2 辅助/可选

## 总览

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  UI["进度入口与面板<br/>P0 · 当前 thread 展示"]:::p0
  API["进度读写 API<br/>P0 · REST 入口"]:::p0
  Store["Session 进度仓储<br/>P0 · 文件事实源"]:::p0
  Tool["LLM 进度写入工具<br/>P0 · 当前 session 写入"]:::p0
  Workflow["编排进度桥接<br/>P0 · 读取 task_run_id"]:::p0

  UI --> API
  API --> Store
  Tool --> Store
  Workflow --> Store
```

## Web Chat 进度入口

### 组件依赖

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  subgraph WebChat["Web Chat 进度入口"]
    Entry["ProgressEntry<br/>P0 · 顶部入口"]:::p0
    Panel["ThreadProgressPopover<br/>P0 · 展示空态和任务"]:::p0
    ViewModel["TaskProgressViewModel<br/>P0 · compact checklist"]:::p0
    Hook["useThreadTaskProgress<br/>P0 · 轮询和切换 thread"]:::p0
    Mobile["MobileToolsMenu Entry<br/>P0 · 移动端入口"]:::p0
  end

  API["ThreadTaskProgress API<br/>邻居模块"]:::p0

  Entry --> Panel
  Mobile --> Panel
  Panel --> ViewModel
  ViewModel --> Hook
  Hook --> API
```

## Session 进度仓储

### 组件依赖

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  subgraph Store["Session 进度仓储"]
    Repo["SessionTaskProgressRepository<br/>P0 · 统一读写入口"]:::p0
    Resolver["SessionPathResolver<br/>P0 · 配置路径解析"]:::p0
    Validator["TaskProgressValidator<br/>P1 · schema 校验"]:::p1
    Writer["AtomicJsonWriter<br/>P1 · 原子替换"]:::p1
  end

  Config["Config<br/>邻居模块"]:::p2
  File["task_progress.json<br/>session 同目录"]:::p0

  Repo --> Resolver
  Repo --> Validator
  Repo --> Writer
  Resolver --> Config
  Writer --> File
```

## 核心流程

### 查看与刷新

```mermaid
sequenceDiagram
  participant User as 用户
  participant UI as 进度面板
  participant API as 进度 API
  participant Store as Session 仓储
  participant File as task_progress.json

  User->>UI: 点击顶部进度入口
  UI->>API: GET 当前 thread 进度
  API->>Store: read(session_id)
  Store->>File: 读取 JSON
  File-->>Store: 快照或缺失
  Store-->>API: 标准快照
  API-->>UI: tasks + counts
  UI-->>User: 展示空态或任务列表
```

### 写入与展示

```mermaid
flowchart LR
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  LLM["LLM 工具调用<br/>P0 · update_task_progress"]:::p0
  Workflow["workflow 事件<br/>P0 · task_run_id + 状态"]:::p0
  Store["Session 仓储<br/>P0 · 原子写入"]:::p0
  Poll["Web 2 秒刷新<br/>P0 · 读取快照"]:::p0
  Model["ViewModel 映射<br/>P0 · 测试友好结构"]:::p0
  Panel["进度面板<br/>P0 · 展示最新状态"]:::p0

  LLM --> Store
  Workflow --> Store
  Store --> Poll
  Poll --> Model
  Model --> Panel
```

## 状态流转

```mermaid
stateDiagram-v2
  [*] --> pending
  pending --> in_progress: 开始执行
  in_progress --> completed: 完成
  in_progress --> pending: 等待或回退
  completed --> in_progress: 返工
  completed --> [*]
```
