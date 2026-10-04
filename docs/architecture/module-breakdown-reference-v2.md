# kongming-agent 模块拆分 v2（借鉴源扩展版）

## 0. v1 → v2 主要变化

**v1 原则**："骨架学 OpenAI，执行语义学 Claude，最小闭环学 Mini-Agent，成长接口留给 Hermes。"

**v2 新原则**：

> **骨架学 OpenAI，实现学 Claude Code（源码镜像），最小闭环对照 Mini-Agent，长期成长参考 Hermes，SDK/CLI 协议参考 cc-agent-sdk。**

起因：`other/claude-code-main` 是 2026-03-31 从 npm sourcemap 泄露的 Claude Code 真实 TypeScript 源码（约 1900 文件 / 512k 行），不再是只能看类型定义的瘦客户端。这意味着 v1 里"Claude 只能学语义，实现看不见"的前提作废，所有工具执行 / 权限 / 压缩 / 记忆都可以**直接对着源码实现抄**。

五方定位：

| 项目 | 类型 | v2 角色 |
|---|---|---|
| `other/openai/` | Python SDK | **抽象骨架标本**——`Agent/Runner/RunState/Session/Lifecycle/Guardrail` 切分最干净 |
| `other/claude-code-main/` | Production CLI 源码 | **落地实现标本**——真实生产级的 QueryEngine / 3 层权限 / 5 种 compact / memdir |
| `other/Mini-Agent/` | 教学级 Python | **最小闭环标本**——证明"能跑"需要多少代码 |
| `other/hermes-agent/` | Research 级 Python | **长期成长标本**——learning loop / 多沙箱 / benchmark |
| `other/cc-agent-sdk/` | Python SDK 瘦客户端 | **SDK 协议标本**——subprocess + control protocol 包装 CLI 的模式 |
| `other/codex/` | Rust/TS CLI | 可选参考，不在 v0.1 计划内 |

---

## 0.5 roadmap 约束（新增）

这里要补一个关键前提，不然前面的“借鉴谁”会被误读成“目标只是做 coding agent”。

`kongming-agent` 的长期目标，不是只做一个帮人写代码的 CLI，而是做成**类似 Hermes 的通用 agent**：

- 能调通用 tools，不限于 coding tools
- 能操作电脑，第一版先落在 macOS
- 能逐步接入 macOS API、本地资料管理、自动化工作流
- 最终要能长成多平台应用，而不是停在终端开发助手

同时还要补一个更具体的约束：

> **必须先有一个不依赖平台的最小可运行版本。**

这里的“不依赖平台”，不是说它没有 UI，而是说它的核心运行时**不绑定 macOS、CLI、桌面窗口、游戏引擎、某个 App SDK**。  
同一套 core，后面应该能接进：

- CLI
- macOS 桌面应用
- 其他 App 内嵌 agent
- 游戏运行时

这些宿主的差异，主要体现在外层 adapter，而不是 core 本身。

比如你提到的游戏场景，和 coding 场景的差异不在 loop 本身，而在这几层：

- **tools 不同**：coding 场景是 read/write/bash；游戏场景可能是地图查询、NPC 调试、状态注入、任务推进、战斗模拟、剧情检查
- **skills 不同**：coding 场景是代码修改流程；游戏场景可能是关卡测试流程、剧情调试流程、数值校验流程、AI 行为排查流程
- **host bridge 不同**：CLI 接终端输入输出；游戏接引擎事件、调试接口、游戏内 UI、存档/运行态
- **state scope 不同**：有的状态属于 agent session，有的属于宿主 app/game world，不能混在一起

但这不等于 v0.1 就该直接长成 Hermes。  
**v0.1 的定位仍然是“通用 agent 的基础内核”**，只解决下面这些最小问题：

- agent 自己有 loop
- 能调 tools
- 有清晰的 run state / session state 边界
- 能暂停、恢复、压缩上下文、记录基本状态

所以这一版文档里的判断标准也要跟着改：

1. `core/` 必须是**领域无关**的，不能写死为“coding 专用内核”
2. macOS API、资料管理、桌面自动化、多平台 UI 都是 roadmap 上的重要方向，但**不应该提前污染 v0.1 core**
3. 游戏、桌面 App、CLI 都只是不同宿主，**宿主差异应该落在 adapter/bridge/toolset/skillset，而不是 core loop**
4. Hermes 对我们真正重要的地方，不是“整套照抄”，而是提醒我们从第一天就给**通用 agent 的成长路径**留接口

换句话说：

> **短期实现学 OpenAI/Claude/Mini-Agent，长期产品方向学 Hermes。**

---

## 1. v2 模块表（校正版）

这版不再默认“文档原判断就是对的”。我把每一项都重新过了一遍，重点看三件事：这个模块是不是应该独立成文件，这个参考源是不是最像我们要做的东西，以及为什么不优先抄另外几家。

标注规则：

- **保留**：原拆分基本合理，可以继续
- **调整**：模块还要，但主参考源要改，或者边界要收一收
- **改名/并入**：不建议按原名字单独拆，应该并到别的层里
- **后置**：不是 v0.1 核心，不该过早占一个主模块名额

### core/（主循环与协议）

这里要加一个约束：  
`core/` 只负责**宿主无关的 agent 运行语义**，例如 loop、turn、tool orchestration、run state、内部生命周期。

它**不负责**：

- CLI/桌面/游戏的输入输出桥接
- 宿主 UI 事件
- 平台 API 细节
- game world / app runtime 的外部状态本体

所以这一层参考谁，标准不是“谁最像 coding agent”，而是“谁最像一个可嵌入不同宿主的通用 agent 内核”。

| 模块 | 判断 | 主参考项目 | 理由 | 不优先参考另外项目的理由 |
|---|---|---|---|---|
| `agent_spec.py` | **调整** | **自己定义，参考 OpenAI** | 这个文件仍然应该借 OpenAI 的干净边界，但最终要自己收口，因为你这里的 agent 不是 SDK demo，而是未来可嵌入 CLI / 游戏 / macOS App 的通用 agent 定义。 | 直接照 OpenAI 抄，容易默认“agent 只是模型+工具配置”；Claude Code 又太偏产品运行时，Mini-Agent 则过薄。 |
| `runner.py` | **调整** | **自己定义，参考 OpenAI + Hermes** | 主循环语义仍然先学 OpenAI，但现在要补进 Hermes 式的现实需求：长生命周期、可中断、可回调、可被不同宿主驱动。所以不能只当成 SDK 的 `run()` 包装。 | 只抄 OpenAI，loop 会太像“库函数”；只抄 Hermes，又会把大量 runtime 杂质一起卷进 core；Claude Code 仍然太重、太产品化。 |
| `run_state.py` | **保留** | **OpenAI** | `RunState` 依然最值得学，因为它最像一个独立、可序列化、可暂停恢复的运行态边界。这个边界对游戏接入也重要：agent state 和 game world state 必须分开。 | Hermes 的 session/state 更像宿主运行时管理；Claude Code 也有 session/checkpoint，但没有这么干净的核心快照对象。 |
| `lifecycle.py` | **调整** | **OpenAI 为主，参考 Hermes 回调面** | run-level 生命周期仍然可以按 OpenAI 的纯协议来建，但现在要明确：它是**内部生命周期**，未来需要和宿主 callback/event bridge 对接。 | 直接照 OpenAI 写容易只剩纯内部 hooks；直接照 Hermes 写又容易变成 callback 参数堆；Claude Code 的 hook 更偏产品事件。 |
| `message.py` | **保留** | **自己定义，参考 Claude Code + OpenAI** | 我们需要统一消息协议，但 Claude 的消息种类更贴近“带本地工具和控制消息的通用 agent”，OpenAI 的 `RunItem`/response item 更适合看抽象边界。 | 单抄 Claude 会把 attachment/system/control 语义一起搬进来；单抄 OpenAI 会弱化本地工具和终端交互。 |
| `result.py` | **保留** | **自己定义，参考 OpenAI** | `ModelResponse` / `RunItem` 能帮助我们把“模型输出”和“运行结果”拆开。 | Claude Code 没有一个独立、轻量、跨 provider 的 result 层；Mini-Agent 太贴具体响应。 |
| `errors.py` | **调整** | **自己定义，参考 OpenAI** | 仍然借 OpenAI 的分层思路，但现在更需要自己定义：要区分 core error、tool error、approval interrupt、host bridge error、platform error，不能只沿用 SDK 风格错误命名。 | Claude Code 的错误更多散在产品模块里；Mini-Agent 基本是字符串报错；OpenAI 的错误模型也还不够覆盖宿主嵌入场景。 |

### tools/（工具与执行）

这一层现在也要换一个判断标准：  
`tools/` 不是“给 coding agent 准备的一组内置工具”，而是**通用 agent 的工具协议层**。

它至少要同时容纳三类工具：

- 本地通用工具：文件、终端、网页、MCP
- 宿主域工具：游戏调试工具、App 内部能力、业务系统能力
- agent 内部工具：skill 调用、subagent 派发、状态查询、记忆读写等

所以这里最重要的不是某个具体工具长什么样，而是：

1. 工具协议是不是足够稳定
2. 注册表能不能容纳不同来源的工具
3. 审批、回调、事件、错误能不能跨宿主统一
4. tool 本身不要偷偷长成 host adapter

换句话说，`tools/` 要做成“通用工具总线”，而不是“文件 + Bash 工具集合”。

| 模块 | 判断 | 主参考项目 | 理由 | 不优先参考另外项目的理由 |
|---|---|---|---|---|
| `base.py` | **调整** | **自己定义，参考 OpenAI + Mini-Agent** | 这里不该再只学 Mini-Agent。Mini-Agent 的 `Tool.execute()` 适合做最小闭环，但还需要借 OpenAI 的 tool context / tool origin / approval boundary 思路，才能承载来自不同宿主和不同来源的工具。 | 单抄 Mini-Agent，协议太薄，不够支撑游戏工具、宿主工具、内部工具并存；单抄 OpenAI，又会偏 schema/function tool，不够贴本地执行语义；Claude Code 则整体太重。 |
| `registry.py` | **调整** | **自己定义，参考 Claude Code + Hermes** | 注册表不能只是“按 feature flag 导入工具”，还要能区分 builtin tool、host tool、MCP tool、skill tool、domain tool。Claude Code 适合参考聚合与权限前置；Hermes 适合参考动态 toolset / 宿主注入。 | 单抄 Claude Code，容易默认所有工具都围绕本地 CLI 产品组织；Mini-Agent 没有足够复杂的注册表；OpenAI 更关注 tool schema，不是运行时注册总线。 |
| `approval.py` | **保留** | **Claude Code** | `permissions.ts` 已经体现了规则匹配、mode、tool check、classifier 叠加的真实链路。 | OpenAI `tool_guardrails.py` 偏 guardrail，不是完整权限系统；Mini-Agent 几乎没有这一层。 |
| `hooks.py` | **调整** | **自己定义，参考 Claude Code + Hermes** | 这个模块应该做成**通用事件/回调桥**，而不是直接照搬 Claude Code 的 shell-hook 体系。Claude Code 适合参考 tool-level hook 事件点；Hermes 更适合参考 callback / host bridge 的接法。 | 单抄 Claude Code，容易把 hooks 做成“面向 coding CLI 的外部命令钩子系统”；单抄 Hermes，又容易只有 callback，没有清晰的 tool-level 生命周期语义；OpenAI lifecycle 仍然偏 run-level，不够细。 |
| `file_tools.py` | **保留** | **Mini-Agent 起步，Claude Code 对齐** | 文件工具依然是 v0.1 最值得先做的一批 builtin tool，但现在要明确：它们只是第一组样板工具，不代表 `tools/` 的形状就是“文件工具中心化”。 | 一上来照 Claude 完整文件工具，会把 patch、budget、diagnostic 等一起带进来，成本过高。 |
| `shell_tool.py` | **保留** | **Mini-Agent 起步，Claude Code 对齐** | shell 仍然重要，因为它是最强的兜底工具，但它只是 builtin tool 之一，不能默认所有宿主能力都通过 shell 暴露。 | OpenAI shell 更偏 sandbox capability；Claude 的 BashTool 对 v0.1 来说太完整，而且容易让架构不自觉偏向 CLI。 |
| `web_tools.py` | **后置** | **Claude Code / Codex** | 网页抓取和搜索仍然后置，但应该被视为通用能力工具，而不是 coding 特供。 | Mini-Agent 这里没有足够样板；OpenAI SDK 也不是以本地 web tool 为核心。 |
| `mcp/client.py` | **调整** | **OpenAI** | MCP 现在更重要了，因为它是“宿主无关扩展工具”的关键入口之一。OpenAI `mcp/` 仍然是最像协议层的参考。 | Claude Code 的 MCP client 夹着 CLI 生命周期；Mini-Agent 虽然有 loader，但更像接入器，不像完整协议边界。 |
| `mcp/adapter.py` | **保留** | **OpenAI** | `mcp/util.py` 这种“把外部工具映射成内部统一 Tool”的 adapter 思路，对你后面接游戏/App 外部能力很关键。 | Claude Code 适配层更贴自己的 Tool 类型；Mini-Agent 没有这么清楚的 adapter 分层。 |
| `domain_tools/` | **新增，v0.1 就要预留目录** | **自己定义，参考 Hermes toolset 思路** | 这里专门承接宿主域工具，比如游戏调试工具、应用内部操作工具。不能把这些工具混进 builtin file/bash 目录，否则后面会越来越乱。 | 现成项目都没有完全对应的目录，但 Hermes 的 toolset 思路证明“按能力域分组”比按单个产品场景硬编码更稳。 |
| `skill_tool.py` / `workflow_tools.py` | **新增，v0.1 预留** | **Mini-Agent + Hermes** | 你这里的 skill 已经不只是“给 coding agent 注入 prompt”，以后还会承担游戏流程、业务流程、测试流程。所以最好从工具层就给“调用 skill / workflow”留位置。 | 单纯把 skill 当上下文加载器，不够支撑以后“流程即工具”的方向；Claude Code 的 SkillTool 偏产品内 prompt 能力。 |

### context/（上下文与会话）

这一层现在需要重新收口。  
如果目标是通用 agent，而不是“会读项目代码的 CLI”，那 `context/` 的职责就不该只是“读项目规则 + 拼 prompt”。

它更准确的定义应该是：

- 保存 **agent 自己的会话上下文**
- 组织 **要喂给模型的输入上下文**
- 注入 **指令/规则/技能元数据/附件/记忆片段**
- 接住 **宿主临时提供的上下文**，比如当前窗口、当前选区、当前游戏场景、当前 app payload

但它**不负责**：

- 持久化宿主 world state / app state / game state
- 代替 host adapter 管理平台事件
- 把 skill 执行本身做掉

所以这一层更像 **session context management + input assembly**，而不是“项目上下文加载器合集”。

| 模块 | 判断 | 主参考项目 | 理由 | 不优先参考另外项目的理由 |
|---|---|---|---|---|
| `session_store.py` | **保留** | **OpenAI** | `sqlite_session.py` 依然最像我们要的基础边界：它保存的是 agent 会话历史，而不是宿主外部状态。这个区分对以后接游戏和 App 很关键。 | Mini-Agent 的 session 太轻，更多是 demo 语义；Hermes 的 session/state 已经带平台运行时味道，不适合当 v0.1 的干净边界。 |
| `context_engine.py` | **新增，v0.1 就该留薄接口** | **Hermes** | 这里最值得借鉴 Hermes。不是因为要照抄它的压缩算法，而是它把“上下文怎么管理”抽成了独立策略层。这样 `history_compactor.py` 就不会被写死成唯一方案，后面不管接记忆召回、宿主上下文筛选还是更复杂压缩，都有落点。 | OpenAI 更强在 session 存储，不在上下文策略抽象；Claude Code 虽然 compact 很成熟，但没有 Hermes 这么干净的 `ContextEngine` 心智模型。 |
| `history_compactor.py` | **调整** | **Mini-Agent v0.1，Hermes 结构预留，Claude Code v0.2+** | v0.1 还是先做最简单的超阈值摘要，但它最好挂在 `context_engine.py` 这类薄接口后面。这样第一版可以很轻，后面再逐步吸收 Claude Code 的 micro/reactive/collapse 等策略。 | 直接照 Claude 全搬会过重；只看 Mini-Agent 又容易把 compactor 写死成一次性实现；Hermes 更适合提供结构，不适合直接拿来当 v0.1 算法样板。 |
| `instruction_loader.py`（替代 `project_context_loader.py`） | **改名** | **Claude Code** | 这里需要改名，因为“project context”还是太像 coding agent。真正要学的是 Claude Code 对 `CLAUDE.md`、规则优先级、目录级指令的处理方式，但我们自己的模块名应该更通用，后面才能容纳项目规则、App 规则、游戏规则、宿主传入 instruction pack。 | 如果继续叫 `project_context_loader.py`，语义会把架构往“只服务代码仓库”上锁死；OpenAI 没有这类成熟规则系统；Mini-Agent 只有简单 prompt 拼装。 |
| `skill_loader.py` | **调整** | **Mini-Agent v0.1，Claude Code v0.2+** | 这个模块还能留在 `context/`，但职责要缩小成“skill discovery + metadata + 按需披露”，不要把 skill 执行也塞进来。因为你后面说得很清楚，skill 在游戏/App 场景里更像流程能力，执行应该落到 tool/workflow 层。 | 如果继续按“技能就是 prompt 片段”来设计，后面会卡死；Claude Code 的 skill 体系已经和产品级指令系统强耦合；Hermes 也不是 skill catalog 的强参考。 |
| `input_assembler.py`（替代 `attachment_loader.py`） | **改名/并入** | **Claude Code** | 这个改名现在更确定是对的。附件、文件引用、相关记忆、规则片段、宿主临时上下文，本质上都是“本轮输入怎么组装”的问题，不是一个孤立 attachment loader。游戏场景里也一样，当前关卡状态、选中对象、调试快照，未来都该从这里并入。 | Claude Code 的 attachment 本来就是消息组装链的一部分；OpenAI、Mini-Agent 都没有强到值得单拆 `attachment_loader.py` 的实现。继续保留旧名字，只会把边界做窄。 |

### memory/（长期记忆）

这一层之前没有把 `mem0` 单独纳进来，这里需要补一句判断。  
`mem0` 很值得关注，但它更像一个**外接记忆后端 / memory provider**，不是 v0.1 应该直接写进 core 的内建记忆形态。

原因很简单：  
它的长处是 **自动事实抽取、去重、语义搜索、rerank、云端托管**，很适合做“记忆增强服务”；  
但你现在 v0.1 更需要的是 **宿主无关、可本地运行、可嵌入 App/游戏、没有外部依赖也能跑** 的最小记忆骨架。

所以对 `mem0` 的正确用法，不是“拿它定义整个 memory 层”，而是：

- v0.1：先不依赖它，memory core 自己收住
- v0.2+：把它当 `external memory provider` / `memory backend adapter` 的重要参考
- 长期：如果你要云记忆、自动抽取、跨端共享，再考虑把它接成可选后端

| 模块 | 判断 | 主参考项目 | 理由 | 不优先参考另外项目的理由 |
|---|---|---|---|---|
| `memory_store.py` | **保留** | **自己定义** | 这里只需要抽象 `get/put/search` 之类接口，不要被任何一家的持久化格式绑死。尤其不要一开始就被 `mem0` 这种外部后端的 API 形状反向定义。 | 现在直接抄 Claude memdir、Hermes MEMORY.md，或者 `mem0` 的远端 API 语义，都会把存储策略硬编码进去。 |
| `profile_store.py` | **调整** | **Hermes v0.1，Claude Code memdir v0.2+** | v0.1 的目标只是“记住用户偏好和项目事实”，Hermes 的 `MEMORY.md / USER.md` 更轻，更符合先做可控文本记忆。 | Claude `memdir/` 已经带相关性检索、自动维护、后处理管线，太像产品成熟态；`mem0` 又更偏托管抽取+检索服务，都不适合当第一版内建 profile store。 |
| `extract_memories.py` | **调整** | **Claude Code + Mem0** | 如果到了自动事实抽取这一步，`mem0` 就值得参考了，因为它把“对话 → 事实抽取 → 去重/冲突处理 → 可检索记忆”做成了清晰产品形态。Claude Code 则更适合参考本地 agent 里何时触发、怎样并入运行时。 | 只看 Claude Code，容易偏本地产品管线；只看 `mem0`，又容易默认要上托管后端。这个模块更像 service，仍然不该进入 v0.1 核心。 |
| `learning_loop.py` | **保留** | **Hermes** | 这是 Hermes 的真正长板，适合作为 v0.3 的成长接口。 | Claude Code 现在更像产品记忆增强，不是 learning loop 框架；OpenAI 也没把这块做成核心。 |
| `team_sync.py` | **改名/并入** | **Claude Code** | 这不是通用 `memory/` 模块，更像 `services/team_memory_sync/` 这种团队协作功能，应该后置。 | 把它挂到 memory/ 会误导架构，以为团队同步是长期记忆的核心能力；实际上它是协作产品功能。 |
| `external_memory_provider.py` / `memory/providers/` | **新增，v0.2+ 预留** | **Hermes + Mem0** | 这个抽象现在值得预留。Hermes 已经证明，内建轻量记忆和外接 provider 可以并存；`mem0` 则是最典型的外接托管记忆后端样板。这样以后你既能保留本地最小可运行版本，也能按需接云记忆。 | 现在就把 `mem0` 直接揉进 `memory_store.py`，会把 v0.1 变成依赖外部服务的架构；Claude Code 也没有把这类外部 provider 做成通用抽象。 |

### safety/（权限与安全）

这一层现在也要改一下理解方式。  
如果目标是通用 agent，`safety/` 就不能只理解成“给 Bash 和文件操作加限制”。

它至少应该覆盖四类东西：

- **语义级约束**：输入、输出、tool input、tool output 的 guardrails
- **审批级约束**：什么操作要问人，什么操作可以自动放行
- **能力级边界**：这个 agent / 这个宿主 / 这个 session 到底允许调用哪些能力
- **执行级隔离**：对 shell、代码执行、文件写入这类高风险能力怎么隔离

这里尤其要补一件事：  
以后你要接 macOS API、computer use、App 内部能力、游戏调试工具，很多风险已经不是“某条 shell 命令危不危险”，而是“这个 agent 这次有没有资格使用某种能力”。  
所以 `safety/` 里只放 `permission + sandbox` 还不够，得补一层 capability boundary。

| 模块 | 判断 | 主参考项目 | 理由 | 不优先参考另外项目的理由 |
|---|---|---|---|---|
| `guardrails.py` | **保留** | **OpenAI** | OpenAI 的 input / output / tool input / tool output guardrail 分层还是最干净，适合当通用 agent 的语义安全骨架。 | Claude Code 的安全重点更多是权限和 hooks，不是统一 guardrail 模型；Hermes 更偏插件拦截点，不如 OpenAI 抽象稳定。 |
| `permission_policy.py` | **保留** | **Claude Code** | permission mode、规则来源、session/local/project 覆盖关系，这套设计已经比较成熟，而且不只适用于 coding tool。以后扩到桌面自动化、系统 API、App 工具、游戏工具时，这种“规则 + 模式 + 审批来源”的结构仍然成立。 | OpenAI 这块不够像本地工具型 agent；Mini-Agent 没有体系。 |
| `capability_policy.py` | **新增，v0.1 预留薄接口** | **自己定义，参考 Claude Code + Hermes** | 这是现在必须补的层。未来风险判断不能只靠 shell pattern，还要看能力类别，比如“读屏幕”“控制鼠标键盘”“发消息”“修改文件”“执行代码”“调用宿主内部调试接口”。这类能力边界必须独立建模，不然 macOS / 游戏 / App 接进来以后，权限模型会立刻失真。 | Claude Code 有成熟的 permission 现实经验，但能力种类还是偏本地开发工具；Hermes 有多宿主审批/回调面，但没有现成一套可直接搬的 capability taxonomy，所以这里要自己定义。 |
| `sandbox_policy.py` | **调整** | **OpenAI 为主，Hermes 对照** | 如果只是抽执行隔离接口，OpenAI `sandbox/` 的 runtime/session/capability 分层仍然最像可复用设计。但现在要明确：sandbox 只是高风险执行能力的一种隔离手段，不等于整个 safety 层。 | 只看 Hermes 会过早把多后端实现问题带进来；只保留旧说法，又容易误以为“有 sandbox 就等于安全边界完整了”。 |
| `prompt_injection_scan.py` | **后置** | **暂不指定主参考** | 现在没有哪一家给出足够好的独立样板，先留扩展点更务实。 | 为了“看起来完整”硬拆一个模块，最后大概率只是空壳。 |

### observability/（追踪与审计）

这一层也需要补一个定义。  
`observability/` 不是“埋点统计”，也不是“只要能看 token 花了多少”。

对通用 agent 来说，这层至少要回答下面几种问题：

- 这次 run 发生了哪些状态迁移
- 哪个 tool 什么时候被调用、被拒绝、被批准、执行成功还是失败
- 哪些 guardrail / permission / capability policy 命中了
- 哪些事件属于调试 trace，哪些属于可追责 audit
- 哪些数据允许上传，哪些只能本地留存，哪些必须脱敏

如果以后真的要操作电脑、管理资料、接 App 和游戏，没有 audit 和 redaction，光有 trace 是不够的。

| 模块 | 判断 | 主参考项目 | 理由 | 不优先参考另外项目的理由 |
|---|---|---|---|---|
| `trace_sink.py` | **保留** | **OpenAI** | `tracing/` 已经把 trace/span/processor/provider 拆得很完整。 | Claude Code 的可观测性更偏产品埋点和 OTel 接口，不如 OpenAI 在 SDK 抽象上干净。 |
| `event_log.py` | **调整** | **自己定义，参考 Claude analytics + Hermes hooks/events** | 我们需要本地结构化事件流，但它不该只是产品埋点。对你这个方向，更重要的是把 run / turn / tool / approval / state transition / host callback 这些事件串成统一时间线。Claude Code 适合参考工程化事件落地，Hermes 适合参考多宿主事件面。 | OpenAI trace 更偏 span；单抄 Claude analytics 又容易退化成“产品埋点系统”；Hermes 单独也不够像完整本地事件日志。 |
| `audit_log.py` | **新增，v0.1 就该留最小版** | **自己定义，参考 Claude Code permissions + Hermes session hooks** | 这个之前漏了，但现在已经应该加。trace 是给开发者调试的，audit log 是给“事后追责和用户可解释”用的。尤其以后如果 agent 能操作电脑、改资料、调用宿主 API，就必须能回答“它何时做了什么、依据什么批准、结果怎样”。 | 现成项目都没给出完全通用的 audit 模块，但 Claude Code 的审批链路和 Hermes 的 session/hook 事件都说明，这类记录不能混在普通埋点里。 |
| `usage_meter.py` | **保留** | **Claude Code** | `cost-tracker.ts` 已经把 token、cost、model usage、session restore 这些关心点串起来了。 | OpenAI 有 usage 字段，但没有这么完整的本地累计与展示逻辑。 |
| `otel_adapter.py` | **保留** | **Claude Code** | 真要接 OTLP，Claude Code 这种工程化接法更接近目标。 | OpenAI tracing 自成体系，但不等于给出 OTLP adapter 的最佳落地方式。 |
| `telemetry_redaction.py` | **新增，v0.2+ 优先** | **OpenAI + Claude Code** | 这层也值得预留。OpenAI tracing 明确有敏感数据控制思路，Claude analytics 也明确区分一般埋点和受限字段。你后面如果处理本地资料、窗口内容、用户文件、游戏运行态，不可能把原始输入输出直接发到 trace/analytics。 | 只看 OpenAI，会更像 tracing 开关；只看 Claude，会更像 analytics 字段治理。两边合起来才比较像你需要的“导出前脱敏层”。 |

### executors/（LLM 与 runtime）

这一层也要补一个边界，不然很容易和 `core/` 或 `host/` 打架。  
`executors/` 负责的是两类事：

- **模型适配**：把不同 provider 的输入输出接成统一协议
- **运行执行层**：把一次 agent run 真正跑起来

但它**不负责**宿主 UI，也不应该偷偷接管 CLI / HTTP / 游戏 / macOS 的事件流。  
换句话说，`executors/` 处理的是“怎么执行”，`host/` 处理的是“谁来驱动和接收事件”。

这里把“执行壳”说人话一点。  
我这里想表达的不是某个神秘大模块，而是一个很具体的东西：

> **同样一套 `core/runner` 语义，最后总得有一层去真正发模型请求、接流式响应、驱动 tool call、处理中断、收口最终结果。那一层就是运行执行层。**

它更像一个 **runtime driver / execution harness**，不是业务逻辑层。

可以把它理解成这三种典型形态：

1. **进程内执行**
   `core/runner` 直接调用本进程里的 provider adapter 和 tool bus。
   这就是 `agent_runtime/session_engine.py`。

2. **外部子进程执行**
   你的 core 不自己跑完整 agent，而是把任务交给外部 runtime，比如某个 CLI agent，然后通过双向控制协议收消息、审批请求、中断、结果。
   这就是 `agent_runtime/external_runtime_adapter.py`。

3. **远端会话执行**
   本地只保留一个控制端，真正的执行在别的进程、容器、机器、服务里。
   这也是 external runtime 的扩展形态，只是传输层从本地 subprocess 变成 RPC / WebSocket / ACP 一类协议。

所以这层的职责不是“决定 agent 做什么”，而是：

- 把一次 run 初始化起来
- 驱动模型与工具的实际调用
- 处理流式输出 / 中断 / 超时 / 恢复
- 把执行结果整理回 core 可理解的统一结果

它和别的层的区别最好记成一句话：

- `core/` 决定 **agent 语义**
- `executors/` 决定 **agent 怎么被跑起来**
- `host/` 决定 **谁在和 agent 对话**

| 模块 | 判断 | 主参考项目 | 理由 | 不优先参考另外项目的理由 |
|---|---|---|---|---|
| `llm/base.py` | **保留** | **自己定义，参考 OpenAI** | 这里必须自己抽 provider interface，不然一开始就被某家 SDK 锁住。 | 直接继承 OpenAI/Claude 的模型接口，后面接本地模型会很痛。 |
| `llm/openai_responses.py` | **保留** | **OpenAI** | 直接对接 Responses API，没什么争议。 | Claude/Mini-Agent 都不提供这一路。 |
| `llm/anthropic_messages.py` | **调整** | **Claude Code + 自己定义** | Claude Code 很适合参考 Anthropic 的流式消息处理、tool use 消息拼装和本地 runtime 配合，但最终仍然应该收敛成你自己的 provider adapter，不能把 Claude 的消息语义直接扩散进通用内核。 | Mini-Agent 有 Anthropic client，但更像简化封装；单抄 Claude 又容易把 provider 适配和产品消息结构绑死。 |
| `llm/local_openai_compat.py` | **调整** | **自己定义，Mini-Agent 起步，Hermes 对照** | v0.1 先把本地 OpenAI-compatible provider 接进去就够了，Mini-Agent 更轻。但模块本身最好按“兼容 provider adapter”自己定义，不要把 Mini-Agent 的客户端形状直接固化。 | Hermes 的智能路由和策略更适合后续，不适合第一版 provider；直接照 Mini-Agent 抄，后面扩本地 provider 时容易卡住。 |
| `agent_runtime/session_engine.py` | **调整** | **自己定义，参考 OpenAI + Hermes** | 这是你自己的**进程内运行执行层**。它的工作不是重新定义 agent，而是把一次 run 在本进程里稳定跑完：调模型、接 tool call、吃流式事件、处理中断和结束。OpenAI 适合参考 run semantics，Hermes 适合提醒你 runtime 以后会面对长生命周期、可中断、可恢复这些问题。 | 直接照 OpenAI，会更像 SDK 调用壳；直接照 Hermes，又会把平台/gateway 侧杂质带进来。 |
| `agent_runtime/external_runtime_adapter.py`（替代 `claude_runtime_adapter.py`） | **改名** | **cc-agent-sdk** | 这是**外部运行执行层适配器**。意思是：agent 不在你当前进程里跑，而是在外部 CLI / 子进程 / 远端 runtime 里跑，你这里只负责通过控制协议和它对话。这里需要改名，因为你以后不一定只接 Claude runtime。真正值得借的是 cc-agent-sdk 的“外部 agent 作为 subprocess / control protocol 对接”的模式。 | 继续叫 `claude_runtime_adapter.py` 会把架构提前锁到单一 vendor；直接看 Claude Code 主仓会把大量产品内部细节带进来。 |
| `agent_runtime/external/claude_code_adapter.py` | **后置，按需再落地** | **cc-agent-sdk** | 如果后面真的要把 Claude Code 当外部执行器，再单独放一个 vendor adapter 会更干净。这样 core/runtime 抽象先成立，具体接哪个外部 agent 是后面的事。 | 现在先把 vendor adapter 放进 v0.1 主路径，收益不大，还会让 runtime 分层看起来像“为 Claude 预留”。 |

### cli/（命令行入口）

CLI 这一层也不能再只写成“一个 main 文件”。  
因为对你来说，CLI 只是第一个宿主，不是产品本体。

更合理的理解是：

- `cli/main.py` 负责启动、参数、选择宿主模式
- 交互式输入输出、流式渲染、审批弹窗、interrupt 等，属于 CLI 交互壳
- 真正的会话执行还是走 `host/cli_adapter.py` → `core/runner.py`

不把这层拆开，后面桌面版和游戏版很容易只能复用 core，复用不了交互语义。

| 模块 | 判断 | 主参考项目 | 理由 | 不优先参考另外项目的理由 |
|---|---|---|---|---|
| `main.py` | **调整** | **自己定义，Mini-Agent 起步** | `main.py` 更适合作为启动入口和模式分发，不应该承载完整交互逻辑。Mini-Agent 适合帮你先把最小启动路径立起来。 | 如果继续把 CLI 全塞进一个入口文件，后面会越来越难和其他宿主共享语义；Claude Code 的入口又太重，不适合第一版照搬。 |
| `repl.py` / `session_shell.py` | **新增，v0.1 就值得拆** | **Claude Code + Mini-Agent** | 交互式 CLI 真正复杂的是这里，不是 `main.py`。流式输出、审批等待、用户中断、会话恢复，这些都更像独立交互壳。Claude Code 值得参考交互语义，Mini-Agent 适合参考最小实现。 | 不单独拆，CLI 代码会很快把 host 逻辑、UI 逻辑、session 控制混在一起；只看 Mini-Agent 又容易把交互语义做得过薄。 |

### api/（可选 HTTP 入口）

| 模块 | 判断 | 主参考项目 | 理由 | 不优先参考另外项目的理由 |
|---|---|---|---|---|
| `chat_api.py` | **保留** | **Mini-Agent 起步，Hermes 对照** | 如果要做 HTTP/SSE，对我们来说先有薄接口就够；Mini-Agent 的 ACP server 更适合起步。 | Claude Code 主体不是 HTTP-first 产品；OpenAI SDK 也不是直接给你本地 chat_api 样板。 |

### host adapters / bridges（宿主适配层，新增）

这一层不是 core，但对产品方向非常关键。它解决的是“同一个 agent core 怎么接进不同宿主”。

这里还要再补一句：  
`host/` 不是简单的“输入适配器目录”，它本质上应该是 **duplex session bridge**。

也就是说，它既要接住宿主发来的东西：

- 用户输入
- 中断
- 审批结果
- 宿主上下文

也要把 agent 运行时产生的东西送回宿主：

- token / message / tool 事件
- approval request
- state change
- final result

如果没有这层双向 bridge，CLI、HTTP、游戏、macOS 桌面最后都会各自偷偷长出半套 runner。

| 模块 | 判断 | 主参考项目 | 理由 | 不优先参考另外项目的理由 |
|---|---|---|---|---|
| `host/base.py` | **新增，v0.1 就该预留** | **自己定义，参考 cc-agent-sdk / Mini-Agent ACP / Hermes** | 需要一个宿主无关协议，把输入、事件流、审批请求、回调能力统一起来，不然以后 CLI / 游戏 / 桌面会各写一套。cc-agent-sdk 和 Mini-Agent ACP 证明双向协议很重要，Hermes 则证明多宿主现实里一定会遇到这层。 | OpenAI 没有现成的 host bridge 抽象；Claude Code 的 bridge 太偏它自己的产品形态。 |
| `host/session_bridge.py` / `host/event_bridge.py` | **新增，v0.1 就值得拆薄层** | **cc-agent-sdk + Hermes** | 这一层之前漏了，但其实很关键。它专门负责 run-time 事件的双向桥接：宿主发输入/interrupt/approval，agent 发 message/tool/approval/state 事件。没有这层，`host/*_adapter.py` 很快会各自长出重复逻辑。 | 只靠 `host/base.py` 一层描述不够落地；Hermes 的 gateway stream consumer 和 cc-agent-sdk 的 control protocol 都说明，事件桥接本身就是一层独立复杂度。 |
| `host/cli_adapter.py` | **调整** | **自己定义，Mini-Agent 起步，Claude Code 对照** | CLI 只是第一个宿主，适合用最轻实现先接 core，但它仍然应该通过统一 session bridge 来收发事件，不该直接绑进 runner。Claude Code 值得对照审批/中断/流式语义。 | 不能让 CLI 直接代表整个产品架构，否则以后很难抽离；只看 Mini-Agent 又容易忽略交互宿主的复杂控制流。 |
| `host/http_adapter.py` | **调整** | **自己定义，Mini-Agent ACP + cc-agent-sdk + Hermes 对照** | 这个模块不该只是“开一个 chat POST 接口”。如果真要给其他 app 或游戏接入，它至少要考虑 streaming、interrupt、approval、session continuation，所以更像一个轻量双向 session host。 | Claude Code 不是面向嵌入式 app/game 接入设计的；如果只学 Mini-Agent 的最薄 HTTP 入口，后面很快又要重写。 |
| `host/game_adapter.py` | **后置但必须在架构上预留** | **自己定义，参考 Hermes gateway 思路** | 游戏接入不是“再写一套 agent”，而是复用 core，把游戏调试工具、游戏事件流、游戏内 UI 接到 adapter 上。 | 现成项目里没有直接等价样板，只能借 Hermes 的 gateway/platform 分层思想，不能生搬。 |
| `host/macos_adapter.py` | **后置但必须在架构上预留** | **自己定义，参考 Hermes 多宿主分层思路** | macOS API、自动化、资料管理都应该挂在平台适配层，不进入 core。以后它更像一个高权限宿主，要接 capability policy、approval、audit，而不是直接把平台 API 丢给 core。 | 现在提前做进 core，会把平台依赖锁死；现成项目也没有可直接照抄的 macOS host 样板。 |

### v0.2+ 才碰的东西（校正版）

| 模块 | 判断 | 主参考项目 | 理由 | 不优先参考另外项目的理由 |
|---|---|---|---|---|
| `integrations/bridge/` | **后置** | **Claude Code** | 如果未来真有 IDE/远控接入，再学 `src/bridge/`；但它显然不是 v0.1 骨架。 | 现在先拆 `bridge/` 会把远程控制、JWT、连接恢复这些产品问题提前带进来。 |
| `coordinator/` | **后置** | **Claude Code** | 多 agent 协调可以参考 Claude Code，但前提是单 agent 核心已经稳定。 | Mini-Agent 的 team 能给思路，但不够作为通用协调器样板；OpenAI handoff 也不等于 coordinator。 |
| `plugins/` | **后置** | **Claude Code + Mini-Agent** | 如果做代码级扩展点，两者都值得看，但这是二期能力。 | v0.1 还没有稳定内核，先做插件系统只会把边界做虚。 |
| feature flags | **后置** | **Claude Code** | 真到了多实验特性并行的时候，Claude 的做法有价值。 | 在功能还少的时候引入 flags，只会增加理解成本。 |
| `services/extract_memories.py` | **后置** | **Claude Code** | 应该明确它是 service，不是 memory 核心模块。 | 放进 `memory/` 容易把“自动抽取”误写成基础存储职责。 |
| `services/team_memory_sync/` | **后置** | **Claude Code** | 这是协作增量能力，不是第一版骨架。 | 现在就做，投入大、通用性差。 |
| learning loop | **后置** | **Hermes** | 这个方向是对的，但得等基础能力稳定。 | Claude/OpenAI 在这里都不是强参考。 |
| benchmark env | **后置** | **Hermes** | 自动评估环境很有价值，但明显是更长期建设。 | v0.1/v0.2 还没把主能力做稳，不该先追 benchmark 基础设施。 |

---

## 2. 分阶段做什么

### v0.1（第 1–4 周）——能跑起来

目标：**先做出一个宿主无关的通用 agent 内核：能接 OpenAI/Anthropic，能调 tools，能走审批，能压缩历史，能追踪。Read/Write/Edit/Bash 只是第一批工具，不代表产品只做 coding。**

**第 1 周（骨架）**
- `core/agent_spec.py` + `core/runner.py` + `core/run_state.py` + `core/lifecycle.py` + `core/message.py` + `core/result.py` + `core/errors.py`
- `host/base.py`（只定义宿主适配协议，不做复杂实现）
- `host/session_bridge.py`（最小双向事件桥：input / message / approval / result）
- `context/session_store.py`（SQLite 版）
- `observability/trace_sink.py`（基础版）
- `observability/audit_log.py`（最小本地审计记录，只记 run / tool / approval / error）
- `executors/llm/base.py` + `executors/llm/openai_responses.py`
- **验收**：能跑一次"LLM → 文本响应"的单轮，无工具。

**第 2 周（工具与审批）**
- `tools/base.py` + `tools/registry.py`
- `tools/file_tools.py`（Read/Write/Edit，Mini-Agent 简版）
- `tools/shell_tool.py`（Mini-Agent 简版，不含分类器）
- `tools/approval.py`（**只做层 1 + 层 2**：规则匹配 + PermissionMode；层 3 classifier 留给 v0.2）
- `tools/hooks.py`（PreToolUse / PostToolUse 骨架）
- `safety/guardrails.py`（input / output tripwire）
- `safety/permission_policy.py`
- `safety/capability_policy.py`（先只定义 capability 枚举和最小判定接口）
- `context/history_compactor.py`（**只做 auto-compact**）
- **验收**：能跑"LLM 发出 tool_call → 审批 → 执行 → 结果回填 → 下一轮"，历史超阈值会压缩。

**第 3 周（上下文与 MCP）**
- `context/context_engine.py`（先只放最薄接口，默认接 auto-compact 策略）
- `context/instruction_loader.py`（先支持 CLAUDE.md / 项目规则；名字保持通用，不写死 coding project）
- `context/skill_loader.py`（只做 skill discovery / metadata / 渐进披露，不做 skill 执行）
- `context/input_assembler.py`（把 attachment / memory / 文件引用 / 宿主临时上下文并入输入组装层，不单独拆 loader）
- `tools/mcp/client.py` + `tools/mcp/adapter.py`（只做 stdio 传输）
- `executors/llm/anthropic_messages.py`
- **验收**：能加载规则/指令 + skills 元数据 + 宿主注入上下文，并接一个 MCP server。

**第 4 周（记忆接口 + runtime adapter）**
- `memory/memory_store.py`（接口）+ `memory/profile_store.py`（先做轻量 profile / project facts，不直接照搬 memdir）
- `observability/usage_meter.py` + `observability/otel_adapter.py`
- `executors/agent_runtime/session_engine.py`
- `host/cli_adapter.py` + `cli/main.py` + `cli/repl.py`（CLI 只是第一个宿主；入口和交互壳分开）
- `host/http_adapter.py`（最小嵌入入口，但按 session bridge 方式做 streaming / interrupt 预留）
- **验收**：能记住用户偏好 / 项目事实；CLI 能跑，外部 app 也能通过最小接口驱动同一套 core。

**v0.1 不做**：3 层权限的层 3、bash classifier、micro/reactive/collapse compact、bridge、coordinator、plugins、learning loop、sandbox 实现、prompt injection scan、feature flags。

---

### v0.2（第 5–8 周）——能给人用

目标：**生产可用的通用本地 agent runtime，权限/压缩/记忆/追踪先对齐 Claude Code 这类成熟本地 agent 的水准。**

- `tools/approval.py` 补**层 3**：`bashClassifier` + `yoloClassifier`（照抄 Claude Code 逻辑）
- `context/history_compactor.py` 补：`micro-compact`（工具结果太大时单条压缩）+ `reactive-compact`（feature flag）
- `services/extract_memories.py`：自动触发版（LLM 驱动事实抽取）
- `memory/providers/` 或 `memory/external_memory_provider.py`：外接记忆后端抽象，优先参考 Hermes provider 模式；`mem0` 作为首个可选后端参考
- `tools/shell_tool.py` 补：interrupt / resume / streaming 输出（对齐 HITL 语义）
- `observability/telemetry_redaction.py`：导出 trace / analytics 前的脱敏层
- `safety/sandbox_policy.py`：**只定义接口**，落地借 OpenAI `extensions/sandbox/` 里最轻量的一个（比如 e2b 或 vercel）
- `observability/trace_sink.py` 补：spans + run tree 可视化
- `api/chat_api.py`：HTTP/SSE 入口
- `executors/agent_runtime/external_runtime_adapter.py`：预留外部 agent/runtime 接入抽象
- `tools/registry.py` 补：按 feature flag 条件导入
- `coordinator/`（雏形）+ `tools/agent_tool.py`：支持子 agent 派发
- `host/game_adapter.py`（如果游戏接入优先级高，这一阶段开始做第一版）

**v0.2 不做**：bridge、plugins、learning loop、team_sync、多后端 sandbox。

---

### v0.3（第 9–12 周）——能自我成长 + IDE 集成

- `memory/learning_loop.py`：从会话沉淀 skill / memory（Hermes 模式）
- `services/team_memory_sync/`：团队记忆同步接口（Claude Code `teamMemorySync` 模式）
- `integrations/bridge/`：IDE ↔ CLI 双向桥（Claude Code 模式 + cc-agent-sdk 协议）
- `plugins/`：代码级扩展点
- `safety/sandbox_policy.py`：落地 2–3 个后端（Docker / E2B / Daytona 任选）
- `safety/prompt_injection_scan.py`：基础版
- `coordinator/`：完整多 agent 协调（含 TeamCreate / InProcess / Remote）
- `executors/llm/local_openai_compat.py`：接本地模型
- feature flags 机制（如果团队需要）
- `platforms/macos/` 或同类系统适配层：开始接第一批 macOS 能力，但仍放在 core 之外

---

### v0.4+（长期）

- benchmark 环境（Hermes `environments/benchmarks/`）
- 多种 LLM provider 智能路由（Hermes `smart_model_routing.py`）
- 更激进的压缩策略（`context_collapse` / `history_snip`）
- 多消息平台 gateway（Hermes `gateway/platforms/`）
- macOS 之外的平台适配层（Windows / Linux / 移动端）
- 资料管理、桌面自动化、系统 API 编排等通用 agent 能力完善

---

## 3. 和 v1 对比的关键变化清单

1. **新增 `core/lifecycle.py`**（独立于 `tools/hooks.py`）——run-level 钩子 vs tool-level 钩子，不是一回事
2. **新增 `core/errors.py` 分层错误模型**（v1 只提一笔）
3. **把 `context/attachment_loader.py` 改成 `context/input_assembler.py` 思路**——AttachmentMessage 值得学，但它本质上是输入组装问题，不适合独立成 loader
4. **把自动记忆与团队同步从 memory 核心层挪到 service 层**——`services/extract_memories.py`、`services/team_memory_sync/`
5. **`tools/approval.py` 从"学 Claude SDK 类型"升级为"照抄 Claude Code 3 层决策链 + bash classifier"**
6. **`context/history_compactor.py` 的策略改成分阶段借鉴**——v0.1 先学 Mini-Agent 自动摘要，v0.2 再补 Claude Code 的 micro/reactive 等高级策略
7. **`memory/profile_store.py` 不再直接改抄 Claude Code `memdir/`**——v0.1 先用 Hermes 风格轻量记忆，`memdir` 留到后续增强
8. **`safety/sandbox_policy.py` 接口参考从 Hermes 改为 OpenAI `extensions/sandbox/`**
9. **`observability/usage_meter.py` 主抄源从泛指 OpenAI/Claude 改为明确的 Claude Code `cost-tracker.ts`**
10. **明确 v0.2+ 的扩展模块边界**：`integrations/bridge/`、`coordinator/`、`plugins/`、`feature flags`、`services/team_memory_sync/` 各自后置，不再提前伪装成 v0.1 核心骨架
11. **补充产品方向约束**：长期目标是 Hermes 式通用 agent，但 v0.1 只做通用内核，不把 macOS API、多平台应用、资料管理这些 roadmap 能力提前塞进 `core/`
12. **补充宿主分层约束**：CLI、游戏、桌面 App 都只是不同宿主；`core` 只负责 loop / state / tool orchestration，宿主差异放到 `host/*_adapter.py`
13. **重写 `context/` 的定义**：不再把它理解成“项目上下文加载区”，而是 agent session context management + input assembly
14. **把 `context/project_context_loader.py` 改成 `context/instruction_loader.py`，并补 `context/context_engine.py`**：前者去掉 coding-only 味道，后者吸收 Hermes 的可插拔上下文策略思想
15. **补上 `mem0` 的正确位置**：它值得参考，但更适合作为 v0.2+ 的 `external memory provider`，而不是 v0.1 的内建 memory core
16. **重写 `safety/` 的判断标准**：不再把安全理解成“shell/file 风险控制”，而是拆成 guardrails、approval、capability boundary、execution isolation 四层
17. **给 `safety/` 新增 `capability_policy.py`**：因为未来接 macOS API、computer use、App 工具、游戏调试工具时，风险边界已经不是简单命令模式匹配
18. **重写 `observability/` 的定义**：不再只盯 trace 和 cost，而是补进 state transition、approval、audit、telemetry redaction
19. **给 `observability/` 新增 `audit_log.py` 和 `telemetry_redaction.py`**：前者解决“做过什么、为什么允许、结果如何”，后者解决“哪些观测数据允许导出”
20. **重写 `executors/` 的边界**：这层只管 provider 适配和执行壳，不再混入宿主事件流；外部 agent 接入改成通用 `external_runtime_adapter`
21. **把 `cli/` 从单入口改成“启动入口 + 交互壳”**：`cli/main.py` 不再承担所有交互复杂度，`cli/repl.py` 单独承接 streaming / interrupt / approval / resume
22. **补上 `host/session_bridge.py`**：宿主层不只是输入适配器，还需要双向 session/event bridge 来承接 input、interrupt、approval、tool 事件和最终结果
