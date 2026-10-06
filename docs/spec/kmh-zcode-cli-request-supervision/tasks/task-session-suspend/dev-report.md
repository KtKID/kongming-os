# task-session-suspend · dev-report

> task: docs/spec/kmh-zcode-cli-request-supervision/tasks/task-session-suspend/dev-checklist.md
> 创建: 2026-10-06 · T7 于同日深夜补齐

## 结果

- task 测试：**T1-T7 全部 🟢**
- 类型检查：`pnpm run typecheck`（宿主 + 客户端双 program）零错误；`build:lib` 全量构建通过
- 既有回归：宿主侧 4734/4734、客户端侧 4576 通过；唯一失败 `ui-trajectory/client-bundle.client.spec` 的"view tab 注册"用例经 git stash 对照确证为**既有失败**（无本次改动同样失败），与本 task 无关
- 高风险行：T1（取消语义反转）以 6 项新 suspension.spec 覆盖；T2 契约变更同步 status 事件/SessionSummary/快照三处并更新全部字面量；T5 经唤醒门 + goal-round-driver/子代理两侧收敛适配；T7 UI 经组件类型检查 + 客户端套件回归

## T7（Web 挂起展示与继续/补充入口）实现记录

- **状态链路**：`api-session/status` 第三参 → 客户端 manager `handleSessionStatus(…, suspended?)` → `Session.handleSuspended` → 快照新增 `suspended: boolean`（契约同步；manager 三处回退 summary 与 test-support 夹具补齐）。新增中继测试：挂起/释放/运行三态互斥断言。
- **已挂起徽标**：ui-chat `ChatView` 在 RunningStatus 同位渲染静态徽标（复用 running 样式，无 shimmer），文案"已暂停，待发送内容保留，点击输入区的「继续」放行"。
- **继续**：ui-conversation `InputBar` 主按钮三态——运行中受阻=停止、挂起+空草稿=继续（`unsuspend()`）、否则发送；注入经 `ComposerBarInjected.unsuspend`（apply.ts 会话分支提供、无会话分支 undefined）。
- **补充本轮**：挂起 + 非空纯文本草稿时在主按钮左侧出现次级按钮（加号图标 + tooltip），提交 `supplement(draft)` 并清空草稿（`inputActions.setDraft('')`，注：未用 commitSend 的不可撤销纪律）。
- `IConversation` 契约与 `ConversationController` 补 `unsuspend/supplement` 两方法；测试夹具（input-bar/input-matrix/input-scenarios/skeleton/queue-dock/chat-view 等 ~10 处）补注入缺省。
- **浏览器实测未做**：徽标与按钮经组件类型检查与套件回归，真实浏览器呈现待与 task-request-state 的 composer dock 一并验证。

## 预稳定 API 全消费方更新（Agent.unsuspend 落地清单）

约 35 处测试桩/夹具补 `unsuspend`：tool-terminal/todo/tool-workflow、job-controller（harness+observe）、archived-session-gate、dsh-badge、headless、time/tmux-context、terminal-bash/terminal、jobs-local、tool-skill、tool-pwsh(±persistent)/tool-bash(±persistent)、schedule harness、tool-ask-user、goal 系列、tool-str-replace-editor、command-feedback、browser-use-runtime、tool-present、core/agent 与 agent-loop/inbox、subagent archive-admission；`gen-cordis-api` 重生 tool-cordis 目录；客户端 program 的 SessionSnapshot/SessionSummary 消费夹具约 15 处补 `suspended`。

## 语义冲突的第三处发现与修复（goal-round-driver）

goal 续跑驱动把 `agent/status === 'idle'` 当取消收敛信号——挂起态停在 `suspended` 导致取消的 goal 回合永不结算（用 git stash 对照确证由本变更引起）。修复：结算监听同时接受 `suspended`（注释写明挂起亦是收敛态、驱动仍被 idle 门挡住直到释放）。附带语义：宿主暂停 goal 触发的 `cancel(user, keepInbox)` 现在同样挂起队列——正是 feat06 场景1"目标续跑挂起"；"withdraws a round parked behind cancelled human work"用例按新预约时序（挂起释放后人类回合先行、goal 回合待本轮结束再预约）改写并保留核心断言。

## 未决

- **子代理会话的释放路由**：subagents 远端仅有 `prompt`/`interruptByParent`，无对称释放动词；需新增 `unsuspendByParent`（按持久父地址解析子代理后调用其 `agent.unsuspend()`），客户端 `Session.unsuspend` 届时像 cancel 一样路由。当前子代理子女队列的释放只能在宿主侧直接操作。
- **DSH 升级指南待写**（dsh-create-upgrade-guide）：`AgentStatus` 联合类型扩展、`Agent.unsuspend()` 新增、`cancel(user, keepInbox)` 行为反转（含 goal-round-driver/子代理 continuation 两处契约更新）、`ISession` 新动词、`api-session/status` 第三参、`SessionSummary/SessionSnapshot.suspended`、`IConversation.unsuspend/supplement` 均为 DSH 外部可感知变更——为下一动作。
- 挂起重启推导的已知边界：挂起期间发生队列编辑（删除/新增 splice 晚于 turn/end）后重启，推导判为非挂起（idle + 队列可见，`unsuspend` 幂等放行仍有效）；标准处置路径按设计清空队列（宿主崩溃不经该路径，推导正是为此）。

## 实现记录

- **挂起态完全由持久事实推导，零新增持久事件类型**：live 侧是闩锁（仅在 `keepInbox` 的 user 取消收敛时置位、队列清空即解除、任何正常 turn 完成即清除）；重启侧由 agent-loop 私有投影 `queueSuspension`（折叠 turn 边界与 inbox splice 的顺序）推导——"最后 turn 以 user 中止、其后无更新的队列写入且仍有待处理输入"。
- `AgentStatus` 增加 `'suspended'`、`Agent.unsuspend()`（避开 `AgentRegistry.resume` 的会话装载语义）；`wakeDriver` 挂起门阻断一切自动唤醒（新发送、收敛期 latch 重放、维护后重放），因此调度/续跑/子代理投递的一致性（feat06）在同一门上成立。
- 取消语义的反转范围：仅 `cause=user && keepInbox`（控制器停止路径）；`parent/hook/disposed` 与无 keepInbox 取消保持旧语义（无队列自动放行），cancel.spec 三个用例按新语义更新（挂起期间新输入停靠、unsuspend 后 FIFO 放行）。
- 控制器新增 `unsuspend`（继续）与 `supplement`（补充本轮，映射 `agent.inject`＝next-step 不唤醒；仅文本，附件拒绝）命令与 @Remote 注册；客户端 `Session` 类、`ISession` 契约、ui-conversation service 封装（`conversation.unsuspend()/supplement(text)`）齐备。
- 子代理 continuation 的"宿主直接 followup 唤醒"契约按 feat06 更新为"挂起期间停靠、显式 unsuspend 放行"（continuation.spec 一处）。
- `api-catalog`（tool-cordis）经 `pnpm run gen-cordis-api` 重生。

## 未决

- **T7 未开工**：Web 会话视图的挂起展示（"已暂停"标记 + 队列展示）与"继续""补充本轮"按钮入口需要 ui-conversation 组件层工作（快照字段已有 `suspended`，service 封装已备）；host 侧子代理会话的 unsuspend 路由（客户端 `Session.unsuspend` 暂不路由 `interruptByParent` 对应的释放路径）一并归入 T7。
- **DSH 升级指南待写**（dsh-create-upgrade-guide）：`AgentStatus` 联合类型扩展、`Agent.unsuspend()` 新增、`cancel(user, keepInbox)` 行为反转、`ISession` 新动词、`api-session/status` 第三参与 `SessionSummary.suspended` 均为 DSH 外部可感知变更，按子模块规则应立即记录——本轮上下文耗尽未写，为下一动作。
- 挂起重启推导的已知边界：挂起期间发生队列编辑（删除/新增 splice 晚于 turn/end）后重启，推导判为非挂起（idle + 队列可见，`unsuspend` 幂等放行仍有效）；标准处置路径按设计清空队列（宿主崩溃不经该路径，推导正是为此）。
