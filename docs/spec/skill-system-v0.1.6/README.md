# skill-system-v0.1.6

> 状态：方案确认中
> 目标：给 kongming-agent 引入 skill 概念——可外挂的工作流知识包，listing 进 system prompt 让模型发现，body 通过 first-class `Skill` 工具按需读
> 调研依据：[docs/research/claude-code-skill-loading.md](../research/claude-code-skill-loading.md)
> 计划版本：v0.1.6
> 创建时间：2026-04-27

## 系统目标

让用户在 `<kongming_home>/skills/` 与 `<cwd>/.kongming/skills/` 两个目录下放置 `SKILL.md` 文件，agent 启动时把这些 skill 的"name + description + when-to-use"列入 system prompt 给模型发现，模型 `tool_call("skill", ...)` 触发实际 body 读盘并以 `tool_result` 形式回到对话——避免 body 全文塞 system prompt 导致 ctx window 膨胀。

价值定位：
- 用户层：写 markdown 即可扩展 agent 行为，不用改代码
- 工程层：复用现有 `Tool` / `Capability` / `Permission` / `EventSink` / `InstructionSource` 协议，零侵入 core
- 演进层：v0.1.6 锁基础形态；v0.2 再补 listing 预算截断、`allowed-tools` 强制改写、fork 子 runtime、路径条件激活

## 范围边界

**包含**：
- `src/context/skill_loader.py`：扫描双源 + frontmatter 解析 + listing 渲染
- `src/tools/builtin/skill_tool.py`：first-class `Skill` 工具（schema、变量替换、读 body、emit 事件）
- `src/safety/capability_policy.py` 扩展：新增 `skill` capability 与 `Skill(name)` / `Skill(prefix:*)` permission rule
- `assemble_instructions()` 接口扩展：listing 作为 `InstructionSource(origin="skills")` 注入
- CLI / web 装配层接入：在 `_make_runtime_factory` / `_assemble_instructions` 调 loader + 注册 SkillTool
- 单元测试：loader 双源去重 / frontmatter 解析 / listing 截断 / tool 变量替换 / `!command` 拒绝 / capability 拒绝

**不包含**：
- listing 预算截断（v0.1.6 假设 skill 数量 < 30，超 1% ctx 留 v0.2）
- `allowed-tools` 真正改写工具集（v0.1.6 仅解析存好，运行时不消费）
- `paths` 路径条件激活（同上）
- fork 子运行时执行模式（v0.2+）
- `disable-model-invocation` / `user-invocable` / `hooks` / `model` / `effort` 等高级 frontmatter 字段
- `!command` bash 注入（**永久禁用**——绕 capability 链，安全无法接受）
- managed / MCP / plugin 加载源（v0.2+）
- listing 增量通知（`sentSkillNames` delta，session 启动锁定即可）
- compaction 锚点重注入（v0.2 LLM 摘要升级时同步处理）

## 模块导航

| 模块 | 状态 | 文档锚点 | 是否可进 task | 说明 |
|------|------|---------|---------------|------|
| A. skill-loader | 方案确认 | [02 §A](./02-module-breakdown.md#模块-a-skill-loader) | 是 | 双源扫描 + frontmatter 解析 + listing 渲染，独立可测 |
| B. skill-tool | 方案确认 | [02 §B](./02-module-breakdown.md#模块-b-skill-tool) | 是（依赖 A） | first-class `Skill` 工具 + 变量替换，与 capability 紧耦合 |
| C. safety 集成 | 方案确认 | [02 §C](./02-module-breakdown.md#模块-c-safety-集成) | 是（与 B 并入） | capability + permission rule 扩展 |
| D. 装配集成 | 方案确认 | [02 §D](./02-module-breakdown.md#模块-d-装配集成) | 是（依赖 A/B/C） | listing 进 `assemble_instructions`、SkillTool 进 registry |

## 文档导航

- [模块拆分](./02-module-breakdown.md)
- [核心流程](./03-core-workflows.md)（启动加载 / 调用流程 / 错误处理）
- [数据与状态](./04-data-and-state.md)（SkillSpec / frontmatter 字段 / listing 输出形态）
- [Task 映射](./90-task-map.md)
- 上游调研：[docs/research/claude-code-skill-loading.md](../research/claude-code-skill-loading.md)

## 关键决策（v0.1.6 锁死，不再讨论）

| # | 决策 | 备注 |
|---|------|------|
| 1 | 文件结构 `<source>/<name>/SKILL.md`（目录形态） | 便于将来扩资源文件（图、子文档） |
| 2 | 双源加载：home + workspace；同名 workspace 覆盖 home | 与 tools 多源策略一致 |
| 3 | 进 listing 字段：`name` + `description` + `when-to-use`，三字段拼一行 | 整行受 250 字硬上限截断 |
| 4 | 进 SkillSpec runtime（不进 listing）：`allowed-tools` / `paths` | v0.1.6 解析存好不消费 |
| 5 | first-class `Skill` 工具：`{skill: str, args: str \| None}` | 复用 `core.contracts.Tool` |
| 6 | body 注入方式 = `tool_result` | 零侵入 Runner，不改 `core.contracts` |
| 7 | 仅 inline 模式 | fork 留 v0.2+ |
| 8 | 变量替换：`$ARGUMENTS` / `${KONGMING_SKILL_DIR}` / `${KONGMING_SESSION_ID}` | 三个静态变量，无副作用 |
| 9 | `!command` bash 注入永久禁用 | 安全约束 |
| 10 | listing 不做预算截断 | v0.2 再补 |
| 11 | listing 入 `assemble_instructions()` 公共函数 | 衔接 web-runtime-factory-v0.1.5 模块 1 |
| 12 | SkillSpec 是 `context` 模块内部类型，不进 `core.contracts` | 对齐 CLAUDE.md 约束 #1 |
| 13 | SkillTool 不直连 policy；capability 在 `safety/capability_policy.py` | 对齐 CLAUDE.md 约束 #5 |
| 14 | skill 事件走现有 EventSink（`skill.discovered` / `skill.invoked` / `skill.completed`） | 对齐 CLAUDE.md 约束 #7 |

## 当前建议

1. **本系统所有模块都已可进入 x-req**，决策面 14 条全部对齐
2. **推荐 task 形态**：3 个 task（loader / tool+safety / assemble），保证 CR 边界清晰；详见 [90-task-map.md](./90-task-map.md)
3. **前置依赖**：等 web-runtime-factory-v0.1.5 模块 1（`assemble_instructions` 公共化）落地后再开 D 模块 task；A/B/C 可立即开
4. **不建议合并 v0.1.5**：v0.1.5 是"让浏览器对话 agent"，v0.1.6 是"让 agent 可外挂 skill"——独立目标，独立版本

---

*方案规划完成时间：2026-04-27*
