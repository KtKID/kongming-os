# 验证策略与演进

## 验证策略

### 单元测试

| 覆盖对象 | 建议测试路径 | 核心断言 |
|----------|--------------|----------|
| `WorkflowPromptCatalogManager` | `repo:tests/unit/test_workflow_prompt_catalog.py` | registry 全量 mode 被读取；每个 mode 调用 describe；`when_to_use` 映射为 `usage_scenarios` |
| `WorkflowPromptListingFormatter` | `repo:tests/unit/test_workflow_prompt_listing_formatter.py` | 输出只含 `mode/title/使用场景`；固定包含 describe/run 指引；排序和空白稳定 |
| `PromptCacheStability` | `repo:tests/unit/test_workflow_prompt_cache.py` | 同一 snapshot hash 一致；template version 变化会改变 cache key；description 变化会改变 listing hash |
| `InstructionAssemblyIntegration` | `repo:tests/unit/test_instruction_loader.py` | `workflow_catalog` origin 位于 prompt files、extra files、env、sitian 之前 |
| CLI assembly | `repo:tests/unit/hosts/cli/test_cli_instructions.py` | workflow listing 位于 skills/memory 之前，CLI 使用共享 formatter |
| Web shared assets | `repo:tests/unit/web/test_web_runtime_factory.py` | `_instructions_cache` 记录 listing hash/template version，registry 变化触发刷新 |
| Tool discovery | `repo:tests/unit/test_agent_workflow_tool_discovery.py` | listing 文案中的 `describe_agent_workflow_strategy` 和 `run_agent_workflow` 对应真实注册工具 |

### 合同测试

| 合同 | 验证方式 | 通过条件 |
|------|----------|----------|
| listing 字段合同 | formatter snapshot | 任意 entry 只渲染 `mode`、`title`、`使用场景` |
| description 来源合同 | fake strategy description | `usage_scenarios == description.when_to_use` |
| 新增 workflow 自动发现 | 注册 fake strategy | assembly 输出新增 mode，无 host 分支 |
| Web cache 合同 | fake registry 两次装配 | listing hash 相同时复用，hash 变化时刷新 |
| CLI/Web 一致性合同 | 同一 fake snapshot 调 CLI/Web formatter | text、template_version、listing_hash 完全一致 |

### E2E / Smoke

| 链路 | 入口 | 断言 |
|------|------|------|
| CLI prompt assembly smoke | `repo:src/hosts/cli/main.py::_assemble_instructions()` | rendered text 先出现 workflow catalog，再出现 extra file、env、skills、memory |
| Web runtime factory smoke | `repo:src/hosts/web/run.py::_ensure_shared_assets()` | `_instructions_cache` 中包含 workflow catalog，cache record 带 hash/version |
| LLM discovery smoke | fake LLM 读取 prompt 后选择 mode | 需要 schema 时调用 describe，执行时调用 run |

## 质量门槛

- listing snapshot 需要固定测试，避免文案和字段意外漂移。
- assembly 顺序测试需要同时断言 `origins` 和文本位置。
- 每个 fake strategy 的 `when_to_use` 至少包含两条，覆盖多行使用场景渲染。
- 测试中禁止通过一次性脚本验证；所有验证落在 `tests/` 下可重复运行。
- Web cache 测试要覆盖同 hash 复用、hash 变化刷新、template version 变化刷新三种情况。

## 风险与缓解

| 风险 | 等级 | 影响 | 缓解 |
|------|------|------|------|
| 装配期只拿到 catalog entry，缺少 `when_to_use` | 高 | listing 使用场景来源失真 | catalog manager 通过 catalog-only registry 调 describe，或新增默认 description 读取入口 |
| listing 混入 schema/example/warnings | 中 | prompt 前缀变长，cache 命中下降 | formatter 禁用字段测试 |
| Web `_instructions_cache` 复用旧 listing | 高 | 新 strategy 注册后 Web prompt 看不到 | cache key 纳入 listing hash/template version |
| CLI/Web 各自格式化 | 中 | 文案漂移，LLM 行为不一致 | 单一 formatter + 双 host 测试 |
| 注入顺序漂移 | 高 | 动态文件覆盖 workflow 发现段或 cache 前缀波动 | origins 和文本位置双断言 |

## 演进路径

### v0.1

- 完成短 listing 注入、共享 formatter、hash/version、CLI/Web 一致性。
- listing 只做 discovery，describe/run 继续承担 schema 和执行。
- 默认 strategy registry 作为 listing 来源。

### v0.2

- 为插件式 workflow registry 增加动态 source label，listing 仍保持同一字段集合。
- 给 Web 管理端增加只读诊断：当前 listing hash、template version、mode 列表。
- 将 workflow prompt catalog 纳入 prompt debug dump，便于线上排查。

### v0.3

- 支持按 host 能力裁剪 runnable workflow，同时保留 stable hash 规则。
- 将 workflow catalog 与 slash catalog 的文案漂移检查接入统一 contract test。

## 审核清单

- [ ] README、目标、模块、数据、验证、task、图集 7 文件齐全。
- [ ] 除 [diagrams.md](./diagrams.md) 外无 mermaid。
- [ ] 包内 Markdown 链接只使用 `./...`。
- [ ] 代码路径只使用 `repo:<path>`。
- [ ] DoD 每条都有模块和 task 支撑。
- [ ] 每个模块都有边界类、风险等级、task 建议。
- [ ] 数据结构字段都有中文注释。
