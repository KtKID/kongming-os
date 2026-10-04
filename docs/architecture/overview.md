# 架构总览（v0.1.6 skill-system 后）

> 本图反映 v0.1.6 skill 系统合入后的整体形态：模块依赖、CLI 主链路、安全决策链、事件总线。
> 以 [CLAUDE.md](../CLAUDE.md) 的"代码地图"和"数据流"为根据，图与文字必须保持一致。

## 模块依赖（layered）

`.importlinter` 强制的分层方向；箭头 = 允许的依赖方向，反向被 CI 拦下。

```mermaid
flowchart TB
    classDef layer fill:#f5f5f5,stroke:#888,color:#000
    classDef core fill:#dbeafe,stroke:#1d4ed8,color:#000
    classDef mid fill:#dcfce7,stroke:#16a34a,color:#000
    classDef safe fill:#fef3c7,stroke:#ca8a04,color:#000
    classDef host fill:#fae8ff,stroke:#a855f7,color:#000
    classDef cli fill:#fee2e2,stroke:#dc2626,color:#000

    cli[hosts/cli / hosts/web] -->|装配| hosts
    hosts -->|safety chain| safety
    hosts -->|runtime| runtime_assembly
    cli -->|build_default_registry| tools

    safety -->|消费 ApprovalProvider| core
    tools --> core
    sessions --> core
    prompting --> core
    llm_providers --> core
    runtime_assembly --> core
    application --> core
    tracing --> core
    network --> core
    memory --> core
    config --> core

    runtime_assembly -. 白名单跨层 .-> safety
    runtime_assembly -. 白名单跨层 .-> prompting

    tools -. v016 装配期接收 .-> skill_loader[prompting.skills: SkillSpec]

    class core core
    class tools,sessions,prompting,llm_providers,runtime_assembly,application,tracing,network,memory mid
    class safety safe
    class hosts host
    class cli cli
    class config,prompts mid
```

**强约束**（来自 CLAUDE.md 的 12 条 + import-linter 5 contracts）：

- `core/` 不能 import 任何 sibling
- `tools/` 不能 import `safety.capability_policy` / `safety.permission_policy` / `safety.guards.*` / `safety.decision_engine` / `safety.boundary_resolver` / `safety._path_trie` / `safety.grant_store`
- 跨层 import 仅两条白名单：`runtime_assembly.session_engine → safety` 和 `→ prompting`
- 跨模块协议真源只在 `core.contracts/`

## CLI 主链路（一次对话）

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant CLI as cli/main.py
    participant LD as skill_loader<br/>(v0.1.6)
    participant Reg as ToolRegistry
    participant NR as SessionEngine
    participant SC as SafetyChain<br/>(HardBlock→Boundary→Trust→Consent)
    participant R as core.Runner
    participant LLM as Provider<br/>(OpenAI/Anthropic)
    participant T as Tool<br/>(read/write/shell/memory/skill)
    participant ES as EventSinks<br/>(Trace + CLI + MemoryRefresh)

    U->>CLI: prompt
    CLI->>LD: load_skill_specs(home, workspace, event_sinks)
    LD-->>ES: skill.{discovered,shadowed,parse_failed,skipped}
    LD-->>CLI: dict[name, SkillSpec]
    CLI->>Reg: build_default_registry(skill_specs=..., skill_event_sinks=...)
    Note right of Reg: 注册 SkillTool（first-class）

    CLI->>NR: SessionEngine.build(cfg, session_factory,<br/>event_sinks, instructions, ...)
    NR->>SC: build_safety_chain(cfg, interactive_approval, event_sinks)
    NR-->>R: Runner(input_assembler, context_compaction_manager, ...)

    R->>R: compact(RUN_START)
    loop turn < max_turns
        R->>R: assemble(active context, instructions)
        R->>LLM: complete(LLMRequest)
        LLM-->>R: LLMResponse(tool_calls?)

        alt tool_calls 存在
            loop each call
                R->>SC: decide(ApprovalRequest)
                Note right of SC: DangerGuard → mode →<br/>current thread permissions → Consent
                SC-->>R: ApprovalDecision
                opt approved
                    R->>T: tool.execute(args, ctx)
                    Note right of T: SkillTool 7 步：<br/>emit invoked → 读 body →<br/>!command 拒绝 → re.sub 单遍替换 →<br/>emit completed → ToolResult
                    T-->>ES: skill.{invoked,completed,failed}<br/>tool.call.*
                    T-->>R: ToolResult
                end
            end
            R->>R: compact(TOOL_RESULT)
        else 无 tool_calls
            R->>R: 终态退出
        end
        R-->>ES: turn.{started,ended} / llm.* / approval.*
    end

    R-->>CLI: Result
    CLI-->>U: 输出
    Note over CLI,NR: finally: await runtime.aclose() 释放 httpx 连接池
```

## 安全决策链（v0.7）

```mermaid
flowchart LR
    classDef block fill:#fee2e2,stroke:#dc2626,color:#000
    classDef pass fill:#dcfce7,stroke:#16a34a,color:#000
    classDef ask fill:#fef3c7,stroke:#ca8a04,color:#000

    REQ[ApprovalRequest<br/>root thread_id<br/>Shell execution_scope.cwd] --> DG{DangerGuard}
    DG -->|HardBlock| BLOCK[rejected<br/>hard_block]:::block
    DG -->|elevated| EASK[Consent<br/>severity=elevated<br/>remember=false]:::ask
    DG -->|FORCE_ASK| DASK[Consent<br/>danger=true<br/>remember=false]:::ask
    DG -->|ordinary| MODE{per-cwd disposition}
    MODE -->|full_trust| TRUST[approved<br/>source=full_trust]:::pass
    MODE -->|llm / user| UA[thread permissions]
    UA --> PM{PermissionsManager<br/>current thread}
    PM -->|deny| DENY[rejected<br/>source=permissions]:::block
    PM -->|allow| ALLOW[approved<br/>source=permissions]:::pass
    PM -->|miss| ASK[ApprovalManager<br/>LLM review + countdown<br/>or user consent]:::ask
    EASK --> IAP[InteractiveApproval]
    DASK --> IAP[InteractiveApproval]
    ASK --> IAP
    IAP -->|allow| AP[approved<br/>explicit_consent]:::pass
    IAP -->|reject| REJ[rejected]:::block
    IAP -->|remember| BOOK[PermissionsManager.remember<br/>pending.thread_id]
```

## 事件总线（EventKind 全集）

runner / safety / tool / memory / skill 五条线汇入 `list[EventSink]`：

```mermaid
flowchart LR
    classDef src fill:#e0e7ff,stroke:#4338ca,color:#000
    classDef sink fill:#dcfce7,stroke:#16a34a,color:#000

    R[core.Runner]:::src -->|run.start/end<br/>turn.started/ended<br/>llm.request/response<br/>llm.chunk.first/stream.end<br/>content.delta/reasoning.delta<br/>error| BUS((EventSink fan-out))
    SC[SafetyChain]:::src -->|approval.required<br/>tool.denied<br/>tool.approval_required<br/>tool.silently_allowed| BUS
    TL[Tool runtime]:::src -->|tool.call.start/end| BUS
    M[MemoryTool]:::src -->|memory.write.success/rejected/error<br/>memory.snapshot.refreshed| BUS
    SK_load[skill_loader<br/>装配期]:::src -->|skill.discovered<br/>skill.shadowed<br/>skill.parse_failed<br/>skill.skipped| BUS
    SK_run[SkillTool<br/>运行时]:::src -->|skill.invoked<br/>skill.completed<br/>skill.failed| BUS

    BUS --> JTS[JsonlTraceSink<br/>.kongming/trace.jsonl]:::sink
    BUS --> CLES[CLIEventSink<br/>verbose/show_reasoning]:::sink
    BUS --> MRS[MemoryRefreshSink<br/>history.compact.completed → snapshot.refresh]:::sink
    BUS --> PD[PromptDebugDumpSink<br/>.kongming/debug/prompt-debug-*.json]:::sink
```

## v0.1.6 skill-system 数据态

```mermaid
flowchart TB
    subgraph FS["文件系统"]
        H["&lt;KONGMING_HOME&gt;/skills/&lt;name&gt;/SKILL.md<br/>(home 源)"]
        W["&lt;cwd&gt;/.kongming/skills/&lt;name&gt;/SKILL.md<br/>(workspace 源)"]
    end

    subgraph SYS_PROMPT["system prompt（listing 段）"]
        L["# skills<br/>- &lt;name&gt;: &lt;description&gt;<br/>  when: &lt;when_to_use&gt;<br/>  ..."]
    end

    subgraph YAML["config/setting.yaml"]
        CFG["safety:<br/>  skill_call_rules:<br/>    - name: 'block-shell-skills'<br/>      matcher: 'shell-'<br/>      match_mode: prefix<br/>      effect: block<br/>      ..."]
    end

    subgraph RT["运行时"]
        SP["dict[str, SkillSpec]"]
        ST["SkillTool"]
        CR["ConsentResolver<br/>(_skill_block/elevated/allow)"]
    end

    H --> SP
    W -->|name 重复 → workspace 覆盖<br/>+ skill.shadowed| SP
    SP --> SYS_PROMPT
    SP --> ST

    CFG -->|SafetySkillCallConfig<br/>→ SkillCallRule| CR

    user[模型 tool_call] -->|skill?| CR
    CR -->|approved| ST
    ST -->|read body_path<br/>+ re.sub 单遍替换| out[ToolResult.content]
```

## 关键文件索引

| 关注点 | 文件 | 来源 task |
|---|---|---|
| 协议真源（含 EventKind） | `src/core/contracts/` | core baseline + v0.1.6 加 skill.* 7 项 |
| skill 装载 | `src/prompting/skills/` | skill-loader-v0.1.6 |
| skill 工具 | `src/tools/builtin/skill_tool.py` | skill-tool-v0.1.6 |
| skill 装配糖 | `src/tools/__init__.py::build_default_registry` | skill-tool-v0.1.6 |
| skill 安全决策 | `src/safety/guards/consent.py::_classify_skill` | skill-tool-v0.1.6 |
| skill 数据类型 | `src/safety/types.py::SkillCallRule` | skill-tool-v0.1.6 |
| skill yaml schema | `src/infrastructure/config/models.py::SafetySkillCallConfig` | skill-tool-v0.1.6 |
| 默认空表锚点 | `src/safety/default_rules.py::DEFAULT_SKILL_CALL_RULES` | skill-tool-v0.1.6 |

## 渲染

GitHub / VS Code Markdown Preview / typora 等都原生支持 mermaid。

预导出的 SVG 在 [`diagrams/`](./diagrams/)：

| 文件 | 对应 |
|---|---|
| [`diagrams/01-module-dependency.svg`](./diagrams/01-module-dependency.svg) | 模块依赖（layered） |
| [`diagrams/02-cli-mainline.svg`](./diagrams/02-cli-mainline.svg) | CLI 主链路时序 |
| [`diagrams/04-event-bus.svg`](./diagrams/04-event-bus.svg) | 事件总线 |
| [`diagrams/05-skill-system-data.svg`](./diagrams/05-skill-system-data.svg) | v0.1.6 skill-system 数据态 |

重新导出（图改动后）：

```bash
# 一次性安装到 /tmp（需 ~400MB，含 chromium）
npm install --no-save --prefix /tmp/mmdc-tools @mermaid-js/mermaid-cli

# 导出全部 5 张图
/tmp/mmdc-tools/node_modules/.bin/mmdc \
  -i docs/architecture-overview.md \
  -o docs/diagrams/arch.svg

# 然后手工 mv arch-{1..5}.svg 到对应有意义文件名
```

## 维护

每次模块新增 / EventKind 扩展 / 安全链改动 / 重要装配点变化都应：

1. 改对应模块 `docs/modules/<name>/README.md`
2. 改 `CLAUDE.md` 代码地图 / 数据流（仅当 ~60 行索引地图被影响）
3. 改本文件的对应图段（图与代码必须同步）
