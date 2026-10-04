> spec_version: 3
> adversarial_risk_version: 3
> complexity: 5
> importance: 3
> risk_average: 4.0
> review_budget: full
> adversarial_review: complete

# llm-conversation-full-fork-v0.1

## 任务目标

- 用户可从一个 `generic_chat` 普通聊天 thread 创建新的完整分支，并立即进入目标 thread 继续对话。
- 每条已完成的 LLM 最终回复气泡在复制按钮右侧提供分叉图标；点击后目标历史精确截止到该回复，源 thread 中更晚的消息保持原样且不进入目标。
- 目标 Session 按原顺序保存所选 assistant 回复边界内的全部结构化 `Message`；每条消息的 `role`、`content`、`tool_calls`、`tool_call_id`、`name` 和嵌套 `metadata` 保真，包含 reasoning/provider metadata 与附件引用。
- 回复级分叉边界以服务端提供的 `Session.history()` 零基 `history_index` 为唯一坐标；历史回放和实时完成帧携带同一语义，前端原样透传。
- 目标 thread 继承源 thread 的 preset 与 cwd，以 `forked_from_id` 记录直接父 thread；目标 run count、permissions、运行态、pending input 和资产目录使用独立坐标。
- fork 只在源 thread 处于完整快照边界时提交；运行中、等待审批或存在 pending input 时返回稳定冲突，且不产生目标 thread。
- fork 的公开成功边界包含目标 metadata、完整 Session 历史和历史引用资产；提交前失败时清理目标状态，客户端只能观察完整目标或明确错误。

## 非目标

- Claude Code 与 Codex provider-owned thread 继续使用各自 SDK/CLI session 真源；本版本不复制或改写其外部历史文件。
- scheduled task thread 保持调度器所有权；本版本不创建 scheduled task 分支。
- 本版本只支持 `session.backend=file` 的 FileSession；memory 与 sqlite 后端在 Manager 边界返回范围错误。
- 回复级入口只接受已完成且无 `tool_calls` 的 assistant 最终回复边界；任意 user、tool、reasoning、中间 tool-call assistant 或流式中的消息不提供分叉入口。
- Web UI 的分叉入口只位于可分叉 assistant 回复气泡下方；侧栏、user 消息、tool request 与 tool result 保持普通展示。
- 本版本不提供覆盖原 thread 的 fork。
- 原始 trace/event 流、旧 session record ID、record 写入时间、累计 usage、瞬态工具卡和审批 UI 状态不属于目标 LLM replay 历史；目标 usage 从零开始。
- 每次成功 POST 创建一个新分支；本版本不把重复请求合并为同一个目标 thread。

## 风险评分依据

- 复杂度：5。功能包含源 thread 并发快照、跨 metadata/FileSession/AssetStorage 的多阶段持久化提交、异常与取消回滚和 Web 前后端协议同步，命中锁、崩溃边界与多阶段持久化提交信号。
- 重要性：3。功能面向所有 Web 用户并影响对话历史完整性、附件可用性和后续 LLM 上下文；fork 属于全用户可用的非核心能力。
- 预算升级：平均分 4.0 映射为 `full`；复杂度单维为 5，预算固定为 `full`。

## 影响边界与不变量

| 模块 | 角色 | 本次影响 | 主要风险 | 必须保持的不变量 | 依据 |
|---|---|---|---|---|---|
| `src/hosts/web/threads/manager.py` | 目标 | 增加完整快照、目标组装、提交与回滚门户 | 源状态在快照时变化、请求取消或目标分阶段可见 → 半截历史成为可打开 thread | `ThreadManager` 是 fork 唯一业务门户；metadata 是最后公开提交点；成功响应前历史和资产完整；冲突、异常和取消不留下可列出的目标 | `J2`、`J4`、`J7`、`J13` |
| `src/core/message.py`、`core.contracts.Session`、`src/core/runner.py` | 上游 | 提供 fork 的语义历史合同和 assistant 落盘坐标 | 只复制文本、共享嵌套 dict 或用前端可见序号猜坐标 → tool/reasoning 丢失、分支互相污染或截断错位 | 目标消息序列等于选定前缀；每个可变嵌套对象使用独立副本；terminal `turn.end` 的 `history_index` 等于刚落盘 assistant 在 Session 中的零基位置 | `J2`、`J3`、`J15` |
| `src/sessions/`、`runtime_assembly/session_engine.py` | 下游 | 为目标 thread 创建独立 FileSession 并在后续 boot 恢复 | 非持久或暂不维护的后端进入 fork → 产生不可验收的第二条存储链路 | Manager 只接受 `session.backend=file`；目标 run count 从 0 开始；重启后 FileSession 可恢复相同 `Message` 序列 | `J2`、`J5` |
| `src/hosts/web/uploads/storage.py` | 下游 | 为历史引用的附件创建目标 thread 独立副本 | 全目录复制、引用缺失或复制中断 → 非对话资产扩散、目标附件缺失或出现半文件 | 只复制历史引用的 ready 资产；每个引用必须形成 payload/metadata 闭包；删除源 thread 不影响目标资产 | `J6`、`J7`、`J14` |
| `src/hosts/web/threads/metadata.py` | 目标 | schema v12 增加 nullable 直接父 lineage | 老 metadata 无法读取或 lineage 指向错误祖先 → 列表丢失或血缘失真 | v1-v11 连续懒升级到 v12；普通 thread 为 `None`；嵌套 fork 记录直接父 thread | `J8`、`J12` |
| `src/hosts/web/protocol/`、`web/src/protocol.ts` | 目标 | 双侧同步 `forked_from_id`、可选 fork request、历史消息与 terminal `turn.end` 的 `history_index` | 单侧协议修改或实时/回放坐标语义分裂 → REST 响应漂移或点击旧回复截到另一条消息 | Python DTO 与 TypeScript 形状、nullable 语义、索引下界和版本集合一致；实时与回放的 `history_index` 都指向 Session 原始 Message 位置 | `J8`、`J15`、`J17` |
| `src/hosts/web/routers/threads.py` | 上游 | 暴露 `POST /api/threads/{id}/fork` 的可选回复边界并映射错误 | 错误类别漂移或非法边界进入 Manager → UI 无法区分重试、缺失与范围错误 | 成功 201；快照冲突 409；缺失 404；非法 ID/DTO 422；不支持的 thread 类型或语义边界 400；无 body 保持全量 fork | `J4`、`J9`、`J16` |
| `src/hosts/web/app_support/generic_history.py`、`src/hosts/web/websocket/event_sink.py` | 目标 | 把 Session 原始索引投影到历史文本和实时 terminal turn | 工具消息展开成多个 UI item 或实时流使用另一套 ID → 前端边界错位 | `history_index` 在 tool 展开前取自原始 Session 序列；只有无 tool_calls 的 terminal assistant 暴露可分叉边界 | `J15`、`J16` |
| `web/src/stores/threads.ts`、`MessageList.tsx`、`ThreadList.tsx`、`web/src/chat/` | 下游 | 发起回复级 fork、保存边界坐标、展示加载/禁用/错误并导航 | 双击重复提交、流式中可点、边界字段在时间线投影中丢失或成功后停留源 thread → 重复分支和错误上下文 | 单次 UI 操作只发一个请求；分叉图标位于 assistant 复制按钮右侧；仅稳定边界可操作；成功导航目标；失败恢复按钮；侧栏与工具卡不提供入口 | `J9`、`J11`、`J15`、`J17` |
| `PermissionsManager`、usage 派生与 thread status | 相关 | 保持目标 thread 独立状态 | 复制 allow/deny、累计 usage 或 active 状态 → 新分支继承安全授权或错误计费 | 新 thread_id 选择新的 permissions 本子；usage、run count、pending/approval/status 从初始状态开始 | `J5`、`J10` |

## 判断依据

| J-ID | 判断 | 来源 | 证据或推断 | 状态 |
|---|---|---|---|---|
| J1 | 本版本目标通道为 `generic_chat` 普通聊天；Claude Code/Codex 保持 provider-owned session 边界 | 架构规范 | AGENTS 规定 generic chat 为 Web 主实现线，provider 专属逻辑留在 SDK/CLI/transport adapter；三类 backend 已有独立历史真源 | 已确认 |
| J2 | generic chat 的可继续推理历史真源是 `Session.history()` 返回的有序 `Message` 序列 | 仓库事实 | `core.contracts.Session`、`SessionEngine.get_or_create_session()`、`websocket/routes.py::_send_history_frame()` 均从 Session 读取历史 | 已确认 |
| J3 | “完整 fork”在 Kongming 内核中表示复制每个 `Message` 的全部字段与嵌套值，不只复制 user/assistant 文本 | 用户任务、仓库事实 | 用户要求完整 fork；`Message` 合同原生承载 tool calls/results、name 与 metadata，LLM replay 直接消费该结构 | 已确认 |
| J4 | 完整快照边界要求源 thread 无 active run、无 pending approval、无 pending input 和 send-now claim | 仓库事实、LLM 推断 | `ThreadCell` 的运行与队列状态分属 `current_run_task`、ApprovalManager、`pending_inputs`、`pending_input_send_now_claims`；任一存在都可能尚未落成完整历史 | 已确认 |
| J5 | 目标分支只继承 replay 配置 preset/cwd；安全授权、usage、run count 和运行态按新 thread_id 初始化 | 安全规范、LLM 推断 | Safety v0.6 以 thread_id 选择 permissions 本子；usage 和 run lineage 属于新分支后续执行坐标 | 已确认 |
| J6 | 历史中 `status=ready` 的附件引用属于可重放上下文，必须拥有目标 thread 下的独立 payload 与 metadata | 仓库事实 | `Message.metadata.attachments` 是 Web 多模态软合同；下游按 thread_id + asset_id 读取资产 | 已确认 |
| J7 | metadata 是目标 thread 的公开存在标志；metadata 提交前可清理内部目标资源，提交后目标必须完整可恢复 | 仓库事实、LLM 推断 | `list_threads()` 扫描 metadata，Web 路由和 WS boot 也以 metadata 存在为入口 | 已确认 |
| J8 | `forked_from_id` 是持久化和 REST/TS 共享字段，需升级 ThreadMetadata schema 并保持旧版本连续迁移 | 仓库事实 | Python metadata/DTO 与 `web/src/protocol.ts` 是 Web wire 双侧真源 | 已确认 |
| J9 | generic chat 只在 assistant 最终回复气泡提供 fork 入口；REST 返回目标 DTO 后 store 更新缓存并导航目标 route | 用户任务、仓库事实 | `MessageList` 已有复制按钮与悬停页脚；Zustand threads store 与 thread CRUD 路由构成共用提交链；工具 request/result 通过独立 ToolCard 展示 | 已确认 |
| J10 | raw trace、旧 record identity、累计 usage 和瞬态 UI 状态不是 `Session.history()` 的一部分，不进入本版本 replay 合同 | 仓库事实 | Session 协议只返回 `Message`；trace、usage、approval 和 timeline transient state 有独立 owner | 已确认 |
| J11 | POST fork 无 idempotency key；每次独立成功请求创建不同 thread_id | LLM 推断 | 用户操作语义是创建分支；当前 REST 合同没有可用于复用目标的 request identity | 已确认 |
| J12 | lineage 保存直接父 thread；从分支再次 fork 时，新目标指向本次源分支 | LLM 推断 | 直接父关系支持稳定树结构，且无需复制祖先链或维护第二份 lineage store | 已确认 |
| J13 | `CancelledError` 和进程中断属于多阶段提交故障；metadata 必须作为最后公开提交点，取消清理需等待已开始的阻塞 IO 收口 | LLM 推断 | 常见错误实现只捕获 `Exception`，而 Python 3.11 的 `CancelledError` 继承 `BaseException`；`asyncio.to_thread` 被取消后底层线程仍可能继续写目标文件 | 已确认 |
| J14 | 资产复制集合等于历史中去重后的 ready attachment 引用集合；无引用资产不属于 fork，任一引用缺少 payload/metadata 时整体失败 | LLM 推断 | 全目录复制会携带未发送上传并让无关损坏文件阻断 fork；静默跳过缺失引用会让目标历史包含无法读取的附件 | 已确认 |
| J15 | 回复级 fork 的唯一边界坐标是服务端生成的 `Session.history()` 零基 `history_index`；前端气泡 ID、run ID、turn 和可见回复序号只服务渲染 | 仓库事实、LLM 推断 | `normalize_generic_history()` 会把一条 tool-call Message 展开为多个 UI item，实时消息又按 run/turn 生成 ID；两条展示路径都无法单独充当 Session 位置真源 | 已确认 |
| J16 | 语义合法的回复边界必须指向 `role=assistant`、无 `tool_calls` 的 terminal Message；目标历史为 `source_history[:history_index + 1]`，附件闭包也只从该前缀提取 | 仓库事实、用户任务 | Runner 在 assistant append 后发 `turn.end`，有 tool_calls 时随后还会追加 tool result；截在该中间点会破坏 tool_use/tool_result 配对 | 已确认 |
| J17 | 历史回放在 `NormalizedMessage` 携带 `history_index`；实时链路在对应 terminal `TurnEndFrame` 携带同一索引，时间线与渲染适配层逐层保留该字段 | 仓库事实、LLM 推断 | 当前历史 ID 为 `<session>:<index>:<frame>`，实时 ID 为 run/turn identity；显式公共字段可让刚完成回复与刷新后的同一回复调用相同 REST 合同 | 已确认 |

## 建模覆盖声明

| 维度 | 覆盖位置或具体不适用理由 |
|---|---|
| 数据流 | `Session.history → 可选 history_index 前缀 → Message 深拷贝 → 目标 Session`、`history_index → wire → timeline → fork request` 与 `attachment ref → AssetStorage target copy`，见 `SC_01`、`SC_02`、`SC_11`、`SC_15`、`SC_16` |
| 状态 | 源快照门卫、目标未提交/已提交、UI idle/loading/error、回复边界可用态与独立 run/permissions 状态，见 `SC_03`、`SC_04`、`SC_07`、`SC_08`、`SC_10`、`SC_17` |
| 时序 | 源状态判定先于快照；assistant append 先于带边界的 terminal turn.end；历史和资产持久化先于 metadata 公开提交；取消等待在途 IO 后清理；见 `SC_03`、`SC_07`、`SC_11`、`SC_13`、`SC_17` |
| 资源 | target runtime/Session、选定前缀的引用资产闭包、payload/metadata 临时文件与失败/取消清理，见 `SC_02`、`SC_07`、`SC_11`、`SC_13`、`SC_14`、`SC_15` |
| 不变量 | `影响边界与不变量`、`SC_01`、`SC_07`、`SC_15`、`SC_16` |
| 故障 | active/pending 冲突、范围错误、复制失败、请求取消、非法/错位回复边界、实时完成竞态、缺失引用资产、源删除后的资产读取与持久后端恢复，见 `SC_03`、`SC_04`、`SC_05`、`SC_06`、`SC_07`、`SC_11`、`SC_13`、`SC_14`、`SC_16`、`SC_17` |

## 验收清单

### 单元测试

- [ ] 完整 `Message` 序列及所有嵌套字段值相等、对象引用独立，目标 run count 为 0（`SC_01`、`SC_08`）。
- [ ] 运行中、等待审批、pending queue 和 send-now claim 各自阻止 fork，目标 metadata/Session/资产计数保持不变（`SC_03`、`SC_04`）。
- [ ] provider-owned、scheduled task 与非 file session backend 返回 400；缺失与非法 ID 分别返回 404/422；非 file 拒绝发生在 runtime factory 调用前（`SC_05`、`SC_06`）。
- [ ] metadata、Session append、资产复制任一步失败时清理目标公开状态和已创建资源（`SC_07`）。
- [ ] 在资产复制、Session append 和 metadata 提交窗口取消请求时，等待在途 IO 收口后清理目标；metadata 提交前的进程中断不会留下可列出的半截目标（`SC_13`）。
- [ ] 资产复制只处理历史引用的 ready asset_id；无引用资产不进入目标，引用缺少 payload/metadata 时整体失败并回滚（`SC_14`）。
- [ ] v1-v11 metadata 升级到 v12，Python/TS 合同包含 nullable lineage；嵌套 fork 保存直接父 ID（`SC_08`、`SC_09`）。
- [ ] 前端覆盖成功导航、请求中禁用、后端错误恢复，以及侧栏、scheduled task、user 与 tool 卡片隐藏入口（`SC_10`）。
- [ ] 同一源 thread 的两次顺序成功请求产生两个不同目标，标题始终满足 200 字符上限（`SC_12`）。
- [ ] 回复级请求精确复制到 terminal assistant 的 `history_index`，保留该点之前的完整 tool_use/tool_result，排除之后的消息和附件；省略 body 继续全量复制（`SC_15`）。
- [ ] REST 拒绝越界索引、user/tool 索引和带 `tool_calls` 的 assistant 索引；历史工具展开、实时 run/turn ID 与可见列表顺序均不参与边界计算（`SC_16`）。
- [ ] Python/TS wire、ChatTimelineStore、ChatRenderAdapter 与 ChatItem 逐层保留实时/回放 `history_index`；流式中隐藏入口，terminal frame 后启用（`SC_17`）。

### Smoke 测试

- [ ] 使用真实 FastAPI TestClient、ThreadManager、FileSession、metadata store 和 AssetStorage：创建源、写入 tool/reasoning/attachment 历史与非零 usage、调用 fork、用新 FileSession 实例恢复目标，并在删除源后读取目标附件（`SC_02`、`SC_08`、`SC_11`）。
- [ ] 使用真实 FastAPI TestClient 与 FileSession 构造至少两个完整回复及中间工具调用；按第一条 terminal assistant 的服务端索引 fork，恢复目标后只得到该前缀，目标资产只含前缀引用（`SC_15`、`SC_16`）。
- [ ] 运行目标 backend unit/smoke、前端组件/store 测试、TypeScript、ruff、mypy、`git diff --check` 与 import-linter。

### E2E 测试

- 决策：需要
- 依据：功能贯穿真实浏览器操作、Zustand store、REST、metadata/Session/资产持久化和目标 route/history replay；分离的组件 mock 与后端 TestClient 无法证明用户操作进入同一个目标 thread。
- [ ] Playwright 使用真实 Web app 与 fake LLM：点击源 assistant 最终回复下方的分叉图标，断言只发一个 POST、URL 切换到返回的目标 ID、目标页面回放源文本/tool item/附件，刷新后仍保持，源 thread 保持原历史（`SC_10`、`SC_11`）。
- [ ] Playwright 使用真实 Web app 与 fake LLM：生成两轮回复，悬停第一条 assistant 气泡，断言复制按钮右侧出现分叉图标；点击后只发一个带该回复 `history_index` 的 POST，导航目标并在刷新后只回放第一轮，第二轮仍留在源 thread（`SC_15`、`SC_17`）。
- [ ] opt-in Playwright 使用真实 Web 服务与真实 provider：源 thread 完成两轮 LLM 对话，从第一轮回复气泡分叉，在目标发送上下文核对消息；目标 LLM 只能复述第一轮 marker，FileSession 证据显示目标截止到所选 `history_index`，第二轮 marker 只存在于源 Session（`SC_15`、`SC_17`）。
- [x] opt-in Playwright 使用实际 Web 服务与真实 provider：空白页首发创建 generic thread，等待 source LLM 回复，完整分叉后经目标 WebSocket 发送第二条消息；目标 LLM 回复确认看见 source assistant marker，两份 FileSession 与 trace 使用同一组 source/fork thread ID（`SC_10`、`SC_11`）。

## 测试驱动开发

1. `SC_01`、`SC_03`、`SC_04` → 先写完整字段保真与四类非完整快照边界的红灯测试。
2. `SC_02`、`SC_07`、`SC_13`、`SC_14` → 先写资产独立性、metadata/Session/asset 分阶段失败、取消回滚、引用闭包和无关资产排除测试。
3. `SC_05`、`SC_06`、`SC_09` → 先写 REST 错误映射和 metadata 双侧升级合同测试。
4. `SC_08`、`SC_12` → 先写独立状态、直接父 lineage、重复请求和标题边界测试。
5. `SC_10` → 先写 UI 成功、loading/disabled/error 与 scheduled task 范围测试。
6. `SC_11` → 先写真实 FileSession/AssetStorage smoke 和浏览器 E2E；对现有实现发现的缺口保持同一测试先红后绿。
7. `SC_15`、`SC_16` → 先写服务端坐标、前缀截断、非法中间边界、前缀资产闭包和无 body 全量兼容的红灯测试。
8. `SC_17` → 先写 Python/TS 协议漂移、实时/历史时间线字段透传、气泡按钮位置及完成态竞态的红灯测试。
9. 实现最小修复，重构后复跑 unit、Smoke、E2E、静态检查和架构合同。

## 对抗性审查记录

| Review | 预算 | 风险来源 | 查询 | 召回 ID | 复用 Scenario | 新增 Scenario | CLI |
|---|---|---|---|---|---|---|---|
| ARV-1 | full | assumption:cancelled-multistage-publish | 功能关键词：generic chat、完整 fork、Session Message、AssetStorage、metadata 最后提交、asyncio cancellation；Risk：请求取消时后台 to_thread 继续写文件，而只捕获 Exception 的回滚被绕过，产生公开可见或随后复活的半截目标 | 无 | SC_07 | SC_13 | skipped:no-corpus |
| ARV-2 | full | assumption:asset-reference-closure | 功能关键词：Message attachments、ready asset_id、payload/metadata、目标资产目录；Risk：复制整个源目录会扩散未发送资产，静默跳过缺失引用会提交无法重放的附件历史 | 无 | SC_02 | SC_14 | skipped:no-corpus |
| ARV-3 | full | assumption:render-id-boundary-drift | 功能关键词：assistant 回复气泡、Session history_index、NormalizedMessage、tool item 展开、实时 run/turn ID；Risk：实现从气泡 ID 或可见回复序号反解历史位置，工具消息展开和实时/回放 ID 差异让目标截到错误 Message | 无 | 无 | SC_16 | skipped:no-corpus |
| ARV-4 | full | assumption:live-final-boundary-race | 功能关键词：流式 assistant、terminal turn.end、history_index、按钮启用、并发新 run；Risk：回复文本刚显示时按钮提前启用，assistant 尚未落成稳定 terminal 边界或新 run 已启动，产生半截历史或错误快照 | 无 | 无 | SC_17 | skipped:no-corpus |

## Scenarios

### Scenario SC_01: 完整结构化历史进入独立目标 Session

- **GIVEN** idle 的 generic chat 源 Session 按序包含 user attachment、assistant reasoning metadata、assistant tool call、匹配的 tool result 和最终 assistant 文本
- **WHEN** 用户 fork 该源 thread
- **THEN** 目标 Session 的 `Message` 序列与源序列逐字段值相等且顺序一致，每个消息 metadata 和 tool arguments 与源对象引用独立，目标 `message_count` 等于实际历史长度
- 测试层：unit
- 依据：用户任务、`J2`、`J3`
- 来源：initial-spec

### Scenario SC_02: 目标附件副本独立于源 thread 生命周期

- **GIVEN** 源历史含一个 `status=ready` 的图片附件，源 AssetStorage 中存在对应 payload 与 metadata
- **WHEN** fork 成功后删除源 thread
- **THEN** 目标 thread 仍可通过历史中的 asset_id 读取相同 bytes 和 MIME metadata，目标资产 metadata 的 thread_id/storage_path 指向目标坐标
- 测试层：smoke
- 依据：`J6`
- 来源：initial-spec

### Scenario SC_03: active run 或待审批阻止快照

- **GIVEN** 源 thread 存在未完成 `current_run_task` 或 ApprovalManager 返回该 thread 有 pending approval
- **WHEN** 客户端请求 fork
- **THEN** REST 返回 409，磁盘 metadata 列表、目标 Session 和目标资产目录均无新增
- 测试层：unit
- 依据：`J4`、`J7`
- 来源：initial-spec

### Scenario SC_04: pending input 与 send-now claim 阻止快照

- **GIVEN** 源 thread 无 active run，同时 `pending_inputs` 或 `pending_input_send_now_claims` 至少含一项
- **WHEN** 客户端请求 fork
- **THEN** REST 返回 409，源队列内容和版本保持原值，系统不创建目标 thread
- 测试层：unit
- 依据：`J4`
- 来源：initial-spec

### Scenario SC_05: provider-owned、scheduled task 与非 file backend 保持范围边界

- **GIVEN** 源 metadata 的 backend_kind 为 `claude_code`/`codex`、thread_kind 为 `scheduled_task`，或配置的 `session.backend` 为 memory/sqlite
- **WHEN** 客户端请求通用 fork 入口
- **THEN** REST 返回 400 且错误说明 thread 类型或 session backend 超出范围；provider session、scheduled source 和 metadata 均保持原值；非 file 请求不调用源或目标 runtime factory
- 测试层：unit
- 依据：`J1`
- 来源：initial-spec

### Scenario SC_06: 缺失和非法 thread ID 使用稳定 HTTP 错误

- **GIVEN** 一个格式合法但不存在的 thread_id，以及一个不满足 `thread-<hex12>` 的 path 参数
- **WHEN** 客户端分别请求 fork
- **THEN** 前者返回 404，后者返回 422，两次请求均不调用目标 runtime factory
- 测试层：unit
- 依据：`J9`
- 来源：initial-spec

### Scenario SC_07: 提交前失败清理目标状态

- **GIVEN** 源快照有效，目标 metadata 写入、runtime/Session 装配、资产复制或第 N 条 Message append 中任一步注入异常
- **WHEN** fork 执行到该失败点
- **THEN** 请求返回对应服务器错误；`list_threads()` 不含目标，目标 Session 历史为空或目录已清理，目标资产目录已删除，源 thread 状态保持原值
- 测试层：unit
- 依据：`J7`
- 来源：initial-spec

### Scenario SC_08: 新分支状态、usage 和嵌套 lineage 独立

- **GIVEN** 源 thread 已有非零 run count、非零持久化 usage、自己的 permissions 本子和可选父 lineage
- **WHEN** fork 成功并再次从该目标 fork
- **THEN** 第一层目标的 run count 为 0、usage 为 `None`/零且使用空的新 permissions 本子，源 usage 保持原非零值；第二层目标的 `forked_from_id` 等于第一层目标 ID；两层都继承各自直接源的 preset/cwd
- 测试层：smoke
- 依据：`J5`、`J12`
- 来源：initial-spec

### Scenario SC_09: metadata v12 双侧合同连续升级

- **GIVEN** v1-v11 任一合法历史 metadata 缺少 `forked_from_id`
- **WHEN** 后端读取并通过 REST DTO 返回该 thread
- **THEN** Python 模型投影为 schema v12 与 `forked_from_id=None`；TypeScript DTO 接受同一 nullable 字段和 1..12 版本集合；v13 继续按未知未来版本拒绝
- 测试层：unit
- 依据：`J8`
- 来源：initial-spec

### Scenario SC_10: 浏览器分叉操作具有完整交互状态

- **GIVEN** 用户在 idle 普通聊天 thread 的完成态 assistant 回复气泡下方看到“从此回复分叉”动作
- **WHEN** 用户点击一次并等待请求完成
- **THEN** 请求期间动作显示 loading 且禁用重复点击；成功时 store 缓存新增目标并导航 `/chat/{target_id}`；失败时显示错误并恢复可操作状态；侧栏、scheduled task、user、tool request 与 tool result 均无分叉动作
- 测试层：e2e
- 依据：`J9`、`J11`
- 来源：initial-spec

### Scenario SC_11: FileSession 目标持久历史可恢复

- **GIVEN** FileSession 路径已通过真实 FastAPI、ThreadManager 和 AssetStorage 返回 201
- **WHEN** 用目标 thread_id 创建新的 FileSession 实例并继续追加一条分支消息
- **THEN** 新实例恢复与源快照相同的 Message 序列且目标 run count 为 0；Web history 同时包含文本、tool_use、tool_result 和附件 metadata；分支消息只追加到目标 Session
- 测试层：smoke
- 依据：`J2`、`J3`、`J6`
- 来源：initial-spec

### Scenario SC_12: 每次成功请求创建独立目标并保持标题上限

- **GIVEN** 同一 idle 源 thread 的名称长度为 200 个字符
- **WHEN** 客户端顺序提交两次 fork 请求
- **THEN** 两次均返回 201 且目标 ID 不同，每个目标 name 以 `（分支）` 结尾并满足长度不超过 200，两个目标都直接指向同一源 ID
- 测试层：unit
- 依据：`J11`、`J12`
- 来源：initial-spec

### Scenario SC_13: 请求取消和提交窗口保持目标不可见

- **GIVEN** 源快照有效，fork 正处于资产 `to_thread`、目标 Session append 或 metadata 最后提交中的任一窗口，且客户端取消请求或服务进入 task cancellation
- **WHEN** fork 协程收到 `CancelledError`
- **THEN** 系统等待已经开始的阻塞 IO 收口，再持有目标 boot lock 清理目标 Session、资产和临时 metadata；并发 `boot_or_attach` 在锁内重读 metadata 后返回缺失，`list_threads()` 与 runtime cell 均不含目标，源 thread 保持可继续使用
- 测试层：smoke
- 依据：`J7`、`J13`
- 来源：adversarial-review (assumption:cancelled-multistage-publish)

### Scenario SC_14: 附件引用闭包排除无关资产并拒绝缺失引用

- **GIVEN** 源资产目录同时包含一个历史 `status=ready` 引用资产和一个从未进入历史的上传资产
- **WHEN** 用户 fork 源 thread
- **THEN** 目标只包含引用资产的 payload 与 metadata；无关 asset_id 在目标目录不存在；当附件 A 已复制而附件 B 缺少 payload 或 metadata 时 fork 整体失败，目标 metadata、Session 和已复制的 A 资产目录全部清理
- 测试层：unit
- 依据：`J6`、`J14`
- 来源：adversarial-review (assumption:asset-reference-closure)

### Scenario SC_15: 从指定最终回复创建精确历史前缀

- **GIVEN** idle 的 generic chat 源 Session 包含第一轮 user、assistant tool call、匹配 tool result、第一条 terminal assistant 回复，随后还有第二轮消息和只在第二轮引用的附件
- **WHEN** 客户端以第一条 terminal assistant 的服务端 `history_index` 请求 fork
- **THEN** 目标 Session 严格等于源历史从开头到该索引的闭区间，保留第一轮 tool_use/tool_result 和 metadata，排除全部第二轮消息及其附件；请求省略 body 时仍复制源 thread 的最新完整历史
- 测试层：smoke
- 依据：用户任务、`J2`、`J3`、`J16`
- 来源：initial-spec

### Scenario SC_16: 服务端坐标抵抗工具展开和展示 ID 漂移

- **GIVEN** 同一源历史经过回放投影后，一条 tool-call Message 展开为多个 UI item，实时 assistant 又使用 run/turn identity，且请求候选索引分别指向越界、user、tool、带 tool_calls 的 assistant 和无 tool_calls 的 terminal assistant
- **WHEN** 客户端逐一提交这些 `history_index`
- **THEN** Manager 只接受 terminal assistant 索引并按 Session 原始序列截断；其余语义边界返回 400 且不创建目标，非法 DTO 返回 422；前端从服务端字段透传索引，不解析气泡 ID、run ID、turn 或可见序号
- 测试层：unit
- 依据：`J15`、`J16`
- 来源：adversarial-review (assumption:render-id-boundary-drift)

### Scenario SC_17: 回复气泡分叉入口只在稳定完成边界启用

- **GIVEN** generic chat assistant 正在流式输出，随后 assistant 已落盘且 terminal `turn.end` 携带 `history_index`，回复气泡页脚已有复制按钮和时间
- **WHEN** 用户在回复完成前后悬停气泡并在图标可用后点击一次
- **THEN** 流式阶段不展示可操作分叉；完成后复制按钮右侧、时间左侧显示带“从此回复分叉”可访问名称的分叉图标；请求期间禁用重复点击，POST 携带该 `history_index`，成功导航目标，失败留在源 thread 并恢复操作；请求到达前源 thread 启动新 run 时服务端返回 409 且不创建目标
- 测试层：e2e
- 依据：用户任务、`J9`、`J15`、`J17`
- 来源：adversarial-review (assumption:live-final-boundary-race)
