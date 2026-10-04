# Task Map

| 模块 | 建议 task 名 | 是否创建 task | 前置依赖 | 当前状态 |
|---|---|---|---|---|
| Memory Snapshot | `self-evolution-memory-v0.1.3` | 是 | 无 | 需求分析中 |
| Error Repair | `self-evolution-error-repair-v0.1.3` | 是 | 无 | 可进入 x-req |
| Checkpoint Safety | `self-evolution-checkpoint-safety-v0.1.3` | 是 | Memory Snapshot 可并行 | 可进入 x-req |
| Config / Observability | `self-evolution-config-observability-v0.1.3` | 是 | Memory、Skill、Checkpoint 字段确认 | 可进入 x-req |
| Learning Loop | `self-evolution-learning-loop-v0.1.3` | 是 | Memory Snapshot、Error Repair | 方案确认 |
| Skill Store | `self-evolution-skill-store-v0.1.3` | 是 | Memory Snapshot、Config | 可进入 x-req |
| MemoryProvider v0.1.5 | `self-evolution-memory-provider-v0.1.5` | 否 | 本地 Memory 闭环稳定 | v0.1.5 待办 |

## 推荐拆分批次

### 第一批：安全学习底座

| Task | 产出 |
|---|---|
| `self-evolution-memory-v0.1.3` | MemoryStore、MemorySnapshot、MemoryTool、prompt 注入 |
| `self-evolution-error-repair-v0.1.3` | ErrorClassifier、分类事件、有限恢复策略 |
| `self-evolution-checkpoint-safety-v0.1.3` | CheckpointManager、file/shell 集成、restore tool |

### 第二批：自动沉淀能力

| Task | 产出 |
|---|---|
| `self-evolution-learning-loop-v0.1.3` | before_run flush、after_run review、state.json、review JSON schema |
| `self-evolution-skill-store-v0.1.3` | SkillStore、skill index、skills_list、skill_view、skill_manage |

### 第三批：产品化收口

| Task | 产出 |
|---|---|
| `self-evolution-config-observability-v0.1.3` | Config.evolution、setting.yaml、trace events、docs、架构合约 |

## x-req 入口建议

优先进入 x-req：

- `self-evolution-memory-v0.1.3`：已创建需求报告，见 `dev-pipeline/tasks/self-evolution-memory-v0.1.3/README.md`
- `self-evolution-error-repair-v0.1.3`
- `self-evolution-checkpoint-safety-v0.1.3`

继续方案确认：

- `self-evolution-learning-loop-v0.1.3`：确认后台 review 的默认策略、退出 drain 策略、review JSON schema。
- `self-evolution-skill-store-v0.1.3`：确认自动创建默认开关和 skill frontmatter schema。

保留到后续版本：

- `self-evolution-memory-provider-v0.1.5`：external provider、prefetch、recall tool、sync、MemoryManager。

## Memory Snapshot 子任务拆分

`self-evolution-memory-load` 已完成最小读取切片：启动时读取 `.kongming/memory/MEMORY.md` 并注入 system prompt。剩余 Memory Snapshot 能力拆成以下需求任务：

| 子任务 | 状态 | 职责 | 前置依赖 |
|---|---|---|---|
| `self-evolution-memory-load` | 已完成 | 读取 `MEMORY.md` 并注入 prompt | 无 |
| `self-evolution-memory-snapshot` | 需求分析中 | 支持 `USER.md`、冻结快照、checksum、snapshot prompt 渲染 | `self-evolution-memory-load` |
| `self-evolution-memory-safety-write` | 需求分析中 | 内容扫描、写入 action、原子写入、去重 | `self-evolution-memory-snapshot` 可并行 |
| `self-evolution-memory-tool` | 需求分析中 | `memory` tool 的 view/add/replace/remove 与审批接线 | `self-evolution-memory-safety-write` |
| `self-evolution-memory-config-observability` | 需求分析中 | `evolution.memory` 配置、env 覆盖、trace events、架构文档 | `self-evolution-memory-snapshot` |

推荐进入 `x-plan` 顺序：

1. `self-evolution-memory-snapshot`
2. `self-evolution-memory-safety-write`
3. `self-evolution-memory-tool`
4. `self-evolution-memory-config-observability`

## v0.1.5 MemoryProvider 待办

| 子任务 | 职责 | 前置依赖 |
|---|---|---|
| `self-evolution-memory-provider-interface-v0.1.5` | 定义 MemoryProvider lifecycle 与 MemoryManager 路由 | `self-evolution-memory-v0.1.3` |
| `self-evolution-memory-prefetch-v0.1.5` | 实现 prefetch_all、memory-context 注入、queue_prefetch_all | provider interface |
| `self-evolution-memory-provider-sync-v0.1.5` | 每轮结束后 sync_all(user, assistant)，写入外部后端 | provider interface |
| `self-evolution-memory-recall-tools-v0.1.5` | 暴露 honcho_search / hindsight_recall 类型主动查询工具 | provider interface |
| `self-evolution-memory-provider-config-v0.1.5` | provider 选择、recall_mode、prefetch/sync/tool 开关 | provider interface |

v0.1.5 默认只允许启用一个 external provider。builtin MemoryStore 继续独立运行，external provider 缺省时所有 prefetch、sync、recall tool 都跳过。
