# kongming-agent · agent-tree-v0.1

> 状态：方案确认
> 目标：把 kongming-agent 从「单 agent + 同步阻塞 subagent + workflow 双机制」重构为「统一 agent 抽象 + mailbox 串行驱动 + 异步 spawn 派生 + 树级打断」。

## Framing Summary

| 项 | 结论 | 判断依据 | 为什么重要 | 缺失后果 |
|----|------|---------|------------|----------|
| 需求本质 | 让 agent A 派出后台子 agent B 做事时，A 不阻塞、能继续和用户聊；B 完成后报告 A，A 汇总报告用户；打断 A 时连带打断 B | 用户原话（需求要点 1-3）+ 现状代码（SubAgentManager 同步阻塞 await） | 保护「主 agent 永远在线可聊」这个核心用户结果 | 沿用阻塞语义 → A 卡死、用户被挂起、与「AI 助手」心智模型背离 |
| 推荐方向 | 数据面走 mailbox（串行）、控制面绕 mailbox（打断/审批）、账本面全经 registry（登记先于暴露），严格三分；统一概念「agent」，主/子零代码分支 | 第一性原理推导 + 约束 16（cancelled 收口成数据）+ 唯一 run loop 事实 | 三者混在一条通道是讨论稿早期版本全部致命洞的根源，重构后严格三分 | 控制面/数据面混通道 → run 时审批挂死、cancel 漏杀、mailbox 静默堆积 |
| spec 范围 | 系统级（横跨 runner / message / approval / wire / hosts 全栈） | 涉及 7 个模块、改动双侧真源协议（约束 17）、影响主链路 | 防止拆分失真导致交付不可验收 | 拆得过窄 → mailbox 与 spawn 跨边界、无法独立测；过宽 → 失焦 |

## 系统目标

kongming-agent 当前是「单 agent + 同步阻塞 subagent + workflow 双机制」。本 spec 把它收敛为「统一 agent 抽象」：整个框架只有一个概念叫 **agent**（不叫 actor），循环叫 **agent_loop**。主 agent 和子 agent 是同一数据结构（AgentCell），差异只在 `parent_id` / `lifecycle` / `depth` 三个字段，零代码分支。

目标场景（需求要点 2）：用户和 agent A 对话；A 派出子 agent B 去做任务（如读文档）；A 能继续和用户聊天（不阻塞）；B 做完后报告 A；A 再汇总报告给用户。

## 方案结论

| 方案 | 适用条件 | 工程代价 | 主要风险 | 判断依据 | 结论 |
|------|---------|---------|---------|---------|------|
| 数据面/控制面/账本面三分 + mailbox 串行 + 异步 spawn | 需要主 agent 不阻塞、树级打断、复用现有 Runner | 高（7 模块、wire 双侧同步） | cancel 时序竞态（模块 C） | 约束 16（cancelled 已是数据）+ 唯一 run loop + asyncio cancellation 天然树传播 | 推荐 |
| 沿用 SubAgentManager 同步阻塞 + 双机制 | 不要求主 agent 不阻塞 | 低 | 主 agent 卡死、与目标场景冲突 | 现状代码，但与需求要点 2/3 直接冲突 | 放弃 |
| detach 豁免（cron 派生豁免级联） | cron 派生需独立存活 | 中 | 打断语义复杂化、孤儿子清理 | 需求要点 12 明确不做豁免 | 放弃（v1） |

## 最小可用路径

用户发消息 → A run → spawn B → A 立即回「已派出 B」并 idle → 用户继续和 A 聊 → B 完成 → `child_result` 入 A mailbox → A 新 run 汇总报告用户。

打断侧链：A 派出 B → B running → 用户点 Stop → `cancel_subtree` → B run_task 被 cancel + B bash PID 被 kill+wait → A mailbox purge 内部消息 → A 回 idle，无「复活说话」。

> 这条链路涉及的模块是 P0（mailbox 是地基，spawn 是住户）。

## 范围边界

**包含**：
- 统一 agent 抽象（AgentCell）、AgentManager（收编 SubAgentManager）
- mailbox + agent_loop 串行驱动内核
- TaskRegistry 账本 + cancel_subtree 树级打断
- run 终态分类器（cancelled 从异常控制流剥成 Disposition 数据）
- ThreadCell 演进为树态 owner（加 root_agent/registry/epoch 字段，ThreadCell 即树本身，无需新增类）
- 审批 _PendingApproval 加 agent_id、子 runner 共享树 bridge
- Event/wire 补坐标字段、流式帧带 agent_id

**不包含**：
- crash recovery（journal 拆后续，需求要点 11）
- drain 同世代消息合并（v1 逐条消费，需求要点 10）
- detach 豁免（需求要点 12）
- 树快照帧 / 子 agent 实时展开 / REST agent 树查询（post-v1）
- agent workflow 收编为 policy agent（v2，需求要点：workflow 排在 v1 之后）

## 模块导航

| 模块 | 状态 | 文档 | 是否可进 task | 说明 |
|------|------|------|---------------|------|
| A · AgentManager | 可进入 x-req | `./02-module-breakdown.md#模块-a-agentmanager` | 是 | 收编 SubAgentManager，spawn 门户；依赖 B/C/D + Runner |
| B · TaskRegistry | 可进入 x-req | `./02-module-breakdown.md#模块-b-taskregistry` | 是 | 资源账本 + cancel_subtree，单 agent 退化先跑通 |
| C · Mailbox + agent_loop | 可进入 x-req | `./02-module-breakdown.md#模块-c-mailbox--agent_loop` | 是（高风险，建议先 PoC） | 串行驱动内核、epoch 门卫、难竞态集中 |
| D · run 终态分类器 | 可进入 x-req | `./02-module-breakdown.md#模块-d-run-终态分类器` | 是 | 纯函数，吃现有 Result |
| F · 审批 agent_id 维度 | 可进入 x-req | `./02-module-breakdown.md#模块-f-审批-agent_id-维度` | 是 | 改现有 _PendingApproval + 共享 bridge |
| G · Event/wire 协议扩展 | 可进入 x-req | `./02-module-breakdown.md#模块-g-eventwire-协议扩展` | 是 | 改现有，纯加法，wire 双侧同步（约束 17） |
| H · 统一时间工具 | 可进入 x-req | `./02-module-breakdown.md#模块-h-统一时间工具` | 是 | 新建收编散落 epoch-ms helper，随 task-1 落地 |

## 文档导航

- [图集：总览 + 各模块局部图](./diagrams.md)
- [目标与完成标准](./01-goals-and-boundaries.md)
- [模块设计 + 接口 + 数据结构](./02-module-breakdown.md)
- [数据模型与状态](./04-data-and-state.md)
- [验证策略与演进](./05-validation-and-evolution.md)
- [Task 映射](./90-task-map.md)

## 路径规则

- 本包内文档链接只使用 `./...`
- 包内文档不反向链接 `docs/spec/README.md`
- 代码文件只写 `repo:<path>` 形式，例如 `repo:src/core/runner.py`

## 当前建议

1. 按落地顺序 5 步推进，每步独立可测可单独提交（铁律 = mailbox 是地基，spawn 是住户）：
   - 步骤 1：Event 补坐标字段（task-1，纯加法）
   - 步骤 2：run 终态分类器（task-2，纯函数）
   - 步骤 3：TaskRegistry + cancel_subtree（task-3，单 agent 退化）
   - 步骤 4：agent_loop mailbox 化（task-4，单 agent，建议先 PoC epoch 门卫）
   - 步骤 5：多 agent spawn（task-5，组合 1-4 + 收编 + 审批共享 + wire）
2. task-4（模块 C）是最高风险点，建议先做 epoch 门卫 PoC 再铺开。
3. agent workflow 收编为 policy agent 排在 v1 之后（深度交互会顶到深度 2）。
