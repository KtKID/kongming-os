# task-progress-single-owner · 影响边界图

```mermaid
flowchart LR
  Workflow["`src/application/agent_workflows/manager.py` 与 task-flow strategy"]
  Tool["`src/tools/builtin/task_progress_tool.py` 与工具注册"]
  Models["`src/sessions/task_progress_models.py`"]
  Sessions["`src/sessions/task_progress_manager.py`"]
  Repository["`src/sessions/_task_progress_repository.py`"]
  Artifact["task-flow plan/artifact writer"]
  Router["`src/hosts/web/protocol/rest_models.py` 与 task-progress router"]
  Frontend["`web/src/protocol.ts`、task progress hook/popover"]
  History["workflow history/active workflow 能力"]

  Workflow --> Models --> Sessions --> Repository --> Router --> Frontend
  Tool --> Sessions
  Artifact -.-> Workflow
  Artifact -.-> Frontend
  History -.-> Frontend
```
