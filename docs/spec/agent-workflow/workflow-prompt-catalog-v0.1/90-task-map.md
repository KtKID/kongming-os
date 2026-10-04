# Task 映射

## Task 总览

| Task | 优先级 | 范围 | 依赖 | 对应 DoD | 风险 | 状态 |
|------|--------|------|------|----------|------|------|
| `workflow-prompt-catalog-core` | P0 | 新增 catalog manager 和 prompt entry/snapshot 数据结构，循环读取全量 strategy description | 无 | DoD#2、DoD#3 | 高 | 可进入 x-req |
| `workflow-prompt-listing-formatter` | P0 | 新增共享 formatter，固定模板、排序、字段裁剪、hash/version | `workflow-prompt-catalog-core` | DoD#3、DoD#4、DoD#5、DoD#7、DoD#8 | 中 | 可进入 x-req |
| `workflow-prompt-assembly-integration` | P0 | 在公共 instruction assembly 注入 workflow source，保证早于文件/env | `workflow-prompt-listing-formatter` | DoD#1、DoD#6 | 高 | 可进入 x-req |
| `workflow-prompt-cli-web-integration` | P0 | CLI/Web 接入共享 render，Web `_instructions_cache` 绑定 hash/version | `workflow-prompt-assembly-integration` | DoD#1、DoD#5、DoD#6 | 高 | 可进入 x-req |
| `workflow-tool-discovery-contract` | P1 | 固化 describe/run 指引文案和工具注册合同 | `workflow-prompt-listing-formatter` | DoD#4、DoD#8 | 低 | 可进入 x-req |
| `workflow-prompt-validation-suite` | P0 | catalog、formatter、assembly、CLI/Web cache、tool discovery 全量测试 | 前五项 | DoD#9 | 中 | 可进入 x-req |

## 建议开发顺序

1. `workflow-prompt-catalog-core`：先解决全量 description 读取与 `when_to_use` 映射，这是 listing 正确性的基础。
2. `workflow-prompt-listing-formatter`：稳定模板、排序和 hash，建立 snapshot 测试。
3. `workflow-prompt-assembly-integration`：在公共 assembly 接入 workflow source，锁定 origin 顺序。
4. `workflow-prompt-cli-web-integration`：让 CLI/Web 共享 render，并把 Web cache key 补上 hash/version。
5. `workflow-tool-discovery-contract`：补齐 listing 到 describe/run 的工具发现合同。
6. `workflow-prompt-validation-suite`：用集中测试收口，覆盖新增 workflow 自动发现和 prompt cache 稳定性。

## Task 详情

### `workflow-prompt-catalog-core`

**目标**：建立 `WorkflowPromptCatalogManager`、`WorkflowPromptCatalogEntry`、`WorkflowPromptCatalogSnapshot`。

**范围**

- 读取默认 workflow registry。
- 对每个 strategy mode 获取 description。
- 从 description 映射 `mode/title/when_to_use`。
- 输出按 mode 排序的 entries。

**验收**

- fake registry 中新增 mode 后 snapshot 自动包含该 mode。
- `usage_scenarios` 逐条等于 `when_to_use`。
- 无 host case 分支。

### `workflow-prompt-listing-formatter`

**目标**：建立 CLI/Web 共用的 workflow prompt listing formatter。

**范围**

- 固定 section 标题。
- 固定 describe/run 指引文案。
- 渲染 `mode/title/使用场景`。
- 计算 template version 和 listing hash。
- 增加 snapshot 测试。

**验收**

- snapshot 输出稳定。
- 禁用字段 `summary/status/runnable/inputs/outputs/examples/warnings/depends_on` 均未进入 listing 文本。
- 相同 entries 重复 render 的 text/hash 一致。

### `workflow-prompt-assembly-integration`

**目标**：把 workflow prompt source 接进公共 assembly，并确保顺序早于读取文件和动态来源。

**范围**

- 在 instruction assembly 层新增 `workflow_catalog` source。
- 调整 origins 输出。
- 覆盖 extra files、env、sitian 的顺序测试。

**验收**

- origins 顺序包含 `workflow_catalog`，且位于 prompt files、extra files、env、sitian 之前。
- rendered text 中 workflow catalog 片段位于 extra file/env 内容之前。

### `workflow-prompt-cli-web-integration`

**目标**：CLI 和 Web 使用同一 render 结果，并让 Web cache key 语义稳定。

**范围**

- CLI `_assemble_instructions()` 接入共享 workflow render。
- Web `_ensure_shared_assets()` 接入共享 workflow render。
- Web cache record 增加 listing hash/template version。
- 调整测试覆盖 `_instructions_cache` 刷新。

**验收**

- CLI rendered text 中 workflow listing 位于 skills/memory 之前。
- Web `_instructions_cache` 在 listing hash 改变时刷新。
- CLI/Web 对同一 snapshot 输出同一 listing 文本。

### `workflow-tool-discovery-contract`

**目标**：保证 LLM 能从 listing 顺利走到 schema 查询和 workflow 执行。

**范围**

- 固化 listing 中 describe/run 指引文本。
- 测试工具注册表包含 `describe_agent_workflow_strategy` 和 `run_agent_workflow`。
- 测试 describe 返回 payload schema，listing 保持短目录。

**验收**

- listing 明确出现 `describe_agent_workflow_strategy(mode="xx")`。
- listing 明确出现 `run_agent_workflow`。
- describe 工具覆盖 inputs/examples/warnings，listing 文本保持字段裁剪。

### `workflow-prompt-validation-suite`

**目标**：把 catalog、formatter、assembly、CLI/Web cache、tool discovery 全部纳入可重复测试。

**范围**

- 单元测试。
- Host assembly 测试。
- Web cache 测试。
- 轻量 smoke。

**验收**

- 测试命令建议：`uv run pytest tests/unit/test_workflow_prompt_catalog.py tests/unit/test_workflow_prompt_listing_formatter.py tests/unit/test_workflow_prompt_cache.py -v`
- Host 测试建议：`uv run pytest tests/unit/hosts/cli/test_cli_instructions.py tests/unit/web/test_web_runtime_factory.py -v`
- 失败输出能定位到 catalog 读取、formatter、assembly 顺序或 cache key。

## 模块到 Task 映射

| 模块 | 主要 task | 次要 task |
|------|-----------|----------|
| `WorkflowPromptCatalogManager` | `workflow-prompt-catalog-core` | `workflow-prompt-validation-suite` |
| `WorkflowPromptListingFormatter` | `workflow-prompt-listing-formatter` | `workflow-tool-discovery-contract`、`workflow-prompt-validation-suite` |
| `InstructionAssemblyIntegration` | `workflow-prompt-assembly-integration` | `workflow-prompt-cli-web-integration` |
| `WorkflowToolDiscovery` | `workflow-tool-discovery-contract` | `workflow-prompt-validation-suite` |
| `PromptCacheStability` | `workflow-prompt-cli-web-integration` | `workflow-prompt-validation-suite` |

## 当前拆分建议

全部 P0 task 都可以进入同一个 x-req 包，但实现时建议按顺序提交：catalog/formatter、assembly、CLI/Web cache、测试。`workflow-tool-discovery-contract` 可随 formatter 合并进同一开发包，测试必须保留独立断言，防止 listing 文案漂移。
