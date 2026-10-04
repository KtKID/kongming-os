# context-compaction-implementation · 影响边界图

```mermaid
flowchart LR
  Config["`config/setting.yaml`、`config/xspace/setting.yaml`、`infrastructure.config.models.Config`"]
  Catalog["`config/model-providers.yaml`、`infrastructure.config.model_provider_catalog`"]
  Contracts["`core.contracts`"]
  Sessions["`sessions.FileSession`"]
  OtherSessions["`InMemorySession`、`SQLiteSession`"]
  Manager["`prompting.compaction.ContextCompactionManager`"]
  Assembler["`prompting.assembly.InputAssembler`"]
  Runner["`core.Runner`"]
  Commands["`commands`、CLI/Web host"]
  Provider["当前 LLM provider"]
  Fork["thread restart/fork"]
  Events["trace/event/usage"]

  Config --> Manager
  Catalog --> Manager
  Contracts --> Sessions
  Contracts --> Manager
  Assembler --> Manager
  Runner --> Manager
  Commands --> Manager
  Manager --> Provider
  Manager --> Sessions
  Manager -.-> OtherSessions
  Manager --> Events
  Fork -.-> Sessions
```
