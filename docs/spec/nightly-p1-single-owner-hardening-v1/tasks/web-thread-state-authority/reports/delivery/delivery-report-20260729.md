# nightly P1 单一 owner 加固 · 完整流程交付报告

> 来源：`reports/night/night-review-20260726-190833.md`
> 基线：`private-main` / `ac07b684`
> 交付状态：当前工作树完成，尚未提交
> RAG：按用户要求跳过

## 八个 P1 的通俗解释与当前状态

| P1 | 问题是什么 | 为什么发生 | 用户会看到什么 / 放任后果 | 当前状态 |
|---|---|---|---|---|
| 1 前端虚假运行态 | 消息刚准备发送，前端就自行认定 agent 正在回答 | 发送动作和服务端真实运行状态写进同一个 store，发送失败缺少完整恢复负责人 | 网络发送失败后仍显示 Stop/运行中，文字、图片或引用可能被清空 | 已修复：发送态独立保存；运行态只接收服务端；失败恢复完整草稿 |
| 2 审批卡提前消失 | 用户点允许/拒绝后，卡片立即从页面删除 | 前端用乐观删除代替服务端最终结果，多 tab 冲突缺少失败回执的承载对象 | 另一 tab 已抢先处理时，本 tab 的卡片消失，用户看不到失败原因，也无法重试 | 已修复：卡片保留到 authoritative remove；失败回到可重试态 |
| 3 status 缺少连接补偿 | 新开页面或断线重连时，服务端无法告知当前有哪些 thread 正在运行 | 旧 broadcaster 只记 socket，缺少 active map、snapshot、run 身份和单连接发送顺序 | 新 tab 看不到 Stop；重连后可能卡在旧 running；旧任务的迟到终态可能清掉新任务 | 已修复：ThreadStatusManager 统一 active map、snapshot、sequence、run lease 和单 writer |
| 4 Web 穿透 SessionEngine | Web 直接取得 SessionEngine 的私有缓存和 raw Session | 历史读取、追加和 fork 播种缺少公开任务级入口 | Session 后端或缓存一调整，首条消息、历史和 fork 会同时出错，失败时还可能留下半份历史 | 已修复：三个公开异步门户承接 read/append/seed，Web 私有访问零残留 |
| 5 child 生命周期双账本 | workflow child 同时可能进入新旧两套登记系统 | 父 AgentManager 可用时走 TaskRegistry，缺失时回落旧 SubAgentManager；Web 又读取旧表 | 子 agent 实际在跑，页面看不到；取消、终态、历史身份在两套账本中不一致 | 已修复：AgentManager + TaskRegistry 成为唯一 owner，Web 读取同一投影，旧路径删除 |
| 6 scheduler task/run 混态 | “这个定时任务还能否继续调度”和“上一次执行成败”混成一个状态 | TaskState 同时装 scheduled/paused/running/failed，另有 enabled 再表达一遍可运行性 | 周期任务一次失败后像被停用；一次性任务领取和执行终态互相覆盖；刷新前后徽标变化 | 已修复：TaskLifecycleState 管任务定义，ScheduledRun.status 管每次执行，v5→v6 原子迁移 |
| 7 Web 误删其他宿主权限 | Web 启动时可能把 CLI、cron 的权限本子当孤儿删除 | Web 只知道自己的 thread，却把局部清单当成全局 thread 清单执行 GC | CLI/cron 已保存的允许/拒绝规则消失，之后重新弹审批或改变安全决策 | 已修复：启动期全局清理入口删除；显式删除某个 thread 时只清理该本子 |
| 8 Tool prepare 双 owner | 同一工具参数先准备一次，执行入口又准备一次 | Runner 和 BaseBuiltinTool 都承担默认填充、校验或归一化 | 用户批准的是参数 A，真正执行可能变成参数 B，审批证据与实际副作用分叉 | 已修复：Runner 形成一次 PreparedToolCall；审批与执行读取等值隔离副本；execute 只执行快照 |

## x-spec → req → dev → verify → QA Gate

- x-spec：`spec.md` 固化八项根因、修复方案、边界、不变量与 `SC_01`—`SC_28`。
- req：拆成六个 task 包，分别覆盖 Web 状态、Session 门户、workflow child、
  scheduler 生命周期、permissions 清理和 Tool preparation。
- dev：六个 task 的 checklist 全部完成，并分别保存 dev、verify、fix 和 QA
  报告。
- Gate①：六个 task 在当前工作树复跑，28 个唯一 Scenario 全部覆盖，0 fail、
  0 manual、0 uncovered。
- Gate②：六个 task 均为 PASS；Web 首轮 QA 的六个 P1 已经 x-fix R3 关闭。
- spec validate：0 issues。

## 分层验证

- Web 状态/审批/provider/协议后端聚焦回归：149 passed。
- Composer 文字、reasoning、图片和引用草稿合同：69 passed。
- TypeScript typecheck、双 frame codegen 漂移、Ruff、mypy：通过。
- import-linter：20 contracts kept，0 broken。
- `git diff --check`：通过。

## QA 后续项

- Web `generation/current lease` 历史身份表增加 thread 生命周期回收入口。
- SC_24 增强为 run 进行中断线，并覆盖旧 socket late frame。

两项按 P2 登记，当前八个 nightly P1 均已完成修复并通过对应 Gate。

## 基线测试说明

额外全量前端试跑发现
`ChatTimelineStore.test.ts` 的“纯重复 terminal 不额外 notify”用例稳定失败
（35 passed，1 failed）。对应生产文件和测试文件相对 `ac07b684` 均为 clean，
该基线问题未进入本次 nightly P1 修复范围，也未影响六个 task 的目标 Gate。
