# 数据与状态

## 1. SkillSpec 数据结构

```python
# src/context/skill_loader.py
from dataclasses import dataclass
from pathlib import Path
from typing import Literal


@dataclass(frozen=True)
class SkillSpec:
    """A single skill discovered on disk.

    `body_path` 指向 SKILL.md 文件，加载阶段不读，调用阶段才读。
    """
    name: str                                 # frontmatter.name (必需)
    description: str                          # frontmatter.description (必需)
    when_to_use: str | None                   # frontmatter.when-to-use (可选)
    allowed_tools: list[str] | None           # frontmatter.allowed-tools (v0.1.6 仅解析，不消费)
    paths: list[str] | None                   # frontmatter.paths (v0.1.6 仅解析，不消费)
    body_path: Path                           # absolute path to SKILL.md
    source: Literal["home", "workspace"]      # 来源标识
```

**约束**：

- `frozen=True`：多 thread 共享安全
- 所有可选字段缺失 → `None`，不抛异常
- `allowed_tools` / `paths` 是 v0.1.6 解析存好但运行时不消费，**目的是让 SKILL.md 编写者已经按目标语义写**，v0.2 接入时不破坏向后兼容
- `source` 用于 trace 事件标注与 shadowing 判定

## 2. 文件结构

```
<home>/skills/                        ← 用户级（与 ~/.kongming 同根）
  ├── commit/
  │   └── SKILL.md                    ← frontmatter + body
  ├── review-pr/
  │   ├── SKILL.md
  │   └── checklist.md                ← 资源文件（v0.1.6 不读，v0.2 ${KONGMING_SKILL_DIR} 引用）
  └── pdf-extract/
      └── SKILL.md

<cwd>/.kongming/skills/                ← 工作空间级（项目根的 .kongming/）
  └── proj-specific-skill/
      └── SKILL.md
```

## 3. SKILL.md 文件格式

```markdown
---
name: commit
description: Create a git commit with a structured message
when-to-use: After completing a logical chunk of work
allowed-tools:
  - shell
  - read_file
paths:
  - "**/*.py"
  - "src/**/*.ts"
---

# Commit Skill

Create a commit using the following template:

1. Run `git status` to see changes
2. Run `git diff` to review
3. Compose a message following the conventional commits format
4. Use `${KONGMING_SKILL_DIR}/templates/commit-template.md` as reference
5. Args provided: $ARGUMENTS

Session: ${KONGMING_SESSION_ID}
```

**Frontmatter 字段二分**：

### 进 system prompt（listing）

| 字段 | 必填 | 类型 | 用途 |
|------|------|------|------|
| `name` | ✅ | string | listing 第一栏 + tool 调用键 |
| `description` | ✅ | string | listing 第二栏 |
| `when-to-use` | ❌ | string | 拼在 description 后用 ` - ` 连接，整体受 250 字截断 |

### 进 SkillSpec runtime（不进 prompt，v0.1.6 不消费）

| 字段 | 类型 | 未来用途 |
|------|------|---------|
| `allowed-tools` | list[string] | v0.2 临时改写允许工具集 |
| `paths` | list[string] (gitignore syntax) | v0.2 路径条件激活 |

### 完全不支持（v0.1.6 直接忽略）

`model` / `effort` / `context` / `disable-model-invocation` / `user-invocable` / `hooks`——出现在 frontmatter 中视作字段静默忽略，不抛异常（前向兼容 Claude Code 同名 SKILL.md，但不实现其语义）。

## 4. listing 输出形态

`format_skill_listing(specs)` 输出形如：

```
- commit: Create a git commit with a structured message - After completing a logical chunk of work
- review-pr: Review a pull request
- pdf-extract: Extract text from PDF
```

注入到 system prompt 后由 `InstructionLoader.render` 加 origin 头：

```
# skills
- commit: Create a git commit with a structured message - After completing a logical chunk of work
- review-pr: Review a pull request
- pdf-extract: Extract text from PDF
```

**截断规则**（与 Claude Code `prompt.ts:43-50, 65` 对齐）：

```python
def _format_one(spec: SkillSpec) -> str:
    desc = spec.description
    if spec.when_to_use:
        desc = f"{desc} - {spec.when_to_use}"
    if len(desc) > 250:
        desc = desc[:249] + "…"  # 注意：含 … 后整体 250 字
    return f"- {spec.name}: {desc}"
```

`name` 字段不参与 250 字预算，因为模型必须看到完整 name 才能 tool_call——name 长度由用户自律（通常 < 30 字）。

## 5. Skill 工具 Schema

```python
# src/tools/builtin/skill_tool.py

SKILL_TOOL_SCHEMA = {
    "name": "skill",
    "description": (
        "Execute a skill by name. The skill body is read on demand and "
        "returned as the tool result. Available skills are listed in the "
        "system prompt under # skills."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "skill": {
                "type": "string",
                "description": "Skill name as shown in the system listing.",
            },
            "args": {
                "type": "string",
                "description": "Optional arguments substituted into $ARGUMENTS within the skill body.",
            },
        },
        "required": ["skill"],
    },
}
```

## 6. 变量替换规则

**支持的三个变量**：

| 占位符 | 替换值 | 备注 |
|--------|--------|------|
| `$ARGUMENTS` | `params.get("args") or ""` | 模型传入的 args，缺失替换为空字符串 |
| `${KONGMING_SKILL_DIR}` | `str(spec.body_path.parent)` | skill 所在目录绝对路径，用于引用同目录资源 |
| `${KONGMING_SESSION_ID}` | `ctx.session_id` | 当前 session ID |

**实现**：

```python
def substitute_vars(body: str, *, args: str, skill_dir: Path, session_id: str) -> str:
    """单次扫描替换；不递归。"""
    return (
        body
        .replace("$ARGUMENTS", args)
        .replace("${KONGMING_SKILL_DIR}", str(skill_dir))
        .replace("${KONGMING_SESSION_ID}", session_id)
    )
```

**禁用规则**：

```python
# v0.1.6 永久禁用 !command 替换
_FORBIDDEN_TOKENS = ("!command",)  # 字面 token

def assert_no_command_substitution(body: str) -> None:
    for token in _FORBIDDEN_TOKENS:
        if token in body:
            raise SkillSecurityError(
                f"!command substitution is disabled in v0.1.6 (skill body contains {token!r})"
            )
```

**说明**：
- 用字面 token 全字匹配，**不**用正则——避免 markdown body 中自然出现的 `!` 标点被误伤
- Claude Code 的 `!command` 语义是"执行 bash 命令并把 stdout 注入 body"，本质是 RCE 通道，与 kongming `Shell` 工具的 capability/permission 链路冲突，永久不接

## 7. Capability 与 Permission 配置

### capability_policy.py 扩展

```python
# src/safety/capability_policy.py
SKILL_CAPABILITY = "skill"

# CapabilityPolicy 自动允许（无封禁规则）
# 用户在 cfg.safety.disabled_capabilities 显式禁用即可全局关掉
```

### permission rule 语法

`config/setting.yaml`：

```yaml
permissions:
  rules:
    - "Skill(commit)"           # 精确允许 name="commit"
    - "Skill(review-pr)"
    - "Skill(plugin:*)"         # 通配前缀（v0.1.6 没有 plugin 概念，语法预留）
    # - "Skill(*)"              # 全允许（不推荐，调试用）
  default: deny
```

**默认策略**：`default: deny`——未显式 allow 的 skill 调用一律拒绝。与现有 `Shell` / `WriteFile` 一致。

### approval prompt 文本（interactive 模式）

```
Use skill 'commit'?
  Source: workspace (.kongming/skills/commit/SKILL.md)
  Body size: 3,142 chars
  Args: "fix typo"
  [y/n]
```

## 8. 多 thread / 多 session 状态共享

| 状态 | 范围 | 并发风险 |
|------|------|---------|
| `list[SkillSpec]` | factory closure 单例（多 thread 共享） | 无（frozen dataclass） |
| `dict[str, SkillSpec]` | SkillTool 内部（多 thread 共享） | 无（read-only） |
| body 文件读取 | 每次 tool_call 独立 I/O | 无（无写） |
| `instructions_cache` | factory closure 缓存 | 已有 asyncio.Lock 保护（v0.1.5 设计） |

**没有可变共享状态** → 不需要新增锁。

## 9. 与现有 InstructionSource 体系的关系

新增 origin 标识：

| origin | 来源 |
|--------|------|
| `runtime` | 时间 / cwd / kongming_home |
| `agent_spec` | prompts/AGENT.md + TOOLS.md + USER.md |
| `file:<name>` | --instructions 指定的文件 |
| `env:KONGMING_EXTRA_INSTRUCTIONS` | 环境变量 |
| `memory` | MemoryStore.load_from_disk() snapshot（CLI 专属） |
| **`skills`** | **新增：listing 文本** |

最终 system prompt 形如：

```
# runtime
当前时间: 2026-04-27T10:00:00+08:00
当前工作目录: /home/user/project
...

# agent_spec
[AGENT.md + TOOLS.md + USER.md 拼接]

# file:rules.md
[--instructions 文件内容]

# memory
[memory snapshot]

# skills
- commit: ...
- review-pr: ...
```

origin 顺序：`runtime` → `agent_spec` → `file:*` → `env:*` → `memory` → `skills`。skills 放最后，与 memory 同属"动态注入"段。
