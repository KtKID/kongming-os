---
description: 把会话挂起/继续/补充本轮从 DSH 核心改动重做为 KMH 纯插件实现的处理方案：回退子模块四笔提交，用公共事件与收件箱门面实现收箱门卫。
---

# Agent Note: 会话挂起的插件化重做：回退 DSH 核心改动，收箱门卫方案

Status: proposed

## 问题

会话挂起（用户停止后待发送队列暂停、显式继续放行）当前实现在 DSH 子模块的核心包里（`kmh/runtime-core` 分支四笔提交 `5719b17ac9`/`eb1f00d6b8`/`c863498bc6`/`9de374a8f3`）：改动了 `core/agent` 的公共接口（`AgentStatus` 加 `suspended`、`Agent` 加 `unsuspend()`）、`core/agent-loop` 驱动内部、`api/session-controller` 十个文件、`ui-conversation`/`ui-chat` 界面组件、`goal-round-driver` 与 `subagent` 的适配，外加约 50 个测试文件与一份升级指南。

这违反本仓的插件式扩展原则（AGENTS.md：「新增能力通过现有插件服务、事件和 effect 扩展」）。`kmh/runtime-core` 维护分支是升级载体，不是自由改核心的许可：每次 upstream 升级都要重新融合这批核心改动，并且「上次改过了」会成为下一次改核心的先例——架构腐蚀从这个先例开始，而不是从某一行具体代码开始。

现状方案还有一个信号说明它方向不对：为了让取消语义反转成立，被迫在别人的包里追着改了三处消费方（goal 驱动、子代理、约 35 个测试桩）。需要追着改别人的东西，说明介入点选错了层。

## 提案

分两步：回退 DSH 侧全部改动；在 KMH 侧用**纯公开接缝**重做同一行为。

### 第一步：回退

在 `kmh/runtime-core` 上以 revert 提交回退四笔，子模块恢复到 `06df1bee3f` 状态（fork 分支保留完整历史供追溯）。主仓同步子模块指针。已写的 DSH 升级指南随回退删除（破坏不存在则指南删除，符合其维护规则）。

### 第二步：收箱门卫插件

新包 `@kmh/session-suspend`（挂 kongming-web 与需要的 profile）。核心思路：**不改驱动的放行逻辑，而是让驱动无事可放行**——挂起期间驱动的收件箱是空的，排队内容保存在插件的保管箱（custody）里。

依赖的接缝全部是 DSH 公开 API（已逐一到源码核实）：

| 接缝 | 用途 |
| --- | --- |
| 会话事件 `turn/end`（含 `reason: aborted/user`） | 观察用户停止，置挂起标志 |
| `Agent.whenIdle()` / `agent/status` 事件 | 等驱动收敛后收箱 |
| `Agent.inbox` 门面（`append`/`remove`/`clear`，公开接口） | 收箱与放行 |
| `agent/inbox/inserted` 事件 | 挂起期间拦截新输入 |
| `agent.followup` / `agent.inject` | 继续时唤醒、补充时排入下一步 |
| `ctx.connection.fetch`（与 `/api/zcode-cli/*` 同模式） | 继续/补充/状态的自有路由 |
| composer.dock 等客户端 slot（与 RequestDock 同模式） | 徽标与操作入口 |

机制按时间线：

1. **停止**：任一停止入口（内置停止按钮、双 Esc）最终都产生 `turn/end(aborted, user)` 事件——插件观察到即置 `pendingSuspend`，此后进入拦截态；`whenIdle()` 收敛后把 inbox 待处理项收入 custody（`inbox.clear()` 语义保留在 custody 中）。
2. **挂起期间**：新输入到达产生 `agent/inbox/inserted`，拦截态下立即 `inbox.remove(message.id)` 并入 custody（保序）。驱动若已被该插入唤醒，claim 时收件箱为空，按既有契约关闭一个**无模型调用**的空轮边界（驱动源码注释明确允许此路径）。
3. **继续**：custody 按序倒回 inbox，`followup` 唤醒，FIFO 放行。
4. **补充本轮**：内容标记为 next-step 项；继续放行时先于 next-turn 队列注入（`inject` 语义）。
5. **持久化**：custody 与挂起标志存 `$KMH_HOME/storages/session-suspend/<sessionId>`；宿主重启后插件启动时恢复挂起态并重建 custody（对应 feat03 场景 4 与 feat07 的重启形态）。

### 界面

徽标（"已暂停"）与"继续""补充本轮"入口注册进 composer.dock slot，与请求状态行同模式；状态经自有路由轮询（挂起会话列表 + custody 概要）。**不动 InputBar 主按钮**：主按钮在挂起+空草稿时仍显示"发送"（点击即排队，符合"新输入只排队"语义）；两段式停止反馈由 zcode-cli 状态行（已是插件）承担。这是与核心方案的可见差异，接受它。

### 与原核心方案的行为差异（明示）

- goal 续跑与子代理在门卫方案下**回归原厂语义**：驱动视角收件箱为空、状态正常 idle，原核心方案里被迫修补的 goal-round-driver `idle|suspended` 结算缺口**不再存在**——这是介入点选对层的直接证据。
- 内置停止与 KMH 语义统一不再依赖改 DSH：一切用户取消经 `turn/end` 事件进入同一挂起流程。
- `AgentStatus` 无 `suspended` 值（那是核心改动）：挂起态由插件自有状态承载，UI 读插件路由。

### 与进行中工作的关系

- `task-stop-chain` 及 zcode-cli 插件侧交付（请求状态行、官方取消链路、终止原因分类）**全部保留**——它们本来就是插件。
- spec `feat03`/`feat06` 场景验收对象不变，实现归属改为本包；`task-restart-recovery` 的恢复调查依赖 custody 持久化，排在本方案之后。
- DSH 侧 revert 后，主仓既有 spec/checklist/dev-report 文档保留（记录第一版实现），本文件与其互链。

### 后续事项（观察到证据再做）

- 空轮边界的噪音消除（若挂起期间频繁发消息导致空轮事件堆积，再评估在 pre-step waterfall 拒绝空批的补充拦截）。
- custody 并发上限与淘汰策略（超长队列的截断告警）。
- 多实例（多进程 Web）下 custody 的互斥（当前单进程假设，与 KMH Web 现状一致）。

## 考虑过的替代方案

- **保持现状（核心改动）**：不予采纳。融合负担随每次 upstream 升级线性累积；三处消费方追改与约 35 个测试桩暴露介入层级错误；先例效应。
- **工厂装饰器（包装 `setFactory` 注册的驱动）**：不予采纳，接缝事实不支持——`AgentRegistry.setFactory` 是单占用（已注册即抛 `"an agent factory is already registered"`），且 `agent-loop` 在 profile 插件列表中自注册；无法在其之后叠加包装，在其之前抢占则原插件加载即崩。
- **fork 整个 `agent-loop` 作为替换插件**：作为后备。profile 层面替换可行（agent-loop 是 profile 列表条目），但需复制 ~700 行驱动并长期承担逐版本融合，负担与核心改动同级。触发条件：本方案的公共接缝被 upstream 收紧且无等价替代。
- **仅在 pre-step waterfall 层拦截**：不予采纳。waterfall 只能在步骤边界改写或拒绝，拒绝会吞掉已认领消息（契约明示"claimed message ends here"），且无法阻止唤醒本身。
- **只做 UI 假挂起（不动队列）**：不予采纳。队列仍在驱动里，挂起期间新消息会触发真实执行，竞态无法根除。

## 验收标准

- 子模块 `git diff 06df1bee3f..kmh/runtime-core` 为空（revert 后与回退基线一致）；主仓子模块指针同步；公开可见面无新增破坏（新包为纯新增）。
- spec `feat03` 场景 1–4、`feat06` 场景 1–2 在新实现下逐场景复验通过：停止挂起、挂起期间新输入只排队（空轮无模型调用有断言）、继续 FIFO 放行、补充本轮不恢复队列、重启后 custody 与挂起态恢复、双会话互不影响。
- goal 续跑与子代理用例在无 DSH 修补的情况下通过原厂测试套件（回归确认）。
- 挂起期间每次拦截产生的轮次边界在会话日志中可见且不含模型调用；custody 持久化文件按会话隔离、重启恢复幂等。
- 本包新增源码具备测试；`pnpm test` 与 DSH 子模块套件全绿。

## 风险

- **空轮事件噪声**：挂起期间每条被拦截的消息留下一个空轮边界记录；属可接受代价，后续事项含消除路径。
- **主按钮联动弱化**：挂起时主按钮不显示"继续"（续读 dock 入口），与核心方案有交互差异；已在界面节明示接受。
- **公开接缝漂移**：`turn/end` 事件形状、inbox 门面、inserted 事件属预稳定 API，upstream 演进需跟随——这是任何插件的同等成本，显著低于核心融合负担。
- **事件时序依赖**：从 `turn/end` 到 `whenIdle` 收敛之间靠 `pendingSuspend` 拦截闭合竞态窗口；该时序假设用端到端测试钉住，跨版本升级时先行复验。
