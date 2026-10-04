# Workflow Prompt Catalog v0.1

> 状态：方案确认
> 目标：把所有已注册 workflow 的短 listing 注入 system prompt 前段，让 LLM 能发现可用 workflow、按 mode 查询参数说明，并调用统一 workflow 工具执行。

## 系统目标

Workflow Prompt Catalog 解决 workflow 可发现性问题。当前 workflow strategy 已经有 registry、description 和 `run_agent_workflow` 入口，但 LLM 需要在启动阶段看到一份稳定、短小、完整的 workflow 列表，才能主动选择 `parallel`、`map_reduce`、`deep_research`、`roundtable_review`、`task_flow` 以及后续新增 strategy。

本方案把 workflow listing 做成公共 assembly 能力：CLI 和 Web 共享同一个 catalog manager、同一个 formatter、同一个 hash/version 语义。listing 只展示 `mode`、`title`、`使用场景`，使用场景来自 `WorkflowStrategyDescription.when_to_use`。具体 payload schema、示例和风险提示由 `describe_agent_workflow_strategy(mode="xx")` 按需返回，执行由 `run_agent_workflow` 负责。

## 最小可用路径

进程装配 system prompt 时读取默认 workflow strategy registry -> `WorkflowPromptCatalogManager` 循环获取每个 strategy 的 description -> `WorkflowPromptListingFormatter` 按稳定排序生成短 listing 和 hash -> `InstructionAssemblyIntegration` 把 workflow 段放在读取文件和动态来源之前 -> LLM 从 listing 得知所有 workflow mode -> 需要具体参数格式时调用 `describe_agent_workflow_strategy(mode="xx")` -> 填好 payload 后调用 `run_agent_workflow` 执行。

## 设计结论

- listing 是 system prompt 的 workflow 发现入口，字段限定为 `mode`、`title`、`使用场景`。
- `使用场景` 直接来自 `WorkflowStrategyDescription.when_to_use`，strategy 自身 description 是文案单一来源。
- formatter 输出固定标题、固定说明句、固定排序和固定空白规则，hash 只由模板版本与规范化 entries 计算。
- assembly 侧循环读取 registry 全量策略；新增 workflow 只注册 strategy 并维护自身 description。
- CLI 和 Web 共享 formatter；Web `_instructions_cache` 绑定 listing hash/template version，保持缓存命中与失效语义一致。
- listing 必须明确告诉 LLM：需要具体调用参数格式时调用 `describe_agent_workflow_strategy(mode="xx")`，执行时调用 `run_agent_workflow`。

## 模块导航

| 模块 | 状态 | 文档 | 是否可进 task | 说明 |
|------|------|------|---------------|------|
| `WorkflowPromptCatalogManager` | 方案确认 | [02-module-breakdown.md](./02-module-breakdown.md#模块-1workflowpromptcatalogmanager) | 是 | workflow prompt catalog 边界，循环读取全部 strategy description 并输出稳定 entries |
| `WorkflowPromptListingFormatter` | 方案确认 | [02-module-breakdown.md](./02-module-breakdown.md#模块-2workflowpromptlistingformatter) | 是 | 稳定文本模板、排序、字段裁剪、hash/version |
| `InstructionAssemblyIntegration` | 方案确认 | [02-module-breakdown.md](./02-module-breakdown.md#模块-3instructionassemblyintegration) | 是 | 公共 assembly 注入点，保证 workflow 段早于文件/env/skills/memory |
| `WorkflowToolDiscovery` | 方案确认 | [02-module-breakdown.md](./02-module-breakdown.md#模块-4workflowtooldiscovery) | 是 | listing 到 describe/run 工具的发现链路和测试合同 |
| `PromptCacheStability` | 方案确认 | [02-module-breakdown.md](./02-module-breakdown.md#模块-5promptcachestability) | 是 | hash、template version、snapshot 与 Web `_instructions_cache` 语义 |

## 文档导航

- [图集：总览、E2E、注入顺序和数据关系](./diagrams.md)
- [目标与完成标准](./01-goals-and-boundaries.md)
- [模块设计、接口和数据结构](./02-module-breakdown.md)
- [数据模型与状态](./04-data-and-state.md)
- [验证策略与演进](./05-validation-and-evolution.md)
- [Task 映射](./90-task-map.md)

## 当前建议

本 spec 可以直接进入 x-req。第一轮实现顺序建议为 formatter 与 catalog manager 先落地，随后接入公共 assembly，再补齐 CLI/Web 缓存语义与测试。高风险点集中在注入顺序和 Web cache 失效语义，优先通过单元测试和 Web shared assets 测试锁定。
