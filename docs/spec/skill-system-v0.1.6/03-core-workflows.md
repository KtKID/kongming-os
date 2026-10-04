# 核心流程

## 流程 1：启动期 skill 加载与 listing 注入

CLI 与 web 装配链共享同一套 loader 调用，仅扫描时机不同。

```
CLI 启动 / Web factory closure 预计算
  │
  ├─ specs = await load_skill_specs(home=kongming_home, workspace=cwd)
  │     │
  │     ├─ scan_dir(home / "skills")
  │     │     遍历每个 <name>/SKILL.md
  │     │     ├─ read_frontmatter(path)            ← 不读 body
  │     │     ├─ build SkillSpec(name, description, when_to_use,
  │     │     │     allowed_tools, paths, body_path, source="home")
  │     │     └─ append to home_specs
  │     │
  │     ├─ scan_dir(workspace / ".kongming/skills")
  │     │     ├─ 同样建 SkillSpec(source="workspace")
  │     │     └─ append to workspace_specs
  │     │
  │     ├─ 去重 + shadowed 标记
  │     │     for spec in workspace_specs:
  │     │         if name in home_map:
  │     │             emit("skill.shadowed", home_spec)
  │     │             home_map[name] = spec  ← workspace 覆盖 home
  │     │
  │     └─ return list(merged.values())
  │
  ├─ listing = format_skill_listing(specs)
  │     │
  │     └─ 对每个 spec：
  │           desc = spec.description
  │           if spec.when_to_use:
  │               desc = f"{desc} - {spec.when_to_use}"
  │           if len(desc) > 250:
  │               desc = desc[:249] + "…"
  │           lines.append(f"- {spec.name}: {desc}")
  │       return "\n".join(lines)
  │
  ├─ system_text = await assemble_instructions(
  │       kongming_home=home,
  │       extra_files=files,
  │       cwd=cwd,
  │       skill_specs=specs,         ← 新挂入参
  │   )
  │     内部新增：
  │     if skill_specs:
  │         sources.append(InstructionSource(origin="skills", content=listing))
  │
  ├─ spec_map = {s.name: s for s in specs}
  │
  ├─ registry = build_default_registry(
  │       ...,
  │       skill_specs=spec_map,      ← 新入参
  │   )
  │     内部新增：
  │     if skill_specs:
  │         registry.register(SkillTool(specs=skill_specs))
  │
  └─ runtime = SessionEngine.build(cfg, ...)  # 后续与现有流程一致
```

**关键点**：

- 加载是 **async**，I/O 走 `asyncio.to_thread`（与 `instruction_loader` / `prompts_loader` 一致）
- frontmatter 解析阶段**不读 body**——读盘点延迟到 SkillTool 调用
- listing 渲染按 `name + ": " + (description[ + " - " + when-to-use])`，整行 250 字硬上限截断（与调研文档对齐）
- listing 作为 `InstructionSource(origin="skills")` 一条 source，与 `agent_spec` / `file:*` / `env:*` / `memory` 同等地位

## 流程 2：运行期模型调用 skill

```
LLM 看到 system prompt 中的 listing：
  # skills
  - commit: Create a git commit - when wrapping up changes
  - review-pr: Review a pull request
  - pdf-extract: Extract text from PDF
  ...

LLM 决定使用某 skill →  生成 tool_call:
  {
    "name": "skill",
    "input": {"skill": "commit", "args": "fix typo"}
  }
                ↓
Runner.run() → 取出 tool_call → SafetyGatedApproval.decide()
  ├─ capability check
  │     SkillTool._required_capability = "skill"
  │     → CapabilityPolicy.allows("skill", ctx)?  无封禁则 True
  │
  ├─ permission check
  │     PermissionPolicy.evaluate("Skill(commit)", rules)
  │     ├─ exact match: "Skill(commit)" → ALLOW
  │     ├─ prefix match: "Skill(plugin:*)" + name="plugin:foo" → ALLOW
  │     └─ default deny
  │
  ├─ approval check (mode-dependent)
  │     - auto: skip
  │     - interactive: prompt_fn("使用 skill commit (body ~3KB)？") → bool
  │     - dry-run: deny
  │
  └─ 通过 → SkillTool.execute(params, ctx)
                ↓
SkillTool.execute()
  ├─ spec = self._specs.get("commit")
  │     unknown → return ToolResult.error("skill not found: commit")
  │
  ├─ emit "skill.invoked" event
  │     {name, source, body_path, args, body_chars: 0}
  │
  ├─ raw_body = await asyncio.to_thread(spec.body_path.read_text, encoding="utf-8")
  │     OSError → emit "skill.failed" + return ToolResult.error(...)
  │
  ├─ 安全扫描：if "!command" pattern in body → return ToolResult.error("!command disabled")
  │     （注：此处仅扫描"用户给变量替换的语义占位符"，不阻止 markdown 内自然出现的 ! 符号；
  │      v0.1.6 用严格的全字匹配 `!command` 字面 token，规则在 04-data-and-state.md 详述）
  │
  ├─ substituted = substitute_vars(raw_body, {
  │       "$ARGUMENTS": params.get("args", ""),
  │       "${KONGMING_SKILL_DIR}": str(spec.body_path.parent),
  │       "${KONGMING_SESSION_ID}": ctx.session_id,
  │   })
  │     注：单次替换，不递归；未识别变量保留原样
  │
  ├─ emit "skill.completed" event
  │     {name, body_chars: len(substituted), elapsed_ms}
  │
  └─ return ToolResult(content=substituted)
                ↓
Runner: session.append(ToolResultMessage(content=substituted))
LLM 下一轮看到 tool_result → 按 body 内容继续推进对话
```

**关键点**：

- body **永远走 tool_result 通道**——不直接 `session.append(UserMessage(...))`
- capability / permission / approval 三层都过，与 `Shell` / `WriteFile` 同等待遇
- 失败 case 全部 emit 事件，trace 完整可观测
- 变量替换**单次扫描，不递归**——避免 `$ARGUMENTS` 内嵌 `${VAR}` 注入

## 流程 3：错误处理与降级

| 错误位置 | 错误类型 | 处理策略 |
|----------|---------|----------|
| 扫描目录不存在 | `FileNotFoundError` | 静默跳过，返回空列表（与缺文件策略一致） |
| 目录权限错误 | `PermissionError` | **冒泡**——CLI 启动失败比静默 degrade 更安全 |
| frontmatter YAML 解析失败 | `yaml.YAMLError` | 跳过该 skill + emit `skill.parse_failed`，不阻断其它 skill |
| frontmatter 缺 `name` 字段 | logical | 同上，跳过 + warning event |
| body 文件不存在（spec 加载后被删） | `FileNotFoundError` | 返回 `ToolResult.error("skill body missing")` |
| body 非 UTF-8 编码 | `UnicodeDecodeError` | 同上，return error；不冒泡（与 instruction_loader 不同——instruction_loader 是装配期，必须强制错；SkillTool 是运行时，不应打断 turn） |
| body 含 `!command` 模式 | logical | return `ToolResult.error("!command substitution is disabled")` |
| 符号链接逃出 skill 目录 | path resolution | `realpath` 比对 → 拒绝 + emit `skill.skipped` |
| capability/permission 拒绝 | safety | 走现有 `SafetyGatedApproval.decide()` 返回 deny；不进入 `SkillTool.execute()` |

## 流程 4：与 v0.1.5 web 多 thread 的协同

v0.1.5 web factory 是多 thread 共享同一份 `_FactoryState`（closure 状态）。skill_specs 加入后：

```
_make_runtime_factory(cfg)
  │
  ├─ closure 预计算（sync 入口 + 一次性 async 加载）：
  │   ├─ preset_map = {p.id: p for p in cfg.web.llm_presets}
  │   ├─ skill_specs = await load_skill_specs(home, workspace)   ← 一次扫描
  │   ├─ skill_spec_map = {s.name: s for s in skill_specs}
  │   ├─ registry_template = build_default_registry(..., skill_specs=skill_spec_map)
  │   └─ instructions_cache = None  # 仍懒加载
  │
  └─ factory(thread_id, preset_id, adapter, sinks):
        ├─ instructions = await _ensure_instructions()
        │     首次调用：
        │     await assemble_instructions(
        │         kongming_home=...,
        │         skill_specs=skill_specs,     ← 复用 closure 中的同一份
        │     )
        ├─ runtime = SessionEngine.build(
        │     ...,
        │     tools=registry_template,         ← 所有 thread 共享同一 registry
        │     instructions=instructions,
        │   )
        └─ return (runtime, bridge)
```

**关键点**：

- 多 thread 共享同一份 `skill_specs`（不可变 frozen dataclass，无并发风险）
- 同一份 SkillTool 实例被多 thread 共享——SkillTool 自身**无状态**（每次 execute 重新读 body，不缓存），多 thread 安全
- skill 修改后需重启 server（v0.1.6 不支持热重载，与 v0.1.5 instructions 一致）

## 流程 5：trace 事件清单

新增 5 个 event kind（沿用现有 EventSink 通道，不开新协议）：

| 事件 | 何时 emit | 含义 |
|------|-----------|------|
| `skill.discovered` | 加载阶段每解析一个 spec | 含 name / source / body_path |
| `skill.shadowed` | workspace 覆盖 home 时 | 含被覆盖的 home spec |
| `skill.parse_failed` | frontmatter 解析失败 | 含 path / error |
| `skill.invoked` | SkillTool.execute 入口 | 含 name / args |
| `skill.completed` | SkillTool.execute 出口（成功） | 含 name / body_chars / elapsed_ms |
| `skill.failed` | SkillTool.execute 出口（失败） | 含 name / error_kind |

事件经现有 `JsonlTraceSink` 落盘到 `<home>/trace/*.jsonl`，无需新增观测组件。
