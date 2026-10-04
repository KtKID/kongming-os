# 验证策略与演进

## 验证目标

| 目标 | 验证方式 | 判断依据 | 为什么重要 | 缺失后果 |
|------|---------|---------|------------|----------|
| 主链路可用（A 派 B 不阻塞、B 报告 A、A 汇总用户） | Smoke / E2E | 需求要点 2 + DoD-1/2 | 保护核心用户结果 | 阻塞复活、目标场景失效 |
| 打断链正确（树级打断、不复活说话、不回滚 session） | Smoke / E2E + 对抗性检验 | 需求要点 3 + DoD-3/4 + 不变量 | 保护打断语义 | 漏杀孤儿子、session 分裂、400 |
| 核心状态正确（epoch 门卫、Disposition 分类、TaskRegistry 后序） | 单元测试 | 约束 16 + 不变量 | 保护数据/账本一致 | cancelled 失语、epoch 门卫失效 |
| wire 协议双侧一致 | 契约测试 + 漂移测试 | 约束 17 + 需求要点 14 + DoD-7 | 保护前后端不漂移崩溃 | 运行时崩溃 |
| 关键反例被覆盖（cancel 瞬间完成、登记竞态、段3） | 对抗性检验 | 第一性原理三段时间线 | 保护竞态正确性 | 复活说话、孤儿子 |

## 验证策略

### Smoke / E2E 验收入口

- **Smoke 路径（主链路）**：用户发消息 → A run → spawn B → A 立即回「已派出 B」→ A idle → 用户继续和 A 聊（A 响应不阻塞）→ B 完成 → `child_result` 入 A mailbox → A 新 run 汇总报告用户。
- **Smoke 路径（打断链路）**：A 派出 B → B running → 用户点 Stop → `cancel_subtree` → B run_task 被 cancel + B bash PID 被 kill+wait → A mailbox purge 内部消息 → A 回 idle，无「复活说话」。
- **E2E 路径**：完整跨边界链路（用户 → WS → host → AgentManager.spawn → AgentCell → Runner → TaskRegistry → Disposition → child_result → A 汇总 → WS 流式帧带 agent_id → 前端）。
- **进入 x-req 的规则**：x-req README 显式展开 smoke/e2e 验收用例；单元/契约/边界测试保留为 x-dev 实现责任，并进入 dev-report 验证命令。

### 单元测试

- **覆盖模块**：
  - D · run 终态分类器（必须单测）：对每个 Result.status + metadata 组合断言 Disposition.action + reason 正确（cancel tree_wide 二选一、exhausted 三种 reason、failed 六种 error reason）。
  - B · TaskRegistry（必须单测）：cancel_subtree 后序遍历顺序正确、关门标志生效、kill+wait 兜底、no_live_descendants 判定。
  - C · epoch 门卫（必须单测）：旧世代内部投递丢弃、user_message 永不过期、run_epoch 盖章时机。
  - A · AgentCell 退出条件（必须单测）：single_shot + 无子孙 → closed；persistent → 回 idle。
- **框架**：pytest（`repo:pyproject.toml` 现有测试栈）。
- **重点场景**：边界值（epoch=0、depth=0/1）、错误路径（Result failed/cancelled）。

### 集成测试

- **端到端链路**：主链路 smoke + 打断链路 smoke。
- **环境要求**：单进程 asyncio + 真实 subprocess（验证 kill+wait）。
- **触发方式**：CI 自动（pytest）+ x-verify 复跑。

### 契约测试（AGENTS.md 必需测试用例）

- **后端路由契约**：REST agent 树查询（如新增，post-v1）、WS interrupt 帧（cancel_subtree 触发）。
- **协议漂移测试**：Event 三坐标字段双侧 fixture 一致；流式帧 agent_id 双侧同步（约束 17）。
- **Manager/状态机测试**：spawn 成功/失败/打断边界；磁盘（审计 TaskRecord）/内存（AgentCell）/运行时（TaskRegistry handle）三者一致。

### 手动验证

- **必须人工过的场景**：WS 流式帧带 agent_id 的前端展示（区分主/子 agent 来源）；打断后 UI 无「复活说话」视觉残留。
- **验收人**：用户 + 主 agent 审核。

## 对抗性检验

| 反例场景 | 影响模块 | 预期系统行为 | 验证方式 | 漏测后果 |
|---------|---------|--------------|---------|----------|
| B 恰在 cancel 瞬间完成 → 结果带旧 epoch | C（epoch 门卫） | A mailbox 门卫拦截旧 epoch envelope，不复活 | 单测 + e2e（注入旧 epoch envelope 断言丢弃） | 复活说话 |
| spawn 登记与 cancel 竞态 | B（关门标志）+ A | registry 关门标志拒绝新登记，无孤儿子 | 单测（并发 spawn + cancel_subtree） | 孤儿子泄漏 |
| 父 run 跑完与 cancel 同时（段3） | C + E | session 已提交保留，只拦上投 envelope（旧 epoch 绕回段1） | e2e（cancel 恰在 run 完成时） | session 分裂、400 |
| cancel 时子 bash PID 在途 | B（kill+wait） | kill PID + wait 兜底，无僵尸进程 | 单测（真实 subprocess） | 僵尸进程堆积 |
| agent_loop 被单独 cancel（误操作） | C | 不应发生（只随树销毁）；若发生 → mailbox 静默堆积，需 watchdog | 单测（断言 agent_loop 不在 cancel 靶子内） | agent 失聪 |
| 子审批请求在父 run 中触发 | F（控制面绕 mailbox） | 审批直达会话级 inbox，不进父 mailbox 排队 | e2e（父 run 中子触发审批） | 子审批挂死 |
| Result.status 组合未覆盖 | D（classify_result 兜底） | 落 internal_failure 兜底，agent_loop 不失聪 | 单测（全覆盖 status+metadata） | action 落空崩溃 |

## 测试覆盖要求

| 模块 | 最低覆盖率 | 重点文件 | 为什么需要 | 缺失后果 |
|------|-----------|---------|------------|----------|
| D · run 终态分类器 | 95% | classify_result 纯函数 | cancelled 剥数据的核心，下游全消费 | 分类遗漏、action 落空 |
| B · TaskRegistry | 90% | cancel_subtree + 关门标志 | 账本面地基，防漏杀 | 漏杀孤儿子 |
| C · Mailbox/agent_loop | 85% | epoch 门卫 + match 分发 | 最难竞态集中地 | 复活说话、失聪 |
| A · AgentManager | 80% | spawn + cancel_subtree 编排 | 主链路门户 | spawn 散落 |
| G · wire 协议 | 漂移测试 100% | protocol 双侧 fixture | 约束 17 双侧真源 | 运行时崩溃 |

## 演进路线

### 短期（本轮 task，v0.1）

- [ ] task-1：Event 补 agent_id/task_id/conversation_id（步骤 1，纯加法）
- [ ] task-2：run 终态分类器（步骤 2，纯函数吃 Result）
- [ ] task-3：TaskRegistry + cancel_subtree（步骤 3，单 agent 退化形态）
- [ ] task-4：agent_loop mailbox 化（步骤 4，单 agent，建议先 PoC epoch 门卫）
- [ ] task-5：多 agent spawn（步骤 5，组合 1-4 + 收编 SubAgentManager + 审批共享 + 用量分桶 + wire 树帧）

### 中期（下 1-2 轮）

- [ ] drain：同世代消息合并进一个 run（需求要点 10，v1 不做，metadata['source_agent_id'] 软键已留语义归属）
- [ ] crash recovery：journal 持久化 mailbox/树态（需求要点 11，v1 不做）
- [ ] REST agent 树查询 + 树快照帧（post-v1）
- [ ] 子 agent 实时展开（post-v1）
- [ ] agent workflow 收编为 policy agent（run_fn 为确定性策略函数的 agent，run 内部不调 LLM）——注意 workflow 编排器 spawn mapper 已占 1 层，若编排器本身又是主 agent spawn 出来则需深度 2，故排在 v1 之后

### 长期（方向性）

- spawn 深度放开（v1 固定 1 层，depth 字段和退出条件已写通用式，将来只改配置）。
- 多树并发（当前一个 thread 一棵树，未来可能多树/跨 thread 树）。
- 子 agent 用量/成本独立计费分桶（task-5 先做基础分桶，长期做细粒度）。
