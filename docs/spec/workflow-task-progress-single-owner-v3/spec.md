> spec_version: 3
> adversarial_risk_version: 3
> complexity: 4
> importance: 3
> risk_average: 3.5
> review_budget: deep
> adversarial_review: complete

# workflow-task-progress-single-owner-v3

## 任务目标

- `SessionTaskProgressManager` 成为 session 当前任务进度的唯一状态判定者与持久化入口；workflow runtime、LLM 工具、REST 和 Web 只通过该 Manager 的公开合同协作。
- LLM 只获得 `start` 与 `next` 两个 task-flow 命令：`start` 激活一个依赖已满足的步骤，`next` 原子完成当前步骤并激活指定下一步；最后一次 `next` 在全部步骤完成后自动结束当前任务流。
- LLM 无法提交裸 `status`、任务描述、展示顺序、运行 ID、错误信息或任意整快照；`pending/in_progress/completed/failed/cancelled` 五态全部由 Manager 状态机写入。
- runtime-owned workflow 根据真实 assigned、running、completed、failed、cancelled 生命周期调用 Manager，失败与取消在落盘、REST、计数和 Web 展示中保持原义。
- `task_progress.json` 只保存当前 foreground workflow 的进度板；workflow 历史继续由既有 workflow artifacts/list API 管理，Web 使用服务端显式返回的 `workflow_id` 与 `title` 展示当前任务。
- 同一 session 中新 workflow 接管 foreground 后，旧 workflow 的晚到、重复或乱序命令无法覆盖新快照；同一 workflow 的重试保持幂等，终态无法被普通推进命令回退。

## 非目标

- 本次不重构 workflow artifact、workflow history list、subagent report 或 task-flow 业务产物的存储格式；这些产物保持不可变计划/历史证据，不参与当前进度判定。
- 本次不增加多 workflow 聚合进度板；一个 thread 同时展示一个 foreground workflow，其他 workflow 继续出现在既有 active/history 能力中。
- 本次不增加 task progress WebSocket 推送、事件日志、耗时估算、优先级、负责人或外部项目管理系统同步。
- 本次不把普通可重试 tool error 自动判定为业务任务失败；当前步骤保持 `in_progress`，由后续重试、`next` 或拥有终态事实的内部 runtime 收口。
- 本次不提供 task progress schema v1 兼容 shim；开发期直接切换 schema v2，并由下一次 workflow 初始化当前进度板。
- 本次不新增通用事件总线或 `core.contracts` 协议；跨模块继续依赖 `SessionTaskProgressManager` 门户和 Web protocol 真源。

## 风险评分依据

- 复杂度：4。改动包含五态状态机、依赖就绪校验、幂等与乱序防护、session 文件原子更新，以及 sessions、agent workflow、LLM tool、REST DTO、前端投影之间的多组件一致性。
- 重要性：3。该能力面向全部 Web/CLI workflow 用户并影响长任务进度可信度，任务实际执行链仍可在进度 UI 之外独立完成。
- 预算升级：平均分 3.5 对应 `deep`；复杂度单维为 4，预算保持 `deep`。

## 影响边界与不变量

| 模块 | 角色 | 本次影响 | 主要风险 | 必须保持的不变量 | 依据 |
|---|---|---|---|---|---|
| `src/sessions/task_progress_models.py` | 目标 | 定义 schema v2、五态 `StrEnum`、控制模式、命令与依赖字段 | 枚举或字段只在一侧更新 → 落盘、REST、TS 语义漂移 → 快照无法读取或展示错误 | 有限状态和控制模式使用 `StrEnum`；任务 ID、依赖、顺序和描述在 workflow 初始化后保持不可变 | `J1`、`J6`、`J8` |
| `src/sessions/task_progress_manager.py` | 目标 | 成为唯一状态 owner，提供初始化、LLM 命令、runtime 迁移和读取入口 | 重复、乱序或错误 owner 命令通过 → 终态回退或新 workflow 被旧写覆盖 → 用户看到错误当前任务 | 所有状态迁移在持锁 repository update 内完成；每次写入同时校验 session、workflow、control mode、当前步骤和依赖 | 用户任务、`J2`、`J5`、`J7` |
| `src/sessions/_task_progress_repository.py` | 相关 | 沿用文件锁、临时文件、`fsync` 与原子替换，写入 schema v2 | 状态校验与写入分离 → 两个命令都基于旧快照成功 → 丢失更新 | 同一 session 的读取、校验、迁移和替换位于同一锁区间；异常后临时文件与锁目录可回收 | `J7` |
| `src/application/agent_workflows/manager.py` 与 task-flow strategy | 上游 | 删除 `_task_progress_state` 镜像；初始化 foreground progress；runtime-owned 模式提交真实生命周期；task-flow 携带依赖图 | 继续维护内存镜像或全量同步 → 进程重启/晚到写覆盖 durable 快照 → 双 owner 复发 | AgentWorkflowManager 只提交初始化或生命周期事实；状态合并、计数与合法迁移由 SessionTaskProgressManager 决定 | `J3`、`J5` |
| task-flow plan/artifact writer | 相关 | 保持既有产物格式和初始化时内容，只作为不可变计划证据 | artifact 中的初始节点状态被当前状态消费者读取 → task_progress 与 artifact 展示不同进度 → 只读侧形成第二真源 | start/next/runtime transition 只更新 SessionTaskProgressManager 快照；REST、Web 与后续业务判断均不从 plan/artifact 重建当前状态 | `J11` |
| `src/tools/builtin/task_progress_tool.py` 与工具注册 | 上游 | 将任意状态 patch 收敛为单一 `advance_task_progress` 工具，action 仅 `start/next` | LLM 继续提交 status/desc/order → 绕过状态机或篡改骨架 → 进度失真 | ToolContext.session_id 是 session 真源；工具只传 workflow_id、action、current/next step ID；Manager 返回结果后工具才报告成功 | 用户任务、`J2`、`J9` |
| `src/hosts/web/protocol/rest_models.py` 与 task-progress router | 下游 | Python Web wire 真源增加 schema v2 五态 DTO；REST 保留 GET，移除 dev PUT 写入口 | router 局部 DTO 或 PUT 继续写快照 → 第三写路径与协议漂移 → 单 owner 失效 | router 只调用 Manager 读取门户；发送前通过协议模型校验并 `model_dump()` | `J6`、`J8` |
| `web/src/protocol.ts`、task progress hook/popover | 下游 | 1:1 复刻 schema v2；直接使用 top-level workflow_id/title 和五态展示 | 前端继续从 task ID 与历史数组推断 current → 旧 workflow 污染标题、计数和历史过滤 | Web 只投影后端状态；current 与 history 使用各自明确 DTO；前端不持久化或改写任务状态 | `J4`、`J8` |
| workflow history/active workflow 能力 | 相关 | 保持既有 owner，只消费显式 current workflow ID 进行展示组合 | task_progress 继续积累历史任务 → 两份历史事实发生分叉 | task_progress 只含 foreground；workflow artifacts/list API 独占历史事实 | `J4`、`J10` |

## 判断依据

| J-ID | 判断 | 来源 | 证据或推断 | 状态 |
|---|---|---|---|---|
| J1 | 公共任务状态必须保留 `failed` 与 `cancelled`，并把 assigned/running 仅在 Manager 边界规范化为 pending/in_progress | 仓库事实 | `src/sessions/task_progress_manager.py` 当前把 `failed -> pending`、`cancelled -> completed`，夜间报告已确认用户可见语义漂移 | 已确认 |
| J2 | LLM 只能表达 start/next 意图，无法直接设置状态字段 | 用户任务 | 用户确认 LLM 只拥有开始与下一步推进能力，异常状态由内部状态机收口；最后一次 next 自动完成以删除冗余 complete 命令 | 已确认 |
| J3 | AgentWorkflowManager 的 `_task_progress_state` 必须删除 | 仓库事实 | `src/application/agent_workflows/manager.py` 当前维护进程内镜像并反复全量调用 `sync_workflow_tasks()`，与 durable snapshot 形成双 owner | 已确认 |
| J4 | 当前进度与 workflow 历史必须使用两个明确 owner | 仓库事实 | `ThreadTaskProgressPopover` 当前从全部 task key 推断 workflow ID，再与 history 交叉过滤；连续 workflow 会让旧任务参与当前标题和计数 | 已确认 |
| J5 | task-flow 的 next 必须校验依赖就绪，LLM 负责从就绪节点中选择下一步 | 仓库事实 | task-flow plan 已携带 `depends_on`，`SubAgentTask.metadata.task_flow_depends_on` 保存该结构；当前 parser 尚未校验缺失依赖、自依赖和环 | 已确认 |
| J6 | schema v2 只保留状态机所需字段并显式携带 foreground workflow 坐标 | LLM 推断 | 单一当前进度板只需 top-level workflow_id/title/control_mode 与任务 id/task_run_id/desc/depends_on/status/order/error/time；`source`、`source_status`、恒等的 orchestration_task_id 和 item.workflow_id 属于重复语义 | 已确认 |
| J7 | P1 的故障机制是多来源整快照覆盖，现有 repository 锁与原子替换继续复用 | 仓库事实 | repository 已用同 session 文件锁、临时文件、fsync、os.replace 防止半写；Manager 当前允许 workflow/LLM 全量合并并根据 source 启发式覆盖 | 已确认 |
| J8 | Python Web wire DTO 与 TypeScript protocol 必须同步修改 | 项目规范 | AGENTS.md 约束 17 指定 `src/hosts/web/protocol/` 与 `web/src/protocol.ts` 为 Web wire 双侧真源 | 已确认 |
| J9 | 普通 tool error 保持当前步骤运行中；具有终态事实的内部 runtime 才能写 failed/cancelled | LLM 推断 | tool error 可能被同一 run 重试，自动失败会产生假终态；AgentWorkflowManager 捕获的 child failure/cancel/timeout 具备任务与 workflow 精确坐标 | 已确认 |
| J10 | 新 foreground workflow 初始化时替换当前快照，旧 workflow 后续命令按 workflow_id 冲突收口 | 用户任务 / LLM 推断 | 当前 UI 只表达一个当前任务标题；显式替换加 workflow_id guard 是消除历史污染与晚到覆盖的最小模型 | 已确认 |
| J11 | task-flow plan/artifact 是不可变计划证据，当前进度只读取 SessionTaskProgressManager 快照 | LLM 推断 | 单 owner 同时约束写入者和当前状态消费者；保留另一份可被读取为 current 的初始节点状态会让正确写入仍产生错误展示和业务判断 | 已确认 |

## 建模覆盖声明

| 维度 | 覆盖位置或具体不适用理由 |
|---|---|
| 数据流 | `影响边界与不变量` 中 LLM/runtime → SessionTaskProgressManager → repository → REST → Web；`SC_01`、`SC_10`、`SC_12`、`SC_14` |
| 状态 | `J1`、`J2`、`J5`、`J9`；`SC_02` 至 `SC_09` |
| 时序 | 新旧 workflow 接管、重复 next、乱序 runtime 终态与并发锁窗口由 `SC_07`、`SC_09`、`SC_11` 覆盖 |
| 资源 | repository 锁、临时文件与原子替换由 `J7`、`SC_11` 覆盖；无新增后台任务、网络连接或长期内存缓存 |
| 不变量 | `影响边界与不变量` |
| 故障 | dependency 错误、owner 错误、recoverable tool error、runtime failure/cancel、Web 协议漂移由 `SC_05` 至 `SC_08`、`SC_12` 覆盖 |

## 验收清单

### 单元测试

- [ ] Manager 初始化 schema v2 foreground 快照，任务骨架不可由后续命令改写，五态 counts 始终由服务端重算。
- [ ] `start` 只激活 control_mode=`llm_steps` 且依赖已满足的 pending step；重复 start 幂等，错误 workflow/step/依赖保持快照逐字段不变。
- [ ] `next` 原子完成 current step 并激活指定 ready step；最后一次 next 自动完成；缺失 unfinished next、终态回退和 stale replay 返回可判定冲突。
- [ ] task-flow parser 拒绝缺失依赖、自依赖、循环依赖和 LLM 提交的初始 status。
- [ ] runtime lifecycle 精确保留 failed/cancelled/error_message；普通可重试 tool error 保持 current step in_progress。
- [ ] 新 workflow 接管 foreground 后，旧 workflow 命令与并发晚到写无法改变新快照。
- [ ] `advance_task_progress` schema 只接受 action、workflow_id、step_id、next_step_id，并使用 ToolContext.session_id。
- [ ] Python REST DTO 与 TS protocol fixture 覆盖 schema v2 五态、未知字段、缺失字段和错误映射。
- [ ] 前端 view model 覆盖五态标签、图标、counts、显式 workflow title、空态与 GET 失败态。
- [ ] task-flow plan/artifact 在 start/next 后保持初始化内容，当前进度的代码与测试消费者只读取 SessionTaskProgressManager/REST 快照。

### Smoke 测试

- [ ] task-flow 通过真实 AgentWorkflowManager 初始化 progress，真实工具调用 start/next，真实 SessionTaskProgressManager 与 repository 落盘，再由真实 FastAPI GET 返回同一 schema v2 快照。
- [ ] runtime-owned parallel workflow 通过真实生命周期入口产生 running→failed/cancelled，并由 GET 返回与磁盘一致的终态和 counts。
- [ ] 同一 session 连续初始化 workflow A/B，再提交 A 的晚到 next，断言磁盘、Manager read 和 REST 三处都保持 B。
- [ ] start/next 更新 task_progress 后，断言 task-flow artifact 保持不可变且真实 GET/Web 投影展示 Manager 的新状态。

### E2E 测试

- 决策：需要
- 依据：该 P1 跨越模型工具、workflow Manager、session 持久化、真实 Web API 与用户可见 React 状态；项目规范要求用户可见跨前后端流程具有薄 e2e，外部 LLM 可使用 fake。
- [ ] 使用 fake LLM 创建两步 task-flow 并调用 start/next，Web 进度弹窗依次显示进行中、下一步进行中、全部完成；随后启动新 workflow，历史区域与当前标题各自读取明确 owner，旧 workflow 晚到更新无法改变当前 UI。

## 测试驱动开发

1. `SC_01`、`SC_05` → 先为 schema v2、StrEnum、任务骨架与 dependency graph 写失败单测。
2. `SC_02`、`SC_03`、`SC_04` → 先为 start/next/final-next 状态机写失败单测。
3. `SC_06`、`SC_07`、`SC_08`、`SC_09` → 先为权限边界、内部异常、幂等和 stale workflow 写失败单测。
4. `SC_11` → 使用同 workflow 并发命令和 repository lock 写失败测试，固定单次原子迁移。
5. `SC_10`、`SC_12` → 先写真实 Manager→file→REST smoke 与 Python/TS protocol、React 投影测试。
6. `SC_14` → 先写 artifact 不参与当前进度读取的失败 smoke。
7. `SC_13` → 先写 fake LLM 驱动的 Web 薄 e2e。
8. 实现满足测试的最小代码，删除旧 patch/PUT/内存镜像路径，重构后复跑单元、Smoke 和 E2E。

## 对抗性审查记录

| Review | 预算 | 风险来源 | 查询 | 召回 ID | 复用 Scenario | 新增 Scenario | CLI |
|---|---|---|---|---|---|---|---|
| ARV-1 | deep | assumption:duplicate-progress-projection | 无 RAG 经验集；Risk：task-flow plan/artifact 的初始节点状态被当前状态消费者读取，形成只读侧第二真源 | 无 | SC_10 | SC_14 | skipped:no-corpus |

## Scenarios

### Scenario SC_01: 初始化唯一 foreground 进度板

- **GIVEN** 一个 session 已存在 workflow A 快照，workflow B 提供非空、ID 唯一且依赖图合法的 task-flow 节点
- **WHEN** AgentWorkflowManager 通过 SessionTaskProgressManager 初始化 workflow B，control_mode=`llm_steps`
- **THEN** `task_progress.json` 只包含 B 的 top-level workflow_id/title/control_mode 与 B 的 pending tasks，counts 与 tasks 一致，A 的任务不再出现在当前快照
- 测试层：unit
- 依据：`J3`、`J5`、`J10`
- 来源：initial-spec

### Scenario SC_02: LLM start 激活依赖已满足步骤

- **GIVEN** 当前 workflow 使用 `llm_steps`，step-1 为 pending 且所有 depends_on 均 completed，当前没有 in_progress step
- **WHEN** LLM 工具提交 action=`start`、当前 workflow_id 与 step_id=`step-1`
- **THEN** Manager 只把 step-1 改为 in_progress，任务骨架字段保持不变，重复相同 start 返回相同快照
- 测试层：unit
- 依据：用户任务、`J2`、`J5`
- 来源：initial-spec

### Scenario SC_03: LLM next 原子完成当前步骤并激活下一步

- **GIVEN** step-1 是唯一 in_progress step，step-2 为 pending，step-2 的全部依赖在本次迁移后均 completed
- **WHEN** LLM 工具提交 action=`next`、step_id=`step-1`、next_step_id=`step-2`
- **THEN** 同一次 repository update 将 step-1 设为 completed、step-2 设为 in_progress并重算 counts，Web 读取不到两次迁移之间的中间态
- 测试层：unit
- 依据：用户任务、`J2`、`J7`
- 来源：initial-spec

### Scenario SC_04: 最后一次 next 自动结束任务流

- **GIVEN** 当前 step 是唯一 in_progress step，其余步骤全部 completed
- **WHEN** LLM 工具提交 action=`next`、当前 step_id 且省略 next_step_id
- **THEN** Manager 将当前 step 设为 completed，快照中没有 pending/in_progress task，counts.completed 等于 total，派生 workflow 状态为 completed
- 测试层：unit
- 依据：用户任务、`J2`
- 来源：initial-spec

### Scenario SC_05: 非法依赖与未就绪下一步无法推进

- **GIVEN** task-flow 含缺失依赖、自依赖或循环依赖，或 next 指向仍有 pending dependency 的 step
- **WHEN** parser 初始化计划或 Manager 处理 next
- **THEN** 对应入口返回明确校验错误，task_progress 文件缺失或保持调用前逐字段相同，错误路径不创建部分迁移
- 测试层：unit
- 依据：`J5`、`J7`
- 来源：initial-spec

### Scenario SC_06: LLM 命令无法写入状态与骨架字段

- **GIVEN** LLM 工具参数包含 status、desc、display_order、task_run_id、error_message、session_id 或未知字段之一
- **WHEN** Tool.prepare 校验参数
- **THEN** 调用在 Manager 之前失败，task_progress 快照保持逐字段不变，ToolContext.session_id 仍是唯一 session 坐标
- 测试层：unit
- 依据：用户任务、`J2`
- 来源：initial-spec

### Scenario SC_07: 内部 runtime 保留失败与取消终态

- **GIVEN** runtime_lifecycle workflow 的任务处于 running，AgentWorkflowManager 捕获带精确 task/workflow 坐标的 failed、cancelled 或 timeout 终态
- **WHEN** 内部 lifecycle adapter 调用 Manager 的 runtime transition 入口
- **THEN** 快照分别保存 failed 或 cancelled，error_message 与五态 counts 一致，后续 assigned/running 普通事件无法回退该终态
- 测试层：unit
- 依据：`J1`、`J9`
- 来源：initial-spec

### Scenario SC_08: 可重试工具错误保持当前步骤运行中

- **GIVEN** llm_steps workflow 的当前步骤为 in_progress，主 LLM 收到一个普通 tool error 且 workflow runtime 没有终态失败或取消事实
- **WHEN** 本轮工具调用结束并允许 LLM 重试或 ask_user
- **THEN** Manager 不产生 failed/cancelled 迁移，当前步骤继续为 in_progress，后续合法 next 仍可完成该步骤
- 测试层：smoke
- 依据：`J9`
- 来源：initial-spec

### Scenario SC_09: 控制模式与旧 workflow 坐标阻断越权推进

- **GIVEN** 当前 foreground 是 workflow B，或当前 workflow 使用 runtime_lifecycle control mode
- **WHEN** LLM 提交 workflow A 的 start/next，或向 runtime_lifecycle workflow 提交 start/next
- **THEN** Manager 返回可判定冲突，当前 workflow ID、tasks、counts 和 updated_at_ms 全部保持不变
- 测试层：unit
- 依据：`J2`、`J10`
- 来源：initial-spec

### Scenario SC_10: Web 只投影显式当前坐标与五态

- **GIVEN** schema v2 快照显式包含 workflow_id/title，并含 pending、in_progress、completed、failed、cancelled 任务；workflow history 同时含相同和旧 workflow 条目
- **WHEN** Web GET 返回快照并由 hook/popover 构造 view model
- **THEN** 当前标题直接取 snapshot.title，任务标签与图标逐一匹配五态，history 由 history DTO 自身渲染，前端不从 task ID 推导 workflow ID
- 测试层：smoke
- 依据：`J1`、`J4`、`J8`
- 来源：initial-spec

### Scenario SC_11: 并发与重复 next 只产生一次合法迁移

- **GIVEN** 两个调用基于同一 in_progress step 并发提交相同或不同 next，repository 对同一 session 使用文件锁
- **WHEN** 两个 Manager update 竞争执行
- **THEN** 第一个合法命令完成单次原子迁移；完全相同的一步重试返回幂等结果，冲突 next 或已经跨过一步的 stale replay 返回冲突，最终快照只含一个 in_progress step
- 测试层：unit
- 依据：`J7`、`J10`
- 来源：initial-spec

### Scenario SC_12: REST 与双侧协议拒绝 schema 漂移

- **GIVEN** Manager 返回 schema v2 快照，Python REST fixture 与 TypeScript fixture 分别覆盖合法五态、未知字段和缺失必填字段
- **WHEN** GET router 序列化响应并运行双侧合同测试
- **THEN** 合法 fixture 在两侧产生一致字段和值，未知或缺失字段在合同边界失败，router 没有 task-progress 写入口
- 测试层：smoke
- 依据：`J6`、`J8`
- 来源：initial-spec

### Scenario SC_13: 用户可见 task-flow 全链路保持单 owner

- **GIVEN** fake LLM 在真实 Web thread 创建两步 task-flow，页面打开 task progress popover
- **WHEN** fake LLM 依次调用 start、next 和最后一次 next，并随后创建新的 workflow B
- **THEN** UI 依次显示 step-1 进行中、step-1 完成且 step-2 进行中、全部完成、B 成为当前标题；A 的晚到命令不会改变 B，A 只通过 workflow history owner 展示
- 测试层：e2e
- 依据：用户任务、`J4`、`J10`
- 来源：initial-spec

### Scenario SC_14: 不可变 task-flow artifact 无法成为当前进度真源

- **GIVEN** task-flow 初始化时已经写入 plan/artifact，SessionTaskProgressManager 快照随后通过 start/next 推进到不同状态
- **WHEN** 后端 GET、Web view model 或内部当前进度消费者读取该 workflow 的最新进度
- **THEN** 所有当前状态结果与 Manager 快照逐字段一致，plan/artifact 保持初始化内容且没有消费者从中重建 status 或 counts
- 测试层：smoke
- 依据：`J11`
- 来源：adversarial-review (assumption:duplicate-progress-projection)
