# assistant-reply-fork-action · 影响边界图

```mermaid
flowchart LR
  Core["`src/core/message.py`、`core.contracts.Session`、`src/core/runner.py`"]
  Manager["`src/hosts/web/threads/manager.py`"]
  Sessions["`src/sessions/`、`runtime_assembly/session_engine.py`"]
  Assets["`src/hosts/web/uploads/storage.py`"]
  Metadata["`src/hosts/web/threads/metadata.py`"]
  Protocol["`src/hosts/web/protocol/`、`web/src/protocol.ts`"]
  Router["`src/hosts/web/routers/threads.py`"]
  Projection["`src/hosts/web/app_support/generic_history.py`、`src/hosts/web/websocket/event_sink.py`"]
  Frontend["`web/src/stores/threads.ts`、`MessageList.tsx`、`ThreadList.tsx`、`web/src/chat/`"]
  Related["`PermissionsManager`、usage 派生与 thread status"]

  Core --> Manager
  Core --> Projection --> Protocol --> Frontend
  Frontend --> Router --> Manager
  Manager --> Sessions
  Manager --> Assets
  Manager --> Metadata
  Related -. "相关/保持独立" .-> Manager
```
