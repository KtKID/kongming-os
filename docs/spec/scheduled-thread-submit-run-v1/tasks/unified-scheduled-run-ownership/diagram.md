# unified-scheduled-run-ownership · 影响边界图

```mermaid
flowchart LR
  Ticker["`src/scheduler/ticker.py`"]
  RunManager["`src/application/scheduled_runs/manager.py`"]
  ExecutionPlan["`src/application/scheduled_runs/execution_bridge.py`"]
  HostDispatcher["`src/hosts/shared/host_dispatcher.py`"]
  Agents["`src/application/agents/manager.py`、`loop.py`、`registry.py`"]
  SessionEngine["`src/runtime_assembly/session_engine.py`"]
  SchedulerState["scheduler domain/store/policy"]
  RuntimeFactory["`src/scheduler/runtime_factory.py`"]
  Lifespan["CLI/Web lifespan"]
  Rest["`SchedulerManager` 与 cron REST router"]
  Wire["Web cron lifecycle sink 与协议真源"]
  Frontend["scheduler 前端 store / runs panel / thread timeline"]
  Gates["tests / module docs / import contracts"]

  Ticker --> RunManager
  RuntimeFactory --> RunManager
  Lifespan --> Ticker
  Lifespan --> RunManager
  RunManager --> HostDispatcher --> Agents --> ExecutionPlan --> SessionEngine
  ExecutionPlan --> SchedulerState
  SchedulerState --> RunManager
  RunManager --> Rest --> Frontend
  RunManager --> Wire --> Frontend
  Gates -.-> RunManager
```

运行身份由 `ScheduledRunManager` 统一持有；ticker 只提交 reservation。Web 与 CLI
装配同一个运行门户，面板从 durable run history 与 live owner 组合投影。
terminal 进入 `FINISHING` 后先发布 durable future 并移除 live 索引，再由同一
owner 广播 `cron.run.finished`；Web 人工审批只重绑 runtime Safety 的 Consent 终点。
