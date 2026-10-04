# Claude Code Skill 装配与 System Prompt 注入调研

> 生成时间：2026-04-26
> 调研范围：`other/claude-code-main/`
> 目的：为 kongming-agent 评估是否引入 skill 概念，以及如何避免 system prompt 膨胀

---

## 核心结论（一句话）

Claude Code **不是**"把 skill 全塞进 system prompt"，而是**渐进披露（Progressive Disclosure）**：

- Turn 0 system 里只有 `name + ≤250 字 description` 的列表，硬上限 = context window × 1%
- 完整 SKILL.md body 永远不在 turn 0 出现
- 模型决定使用时调 first-class **Skill 工具**，工具内部才从磁盘读完整 body
- 支持 inline（注入主对话）/ fork（子 agent 隔离）两种执行模式

---

## 1. Skill 存储形态

### 文件结构

每个 skill 是一个目录：`<skill-name>/SKILL.md`

`SKILL.md` 顶部是 YAML frontmatter，主体是 markdown body。

### Frontmatter 字段（解析见 `loadSkillsDir.ts:185-265`）

| 字段 | 用途 |
|---|---|
| `name` | skill 名称（默认取目录名） |
| `description` / `when-to-use` | 触发说明，进 system listing 用 |
| `allowed-tools` | 该 skill 调用时临时改写允许工具集 |
| `model` | 模型覆盖（`loadSkillsDir.ts:221-226`） |
| `effort` | 推理级别（`:228-230`） |
| `context: fork` | 在子 agent 中执行（`:260`） |
| `disable-model-invocation` | 禁用模型调用（仅 user 可触发，`:255`） |
| `user-invocable: false` | 隐藏，不进 listing（`:217-219`） |
| `paths` | 路径条件激活（gitignore 风格，`:771-796`） |
| `hooks` | Lifecycle hooks（`:136-153`） |

### 存放路径（多源 + 去重 + 优先级）

加载顺序（`loadSkillsDir.ts:638-803`，优先级递减）：

1. **Managed**：`/etc/claude-code/.claude/skills/`（组织级强制）
2. **User**：`~/.claude/skills/`
3. **Project**：`.claude/skills/`（向上遍历到 home）
4. **Additional**：`--add-dir` CLI 参数指定的路径
5. **Bundled**：编译进二进制的 skill（`bundledSkills.ts:106-108`）
6. **MCP**：MCP server 通过 `registerMCPSkillBuilders()` 注册（`loadSkillsDir.ts:1083-1086`）

去重通过 `realpath()` 解析符号链接后比对规范路径（`loadSkillsDir.ts:118-124`）。

### Body 中的模板替换（`loadSkillsDir.ts:349-369`）

| 占位符 | 含义 |
|---|---|
| `!command` | 执行 bash 注入输出 |
| `$ARGUMENTS` | 用户调用时传入的参数 |
| `${CLAUDE_SKILL_DIR}` | 当前 skill 目录路径 |
| `${CLAUDE_SESSION_ID}` | 会话 ID |

---

## 2. 加载流程（启动时全量扫描，非 lazy）

```
QueryEngine.ts:534-537
  getSlashCommandToolSkills(cwd)              ← 可调用 skill 过滤器
    └─ getSkillToolCommands()                 ← 全部 prompt 命令
        └─ getCommands()                      ← local + plugin + dynamic 融合
            └─ loadAllCommands()              ← 编排
                ├─ getSkillDirCommands()      ← /skills/ 目录扫描（memoized）
                ├─ getSkillDirCommands()      ← /commands/ 遗留目录
                ├─ getBundledSkills()         ← 编译进二进制
                └─ registerMCPSkillBuilders() ← MCP server 提供
```

关键点：**body 此时已读取并缓存到 Command 对象，但不会进 system prompt**。

### 路径条件激活（动态扩列表）

带 `paths` frontmatter 的 skill 不在 turn 0 暴露，而是在文件操作时动态激活：

- 加载阶段存入 `conditionalSkills` map（`loadSkillsDir.ts:771-796`）
- 文件编辑触发 `activateConditionalSkillsForPaths()`（`:997-1058`）
- 用 `ignore` 库做 gitignore 风格匹配（`:1012`）
- 通过 `onDynamicSkillsLoaded` signal 通知缓存清理（`:923-975`）

---

## 3. 进入 System Prompt 的方式（核心）

### Step 1：listing attachment 生成

位置：`src/utils/attachments.ts:875` 调用 `getSkillListingAttachments(context)`

实现：`attachments.ts:2680-2751`

流程：
1. 拿到全部可见 skill（`getSkillToolCommands(cwd)`，过滤 `user-invocable !== false` 等）
2. 调用 `formatCommandsWithinBudget(skills, tokenBudget)`
3. 输出 `attachment` 类型 = `skill_listing`

### Step 2：预算驱动截断（`SkillTool/prompt.ts:70-171`）

```
SKILL_BUDGET_CONTEXT_PERCENT = 0.01     // listing 总预算 = ctx × 1%
MAX_LISTING_DESC_CHARS = 250            // 单 desc 上限
bundled skill 描述 → 永不截断（信任锚）
其他 skill 描述 → 自动缩放以适应预算
```

### Step 2.5：listing 行格式（关键细节）

进 prompt 的**只有 3 个 frontmatter 字段**，拼成一行（`prompt.ts:43-50, 65`）：

```typescript
function getCommandDescription(cmd: Command): string {
  const desc = cmd.whenToUse
    ? `${cmd.description} - ${cmd.whenToUse}`
    : cmd.description
  return desc.length > MAX_LISTING_DESC_CHARS
    ? desc.slice(0, MAX_LISTING_DESC_CHARS - 1) + '…'
    : desc
}

// 每行格式：
return `- ${cmd.name}: ${getCommandDescription(cmd)}`
```

输出形如：

```
- <name>: <description>[ - <when-to-use>]
```

整行（含拼接后的 description + when-to-use）受 250 字硬上限截断，超出末尾追加 `…`。

#### Frontmatter 字段去向（明确分两类）

| 字段 | 进 prompt？ | 用途 |
|---|---|---|
| `name` | ✅ | listing 显示 |
| `description` | ✅ | listing 显示 |
| `when-to-use` | ✅（拼在 description 后用 ` - ` 连接，整体受 250 字截断） | listing 显示 |
| `allowed-tools` | ❌ | 调用时改写工具集 |
| `model` | ❌ | 调用时模型覆盖 |
| `effort` | ❌ | 调用时推理级别 |
| `context: fork` | ❌ | 决定 inline / fork 执行 |
| `disable-model-invocation` | ❌ | 过滤是否暴露 |
| `user-invocable` | ❌ | 过滤是否暴露 |
| `paths` | ❌ | 路径条件激活，决定何时进 listing |
| `hooks` | ❌ | lifecycle 回调 |
| **body（markdown 正文）** | ❌ | 调用 Skill 工具时才读 |

#### 设计意图

`prompt.ts:25-29` 原话注释：

> Per-entry hard cap. The listing is for discovery only — the Skill tool loads full content on invoke, so **verbose whenToUse strings waste turn-1 cache_creation tokens without improving match rate**.

listing 给模型"发现"用，不给它"理解"用——`when-to-use` 写太长不提高匹配率，反而浪费第一轮 cache creation token。其他 frontmatter 字段（`allowed-tools` / `model` / `paths` / `hooks` 等）是给 loader / runtime 消费的，不进 prompt；body 永远不进 prompt。

### Step 3：注入到 system message

`skill_listing` attachment 在 `mapAttachmentsToSystemMessage()` 转成 `<system-reminder>` 文本块：

```
<system-reminder>
Available skills for this conversation:
- commit: Create a git commit with a message
- review-pr: Review a pull request - reviewing code changes
- pdf: Extract and process PDF files
</system-reminder>
```

注入位置：system message 的**动态段**（不是固定段）。

### Step 4：会话级增量

`sentSkillNames` set（per-agent）追踪已发送的 skill name，仅通知增量（`attachments.ts:2700-2730`）：

- 跨 tool call 边界保留
- session resume 时抑制重复注入
- 新 plugin / 路径条件激活时只发 delta

---

## 4. Skill 工具（first-class tool）

### 工具签名（`SkillTool.ts:67, 291-298`）

```typescript
SKILL_TOOL_NAME = "Skill"
input  = { skill: string, args?: string }
```

### 调用流程（`SkillTool.ts:580-841`）

```
模型 → tool_call("Skill", {skill: "commit", args: "fix typo"})
  ↓
SkillTool.call()
  ├─ permission 检查（deny/allow rules，前缀通配 review:*）
  ├─ processPromptSlashCommand(skillName, args)
  │   └─ 此时才读磁盘完整 SKILL.md
  ├─ frontmatter 替换 + $ARGUMENTS 注入 + !command 执行 + ${VAR} 替换
  └─ 按 context 字段决定执行模式：
      ├─ inline（默认，~99% 用例）
      │   ├─ 完整 body 作为 new user message 推入主对话
      │   ├─ contextModifier 更新 allowed-tools / model override
      │   └─ sourceToolUseID 标记（用于 transient message 跟踪）
      └─ fork（context: fork）
          ├─ executeForkedSkill() 起独立子 agent
          ├─ 隔离 allowed-tools，跑完返回结果
          └─ 不污染主对话的 context
  └─ addInvokedSkill() 写入 compaction state（保证压缩后保留"激活过 X"语义）
```

### 权限机制（`SkillTool.ts:451-537`）

- 支持 `Skill(skill_name)` / `Skill(prefix:*)` 规则
- "safe properties allowlist"：纯 metadata 的 skill 自动允许
- 黑名单：permission rules `Skill(skillname:*)` deny
- `disable-model-invocation: true` → 模型完全不能调用（仅 user 通过 slash 触发）

---

## 5. 筛选与命名空间

| 维度 | 实现 |
|---|---|
| 可见性过滤 | `loadedFrom in {skills, plugin, bundled}` 或显式 description（`commands.ts:586-608`） |
| Plugin 命名空间 | `plugin:skill-name` 由 plugin system 自动加前缀（`SkillTool.ts:185`） |
| MCP skill | 同 plugin 模式注册（`mcpSkillBuilders.ts`） |
| 用户禁用 | `user-invocable: false` / `disable-model-invocation: true` |
| 黑/白名单 | permission rules `Skill(...)` |
| `allowed-tools` | skill 触发时临时改写工具集（隔离副作用） |

---

## 6. 与 Compaction 的联动

`SkillTool.ts:765` 的 `addInvokedSkill()` 把激活记录写入 compaction state。

压缩后通过 `getInvokedSkillsAttachment()` 重新注入"激活过 X / Y / Z skill"的元信息，避免压缩丢失 skill 激活语义。

这与之前调研的"压缩后 top-5 文件 attachment 重注入"是同一个思路：**压缩 = 改写历史，但工具/skill/文件激活态必须显式延续**。

---

## 7. 关键文件清单

| 文件 | 行号 | 用途 |
|------|------|------|
| `src/tools/SkillTool/SkillTool.ts` | 67 | `SKILL_TOOL_NAME` 常量 |
| `src/tools/SkillTool/SkillTool.ts` | 291-298 | Input/Output schema |
| `src/tools/SkillTool/SkillTool.ts` | 451-537 | 权限检查 |
| `src/tools/SkillTool/SkillTool.ts` | 580-841 | inline vs forked 执行 |
| `src/tools/SkillTool/SkillTool.ts` | 765 | `addInvokedSkill()` |
| `src/tools/SkillTool/prompt.ts` | 70-171 | **`formatCommandsWithinBudget` 预算截断** |
| `src/tools/SkillTool/prompt.ts` | 173-196 | 模型看到的 Skill 工具说明文本 |
| `src/tools/SkillTool/loadSkillsDir.ts` | 185-265 | Frontmatter 解析 |
| `src/tools/SkillTool/loadSkillsDir.ts` | 638-803 | 加载主流程（多源 + 去重 + 优先级） |
| `src/tools/SkillTool/loadSkillsDir.ts` | 771-796 | 路径条件激活注册 |
| `src/tools/SkillTool/loadSkillsDir.ts` | 997-1058 | `activateConditionalSkillsForPaths()` |
| `src/tools/SkillTool/bundledSkills.ts` | 53-108 | Bundled skill 注册 |
| `src/utils/attachments.ts` | 875 | attachment 流水线挂入点 |
| `src/utils/attachments.ts` | 2680-2751 | **`getSkillListingAttachments`** |
| `src/QueryEngine.ts` | 534-551 | systemInit 透 skill 列表给客户端 |
| `src/utils/commands.ts` | 430-608 | 加载编排 + 过滤 |

---

## 8. 对 kongming-agent 的 5 条启示

### 8.1 渐进披露：别把 body 全塞进 system prompt

kongming 当前 `prompts/AGENT.md / TOOLS.md / USER.md` 三段是**固定全文**拼接（`src/prompts/`）。

引入 skill 概念时，**只能塞 name + ≤250 字 desc 列表**，body 永远延迟到工具调用。否则只要装 50+ skill，system prompt 直接超 ctx window 一半。

### 8.2 listing 必须设 token 预算

参考 `SKILL_BUDGET_CONTEXT_PERCENT = 0.01`（context window × 1%）：

- 32K window → listing 上限 320 tokens
- 200K window → listing 上限 2000 tokens

bundled skill 永不截断作为"信任锚"——这是设计层面的好品味，避免用户加 plugin 把官方 skill 挤掉。

### 8.3 暴露成 first-class 工具

不要新增独立协议（`SkillProvider` 之类）。直接在 `ToolRegistry` 注册一个 `Skill` 工具，schema 极简：

```python
{
    "skill": str,                      # required
    "args": str | None,                # optional
}
```

工具实现内部读 body、做替换、改写 allowed-tools。**与现有 `core.contracts.Tool` 协议天然契合**，不需要碰核心。

### 8.4 支持 inline / fork 两种执行

- **inline**：body 作为 new user message 注入主对话，临时 contextModifier 改 allowed-tools。简单场景用。
- **fork**：起子 agent 跑（隔离工具集 + model 覆盖），结果回传。**跟 kongming 的 `SessionEngine.build()` 装配模式天然契合** —— 起一个临时 SessionEngine 跑完销毁即可。

复杂 / 高风险 skill 强制走 fork，避免污染主对话。

### 8.5 进 compaction state

之前调研 Claude Code 压缩时已经看到 `preCompactDiscoveredTools` / 后压缩文件 attachment 重注入，这里 `addInvokedSkill()` 是同一思路的另一面。

kongming 的 `HistoryCompactor` 升级到 v0.2 LLM 摘要时，**必须保留"激活过哪些 skill"的元信息**，否则压缩后模型不知道之前为什么走了某个工作流。

---

## 9. 后续推进项

1. **PoC**：在 `src/tools/` 加 `skill_tool.py`，先支持 inline 模式 + bundled skill（编译进二进制），不做磁盘扫描
2. **加载器**：参考 `loadSkillsDir.ts` 写 `src/tools/skills/loader.py`，多源 + 去重 + 优先级
3. **listing 注入**：在 `src/context/input_assembler.py` 加 skill_listing attachment 通道，预算 = ctx × 1%
4. **路径条件激活**：v0.2+，跟文件操作 / EventSink 联动
5. **fork 执行**：v0.2+，复用 SessionEngine 起子运行时

落地优先级：1 → 2 → 3 是 v0.2 必做；4 / 5 是 v0.3+ 增强。

---

> 调研由 Explore agent 完成，原始引用全部保留。
