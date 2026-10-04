# 模块拆分

## 模块总览

| 模块 | 职责 | 依赖 | 状态 | 备注 |
|------|------|------|------|------|
| A. skill-loader | 扫描双源 + frontmatter 解析 + listing 渲染 | stdlib | 方案确认 | 独立可测；纯 I/O + 字符串处理 |
| B. skill-tool | first-class `Skill` 工具 + 变量替换 + body 读取 | A | 方案确认 | 与 capability 紧耦合 |
| C. safety 集成 | `skill` capability + `Skill(name)` permission rule | 现有 safety | 方案确认 | 与 B 并入同一 task |
| D. 装配集成 | listing 进 `assemble_instructions`、SkillTool 进 registry | A、B、C | 方案确认 | CLI / web 装配层都要改 |

## 模块详情

### 模块 A：skill-loader

**职责**：扫描双源目录，解析每个 SKILL.md 的 frontmatter（不读 body），产出 `SkillSpec` 列表与 listing 文本。

**包含范围**：

- 新建 `src/context/skill_loader.py`
- `SkillSpec` dataclass（frozen）——见 [04-data-and-state.md](./04-data-and-state.md)
- `async def load_skill_specs(home: Path, workspace: Path | None) -> list[SkillSpec]`
- `def format_skill_listing(specs: Sequence[SkillSpec]) -> str`
- frontmatter 解析：YAML 头 `---\n...\n---`，用 `pyyaml` 或自写 mini parser（只取 5 个字段，简单到可自写）
- 双源去重：同名 workspace 覆盖 home，记录 `source` 字段便于 trace
- 缺目录静默返回空列表（与 `instruction_loader` 缺文件静默策略一致）

**不包含范围**：

- 读取 body（body 路径只记录在 `SkillSpec.body_path`，不读盘）
- listing 预算截断（v0.1.6 不做）
- 路径条件激活的 `paths` 匹配（仅解析存好）
- managed / MCP / plugin 多源（v0.2+）
- frontmatter `hooks` / `model` / `effort` / `disable-model-invocation` / `user-invocable` 字段（直接忽略）

**依赖**：

- 仅 stdlib（`pathlib` / `re` / `asyncio` / `dataclasses`）+ 第三方 `pyyaml`（项目已有依赖）
- **不 import** `core` / `tools` / `executors` / `safety`——`context` 模块已经是这个边界

**风险与讨论点**：

- **frontmatter 解析容错**：缺 `name` 字段时跳过该 skill 还是报错？建议**跳过 + warning event**（`skill.skipped`），与"缺文件静默"策略一致
- **body_path 安全**：`body_path` 必须落在 skill 目录内，防止符号链接逃逸？建议 v0.1.6 用 `realpath` 解析后比对前缀（与 Claude Code `loadSkillsDir.ts:118-124` 同思路）
- **同名冲突日志**：workspace 覆盖 home 时是否打 trace 事件？建议 emit `skill.shadowed`（home spec 标记为 shadowed，listing 不输出）

**task 建议**：
- task 名：`skill-loader-v0.1.6`
- 进入 x-req：是
- 原因：纯 I/O 模块，单测覆盖容易，可独立交付

---

### 模块 B：skill-tool

**职责**：注册 first-class `Skill` 工具到 `ToolRegistry`，模型 `tool_call("skill", {...})` 时按 name 读 body、做变量替换、emit 事件、返回 `tool_result`。

**包含范围**：

- 新建 `src/tools/builtin/skill_tool.py`
- 工具实现满足 `core.contracts.Tool` Protocol
- 工具 schema：

  ```json
  {
    "name": "skill",
    "description": "Execute a skill by name. Returns the skill body as result.",
    "parameters": {
      "type": "object",
      "properties": {
        "skill": {"type": "string", "description": "skill name from system listing"},
        "args": {"type": "string", "description": "optional arguments substituted into $ARGUMENTS"}
      },
      "required": ["skill"]
    }
  }
  ```

- 构造时接收 `dict[str, SkillSpec]`（closure 模式，由 loader 提供）
- 执行流程：
  1. 校验 `params["skill"]` 是否在 spec map（不在 → `ToolResult.error("skill not found: <name>")`）
  2. emit `skill.invoked` event（含 spec.name / source / args）
  3. 异步读 `spec.body_path`（`asyncio.to_thread`）
  4. 变量替换三选三：`$ARGUMENTS` → `args or ""`、`${KONGMING_SKILL_DIR}` → `spec.body_path.parent`、`${KONGMING_SESSION_ID}` → `ctx.session_id`
  5. **禁止 `!command` 替换**：检测到 `!command` 模式直接 raise `SkillSecurityError`（return error，不打断 runtime）
  6. emit `skill.completed` event
  7. return `ToolResult(content=substituted_body)`

- 注册到 `build_default_registry`：与现有 builtin 工具同样注册路径
- 单测：name 路由、变量替换 happy path、`!command` 拒绝、读盘失败、unknown skill name

**不包含范围**：

- inline body 推回 user message（v0.1.6 走 tool_result 通道）
- fork 子运行时（v0.2+）
- `allowed-tools` 真正改写运行时工具集（仅解析存好）
- 重读盘缓存（每次调用重读，简单优先；v0.2 视命中率再加 LRU）

**依赖**：

- 模块 A：拿 `dict[str, SkillSpec]`
- `core.contracts.Tool` / `core.contracts.ToolContext` / `core.contracts.ToolResult`（如已有）
- 现有 EventSink fan-out 链路

**风险与讨论点**：

- **body 太大**：单 SKILL.md 可能 10KB+，作为单条 tool_result 进 LLM 直接吃 ctx——v0.1.6 不做截断，由用户自律；event 里记录 `body_chars` 便于 trace 监控
- **变量替换递归**：`$ARGUMENTS` 内容可能含 `${...}`，不递归替换（一遍替换为准），避免注入
- **路径变量编码**：`${KONGMING_SKILL_DIR}` 直接 `str(Path)`，Windows 反斜杠不规范化——v0.1.6 unix-only 验证

**task 建议**：
- task 名：`skill-tool-v0.1.6`（与模块 C 合并）
- 进入 x-req：是
- 原因：tool 与 capability 在同一安全边界，CR 一起看更清晰

---

### 模块 C：safety 集成

**职责**：扩展 `safety/capability_policy.py` 与 permission rule，让 `Skill(...)` 调用走标准 capability → permission → approval 三层链。

**包含范围**：

- `src/safety/capability_policy.py`：新增 `skill` capability 常量；`SkillTool` 在 `_required_capability` 返回 `"skill"`
- `src/safety/permission_policy.py`：permission rule 解析支持 `Skill(<name>)` 与 `Skill(<prefix>:*)` 通配语法
  - 精确匹配：`Skill(commit)` 仅允许 name=`commit`
  - 通配前缀：`Skill(plugin:*)` 允许所有 `plugin:` 开头的 name（v0.1.6 没有 plugin 命名空间，但语法预留）
  - 全通配：`Skill(*)`
- 配置层：`config/setting.yaml` 的 `permissions` 段加示例（注释方式）
- `SafetyGatedApproval` 链不需要改：现有 capability → permission → approval 流程已支持新 capability

**不包含范围**：

- `disable-model-invocation` 字段消费（v0.2+，listing 阶段过滤）
- "safe properties allowlist" 自动允许（Claude Code 有，v0.1.6 不引入——所有 skill 走 permission rule）
- skill prefix 命名空间（plugin/MCP）的实际实现

**依赖**：

- 现有 capability / permission / approval 三层链
- `_required_capability` 只是 SkillTool 的属性，模块 B 顺带定义

**风险与讨论点**：

- **默认策略**：默认 `Skill(*)` allow 还是 deny？建议 **deny**（与现有 shell / write 工具一致），用户在 setting.yaml 里显式 allow——避免恶意 SKILL.md 通过 frontmatter 绕过审批（虽然 body 也只是文本不可执行）
- **interactive 模式提示文本**：approval prompt 应包含 skill name + body 大小，让用户判断是否放心读入对话

**task 建议**：
- 与模块 B 合并入 `skill-tool-v0.1.6` task
- 原因：capability 注册与 SkillTool 实现强耦合，分开 PR 容易割裂

---

### 模块 D：装配集成

**职责**：把模块 A 的 listing 接入 `assemble_instructions()` 公共函数；CLI / web 装配层在 build registry 时实例化 SkillTool 并注册。

**包含范围**：

- `src/context/instruction_loader.py` 的 `assemble_instructions()`（v0.1.5 web-runtime-factory 引入的公共函数）签名扩展：

  ```python
  async def assemble_instructions(
      *,
      kongming_home: Path,
      extra_files: Sequence[str | Path] = (),
      cwd: Path | None = None,
      skill_specs: Sequence[SkillSpec] = (),  # ← 新增
  ) -> tuple[str, list[str]]:
      ...
      if skill_specs:
          listing = format_skill_listing(skill_specs)
          if listing:
              sources.append(InstructionSource(origin="skills", content=listing))
      ...
  ```

- CLI 装配层 (`src/cli/main.py`):
  - 在 `_assemble_instructions` 前调 `load_skill_specs(home, cwd)` → `specs`
  - 把 `specs` 传给 `assemble_instructions(skill_specs=specs)`
  - 把 `dict(specs by name)` 传给 `build_default_registry(skill_specs=...)` 让 SkillTool 拿到

- Web 装配层 (`src/web/run.py` 的 `_make_runtime_factory`):
  - 在 closure 预计算阶段调 `load_skill_specs(home, cwd)`（每个 thread 共享同一份 specs）
  - 同样传给 `assemble_instructions` + `build_default_registry`

- `build_default_registry`：新增 `skill_specs: dict[str, SkillSpec] | None = None` 入参，非空时实例化 SkillTool 注册

**不包含范围**：

- 路径条件激活（v0.2+，需要每 turn 重生成 listing）
- listing 增量通知（v0.1.6 装配期一次锁定）
- skill 热重载（修改 SKILL.md 后 agent 不感知，需重启——v0.2 加 watcher）

**依赖**：

- 模块 A：`load_skill_specs` / `format_skill_listing` / `SkillSpec`
- 模块 B：SkillTool 类
- v0.1.5 web-runtime-factory 模块 1：`assemble_instructions` 公共函数（前置依赖）

**风险与讨论点**：

- **factory closure 缓存**：v0.1.5 web factory 的 instructions 是 closure 缓存的，本次扩展加了 `skill_specs` 入参后**缓存键不变**（specs 在 closure 创建时一次扫描永久持有），符合预期
- **CLI 与 web 双份扫描**：CLI 启动一次扫，web factory 创建时一次扫——独立流程独立扫描，不共享 cache
- **错误传播**：`load_skill_specs` 抛异常时，CLI 启动应明确失败（与 prompts 物化失败同策略）；web factory 创建时抛则导致整个进程启动失败——可接受

**task 建议**：
- task 名：`skill-assemble-v0.1.6`
- 进入 x-req：是（前置等 A、B、C 完成 + v0.1.5 模块 1 落地）
- 原因：装配是收尾环节，独立成 task 便于联调验证（手跑一遍 CLI 看 listing 是否进 system prompt）

---

## 模块依赖关系图

```
模块 A (skill-loader)
    │
    ├─→ 模块 B (skill-tool)  ←──→  模块 C (safety 集成)
    │       │
    │       ▼
    └─→ 模块 D (装配集成)
            │
            前置：v0.1.5 web-runtime-factory 模块 1
            （assemble_instructions 公共函数）
```

A 必须先于 B / D；B 与 C 紧耦合（同 task）；D 等 A、B、C 都完成后接入。

## 推荐开发顺序

1. **第一步**：模块 A — 独立可测，无其它依赖
2. **第二步**：模块 B + C — 同 task 联合开发
3. **第三步**：模块 D — 最后接入 CLI / web 装配链，端到端验证
