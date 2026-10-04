# Task 映射

## 建议开发顺序

| Task | 优先级 | 模块 | 内容 | 依赖 | 风险 |
|------|--------|------|------|------|------|
| task-1 | P0 | `ResearchSourceProvider` / WebSearch WebFetch | 做高风险前置 PoC：搜索、fetch、权限、审计、fake provider | 无 | 高 |
| task-2 | P0 | `AgentWorkflowTool` + contracts | 增加 mode schema、payload normalize、limits 默认值和错误提示 | task-1 输出合同 | 中 |
| task-3 | P0 | `DeepResearchStrategy` skeleton | 注册 strategy，写 describe/catalog/run skeleton，生成 workflow 目录和 phase summaries | task-2 | 中 |
| task-4 | P0 | Plan phase | planner prompt、3-6 search lines、空输入和 Plan null | task-3 | 中 |
| task-5 | P0 | Search + dedupe | 多线 search、fit rank、canonical URL、duplicates、overflow、source budget | task-1、task-4 | 高 |
| task-6 | P0 | Extract phase | fetch、source tier、可证伪 facts、Read 失败降级、facts=0 | task-5 | 高 |
| task-7 | P1 | Group phase | 等价事实合并、Group null fallback、members 越界过滤、fact cap | task-6 | 中 |
| task-8 | P0 | Crosscheck phase | adversarial jury、quorum、弃权、全部否决、tally | task-7 | 高 |
| task-9 | P0 | Report phase | 报告 prompt、引用、投票比分、Report null fallback | task-8 | 中 |
| task-10 | P1 | Artifact/result projection | `FactBoard` 完整产物、root result extra、reports index | task-3 到 task-9 | 中 |
| task-11 | P0 | Tests | 单元、集成、完整 e2e、live smoke 矩阵；子 agent task log 完整性 | task-1 到 task-10 | 高 |
| task-12 | P1 | Viewer adapter | 专用 workflow viewer adapter 和 Web e2e 投影 | task-10 | 中 |

## PoC 切入点

`ResearchSourceProvider` / WebSearch WebFetch 是 P0 前置 PoC。PoC 产出需要回答：

1. 子 agent 能否稳定调用 `web_search` / `web_fetch`，以及工具名、参数和返回结构。
2. 当前 `scoped_workdir` 权限模型如何表达网络工具授权和审计。
3. strategy 内部 `ResearchSourceProvider` 是否能更清晰地封装网络访问、测试 fake 和审计。
4. 搜索/fetch 失败时能否生成一致的 source record。
5. live smoke 能否在低预算下稳定完成。

推荐先实现内部 `ResearchSourceProvider` Protocol 和 fake provider，把真实 WebSearch/WebFetch 适配作为一个 provider 实现。这样 unit/e2e 可离线复跑，权限和网络审计也有单一入口。

## 进入 x-req 建议

建议拆成两轮 x-req：

| x-req 包 | 包含 task | 目标 |
|----------|-----------|------|
| [`deep-research-source-provider-v0.1`](../../../dev-pipeline/tasks/deep-research-source-provider-v0.1/README.md) | task-1、task-5 的 PoC 部分、live smoke scaffold | 已创建 req 包，先确认搜索/fetch 合同、权限边界和 fake provider |
| `deep-research-workflow-v0.1` | task-2 到 task-11 | 完成完整 workflow strategy、artifacts 和测试 |
| `deep-research-viewer-v0.1` | task-12 | 完成专用 viewer adapter、Web API 投影和 Web e2e |

`DeepResearchViewerAdapter` 放入 `deep-research-viewer-v0.1` 后续包，等 artifact schema 在 workflow v0.1 中稳定后再做。

## 模块到 task 映射

| 模块 | 目标路径 | Task |
|------|----------|------|
| `AgentWorkflowTool` | `src/tools/agent_workflow_tool.py` | task-2 |
| `AgentWorkflowManager` registration | `src/application/agent_workflows/manager.py` | task-3 |
| `DeepResearchStrategy` | `src/application/agent_workflows/strategies/deep_research/strategy.py` | task-3 |
| `DeepResearchContracts` | `src/application/agent_workflows/strategies/deep_research/contracts.py` | task-2 |
| `DeepResearchPrompts` | `src/application/agent_workflows/strategies/deep_research/prompts.py` | task-4、task-6、task-7、task-8、task-9 |
| `ResearchSourceProvider` | `src/application/agent_workflows/strategies/deep_research/source_provider.py` | task-1 |
| `SourceDeduper` | `src/application/agent_workflows/strategies/deep_research/dedupe.py` | task-5 |
| `FactBoard` | `src/application/agent_workflows/strategies/deep_research/fact_board.py` | task-10 |
| `AdversarialJury` | `src/application/agent_workflows/strategies/deep_research/jury.py` | task-8 |
| `DeepResearchViewerAdapter` | `src/hosts/web/workflow_viewer/adapters/deep_research.py` | task-12 |

## 验收门槛

| 阶段 | 必跑验证 | 通过标准 |
|------|----------|----------|
| PoC | source provider unit + live smoke provider-only | 搜索/fetch 结构稳定，失败可解释 |
| workflow unit | contracts/dedupe/jury/fact_board 单测 | MiMo 缺口场景全覆盖 |
| workflow integration | fake provider strategy 测试 | artifacts、audit、result 完整 |
| subagent audit | task log 完整性测试 | 每个子 agent task 都有 `task.log.jsonl`、`subagent.json` 索引和 audit 事件 |
| full e2e | tool -> manager -> strategy -> artifacts | exit code 0，report 含 citation/tally |
| web e2e | workflow artifacts -> viewer API -> UI panel | deep_research 列表、详情、conversation、diagnostics 可读 |
| live smoke | 低预算真实来源测试 | 能完成或明确指出前置能力错误 |
