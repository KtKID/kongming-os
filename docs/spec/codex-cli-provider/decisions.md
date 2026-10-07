---
description: codex-cli 接入讨论过程的技术抉择时间线：每轮拍板的结论、理由与被后续修订的关系，供方案评审与后续决策对照。
---

# 技术抉择记录

`@kmh/codex-cli` 需求讨论与实施过程中的拍板记录，按时间顺序编号。被后续修订的决策保留原文并标注修订关系；[spec.md](spec.md) 的场景始终反映最终生效语义，本页负责"为什么"。

## D1 需求输入与基线

接入方式采用官方 `codex app-server --stdio` 行协议，进程生命周期覆盖完整 KMH 回合；职责划分为 KMH 管技能、工具权限、工具执行与外层回合控制，Codex 管内部模型续推与原生历史。首个支持基线锁定调研验证所用的 0.160.0（vendored 官方模型目录与协议形态随基线绑定）。工具桥建议为稳定 `kmh_call_tool` 调用桥；实施期实测官方平铺真名声明即可满足，且 canonical namespace 的模型侧名称是无点拼接（`kmh`+名），故采用平铺真名、兼容监听新旧两个回调方法名。

## D2 登录状态与退出验收

登录状态按本地凭据存在性判定，不发起请求验证；真实可用性以测试连接为准。退出账号操作作用于本机 Codex CLI 登录态，验收不执行真实退出（避免登出正在使用的账号），以实现检查为准。

## D3 原生工具与技能开关（扩展需求见 D12）

详情页提供"使用原生 Codex 工具与技能"开关，默认关闭即仅用 KMH 的；切换立即保存显示，进行中回合不受影响，下一回合生效。

## D4 不改 DSH 底层

插件只经公开插件服务接入宿主（llm 注册、connection 路由、sessions、subprocess、界面槽位），禁止对 DSH 底层的私有改动。背景：zcode-cli 曾为账号登录与停止语义改动子模块，该类改动将被还原，独立发布件不得依赖。

## D5 差分投递

DSH 每次调用携带全量历史而 Codex thread 自持历史，adapter 以逐条消息指纹的差分游标对齐已投前缀、只投尾部增量：新用户输入发起 turn，工具结果作为挂起中服务端请求的延迟回执写回并续推同一 turn；system 提示与工具目录在 thread 创建时绑定。用户输入的其余部分不重复投递。

## D6 分叉与工具超时

分叉（含编辑/重发历史消息，后者等同从该点分叉）创建新绑定并携带分叉点前历史，实施采用官方 `thread/fork` 原生分叉，失败回落新建 thread 注入重建历史。工具执行超时按 KMH 侧时限，超时作为结果回传，不存在无结果的自动续推。

## D7 CODEX_HOME 独立（已被 D9 修订）

为根治用户 MCP 设备进入模型可见集的问题，曾拍板 CODEX_HOME 指向 KMH 数据目录下的独立 codex home（config 由插件写入）。该方案消灭了 MCP 残留，但导致本机登录不能共享。

## D8 禁改配置文件

无论 CODEX_HOME 指向何处，禁止修改任何 Codex 配置文件：一切隔离经进程 `-c` 参数注入、仅影响单次调用。D7 期间曾落盘 config.toml，按本条撤回。

## D9 最终方案（修订 D7）

CODEX_HOME 沿用用户默认 `~/.codex`：共享登录、无需额外登录；代价是用户 MCP 设备可见（`-c` 压不掉且清空覆盖会重置用户禁用状态，已接受）。共享 home 的连带——用户 hooks.json 钩子会在插件回合触发——拍板关闭：探针发现钩子后经 `hooks.state` 逐键禁用，同样仅进程参数生效。

## D10 压缩归属（修订早前"两边同步"）

早前拍板压缩后内容全量回传、KMH 覆盖本地历史；最终修订为压缩由 Codex 在 thread 内原生处理：模型侧自动续用压缩结果，KMH 侧历史与差分基线不受影响，KMH 发起的压缩请求被明确拒绝。

## D11 工作目录一致

官方 CLI 的工作目录跟随 KMH 当前会话的工作目录（沿用 zcode-cli 的会话目录跟随机制），查不到会话目录时回落插件配置 cwd。

## 实施期补充事实

- 模型目录的推理等级在 wire 上为 `supportedReasoningEfforts` 键、`{reasoningEffort, description}` 对象数组，思考等级选择据此映射。
- 共享 home 下用户 `~/.codex/hooks.json` 的 userPromptSubmit/stop 钩子默认会在每个回合执行（与桌面 Codex 行为一致），按 D9 禁用。
- 独立发布与混部验证、真实账号多轮对话等验收项见各 task checklist 的状态与实施记录。

## 2026-10-07 扩展需求与拟实施方案

以下记录本次扩展需求、源码核查与推荐实施方案。D1–D11 保留原交付的决策历史；新需求的用户行为以 [spec.md](spec.md) 为准，配置默认值见该页待确认清单。这里的实施步骤属于待开发方案，已有图片生成功能继续沿用。

### D12 交付范围与职责

用户要求 Codex CLI 同时使用原生工具与 KMH 工具，原生执行信息在 KMH 实时可见，审批转交 KMH 用户决定。图片生成已有实现，本次补齐其余工具，并核查既有图片的尺寸交付。

KMH 持有提示、上下文输入、KMH 技能、KMH 工具执行、用户审批和外层回合；Codex 持有内部模型续推、原生工具执行与原生历史。`item/tool/call` 延迟回执沿用已实现的挂起与续推流程。原生执行通知通过单独的观察记录展示，执行归属保持明确。

允许清单替代一键撤销隔离：保留基础隔离，再按清单开放经过验证的能力。原生技能独立配置，用户/项目钩子继续禁用，隔离经进程和 thread 参数注入，用户 Codex 配置文件保持原样。旧总开关需要明确转换规则并显示迁移后的选择。模型目录、功能开关、账号与扩展装载共同决定能力可用性；每个清单项验证实际模型可见工具，配置失效时在准备阶段报错。参考 [isolation.ts](../../../packages/codex-cli/src/isolation.ts) 与 [config.ts](../../../packages/codex-cli/src/config.ts)。

### D13 工具名称与旧会话

KMH 工具对 Codex 统一声明为 `kmh-<原名>`。adapter 保存声明名与 KMH 注册名的双向表，投递、返回解析与工具引用转换全部由代码完成。按声明表精确解析返回名称，旧会话按其声明版本解析；未知名称作为明确错误处理。前缀后的名称按官方接受范围校验，并开启可用的工具冲突报错能力；前缀本身仍需碰撞检查。

提示中的结构化工具引用按同一映射渲染，普通自然语言、用户内容与历史正文保留原文。任意正文整词替换会改写普通词义，只加前缀说明也会把名称转换交给模型；实施时优先定位工具引用的生成处。

绑定记录增加工具声明版本、目录指纹与名称映射。`thread/start` 声明动态工具，当前基线的 `thread/resume` 与 `thread/fork` 继承既有工具集。新回合先比较实际工具目录；目录变化时创建可重新声明工具的新 thread，按既有历史重建规则恢复上下文并更新绑定。旧会话延续或迁移的选择须与最新工具目录承诺一致。仅兼容带前缀和裸名的回调覆盖了返回解析，目录更新还需要上述重建路径。参考 [turn.ts](../../../packages/codex-cli/src/turn.ts)、[session-store.ts](../../../packages/codex-cli/src/session-store.ts) 与 [cursor.ts](../../../packages/codex-cli/src/cursor.ts)。

官方工具名拥有 namespace 与 name 两个字段，具体声明方案以模型实际接受结果验收；`ToolName::Display` 的字符串格式只覆盖一种表示形式。D1 的平铺方案保留历史记录，本次继续采用显式前缀与映射表。官方动态工具冲突默认可跳过并告警，严格冲突开关的支持情况随版本核对。

### D14 原生信息透传与进度

使用 app-server 的结构化通知记录原生工具状态，通过 KMH 插件的公开 session 事件和对话视图扩展呈现；原生观察记录独立于会触发 KMH 执行的 `StreamChunk` 工具调用。按 session/thread/turn/item 关联更新，同一次原生调用保持单次执行，重复事件归并，刷新和恢复读取已保存记录。

| 原生操作 | 可透传的信息 | 展示要求 |
| --- | --- | --- |
| 命令执行 | `item/started`、`item/commandExecution/outputDelta`、`item/completed` | 命令、工作目录、输出增量、完成状态与退出信息 |
| 文件修改 | 文件操作 item、`turn/diff/updated` 与可提供的输出 | 文件列表、变更内容与状态；turn 级 diff 按其范围展示 |
| MCP 调用 | item 生命周期与 `item/mcpToolCall/progress` | 服务、工具、可提供的阶段和最终结果 |
| 搜索、查看图片等 | 对应 item 的实际可用信息 | 操作摘要与状态，提供多少过程信息就展示多少 |
| 图片生成 | imageGeneration 开始、完成及产物 | 执行中、等待时间、结果与图片；当前协议提供生命周期状态 |

过程输出分批合并并限制记录体积，完整大输出使用宿主既有附件或溢出能力。需要原始调用参数时按本机版本评估 `experimentalRawEvents` 与 `rawResponseItem/completed`，与标准 item 按调用标识去重。base64 媒体走附件，凭据与原始传输头保持在专有传输层。

公开扩展点参考 [session](../../../third_party/dsh/packages/core/session/src/index.ts) 和 [ui-conversation](../../../third_party/dsh/packages/client/ui-conversation/src/client/conversation/assembly.ts)。新增持久事件须明确旧宿主的读取兼容性；若所需公开能力缺失，先记录缺口和宿主版本要求，再确定接入方式。插件独立分享的约束继续生效。

### D15 用户审批与服务端请求

原生命令、文件修改与权限申请采用能产生用户审批请求的策略，并显式核对 reviewer 为用户路径。`approval_policy=never` 会抑制升级审批，与用户要求的等待决定流程存在语义差异。本机基线审批拒绝回执为 `decline`，以生成 schema 核对各方法的准确字段。

| 服务端请求 | 处理方向 |
| --- | --- |
| `item/tool/call`，以及已支持的旧动态工具方法 | 按映射交给 KMH 执行，结果写回原请求 |
| `item/commandExecution/requestApproval` | 展示真实命令和授权范围，用户决定映射为方法声明的决定值 |
| `item/fileChange/requestApproval` | 展示文件修改请求；详细变更优先关联此前的 fileChange item |
| `item/permissions/requestApproval` | 只授予用户明确批准的权限与有效期 |
| `item/tool/requestUserInput` | 展示问题与选项，按声明的答案结构回传 |
| `mcpServer/elicitation/request` | 按请求的输入或外部授权类型展示并处理答复、拒绝与取消 |
| 时间、attestation、账号 token 刷新等请求 | 逐项核对当前版本及部署所需能力，使用对应处理器；未知请求返回明确错误 |

桥通过公开 `approval.request()` 接入，或将审批投影为模型工具目录之外的内部 KMH 工具。采用内部工具时，权限入口须明确产生 `ask`；注册工具后的默认允许行为需要单独处理。审批请求在当前 KMH 会话已打开的 turn 内发起，遵循该会话审批策略，将 `allowed-once`、`rejected`、`cancelled`、`unavailable` 分别映射到对应原生结果。内部工具只负责用户决定，原生命令仍由 Codex 执行。

挂起请求保存请求 id、类型、session/thread/turn/item 及一次性完成状态。批准、拒绝、停止、断连和超时统一收口；迟到或重复答案按过期或已完成处理。缺少审批入口时拒绝权限升级并记录可读原因。进程存活且当前 turn 挂起时直接回执同一个请求；进程失联后按恢复状态处理，副作用不确定的操作保留待确认记录。参考 [turn.ts](../../../packages/codex-cli/src/turn.ts) 和公开 [user-approval](../../../third_party/dsh/packages/interaction/user-approval/src/index.ts)。

### D16 图片尺寸与接入验收

已核查的银河会话实际调用了 `image_gen.imagegen`，原生产物为 1254×1254，用户要求 256×256，模型最终报告为 256×256。调查记录保存在私有 `reports/cr/cr-report-20261007-153312.md`，原图与原生工具返回的字节一致。

原生工具名与执行路径以调用记录确认；Work/Chat 界面分类需要对应客户端和服务端证据。官方 0.160.0 生图工具参数只包含提示、透明背景与编辑图片引用，内部生成请求采用 `size="auto"`；本次实际执行版本为 0.162.0-alpha.2，其服务端原始生图请求未被本次调查捕获。精确像素要求应以产物元数据验证，再根据授权调用可用工具另存目标尺寸副本。验收同时检查原图、交付图、KMH 附件、实际像素和最终回复。

官方源码依据：[工具参数与生成请求](https://github.com/openai/codex/blob/rust-v0.160.0/codex-rs/ext/image-generation/src/tool.rs)、[生图 backend](https://github.com/openai/codex/blob/rust-v0.160.0/codex-rs/ext/image-generation/src/backend.rs)。现有 KMH 投影入口见 [protocol.ts](../../../packages/codex-cli/src/protocol.ts) 与 [turn.ts](../../../packages/codex-cli/src/turn.ts)。

### D17 权限模式三档映射与验收从简（2026-10-07 用户拍板）

feat09 的审批与执行范围跟随 KMH 会话权限模式，不再由插件自定审批策略：KMH Web 权限设置的原“工作区内修改”改为“请求审批”，新增“帮我审批”，“完全权限”沿用——三档对应官方 CLI 的同名模式。预设表经 kmh-web profile 配置（`presets` 各项的 `name` 字段，非 kebab 文案由客户端原样透传），无需改动 DSH 客户端。

| KMH 权限模式 | 旋钮（sandbox + approval） | 官方 CLI 映射 | 审批行为 |
| --- | --- | --- | --- |
| 请求审批 | workspace-write + ask | workspace-write，审批请求经桥转用户 | 场景1–5 流程，单次请求授权 |
| 帮我审批 | workspace-write + never | workspace-write，不询问 | 原生工具沙箱内自主执行 |
| 完全权限 | danger-full-access + never | 完全访问，不经沙箱与审批 | 直接执行 |
| 仅可查看 | read-only + ask | read-only | 保持只读 |

插件经公开 `permissionPresets`/`sessionProjections` 读取会话生效档位，映射为进程 `-c` 参数；D15 的审批桥只在请求审批档生效（never 档官方不产生审批请求，与 KMH 侧 ask/never 语义一致）。

同轮拍板：R1 确认（feat02 默认集合）；R3 图片尺寸从简——如实显示实际与要求尺寸、完成状态反映实际交付，撤销另存交付图方案，feat10 收敛为 3 场景。

### D18 审批桥接入路径（2026-10-07 实施期拍板）

T1 两路核对结论：采用**公开服务直连**，否决内部工具投影。事实依据：

- `GenerateOptions` 不携带 Agent（仅 sessionId），但 `ctx.agents.get(sessionId)`（`@deepseek-ai/dsh-agent` 公开 AgentRegistry）可取到活跃 Agent；模型请求进行中 agent 会话必为开放 turn，满足 `approval.request()` 的审计对前置。
- 三类 requestApproval 走 `ctx.approval.request({agent, toolName, reason, signal})`，四态映射：`allowed-once`→accept（单次请求授权，R2）、`rejected`→decline、`cancelled`→cancel、`unavailable`→decline（fail closed，可读原因由桥记录日志）；permissions 档拒绝回空授权（scope=turn，只授予请求声明的范围）。
- 用户输入与 MCP elicitation 需要结构化答案（approval 四态带不动），走 `ctx.userQuestions.ask()`（`@deepseek-ai/dsh-user-questions` 公开服务）：requestUserInput 问题逐条映射、答案按 `{answers:[...选中+自填]}` 回填；elicitation 表单按 requestedSchema 属性逐个映射（枚举→选项、其余→自填），答案组装回 content 对象；无应答者（NO_PROVIDER）→decline、中止→cancel。
- 内部工具投影被否决：需要伪造模型可见工具调用与权限链挂钩，复杂且污染对话历史；公开直连零模型侧痕迹。
- 未知服务端请求：handler throw → 行协议 `-32603` 错误回执（sdk protocol `handleIncomingRequest` 实测语义），Codex 侧收到明确失败。
- 一次性语义结构性保证：每个服务端请求 id 恰有一次回执（transport 每 id 写一帧）；停止/中断经回合级 AbortController 使 `approval.request` 归结 cancelled、`userQuestions.ask` 抛 ASK_ABORTED，映射 cancel。
- wire 形态依据 0.160.0 生成 schema（`app-server-protocol/src/protocol/v2/{item,permissions,mcp}.rs`）：command 决定值 accept/acceptForSession/acceptWithExecpolicyAmendment/applyNetworkPolicyAmendment/decline/cancel（桥只发 accept/decline/cancel）；fileChange 同形；permissions 回 `{permissions, scope: turn|session}`；userInput 回 `{answers: Record<id,{answers:string[]}>}`；elicitation 回 `{action: accept|decline|cancel, content?}`。

### D19 原生进度 v1 形态与宿主缺口（2026-10-07 实施期拍板）

T1 扩展点调查结论：完整形态（独立持久观察记录 + 对话卡片 + 结构化刷新恢复）依赖宿主新增公开扩展点，当前基线没有：

- `Session.append` 无法写 `ignorable` 标记（签名不含该字段，事件构造也不注入）；插件自定义会话事件类型会被持久化读取路径按"未知必需事件"拒绝重载（surface 兼容门），旧宿主会话被破坏。
- `uiConversation.events.register` 的对话 Definition 按会话事件类型路由——写不进事件就无从挂卡片。
- 流块类型封闭（text/reasoning/tool-call/image），无插件扩展块。

v1 落地（既有公开通道，与生图附注同形态）：原生活动叙述为助手消息内**独立文本块**——`item/started` 开块（来源+操作摘要+执行中）、`item/commandExecution/outputDelta`/`item/mcpToolCall/progress` 增量追加（单条上限 8000 字符、超限截断标注）、`turn/diff/updated` 摘要行（+−行数、20 次封顶）、`item/completed` 收尾（状态/退出码/耗时）、回合终局未收尾补"待确认"。差分账目（blockDigest）自动识别叙述块为 Codex 自产内容，刷新/重开随会话历史可查；block-end 携带累积全文（差分与消息组装的权威内容）。

宿主版本要求（后续升级到卡片形态）：公开可 ignorable 的插件会话事件写入通道，或对话视图的扩展块/插件事件路由。webSearch 在 0.160.0 v2 ThreadItem 无独立变体，暂无叙述来源。

### 推荐实施顺序与验收

1. 核对当前生图产物接入和尺寸错误，补上真实产物尺寸、交付图与回复的一致性验收；保留已有生图实现。
2. 完成 KMH 工具名称映射、绑定版本和目录变化后的上下文恢复，再落地原生工具逐项选择与隔离保留。
3. 完成原生事件持久记录与 KMH 对话卡片，先验证开始、完成、刷新恢复，再验证命令输出和文件变更的增量。
4. 接通用户审批后开放命令执行与文件修改；同时完成用户输入、MCP 确认及未知服务端请求的明确失败处理。
5. 通过真实 KMH Web 跑混合工具回合，验证两类工具来源、单次执行、审批批准与拒绝、停止时挂起回收、工具目录变化后续聊及页面刷新后的记录。检查以当前部署 binary 的 schema 和实际调用为准；0.160.0 保留为原始支持基线，新增能力逐项声明已验证版本。

自动检查覆盖映射与碰撞、声明版本更新、通知去重与记录恢复、审批有效期和一次性回执、PNG 实际尺寸与最终回复。真实会话验证覆盖“KMH 发任务 → Codex 原生调用 → KMH 决定审批 → 原生结果回传 → KMH 展示并保存”；静态检查与运行结果分别记录。
