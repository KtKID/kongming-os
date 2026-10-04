# 目标与完成标准

## 需求要点

1. workflow listing 需要进入 assembly 的 system prompt，让 LLM 在启动阶段发现所有 workflow。
2. listing 来源必须是 workflow manager 或 strategy registry 的全量 workflow 列表，字段只包含 `mode`、`title`、`使用场景`。
3. `使用场景` 来自 `WorkflowStrategyDescription.when_to_use`，payload schema 通过 `describe_agent_workflow_strategy(mode="xx")` 按需披露。
4. listing 文案必须告诉 LLM：需要具体调用参数格式时调用 `describe_agent_workflow_strategy(mode="xx")`，执行时调用 `run_agent_workflow`。
5. assembly 侧循环读取全部 workflow，新增 workflow 只注册 strategy 并维护自身 description。
6. workflow prompt 在组装顺序上早于所有读取的 instruction 文件、`InstructionLoader.extra_files`、`KONGMING_EXTRA_INSTRUCTIONS`、skills、memory 等动态来源。
7. prompt cache 稳定性是核心目标：稳定排序、稳定模板、短 listing、hash/version 语义清晰，并减少前缀 cache 失效。
8. CLI 和 Web 共享一致的 workflow listing formatter，Web `_instructions_cache` 与 listing hash/template version 保持稳定语义。

## 系统目标

该系统让 workflow strategy 从“工具 schema 里隐藏的执行能力”升级为“system prompt 中可被 LLM 主动发现的工作流目录”。LLM 先读短 listing 做策略选择，再通过 describe 工具获取 schema，最后通过 run 工具执行。strategy registry 和 description 继续作为事实源，assembly 侧只做读取、裁剪、排序和注入。

## 完成目标（DoD）

- [ ] DoD#1：CLI 和 Web 的 system prompt 都包含 workflow listing，且 listing 出现在读取的 instruction 文件、extra files、env、skills、memory 之前。
- [ ] DoD#2：listing entries 来自 registry 全量循环读取，新增 strategy 注册后自动进入 listing。
- [ ] DoD#3：每条 listing 只展示 `mode`、`title`、`使用场景`，场景文本来自 `WorkflowStrategyDescription.when_to_use`。
- [ ] DoD#4：listing 固定包含 describe/run 指引：参数格式查询走 `describe_agent_workflow_strategy(mode="xx")`，执行走 `run_agent_workflow`。
- [ ] DoD#5：listing formatter 对 CLI/Web 共用，输出排序、标题、空白、换行和 hash 完全一致。
- [ ] DoD#6：Web `_instructions_cache` 的复用和失效由 instructions base、listing template version、listing hash 共同决定。
- [ ] DoD#7：prompt cache 稳定性可验证：同一 registry 重复装配得到相同 listing 文本和 hash；strategy description 改动只改变对应 hash。
- [ ] DoD#8：payload schema、examples、warnings、inputs、outputs 均通过 describe 工具披露，listing 里保持短目录。
- [ ] DoD#9：测试覆盖 catalog、formatter、assembly 顺序、CLI/Web 一致性、cache key、describe/run 工具发现链路。

## 范围边界

**包含**

- workflow prompt catalog 数据结构和 manager 边界。
- `WorkflowStrategyDescription.when_to_use` 到 listing `使用场景` 的映射。
- 稳定 listing formatter、template version、listing hash。
- 公共 instruction assembly 注入点。
- CLI `_assemble_instructions()` 接入共享 listing。
- Web `_ensure_shared_assets()` 接入共享 listing，并让 `_instructions_cache` 绑定 hash/version 语义。
- describe/run 工具发现文案和测试。

**范围外**

- 新增 workflow strategy。
- 修改 `run_agent_workflow` payload schema。
- 把具体 payload schema 塞进 listing。
- 设计新的 Web slash catalog UI。
- 改造 LLM provider prompt cache API。
- 引入旧版本兼容 shim 或重复的 host 专用 formatter。

## 关键约束

- 协议来源：workflow 运行期能力继续从 `repo:src/application/agent_workflows/manager.py` 和 strategy registry 读取。
- 字段约束：listing 只包含 `mode`、`title`、`使用场景`。
- 顺序约束：workflow prompt source 位于读取文件和动态来源之前；CLI 后续 skills/memory 继续追加在后段。
- 稳定性约束：formatter 排序按规范化 `mode` 升序，模板版本显式记录，hash 输入使用规范化 entries。
- Host 约束：CLI 与 Web 共用同一 formatter 和同一 catalog snapshot 结构。
- 文档约束：包内 Markdown 链接只使用 `./...`，代码路径只写 `repo:<path>`。

## DoD ↔ 模块追溯矩阵

| DoD 条目 | 需要哪些模块 | 需要哪些 task | 状态 |
|---------|-------------|--------------|------|
| DoD#1 | `InstructionAssemblyIntegration` + `WorkflowPromptCatalogManager` | `workflow-prompt-assembly-integration`、`workflow-prompt-cli-web-integration` | 待实现 |
| DoD#2 | `WorkflowPromptCatalogManager` | `workflow-prompt-catalog-core` | 待实现 |
| DoD#3 | `WorkflowPromptCatalogManager` + `WorkflowPromptListingFormatter` | `workflow-prompt-catalog-core`、`workflow-prompt-listing-formatter` | 待实现 |
| DoD#4 | `WorkflowPromptListingFormatter` + `WorkflowToolDiscovery` | `workflow-prompt-listing-formatter`、`workflow-tool-discovery-contract` | 待实现 |
| DoD#5 | `WorkflowPromptListingFormatter` + `PromptCacheStability` | `workflow-prompt-listing-formatter`、`workflow-prompt-cli-web-integration` | 待实现 |
| DoD#6 | `PromptCacheStability` + `InstructionAssemblyIntegration` | `workflow-prompt-cli-web-integration`、`workflow-prompt-cache-tests` | 待实现 |
| DoD#7 | `PromptCacheStability` + `WorkflowPromptListingFormatter` | `workflow-prompt-cache-tests` | 待实现 |
| DoD#8 | `WorkflowPromptListingFormatter` + `WorkflowToolDiscovery` | `workflow-tool-discovery-contract` | 待实现 |
| DoD#9 | 全部模块 | `workflow-prompt-validation-suite` | 待实现 |

## 审核基准

主 agent 审核时以本文件“需求要点”和 DoD 为准。任何实现文档或 task 拆分都要能追溯到本矩阵，新增模块也要补入矩阵。
