# 01 · 目标与边界

## 背景

Runner 只认 `ApprovalProvider.decide()` 这个结构协议。Python 的 `Protocol` 采用结构化类型判断，因此 `SubAgentApprovalProvider` 只要提供相同签名就属于 `ApprovalProvider`，无需继承父类。

这个开放合同适合扩展，也允许低层 provider 被注入最终决策位。当前子 Agent 链路正是通过这种能力，把只检查 scope 的 provider 放到 Runner 前面。根因是“最终审批决策”与“分支局部授权”共用了同一个协议和同一个注入槽位。

## 事实与可重新评估的历史假设

| 编号 | 类型 | 内容 | 判断依据 | 本次处理 |
|---|---|---|---|---|
| F1 | 事实 | Runner 只调用 `ApprovalProvider.decide()` | `repo:src/core/runner.py` 的工具执行入口 | 保留一个高层最终协议 |
| F2 | 事实 | `Protocol` 采用结构化类型，类无需继承即可满足合同 | `repo:src/core/contracts/approval.py` | 用不同签名拆出 `ConsentPrompt` |
| F3 | 事实 | `SessionEngine.run()` 的 approval 参数可覆盖 build 时 provider | `repo:src/runtime_assembly/session_engine.py` | 删除 run 级行为对象注入 |
| F4 | 事实 | 子 Agent provider 保存 upstream，却只执行 tool/path scope | `repo:src/application/subagents/permissions.py` | scope 改为纯 evaluation |
| F5 | 事实 | 子 Agent 与 scheduler provider 各自直接写 audit | application 与 scheduler 当前实现 | 引入单一终态事件 owner |
| H1 | 历史假设 | 每个分支需要独立最终 provider 才能表达局部规则 | 分支功能分阶段建设形成的装配方式 | 改为共享规则链加分支 context |
| H2 | 历史假设 | 子 Agent scope 可以先直接放行，后续再接 upstream | 旧 subagent scoped permission spec 的演进项 | 升级为 P0 同批迁移 |
| H3 | 历史假设 | policy 就地写 audit 更容易保证留痕 | `_write_audit()` 和 wrapper audit | 改为结构化结果加必达投影 |

F1-F5 来自当前代码和报告链路。H1-H3 属于可重新评估的设计选择，本 spec 用安全不变量重新推导目标结构。

## 术语

| 术语 | 定义 |
|---|---|
| 最终审批 provider | Runner 在执行工具前调用的唯一高层决策入口 |
| 全局规则 | HardBlock、Boundary、Destructive、Trust、Consent 等所有分支共享的规则 |
| scope | 当前 run 允许触达的工具、路径、工作区或资源边界，只能收紧 |
| grant evidence | 父级或用户已授予某项能力的类型化证据，由 Trust 阶段验证和消费 |
| consent prompt | 规则链要求显式同意时的叶子交互能力 |
| evaluation | 单个规则阶段产生的结构化事实，包含阶段、结果、理由和证据引用 |
| final decision | 完整规则链完成后产生的 approved、rejected 或 cancelled 终态 |
| 单调收紧 | 子上下文的有效权限集合始终是父上下文权限集合的子集 |

## 目标

### G1 · 单一最终入口

每个 `SessionEngine` 在 build 时创建并持有一个 `SafetyGatedApproval`。`run()`、`continue_from_last_user_message()`、主 Agent、子 Agent和 scheduled run 都复用该实例。

### G2 · 规则顺序稳定

所有原生运行分支执行同一决策序列：

1. HardBlock 判断永久禁止能力。
2. RuntimeScope 判断当前分支可触达范围。
3. Boundary 判断工作区和资源边界。
4. Destructive 判断破坏性动作等级。
5. Trust 验证默认信任、预授权和 grant evidence。
6. Consent 在需要时请求人工或宿主决定。

### G3 · 子 Agent 权限单调收紧

父级上下文派生子上下文时，只允许执行集合求交、路径收窄、额度降低和期限缩短。scope 通过后继续执行全局规则。

### G4 · 协议职责分离

`ApprovalProvider` 表达完整最终决策能力；`ConsentPrompt` 表达单次 consent 响应能力；`ApprovalScope` 和 `GrantEvidence` 表达数据。调用方无法把 auto-allow 或 scope evaluator 当成完整 provider 传给 Runner。

### G5 · 审计单写点

各规则返回 evaluation，`ApprovalAuditManager` 在最终判定后发布一次 `approval.evaluated`。workflow、scheduler 和 trace 通过 EventSink 投影相同事实。

### G6 · 首次/继续运行一致

首次运行和继续运行都使用 `SessionEngine` 持有的 provider 与本次 `ApprovalRunContext`，恢复路径无法回退到另一组规则。

## 需求清单

| 编号 | 需求 | 验收信号 |
|---|---|---|
| R1 | Runner 最终决策位只有 `SafetyGatedApproval` | 生产装配与运行调用点无分支 provider 注入 |
| R2 | `SessionEngine.run()` 移除 `approval` 参数 | run 级输入只包含 `ApprovalRunContext` |
| R3 | `SpawnAgentRequest` 与 `AgentCell` 移除 provider 字段 | 子 Agent 只携带 frozen scope/evidence/context |
| R4 | 所有分支共享固定六阶段顺序 | 合同测试对 main/subagent/scheduled 参数化验证 |
| R5 | scope allow 只能继续评估 | 范围内 destructive 请求仍进入后续阶段 |
| R6 | grant evidence 仅由 Trust 消费 | HardBlock 与 scope 在 evidence 之前执行 |
| R7 | auto-allow 只实现 `ConsentPrompt` | auto 策略无法满足 `ApprovalProvider` 类型 |
| R8 | 策略层无直接文件 I/O | policy/provider 中无 audit writer 调用 |
| R9 | 每个 tool call 产生一个终态审批事件 | 事件以 run_id + tool_call_id 唯一关联 |
| R10 | 安全账本写入失败采用 fail-closed | approved 工具在必达审计确认前不执行 |
| R11 | 观测副本写入采用 best-effort | trace 故障被报告且不改写已确认决定 |
| R12 | 旧 spec 和模块文档随实现同步 | 权威关系、现状与目标状态一致 |
| R13 | 运行时、静态类型、架构边界和 smoke 分层验证 | 每层都有独立命令或测试证据 |

## 完成标准

| DoD | 完成条件 |
|---|---|
| D1 | 每个 `SessionEngine` 只有一个最终 `SafetyGatedApproval`，`run()` 与 `continue_from_last_user_message()` 复用该实例 |
| D2 | run、spawn 和 cell 合同中的 provider override 字段全部移除 |
| D3 | main、subagent、scheduled 对同一请求执行相同六阶段顺序 |
| D4 | 子 scope 超界拒绝，范围内请求继续进入后续全局规则 |
| D5 | 子 scope 在工具、路径、资源、预算、期限和委派深度上均为父 scope 子集 |
| D6 | `GrantEvidence` 只由 Trust 消费，HardBlock 与 RuntimeScope 保持优先 |
| D7 | interactive、auto-allow、fail-closed 都通过 `ConsentPrompt` 实现 |
| D8 | 分支最终 provider wrapper 与 policy 直接 audit I/O 移除 |
| D9 | 每个 tool call 最多产生一个字段完整的 `approval.evaluated` 终态事件 |
| D10 | required 审计故障 fail-closed，best-effort 故障保持决定并报告投影错误 |
| D11 | 运行时、静态类型、架构边界和跨分支 smoke 证据全部通过 |
| D12 | 相关模块 README、架构导航和旧 spec 权威关系完成同步 |

详细验证证据见 [验证与演进](./05-validation-and-evolution.md)。

## 必要能力推导

| 能力 | 来源 | 为什么重要 | 缺失后果 | 落点 |
|---|---|---|---|---|
| C1 最终决策与 consent 类型隔离 | F1-F3、R1、R7、D1、D7 | 类型系统需要封住低层策略进入 Runner 的能力 | auto-allow 或 scope evaluator 可再次替换全局链 | M1、T1 |
| C2 固定顺序的纯规则引擎 | F4、R4-R6、D3、D4、D6 | 所有分支需要共享安全不变量和可断言阶段事实 | 规则顺序继续按 provider 组合漂移 | M2、T1 |
| C3 SessionEngine 单入口装配 | F3、R1、R2、D1、D2 | composition root 需要持有最终 provider identity | 首次/继续运行和分支可继续覆盖 provider | M3、T1 |
| C4 父子 scope 单调派生 | H1、H2、R3-R6、D4-D6 | 子 Agent 需要最小权限且保留全局规则 | 范围内动作绕过 destructive/trust/consent | M4、T2 |
| C5 scheduler 预授权证据化 | H1、R4、R6、D3、D6、D8 | task trust 需要成为可验证输入 | scheduler wrapper 继续维护独立规则链 | M5、T3 |
| C6 终态事件单写点 | F5、H3、R8-R11、D8-D10 | 多消费者需要共享同一决策事实和持久化语义 | 重复、漏写、阻塞 I/O 和故障行为继续漂移 | M6、T4 |
| C7 context 恢复与撤销校验 | R4-R6、D3、D5、D6 | continue 必须应用当前有效授权状态 | 过期或撤销 grant 可在恢复后继续生效 | M3、M4、M5；T1-T3 |
| C8 跨分支质量与文档门禁 | R12、R13、D11、D12 | 安全合同需要运行时、静态和文档证据共同闭环 | 测试全过仍可能保留类型或架构绕过面 | M1-M6、T5 |

能力聚合到模块的依据与风险见 [模块拆分](./02-module-breakdown.md)。

## 范围

### 本 spec 覆盖

- `repo:src/core/contracts/approval.py` 的最终审批合同与新运行上下文合同。
- `repo:src/safety/approval/` 的规则顺序、consent seam 和审计协调。
- `repo:src/runtime_assembly/session_engine.py` 的装配与运行入口。
- `repo:src/core/runner.py` 的最终审批调用与上下文传递。
- `repo:src/application/agents/`、`repo:src/application/subagents/` 的子 Agent 授权派生。
- `repo:src/scheduler/` 与 `repo:src/application/scheduled_runs/` 的定时任务授权派生。
- workflow、scheduler、trace 的审批审计投影。
- 相关测试、模块 README 和旧 spec 漂移修正。

### 本 spec 不覆盖

- Web approval inbox 的视觉交互改版。
- Claude Code、Codex 外部执行器内部的原生审批协议重构。
- 工具业务实现、文件工具路径校验算法和 capability catalog 重写。
- 跨进程集中式审批服务。
- 历史 JSONL 审计文件的迁移和回填。

外部执行器接入本合同的前提是其工具调用进入 Kongming Runner；独立 transport 的审批语义由对应通道 spec 负责。

## 架构约束

- `ApprovalProvider` 等跨模块协议只在 `repo:src/core/contracts/` 定义。
- `repo:src/core/` 保持零 sibling 依赖。
- Runner 仍是唯一 turn 推进循环。
- `SessionEngine.build()` 负责装配，`SessionEngine.run()` 只负责运行参数和 Runner 调用。
- 审批事件继续通过 EventSink，不新增平行的通用审计 Protocol。
- 有限状态和模式使用 `StrEnum`。
- 跨模块值对象优先 frozen dataclass。
- 新合同使用具体类型、Protocol 或 object，避免扩大 `Any`。
- 子 Agent 的 execution-time 文件工具 wrapper 保留为纵深防御，不能承担最终审批职责。

## 安全不变量

1. HardBlock 无法被 trust、grant、consent 或宿主配置绕过。
2. 子 scope 无法扩大父 scope。
3. scope 自身无法签发最终 approved。
4. grant evidence 无法改变 HardBlock 和 scope 的结果。
5. 必达审批审计确认完成后，approved 工具才能开始执行。
6. cancelled 与 rejected 都产生可关联的终态审批事件。
7. continue 使用和原 run 相同的安全配置快照与分支上下文。

## 兼容与迁移策略

项目处于底层接口开发期，本次直接修改内部合同。删除 `SessionEngine.run(approval=...)`、`SpawnAgentRequest.approval`、`AgentCell.run_approval`、`SubAgentApprovalProvider` 和 `ScheduleApprovalProvider` 的最终 wrapper 角色，不增加兼容 shim。

迁移采用编译期封口：先修改类型合同和方法签名，让所有旧调用点通过 mypy 暴露；随后逐分支迁移，并以 import-linter 保证依赖方向。
