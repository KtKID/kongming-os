# v1-minimal 文档边界检查报告

> 范围：第二轮审查，针对 `README.md` + `02-module-breakdown.md` + `90-task-map.md` 修改后的版本
> 检查维度：边界不明确 / 需求错乱 / 模糊表述 / 跨文档矛盾
> 结论：**未发现阻塞性问题**；有 11 处细节建议修正，分 🔴/🟡/🟢 三级

---

## 🔴 高优先级（可能导致开发时职责重合或返工）

### 1. `core/session.py` 与 `context/session_store.py` 的接口归属没写死

**现状**：

- `02-module-breakdown.md` 模块 1（Core Runtime）包含 `core/session.py`
- `02-module-breakdown.md` 模块 3（Session / Context）包含 `context/session_store.py`

**问题**：两个文件名都暗示"这里定义 Session"。如果没讲清楚，第一批的 `core/session.py` 和第二批的 `context/session_store.py` 很可能**各自定义一套 Session 接口**，第二批整合时要 refactor。

**建议**（写进模块 3 的开头或"包含范围"下）：

> `context/session_store.py` 是 `core/session.py` 里 `Session` 接口的持久化实现，不重新定义接口。模块 3 不引入新的 session 抽象，只增加实现（落盘、恢复、压缩、规则加载、输入组装）。

### 2. `tools/approval.py` 在模块 2 和模块 6 都声称"最小"——职责切分模糊

**现状**：

| 位置 | 措辞 |
|---|---|
| 模块 2 (Tool Runtime) 包含范围 | `tools/approval.py` 的**最小能力接入点** |
| 模块 6 (Safety Baseline) 包含范围 | `tools/approval.py` 的**最小配合** |

**问题**：两处都说"最小"，同一个文件被两个模块声称管辖。读者无法判断：
- 第一批在 `tools/approval.py` 里写到什么程度？
- 第二批在同一个文件里补什么？

**建议**：给这个文件画清楚两阶段的职责。

- **模块 2 v1-tool-runtime**：在 `tools/approval.py` 里**实现** `ApprovalDecision` 接口 + 一个 `InteractiveApproval`（y/n 交互）实现；Tool Runtime 在执行工具前调用它
- **模块 6 v1-safety-baseline**：**新增**一个 `PolicyApproval` 实现（走 `safety/permission_policy.py` 的规则引擎），并让 Tool Runtime 可以选用不同的 approval 实现——不改 Tool Runtime 的接口形状

明确"模块 2 做接口 + 默认实现；模块 6 做策略实现"，而不是含糊地说两者都有"最小"部分。

### 3. `capability_policy.py` 与 `permission_policy.py` 的区别没讲

**现状**：模块 6 "包含范围" 同时列出两个文件，都归到 "最小 safety"。

**问题**：读者会问——这俩有什么区别？为什么不是一个？哪个在前？

**建议**（补一段小节到模块 6）：

- `permission_policy.py`：**工具/命令级** allow/deny/ask 规则（例如 "禁止 `rm -rf`"、"允许 `ls`"）
- `capability_policy.py`：**能力域级** 开关（例如 "是否允许网络"、"是否允许写当前项目外文件"、"是否允许子进程"）
- 两者的关系：capability 是粗粒度门禁，permission 是细粒度规则；一次 tool call 先过 capability，再过 permission

不写清楚的话，很容易把两者合并成一个文件或互相包含实现。

---

## 🟡 中优先级（开发中一定会问出的问题）

### 4. README 对"第一批内嵌最小实现"的表述不对称

**现状**：

- README Line 10-17 "最小可运行"定义里，明确提到"第一批内嵌一个最简 in-memory session"
- README Line 30-38 "范围边界-包含"只写"最小 session/context"，没说是第一批还是第二批内嵌
- 关于 **approval 的内嵌**，README **完全没提**，只在 `90-task-map.md` 里一笔带过

**问题**：session 和 approval 都是"第一批内嵌最简实现 → 第二批升级"的同构模式，但 README 只给了 session 说法。读者读 README 会以为只有 session 被内嵌了。

**建议**：README 的 "最小可运行"清单里把 approval 也写进来。

```
- 有自己的 loop 和 run state
- 第一批在 Core Runtime 内嵌最简 in-memory Session，支撑多轮 history
- 第一批在 Tool Runtime 内嵌最简 Approval（y/n 人工确认），避免工具裸跑
- 能调用一小组 tools
- 能接一个模型 provider
- 能通过一个宿主真正跑起来
- 有最基本的追踪和审计
```

同时 README "当前建议"那一节也应该加一段呼应 approval 的内嵌约束（现在只讲了 session）。

### 5. `host/` 与 `cli/` 的分工没讲

**现状**：模块 5 "包含范围" 列出：

- `host/base.py`
- `host/session_bridge.py`
- `host/cli_adapter.py`
- `cli/main.py`
- `cli/repl.py`

**问题**：`host/` 和 `cli/` 两个目录的**职责边界**没解释。`cli_adapter.py` 和 `cli/main.py` 看起来都"管 CLI"。

**建议**（补进模块 5 开头）：

- `host/` 是**宿主无关**的抽象层：`base` 定义宿主协议，`session_bridge` 是 agent 事件流与宿主事件流的桥，`cli_adapter` 是 CLI 这一类宿主的适配器（把 stdin/stdout 事件转成 host 事件）
- `cli/` 是**具体 CLI 入口**：`main` 负责参数解析和启动，`repl` 负责读-评-显示循环
- 关系：`cli/` 依赖 `host/cli_adapter`；将来再加 `host/http_adapter` 时，`cli/` 完全不动

### 6. `session_engine.py` 与 `cli/main.py` 的边界没讲

**现状**：

- 模块 4 Line 175-178 说 `session_engine.py` 做"组装 + 依赖注入 + 启动参数处理"
- 模块 5 Line 202 说 `cli/main.py` 也是"启动入口"

**问题**：谁负责**参数解析**？谁负责**依赖装配**？两个文件都可能抢这个职责。

**建议**（补进模块 4 "与 core/runner.py 的边界" 下面再加一节）：

- `session_engine.py` 是**进程内运行时库**——暴露 Python API 给任何宿主调用，负责依赖装配（把 provider/tool registry/session/sink 装起来交给 runner）
- `cli/main.py` 是**CLI 应用入口**——解析命令行参数，**调用** `session_engine` 构建运行时，然后把控制权交给 `cli/repl.py`
- `session_engine.py` **不处理**任何 CLI 概念（argparse、环境变量解析都在 cli 层）
- `cli/main.py` **不做**依赖装配（全部委托给 session_engine）

### 7. `history_compactor.py` 的参考项目遗漏

**现状**：模块 3 "参考项目" 只提了 openai session 存储、claude 指令加载与输入组装，**没提压缩应该抄谁**。

**问题**：`context/history_compactor.py` 是模块 3 的四个文件之一，但"参考项目"一节没覆盖它。

**建议**（在模块 3 "参考项目"补一行）：

- 压缩策略主参考：`other/claude-code-main/` 的 `services/compact/`（v0.1 只做 auto-compact，micro/reactive/collapse 留到 v0.2+）

v2 文档已经定了这个对齐，v1-minimal 里应该同步上。

### 8. 模块 7 三个文件的关系没讲

**现状**：模块 7 "包含范围"：`trace_sink.py` / `usage_meter.py` / `audit_log.py`。

**问题**：三者是互相独立还是有数据流？`audit_log` 是读 `trace_sink` 的输出还是独立写？Observability 做到什么程度算最小？

**建议**（模块 7 补一段边界说明）：

- `trace_sink.py`：run/span/tool_call 事件流的单一接收口；v1 只需要落 JSONL
- `usage_meter.py`：token / cost / 延迟的聚合计数器；独立于 trace，不依赖 trace_sink
- `audit_log.py`：安全相关事件（approval 批准/拒绝、guardrail 命中）的独立审计流；**独立于** trace（因为审计要求保留即便 trace 关了也能看到）
- 三者互不依赖，各自独立写盘（v1 都落 `~/.kongming/logs/<run-id>/`）

---

## 🟢 低优先级（更像风格问题，不影响开发）

### 9. "最小 session/context" vs "Session Context 模块" 的命名晃动

**现状**：README 里 Line 35 的"最小 session/context"和 Line 55 的导航表"Session Context"用的是同一个措辞，但一个指"整个 v1 包含 session 能力"、一个指"第二批那个独立模块"。

**问题**：读者会把两者读成同一件事。

**建议**：

- Line 35 的"最小 session/context" 改成"**会话历史容器（第一批最简 + 第二批工程化）**"
- 或者保留原词但在 Line 35 加脚注：`* 分两阶段交付，详见"当前建议"`

### 10. 模块 1 的"不包含范围"没把最小 session 的反面边界写进去

**现状**：模块 1 "包含范围"列了 `core/session.py`，"第一批最小 session 约束" 的正文里讲了"不承担持久化、压缩、规则加载"。

**问题**：这些反面边界应该也**同步写进**"不包含范围"，读者不需要翻到下面的约束小节。

**建议**：模块 1 "不包含范围"追加：

```
- session 持久化 / 恢复（留给第二批 context/session_store.py）
- 历史压缩（留给第二批 context/history_compactor.py）
- 指令 / 规则加载（留给第二批 context/instruction_loader.py）
- 输入组装（留给第二批 context/input_assembler.py）
```

### 11. 第二批内部顺序 session → safety → obs 的理由没写

**现状**：`90-task-map.md` 第二批顺序：

1. v1-session-context
2. v1-safety-baseline
3. v1-observability-baseline

**问题**：依赖图上没有强制这个顺序（三者无硬依赖）。读者会问"为什么 session 先"。

**建议**：补一句理由（或告诉开发者三者可以并行）：

```
第二批三个 task 彼此无硬依赖，顺序可并行；建议串行时按
session → safety → obs 的顺序，因为：
- session 的持久化是后面两者调试时最常用的上下文来源
- safety 依赖 observability 的 audit_log 会更好，但 v1 阶段 safety 可以先写日志到 stderr，等 obs 做好再切
```

如果没有这种理由，直接说"三者可并行，无强制顺序"。

---

## 附：不算问题但值得记录

### 关于 "第一批无结构化 observability" 的隐含取舍

检查过程中注意到：**第一批完全没有任何 observability 承担**（connection、audit 都没 stub）。这不算矛盾，是明显的取舍——第一批靠 Python 标准 logging 顶着调试需求就行。但如果这是明确决策，建议在 `90-task-map.md` 的 "第一批默认带着两个最小实现" 那一节下面加一句：

```
第一批不内嵌 observability 最小版本——用 Python 标准 logging 顶替。
第二批 v1-observability-baseline 做结构化 trace / usage / audit 时
直接替换 logging 调用。
```

这样就不会在第二批开工时有人问"为什么 session 内嵌了、approval 内嵌了、偏偏 observability 不内嵌"。

---

## 综合结论

**三份文档内容相互一致，没有需求错乱或硬性矛盾。** 发现的 11 处问题都是"**边界描述不完整**"或"**命名/表述不对称**"，不是"方向错了"。

修复建议按优先级处理：

- 🔴 1–3：开工前必改（会直接影响 task 内部职责切分）
- 🟡 4–8：最好一并改（开发中肯定会问到）
- 🟢 9–11：有空再改（风格和可读性）

改完之后，这套 v1-minimal 规划可以直接进入 `v1-core-runtime` 的 x-req 环节。

---

## 附录：预防接口重复定义的工程实践

本次审查里 🔴 问题 1（`core/session.py` 与 `context/session_store.py` 的接口归属不明确）不是偶发，而是**多模块系统在没有明确约束下的典型演化结果**：两个模块在不同时间独立演化，各自都需要同一个抽象，于是各自"顺手定义一份"。

下面这些软件工程实践能在**设计阶段**就把这类问题消除，排序按预防强度：

### 实践 1：单一契约文件（Single Source of Truth, SSOT）

**最基础也最管用的一条**。所有跨模块共享的类型/协议集中放在一个文件，其他模块**只能 import、禁止重新定义**。

- Python 惯例：`core/contracts.py` / `core/protocols.py` / `core/types.py`
- Go：专门的 `interface.go`
- TypeScript：`types.ts` 或独立的 `@project/types` 包
- Protobuf / OpenAPI：schema 本身就是 SSOT

对 kongming-agent：对应 `91-review.md` 里建议的 `docs/10-contracts.md` + `core/contracts.py`。

### 实践 2：依赖倒置 + 依赖方向规则（Dependency Inversion）

写一条硬规则：**"所有模块都能 import core；core 不能 import 任何其他模块。"**

推论：Session 接口必须在 core 里（两端都用它），session 的具体**实现**散落在 context/、memory/ 里。这是 Clean Architecture / Hexagonal Architecture 的核心思想。

对 kongming-agent：

```
core/ ────────────────────← 所有模块都能导入
  contracts.py (Protocol 集合)
  runner.py
  session.py (最简 in-memory 实现)
  ...

context/ ────────────────← 导入 core，不被 core 导入
  session_store.py (实现 core.contracts.Session)

tools/memory/safety/... ─← 同上
```

### 实践 3：Protocol 优先于 ABC（Python 特有，思想通用）

用 `typing.Protocol` 做接口，实现方**不需要显式继承**，只需形状匹配：

```python
# core/contracts.py
from typing import Protocol

class Session(Protocol):
    def get_history(self) -> list[Message]: ...
    def append(self, msg: Message) -> None: ...
```

```python
# context/session_store.py
from core.contracts import Session  # 只 import，不重定义

class SQLiteSessionStore:  # 不需要 inherit Session
    def get_history(self) -> list[Message]: ...
    def append(self, msg: Message) -> None: ...
```

好处：

- 实现方**物理上**不可能"重新定义一份 Session"——根本没继承，重复定义毫无意义
- mypy / pyright 会自动校验实现是否符合契约
- 解耦最彻底：core 不 import 任何实现就能描述实现应长啥样

TypeScript 对应：用 `interface` 而非 `class` 做契约；Go 对应：interface 内置鸭子类型。

### 实践 4：导入规则可执行化（Architectural Fitness Functions）

把"谁能 import 谁"写成**可执行规则**放进 CI，人类不会忘。

Python：[`import-linter`](https://github.com/seddonym/import-linter)

```toml
# importlinter.cfg
[importlinter]
root_package = kongming

[importlinter:contract:1]
name = core 不依赖任何其他模块
type = forbidden
source_modules = kongming.core
forbidden_modules =
    kongming.context
    kongming.tools
    kongming.memory
    kongming.executors
    kongming.safety
    kongming.observability
    kongming.host
    kongming.cli

[importlinter:contract:2]
name = 跨模块类型只能来自 core.contracts
type = layers
layers =
    kongming.context | kongming.tools | kongming.memory
    kongming.core.contracts
```

其他语言工具：

- TS/JS：`dependency-cruiser`、ESLint `import/no-restricted-paths`
- Java：`ArchUnit`
- Rust：workspace 分 crate + `cargo deny`

**这一步最关键**：把架构约束从"文档里的规矩"变成"CI 里的 lint"。违反 → CI 红 → 合不了。

### 实践 5：Contract-First + Contract Tests

接口先行：**写 contracts.py 之前禁止写实现**。每个契约附带一组合规性测试，任何实现都要通过：

```python
# tests/contracts/test_session_contract.py
def contract_test_session(session: Session):
    assert session.get_history() == []
    session.append(msg1)
    assert session.get_history() == [msg1]

# 所有实现都跑一遍
def test_in_memory_session():
    contract_test_session(InMemorySession())

def test_sqlite_session():
    contract_test_session(SQLiteSession(":memory:"))
```

好处：

- 新加一个实现时，合规性测试复用
- 改契约时**所有实现**的测试同时变红，不会有人偷偷只改一边

### 实践 6：ADR（Architectural Decision Record）

每个关键边界决策写一份 markdown，编号保留、不删除：

```
docs/adr/
  0001-session-interface-lives-in-core.md
  0002-core-imports-nothing-from-siblings.md
  0003-approval-two-stage-interface-vs-policy.md
  0004-native-runtime-not-second-runner.md
```

出现"又想在 context/ 里定义一份 Session"的冲动时，去看 0001 就知道不行。

### 实践 7（v0.1 暂不考虑）：Monorepo + 包隔离

把每个模块做成独立 Python package，`core` 作为依赖发布到内部 registry。其他模块 `pip install core`，物理上没法偷偷改 core 里的接口。

成本高，**v0.1 完全不需要**；v1.0 之后团队变大再考虑。

---

## 附录续：kongming-agent v0.1 的具体落地建议

按投入/收益排序：

| 优先级 | 做什么 | 时间成本 | 主要收益 |
|---|---|---|---|
| 🔴 | **①** 建 `core/contracts.py`，跨模块类型只在这里定义 | 半天 | 防 90% 的接口重复定义 |
| 🔴 | **②** 在 README 和各模块头部写一条硬规则："Message/Tool/Session/RunState/LLMProvider 只能从 `core.contracts` 导入" | 10 分钟 | 纪律层防护 |
| 🔴 | **③** 接入 `import-linter` 到 CI（v0.1 阶段先写 2-3 条最关键规则） | 2 小时 | 机器层防护，违规即挂 CI |
| 🟡 | ④ 契约一律用 `typing.Protocol`，不用 ABC | 0（写法差异） | 实现解耦最彻底 |
| 🟡 | ⑤ 每个核心契约配一份 contract test | 1 小时/契约 | 改契约时实现同步 |
| 🟢 | ⑥ 关键边界决策写 ADR | 30 分钟/决策 | 知识沉淀，防新人踩坑 |

**做完前三条，🔴 问题 1（session 接口归属）就物理上消失了**——接口只能在 `core.contracts` 里定义，`context/session_store.py` 想重复都没地方写；即使有人试图在 context 里 `class Session(Protocol)`，import-linter 直接在 CI 红掉。

### 参考项目里谁做到了这点

| 项目 | 做法 | 结果 |
|---|---|---|
| OpenAI agents SDK | 核心类型集中在 `src/agents/` 顶层（`agent.py` / `items.py` / `run_state.py` / `model_settings.py`），`extensions/` 下的扩展只 import 不重定义 | 结构上天然隔离，没有重复定义 |
| Claude Code | TypeScript + Zod schema，schema 本身是 SSOT | 没有重复定义问题 |
| Hermes | 没做 SSOT，`agent/memory_manager.py` 和 `agent/memory_provider.py` 各自有 Memory 抽象 | 读起来累，不同模块对 Memory 的理解不一致 |

这验证了一件事：**集中放 + 强类型 → 几乎必然做好；散放 + 弱类型 → 几乎必然出现重复定义。**

---

## 下一步建议

本报告的建议合并到 `02-module-breakdown.md` 时，可以：

1. 在模块 1（Core Runtime）的"包含范围"开头加一个 `core/contracts.py`，作为所有契约的 SSOT
2. 在 `README.md` 的"边界约束"里加一条："跨模块类型只能从 `core.contracts` 导入；core.contracts 只定义，不提供任何实现"
3. 在 `90-task-map.md` 的第一批（`v1-core-runtime` 之前）加一个前置任务 `v0-contracts`，产物为 `docs/10-contracts.md` + `core/contracts.py` + `importlinter.cfg` 初版——开工三条 🔴 实践，花半天到一天
4. 后续每开一个 task，在任务开头明确它"消费哪些 core.contracts 里的协议、实现哪些"，不允许新增协议定义到模块自己的文件里

这样一来，v0.1 从第一天起就有架构硬约束，不靠人类记忆力维护边界。

