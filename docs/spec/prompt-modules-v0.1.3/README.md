# System Prompt 模块化（v0.1.3）

> 状态：需求分析完成
> 当前阶段：需求分析 → 开发计划 → 开发执行 → 测试 → 关闭
> 需求来源：用户对话讨论（2026-04-24）
> 分析时间：2026-04-24
> 归属版本：v0.1.3（与 self-evolution / memory 同一节奏）

## 相关文档

- [docs/modules/命令行/README.md](../modules/命令行/README.md) — 当前 instructions 装配链（需被本方案修订"四通道"说明）
- [docs/modules/配置加载/README.md](../modules/配置加载/README.md) — 新增 `paths.py::get_kongming_home` 后需补条目
- [docs/self-evolution-v0.1.3/README.md](../self-evolution-v0.1.3/README.md) — 同版本 memory 冻结快照方案（.kongming/memory/ 目录先行者）
- [src/cli/main.py](../../src/cli/main.py) — `_DEFAULT_AGENT_INSTRUCTIONS` 常量的当前位置（本方案会将其移除）

## 核心目标

把 `cli/main.py:_DEFAULT_AGENT_INSTRUCTIONS` 硬编码字符串拆成三段独立 section，分别以 md 文件形式作为模板内置在项目代码里，启动时自动物化到用户工作目录 `.kongming/prompts/` 下，用户可编辑覆盖。装配阶段只从 `.kongming/prompts/` 读取、裸拼合成最终 system prompt 片段。

同时补一个统一的 `.kongming/` 根目录入口函数 `get_kongming_home()`，本次只在 prompts 装配里使用。

## 范围

**包含**：
- 新增 `get_kongming_home() -> Path` 函数（统一 .kongming 根目录入口，支持 env `KONGMING_HOME` 覆盖）
- 删除 `_DEFAULT_AGENT_INSTRUCTIONS` 常量
- 新增三份模板文件（随代码发布）：`src/prompts/templates/{AGENT,TOOLS,USER}.md`
- 新增 prompts 装配器：启动时模板物化（缺失才复制）+ 读取 + 剔除 HTML 注释 + 裸拼
- `cli/main.py:_assemble_instructions` 接入新装配器
- unit 测试覆盖物化、覆盖、HTML 注释剔除、空白判定等分支
- 模块文档 + CLAUDE.md 同步更新

**不包含**：
- 不重构 memory / trace / sessions 等现存模块的 `.kongming/xxx` 路径拼接（另立 task）
- 不引入 Config YAML 字段（不加 prompts.enabled 之类开关；跟随文件存在性决定）
- 不引入模板变量 / frontmatter / 模块间引用
- 不改 `AgentSpec.instructions` 字段结构（保持单一字符串）
- 不动对话 history
- `--instructions-file` / `KONGMING_EXTRA_INSTRUCTIONS` / memory snapshot 现有通道**不变**，仍在三段之后追加

## 设计要点

### 模板 → 物化 → 加载

```
代码仓库：    src/prompts/templates/{AGENT,TOOLS,USER}.md
                │
                ▼ 启动时（目标缺失才复制，存在不覆盖）
用户目录：    .kongming/prompts/{AGENT,TOOLS,USER}.md
                │
                ▼ 装配时读取 + 剔除 HTML 注释 + strip
最终 system prompt 片段（AGENT + TOOLS + USER 裸拼，\n\n 分隔）
```

### 模板内容

**AGENT.md**（默认内容）：
```markdown
你是 kongming-agent。
```

**TOOLS.md**（默认内容 = 当前硬编码里"## 长期记忆..."原文）：
```markdown
## 长期记忆

当你学习到值得跨会话保留的信息（用户偏好、项目事实、错误修复经验、环境细节）时，
使用 `memory` 工具的 target=memory/user/errors 参数进行维护。
不要用 write_file 或 shell 手动创建 MEMORY.md 等文件——
agent 框架不会识别这些手写文件，也不会进下一次 prompt。
```

**USER.md**（默认内容 = 纯 HTML 注释引导 + 测试示例 + 删除说明）：
```markdown
<!--
这是 USER.md 模板文件。

在本注释下方填写你希望 kongming-agent 了解的个人偏好、项目背景、工作约束。
填写完成后，请删除本注释和下方的测试内容。

本注释块不会被装配进 system prompt（装配器会剔除 HTML 注释）。
-->

<!-- 下方为测试内容，请替换为真实用户说明或删除整行 -->
测试占位：此内容仅验证 USER.md 装配链，请填入真实内容后删除。
```

### 装配器行为

启动时（`_assemble_instructions` 内部）：

```
prompts_dir = get_kongming_home() / "prompts"
prompts_dir.mkdir(parents=True, exist_ok=True)

for name in ["AGENT.md", "TOOLS.md", "USER.md"]:
    target = prompts_dir / name
    if not target.exists():
        shutil.copy(src/prompts/templates/<name>, target)
        emit Event(kind="prompts.materialized", payload={"name": name, ...})

agent = read(prompts_dir / "AGENT.md") |> strip_html_comments |> strip
tools = read(prompts_dir / "TOOLS.md") |> strip_html_comments |> strip
user  = read(prompts_dir / "USER.md")  |> strip_html_comments |> strip

sections = [s for s in (agent, tools, user) if s]
result = "\n\n".join(sections)
```

`strip_html_comments` 用正则 `<!--[\s\S]*?-->` 剔除（贪婪跨行，非贪婪匹配）。

### Fallback 语义

启动时物化保证了三文件一定存在——装配阶段**不需要** fallback 分支。但为防御异常（例如用户手动删除了文件并把 prompts 设为只读），装配器读失败时 emit `prompts.read_failed` 事件，对应 section 视为空。

## 功能模块拆分

### 模块 1：`get_kongming_home()` 路径函数

**职责**：统一 `.kongming/` 根目录入口
**功能范围**：
- 新增 `src/config_loader/paths.py`，导出 `get_kongming_home() -> Path`
- 优先级：env `KONGMING_HOME`（绝对或相对，`~` 展开） → `Path.cwd() / ".kongming"`
- 不创建目录，只返回 Path 对象
- 返回的路径 `.resolve()` 成绝对路径

**依赖**：无
**价值**：为本次 prompts 装配提供统一路径入口；未来其他模块可渐进切换
**优先级**：P0

---

### 模块 2：模板文件内置

**职责**：把硬编码字符串迁移到文件形式
**功能范围**：
- 新增 `src/prompts/__init__.py`（空）
- 新增三份模板：
  - `src/prompts/templates/AGENT.md`
  - `src/prompts/templates/TOOLS.md`
  - `src/prompts/templates/USER.md`
- 删除 `cli/main.py:_DEFAULT_AGENT_INSTRUCTIONS` 常量
- `pyproject.toml` 或 `MANIFEST.in` 确保 `.md` 模板被打包（如果适用；uv 的 hatchling 默认包含）

**依赖**：无
**价值**：硬编码内容变成可 diff、可编辑、可 git track 的文本资源
**优先级**：P0

---

### 模块 3：Prompts 装配器

**职责**：启动时物化 + 加载 + 拼接
**功能范围**：
- 新增 `src/context/prompts_loader.py`（放在 `context/` 下，与 `instruction_loader.py` 同层）
- 导出 `async materialize_and_load_prompts(home: Path) -> str`
- 实现步骤：
  1. `(home / "prompts").mkdir(parents=True, exist_ok=True)`
  2. 对每个模板：目标不存在 → `shutil.copy` 复制，存在 → 跳过
  3. 每个文件：读 → 剔除 HTML 注释 → `strip()`
  4. 过滤空段 → `"\n\n".join(...)` 返回
- 文件 I/O 用 `asyncio.to_thread`
- `OSError` 静默降级；`UnicodeDecodeError` 冒泡

**辅助**：
- `_strip_html_comments(text: str) -> str` — 用正则 `re.sub(r"<!--[\s\S]*?-->", "", text)`
- 模板源路径通过 `importlib.resources.files("prompts") / "templates" / name` 定位（兼容打包后 wheel / 源码两种部署）

**依赖**：模块 1（路径）+ 模块 2（模板文件）
**价值**：核心需求落地
**优先级**：P0

---

### 模块 4：CLI 装配链接入

**职责**：把装配器接到 `SessionEngine.build(instructions=...)` 入口
**功能范围**：
- `cli/main.py:_assemble_instructions` 改写：
  - 开头调用 `base_prompt = await materialize_and_load_prompts(get_kongming_home())`
  - 把 `base_prompt` 作为 `InstructionLoader.load(agent_instructions=base_prompt)` 的首来源（替代原 `_DEFAULT_AGENT_INSTRUCTIONS`）
  - `--instructions-file` / env / memory snapshot 后续追加逻辑**不变**
- 保留原有 `instruction_origins` 收集路径

**依赖**：模块 3
**价值**：让新机制真正生效
**优先级**：P0

---

### 模块 5：测试覆盖

**职责**：unit 层保证物化 / 覆盖 / 空白 / 注释剔除分支正确
**功能范围**：
- `tests/unit/test_paths.py` —
  - 默认 cwd 下返回
  - env `KONGMING_HOME` 绝对路径覆盖
  - env `KONGMING_HOME` 相对路径覆盖（相对 cwd）
  - env `KONGMING_HOME` 含 `~` 展开
  - 不触发目录创建
- `tests/unit/test_prompts_loader.py`（用 `tmp_path` 作 home）—
  - 首次启动：prompts 目录不存在 → 物化后三文件存在且内容 = 模板
  - 第二次启动：用户改过 AGENT.md → 不被覆盖
  - 三文件都存在且非空 → 全部拼入
  - AGENT.md 存在但只含 HTML 注释 → strip 后空，不拼入（防御）
  - USER.md 模板未改（只含 HTML 注释 + 测试内容）→ 剔除注释后仍有"测试占位"文本，会被拼入 —— **这是预期行为**，用户看到 prompt 里有测试内容才知道该去删；注释剔除本身正确
  - USER.md 被用户清空 → 不拼入
  - USER.md 用户只删除注释保留"测试占位"文字 → 拼入（用户选择）
  - USER.md 用户全改为真实内容 → 真实内容拼入
  - `_strip_html_comments` 单测：跨行注释、嵌套注释（不支持，按第一对 `-->` 闭合）、空输入
  - 非 UTF-8 文件 → `UnicodeDecodeError` 冒泡
- `tests/unit/test_cli_main.py` 补：`_assemble_instructions` 返回值包含物化后的三段内容

**依赖**：模块 1 / 模块 3 / 模块 4
**优先级**：P1

---

### 模块 6：文档同步

**职责**：CLAUDE.md + 模块文档更新
**功能范围**：
- [docs/modules/命令行/README.md](../modules/命令行/README.md) 的 "CLI 装配的四条通道" 升级为"五条"（或保持四条但在 instructions 通道内说明 prompts 三段 + 后续追加）
- [docs/modules/配置加载/README.md](../modules/配置加载/README.md) 代码索引表加 `paths.py::get_kongming_home` 条目 + env 白名单加 `KONGMING_HOME`
- [CLAUDE.md](../../CLAUDE.md) 代码地图行 + 数据流段对应更新
- 本文档（`docs/prompt-modules-v0.1.3/README.md`）在实现后追加 "实现记录" 段

**依赖**：模块 1-4 完成
**优先级**：P2

---

## 模块依赖关系

```
模块1 (get_kongming_home) ─┐
                            ├─> 模块3 (prompts_loader) ─> 模块4 (CLI 接入) ─> 模块5 (测试) ─> 模块6 (文档)
模块2 (模板文件内置)  ─────┘
```

模块 1 和模块 2 互相独立，可并行；其他严格顺序。

## 推荐开发顺序

1. **第一步**：模块 1 + 模块 2（可并行）— 基础设施
2. **第二步**：模块 3 — 核心装配器
3. **第三步**：模块 4 — CLI 接入
4. **第四步**：模块 5 — 测试覆盖（建议与模块 3/4 同步写）
5. **第五步**：模块 6 — 文档

## 澄清问题及结论

| # | 问题 | 结论 |
|---|------|------|
| 1 | 目录名 | `.kongming/prompts/`（不是 `setting/`） |
| 2 | 三段覆盖规则 | 通过"启动物化"实现：模板内置 + 首次启动复制到用户目录；装配只读文件 |
| 3 | AGENT / TOOLS / USER 的硬编码拆分 | 迁移到 3 份独立 md 模板文件；原 `_DEFAULT_AGENT_INSTRUCTIONS` 删除 |
| 4 | TOOLS 默认内容 | 当前硬编码里"## 长期记忆..."原文搬过去；默认四工具（read/write/list/shell）**不额外增加描述**——用户按需自己在 TOOLS.md 里补充 |
| 5 | USER 默认内容 | HTML 注释引导 + 测试占位文本，引导用户"填写后删掉" |
| 6 | 装配拼接顺序 | AGENT → TOOLS → USER，用 `\n\n` 裸拼（不加外层 header） |
| 7 | HTML 注释是否进 prompt | **剔除**。装配器用正则 `<!--[\s\S]*?-->` 剥离后再 strip |
| 8 | 空段跳过规则 | 去注释 + strip 后为空 → 该段不拼入 |
| 9 | 统一路径入口 | 新增 `get_kongming_home()`，env `KONGMING_HOME` 覆盖，默认 cwd + `.kongming` |
| 10 | 本次范围是否统一所有 `.kongming/` 用法 | 否。本次只在 prompts 装配里用 `get_kongming_home()`；memory / trace / sessions 现存拼接保留，未来另立 task 统一 |
| 11 | 是否引入 Config 字段 | 否。跟随文件存在性决定；env 只加一条 `KONGMING_HOME` |
| 12 | 其他三通道（`--instructions-file` / env / memory snapshot）| 完全保留，在三段 prompts 之后按原顺序追加 |

## 文件导航

- [开发计划](./plan.md)（待 x-plan 生成）
- [开发清单](./dev-checklist.md)（待 x-plan 生成）
- [变更记录](./changelog.md)（待 x-dev 维护）

## 相关设计文档

- [docs/self-evolution-v0.1.3/README.md](../self-evolution-v0.1.3/README.md) — 同版本 memory 方案，`.kongming/memory/` 是本方案 `.kongming/prompts/` 的先行者
- [docs/instruction-loader-prompt-sources-v0.1.2/README.md](../instruction-loader-prompt-sources-v0.1.2/README.md) — v0.1.2 指令多来源加载器方案（本方案复用其 "`# <origin>` 标注 + 多来源合并" 思路，但不直接修改 InstructionLoader）
- [docs/kongming-agent-v1-minimal/10-contracts.md](../kongming-agent-v1-minimal/10-contracts.md) — 协议边界（本方案未新增协议，不改 AgentSpec / InputAssembler Protocol）
- [docs/kongming-agent-v1-minimal/11-v1-file-layout.md](../kongming-agent-v1-minimal/11-v1-file-layout.md) — 文件布局（本方案新增 `src/prompts/templates/` 和 `src/config_loader/paths.py`，需补）

## 实现记录

> 实现完成时间：2026-04-24
> 开发流程：x-req → x-plan → x-dev（subagent 并行）
> 开发 task：[dev-pipeline/tasks/prompt-modules-v0.1.3/](../../dev-pipeline/tasks/prompt-modules-v0.1.3/)

### 落地文件清单

**新增**：
- `src/config_loader/paths.py` — `get_kongming_home() -> Path`（env `KONGMING_HOME` → `Path.cwd() / ".kongming"`）
- `src/prompts/__init__.py` — 包门面
- `src/prompts/templates/AGENT.md` — 25 字节，身份段默认模板
- `src/prompts/templates/TOOLS.md` — 356 字节，memory 工具使用指引原文迁移
- `src/prompts/templates/USER.md` — 462 字节，HTML 注释引导 + 测试占位
- `src/context/prompts_loader.py` — `materialize_and_load_prompts(home)` + `_strip_html_comments`
- `tests/unit/test_paths.py` — 8 测试
- `tests/unit/test_prompts_loader.py` — 16 测试

**修改**：
- `src/config_loader/__init__.py` — re-export `get_kongming_home`
- `src/cli/main.py` — 删除 `_DEFAULT_AGENT_INSTRUCTIONS` 常量；`_assemble_instructions` 开头调 `materialize_and_load_prompts(get_kongming_home())`
- `pyproject.toml` — `[tool.hatch.build.targets.wheel].packages` / `sdist.include` 追加 `src/prompts`，让模板 md 被打进 wheel
- `tests/unit/test_cli_memory_config.py` — 原依赖 `_DEFAULT_AGENT_INSTRUCTIONS` 的测试改成走 `materialize_and_load_prompts(tmp_path)` 断言关键词

### 实施偏离

- **原计划 #3（打包验证）**发现 `packages` 列表未含 `src/prompts`，默认打包会漏掉模板；通过追加该项并同步 `sdist.include` 修复。未使用 `force-include` / `include = ["src/prompts/**/*.md"]` —— hatchling 对 `packages` 子目录下的非 `.py` 资源默认会打包。
- **原计划 #8**（改 `test_cli_main.py` + 补集成单测）：实际 `test_cli_main.py` 本来就没有 `_DEFAULT_AGENT_INSTRUCTIONS` 字面量依赖，改不需要；集成断言在 `test_cli_memory_config.py` 的 `test_default_agent_instructions_mentions_memory_tool` 里就地升级为"走真实 materialize_and_load_prompts"，覆盖相同语义。
- **事件 emit**：方案曾考虑 `prompts.materialized` trace 事件，最终**未实现**——装配器是纯函数，不持 event_sinks；trace 归因靠 `InstructionLoader.load` 的 `origin="agent_spec"` 已足够。如有需要后续再加。

### 回归验证

- `uv run pytest tests/unit -q` → **554 passed**（原 530 → +24 新测试，0 回归）
- `uv run pytest tests/unit --cov` → `src/config_loader/paths.py` 100% + `src/context/prompts_loader.py` 100%；总体覆盖率 82% → 84%
- `uv build` → wheel 内 `prompts/templates/{AGENT,TOOLS,USER}.md` 均存在

### 未来扩展方向

- `get_kongming_home()` 统一入口目前只被 prompts 装配使用；memory / trace / sessions 现存的 `.kongming/xxx` 拼接未切换，可另立 task 渐进迁移
- `TOOLS.md` 未按启用工具集自动生成（方案明确不做）；用户手动按需扩展文件内容
- 流式 CLI render 未接入，与 prompt 装配正交

---

*需求分析完成时间：2026-04-24*
