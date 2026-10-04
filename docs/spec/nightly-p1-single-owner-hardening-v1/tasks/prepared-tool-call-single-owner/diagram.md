# prepared-tool-call-single-owner · 影响边界图

```mermaid
flowchart LR
  StatusRoute["`src/hosts/web/websocket/thread_status.py`"]
  StatusManager["`src/hosts/web/websocket/thread_status_manager.py`"]
  Protocol["`src/hosts/web/protocol/` ↔ `web/src/protocol.ts`"]
  StatusStore["`web/src/stores/threadStatus.ts`、`useThreadStatusWS`"]
  Dispatch["`ChatManager`、`Chat.tsx`、dispatch store"]
  Approval["approval inbox frontend reducer"]
  Runtime["`src/runtime_assembly/session_engine.py`"]
  WebHistory["`src/hosts/web/threads/manager.py`、WS history route"]
  Agent["`AgentManager`、`TaskRegistry`、`HostDispatcher`"]
  AgentWeb["`ThreadManager`、`thread_subagents` router"]
  Scheduler["scheduler domain/store/manager"]
  SchedulerWeb["scheduler REST/前端"]
  Permissions["`PermissionsManager`、Web ThreadManager"]
  Tool["`core.contracts.Tool`、Runner、tools"]
  Docs["模块 README 与架构门禁"]

  StatusRoute --> StatusManager --> Protocol --> StatusStore
  Dispatch -.-> StatusStore
  Protocol --> Approval
  WebHistory --> Runtime
  Agent --> AgentWeb
  Scheduler --> SchedulerWeb
  Permissions -.-> WebHistory
  Tool -.-> Runtime
  Tool --> Docs
```
