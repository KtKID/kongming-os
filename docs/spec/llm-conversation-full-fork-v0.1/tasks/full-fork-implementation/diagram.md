# full-fork-implementation · 影响边界图

```mermaid
flowchart LR
  Message["`src/core/message.py`、`core.contracts.Session`"]
  Manager["`src/hosts/web/threads/manager.py`"]
  Sessions["`src/sessions/`、`runtime_assembly/session_engine.py`"]
  Assets["`src/hosts/web/uploads/storage.py`"]
  Metadata["`src/hosts/web/threads/metadata.py`"]
  Protocol["`src/hosts/web/protocol/`、`web/src/protocol.ts`"]
  Router["`src/hosts/web/routers/threads.py`"]
  Frontend["`web/src/stores/threads.ts`、`ThreadList.tsx`"]
  Related["`PermissionsManager`、usage 派生与 thread status"]

  Message --> Manager
  Manager --> Sessions
  Manager --> Assets
  Manager --> Metadata
  Protocol --> Router --> Manager
  Frontend --> Router
  Related -. "相关/不修改" .-> Manager
```
