> spec_version: 3
> adversarial_risk_version: 3
> complexity: 3
> importance: 2
> risk_average: 2.5
> review_budget: standard
> adversarial_review: skipped-standard

# sitian-generic-chat-analysis-v1

## 任务目标

- 为司天增加 `generic_chat` source kind，批量读取 Kongming Web 通用频道的普通聊天历史，并输出 Analyzer 已有合同所需的 `project` 与 `thread` observations。
- 复用现有 `SiTianRunOnce` 完成扫描、物化、分析和报告持久化；复用现有前端 `SitianManager` 与 `GET /api/sitian/report` 展示包含通用频道养料的报告。
- 以 `thread_id` 关联 ThreadMetadata 与 FileSession：ThreadMetadata 提供通道归属、业务类型、标题和消息数，FileSession manifest 提供 cwd，FileSession JSONL 提供最近活跃时间与 user/assistant 正文。
- 在现有 `sitian/session_reader.py` 增加 `read_kongming_session_tail()`，沿用逆序分块、条数限制和字符截断，保证大会话读取的有界内存与有界分析上下文。
- 一个 `generic_chat` source 下按 cwd 生成独立项目和 work item；不同项目的聊天内容、状态和报告归属保持隔离。

## 非目标

- 本版本不新增 Python `SiTianManager`、History Manager、Session Reader 类或 `core.contracts` 历史查询协议。
- 本版本不改变 `SessionEngine.read_session_history()`；该入口继续服务进程内、已知 session id 的在线历史查询。
- 本版本不修改 Runner、ThreadManager、FileSession 写入格式、Analyzer prompt/报告 schema、司天 REST 协议或前端 `SitianManager`。
- 本版本不采集 Claude Code、Codex 和 `scheduled_task` thread；这些通道继续走各自 source kind 或调度语义。
- 本版本不支持 memory/SQLite session backend，也不支持脱离标准 Kongming home 布局的自定义 FileSession 根目录。
- 本版本不重命名现有 `generic_channel`；该 kind 继续表示工作区文件扫描。
- 本版本不增加聊天内容脱敏规则；system、tool、附件元数据和 tool calls 保持在采集范围外，user/assistant 文本继续受现有条数和字符上限约束。

## 风险评分依据

- 复杂度：3。实现包含两个持久化真源的关联、通道与业务类型过滤、损坏记录降级、逆序 JSONL 读取、跨项目归并和 Analyzer 输入合同；无锁、跨进程写事务或新状态机。
- 重要性：2。功能服务本地司天报告的日常分析，错误会造成漏报、串项目或无关聊天进入分析，不影响资金、合规或核心 Agent 执行链。
- 预算升级：平均分 2.5 对应 `standard`，两个维度均未触发单维升级。

## 影响边界与不变量

| 模块 | 角色 | 本次影响 | 主要风险 | 必须保持的不变量 | 依据 |
|---|---|---|---|---|---|
| `src/sitian/config.py` | 目标 | 新增 `SiTianSourceKind(StrEnum).GENERIC_CHAT`，`SiTianSourceConfig.kind` 使用该枚举；`path` 对该 kind 表示 Kongming home | kind 继续散落为裸字符串 → 配置拼错静默进入错误分支 | 所有 source kind JSON/YAML 值保持现有字符串；`generic_channel` 语义保持工作区文件扫描 | `J7`、`J11`、`SC_01` |
| `src/sitian/global_scanner.py` | 目标 | 以纯 stdlib 扫描 `<source.path>/web/threads/*/metadata.json`、`<source.path>/sessions/<thread_id>/manifest.json` 与同 id JSONL 的文件时间，按 cwd 归并项目 | metadata/session 错配或路径推断错误 → 跨项目串料、漏采或读取错误会话 | 关联键唯一使用 `thread_id`；生产代码保持独立于 `hosts.web` 与 `sessions` import；单条损坏记录不阻断其余线程 | `J4`、`J9`、`J13`、`SC_02`、`SC_05` |
| `src/sitian/session_reader.py` | 目标 | 在现有模块增加 `read_kongming_session_tail()`，解析 FileSession message record | 沿用 Claude record 判别方式 → 全部 Kongming 消息被跳过或误收 system/tool | 只读取 `record_type=message` 且 role 为 user/assistant 的非空文本；逆序分块、条数上限和字符截断持续成立 | `J3`、`J10`、`SC_04`、`SC_10` |
| `src/sitian/scanners.py` | 目标 | `SiTianScanSource` 分派 `generic_chat`，构造既有 `project`/`thread` observation payload | payload 缺 cwd 或 recent messages → Analyzer 无法关联项目或得到空养料 | project 与 thread 通过相同规范化 cwd 关联；输出字段满足 Analyzer 现有输入合同；evidence refs 指向 metadata、manifest、JSONL | `J5`、`J6`、`SC_01`、`SC_02` |
| `src/sitian/suggestions.py` | 下游 | 让 `generic_chat` 与 `claude_workspace` 共用逐项目 work item 展开 | 一个 source 的多项目被压成一个 work item → 状态、建议和 thread ids 串项目 | 每个规范化 cwd 对应一个 work item；同一 cwd 的历史 observations 只选最新 project 快照 | `J8`、`SC_06` |
| `src/sitian/service.py`、`src/sitian/store.py` | 下游 | 保持现有 `SiTianRunOnce` 编排、source 失败收口、append-only observations 和 report/hash 写入 | scanner 局部失败被吞掉 → runtime_state 假成功；新入口另起编排链 → 状态分裂 | 所有扫描仍经 `SiTianRunOnce → SiTianScanSource → SiTianRecordsStore`；根目录级失败进入 `failed_sources` 和 runtime error | `J1`、`J12`、`SC_05`、`SC_08` |
| `src/sitian/analyzer.py` | 下游 | 无生产改动；消费通用频道生成的既有 observation 形态 | scanner 自创新 payload → prompt 缺 session 正文或报告丢项目 | Analyzer 继续只按 `entity_type=project/thread` 与 cwd 关联；generic_chat 与现有 source 共用报告 schema | `J6`、`SC_07`、`SC_08` |
| `src/hosts/web/threads/metadata.py`、`src/sessions/file_session.py` | 上游 | 无生产改动；其真实写盘产物用于合同测试与扫描输入 | 只用手拼 fixture → 上游 schema 漂移后 scanner 测试继续假绿 | 至少一条 smoke 使用真实 `write_thread_metadata` 与 `FileSession.append()` 生成输入；冲突哨兵证明各字段真源 | `J4`、`J13`、`SC_02`、`SC_08` |
| `src/hosts/web/routers/sitian.py`、`web/src/modules/sitian/` | 相关 | 无生产改动；继续读取和展示 `sitian_report.json` | 报告写入目录与 API 读取目录不一致 → 扫描成功但用户看不到 | 相同 `output_subdir` 指向同一 `SiTianRecordsStore`；现有加载、空态和错误态保持稳定 | `J2`、`J14`、`SC_09` |
| `config/sitian.local.yaml`、`docs/modules/司天/README.md` | 相关 | 增加 `generic_chat` source 示例、path 语义和模块入口说明 | 示例继续使用 `generic_channel` 表示聊天 → 用户配置后只扫描文件 | 文档明确区分 `generic_chat` 聊天历史与 `generic_channel` 工作区文件 | `J7`、`J9` |

## 判断依据

| J-ID | 判断 | 来源 | 证据或推断 | 状态 |
|---|---|---|---|---|
| J1 | 后端唯一编排入口继续使用 `src/sitian/service.py::SiTianRunOnce` | 仓库事实、用户反馈 | 现有入口已经持有 source readiness、扫描、物化、Analyzer 和 Store 顺序；新增第二门户会分裂 runtime state | 已确认 |
| J2 | `web/src/modules/sitian/manager.ts::SitianManager` 是现有前端副作用门户，继续通过 `GET /api/sitian/report` 展示报告 | 仓库事实、用户反馈 | manager 已实现 open/close/refresh，API 已读取 `SiTianRecordsStore` 报告 | 已确认 |
| J3 | Reader 复用 `src/sitian/session_reader.py`，新增函数 `read_kongming_session_tail()` | 仓库事实、用户反馈 | 现有模块已经拥有 `_ReverseLineIterator` 与 Claude tail reader；FileSession record 只需独立角色判别 | 已确认 |
| J4 | ThreadMetadata 与 FileSession 的唯一关联键为 `thread_id`；标题、通道、thread kind 和消息数读 metadata，cwd 读 manifest，最近活跃时间与正文读 JSONL | 仓库事实 | metadata.id 与 runner session_id 同值；FileSession 目录、manifest、JSONL 均以 session_id 命名；generic_chat metadata.cwd 明确为空且不作为运行 cwd 真源 | 已确认 |
| J5 | 只采集 `backend_kind=generic_chat` 且 `thread_kind=chat` 的 metadata；普通 archived chat 仍由最近活动窗口决定是否进入分析 | 用户任务、仓库事实、LLM 推断 | 用户要求通用频道聊天养料；scheduled task 是独立业务类型；archive 只隐藏列表并保留历史 | 已确认 |
| J6 | 新 scanner 输出沿用 Analyzer 已有 project/thread payload：project 至少含 `cwd/displayName/sessionCount/lastModifiedAt/recentSessions`，thread 至少含 `threadId/title/cwd/lastModifiedAt/messageCount/recentUserMessages/recentAssistantMessages` | 仓库事实 | `sitian/analyzer.py` 已按这些字段分组、裁剪并生成 prompt，无需修改 Analyzer | 已确认 |
| J7 | 新聊天 source kind 命名为 `generic_chat`；现有 `generic_channel` 继续表示文件系统 source | 用户任务、仓库事实 | Web metadata 使用 `generic_chat` 表示通用运行通道；现有 scanner 的 `generic_channel` 已稳定指向 rglob 文件扫描 | 已确认 |
| J8 | `generic_chat` 是多项目 source，复用现有 workspace 逐 cwd 展开函数 | 仓库事实、LLM 推断 | `suggestions.py` 当前只为 `claude_workspace` 展开多项目；新 scanner 会从一个 Kongming home 发现多个 cwd | 已确认 |
| J9 | `generic_chat` source 的 `path` 表示 Kongming home；metadata 根为 `<path>/web/threads`，FileSession 根为 `<path>/sessions` | LLM 推断、仓库事实 | 默认配置把 `.kongming/*` 派生到同一 Kongming home；单 path 能保持 source 配置最小 | 已确认 |
| J10 | 每项目最多保留最近 20 个 session；项目数受 `source.top_n` 控制，缺省为 10；session 时间窗与消息条数/字符上限复用 `SiTianScannerConfig` | 仓库事实、LLM 推断 | 现有 Claude workspace 已使用相同窗口、20 session 上限和 tail 配置；沿用可稳定控制 I/O 与 prompt 大小 | 已确认 |
| J11 | source kind 是有限封闭集合，使用 `StrEnum` 满足仓库类型规则 | 架构规范 | AGENTS 要求 mode/type/status 等有限取值使用字符串枚举，StrEnum 保持 YAML/JSON 字符串形态 | 已确认 |
| J12 | 配置根目录缺失或不可读时 source 失败；单个 metadata、manifest 或 JSONL 损坏时跳过该 thread 并继续 | LLM 推断 | 根目录问题表示配置/运行环境整体错误；单记录损坏不应使其余健康会话失去分析 | 已确认 |
| J13 | 生产 scanner 直接解析稳定落盘形态并保持纯 stdlib；测试使用真实 producer 产物建立跨模块漂移哨兵 | 架构规范、仓库事实 | `global_scanner.py` 的既有边界要求独立于 Web scanner；standalone 司天进程不持有 Web ThreadManager 或 SessionEngine | 已确认 |
| J14 | 本版本把通用频道 observations 合入当前 `output_subdir` 的同一份报告，现有前端和 REST 无需新增 channel 参数 | 用户任务、仓库事实、LLM 推断 | 用户期望“加上通用频道”；Analyzer 已支持多 source observations，Web 当前只读取一份报告 | 已确认 |

## 建模覆盖声明

| 维度 | 覆盖位置或具体不适用理由 |
|---|---|
| 数据流 | ThreadMetadata + FileSession manifest/JSONL → `global_scanner`/`session_reader` → `SiTianScanSource` → project/thread observations → `SiTianRecordsStore` → Analyzer → report API/SitianManager，见 `SC_01`、`SC_08`、`SC_09` |
| 状态 | source ready/error 状态保持由 `SiTianRunOnce` 管理；observations append-only、work items/report 覆盖写，见影响边界与 `SC_05`、`SC_06` |
| 时序 | 先过滤 metadata，再按 thread_id 读取 manifest 与 JSONL，再落 observations、物化 work items、调用 Analyzer，见 `SC_03`、`SC_08` |
| 资源 | JSONL 由 `_ReverseLineIterator` 逆序定块读取；项目/session/消息/字符四层上限见 `J10`、`SC_04`、`SC_10` |
| 不变量 | `影响边界与不变量`、`SC_02`、`SC_06`、`SC_11` |
| 故障 | 根目录缺失、单 metadata/manifest/JSONL 损坏、真源冲突、无有效会话和报告目录失配，见 `SC_02`、`SC_05`、`SC_09` |

## 验收清单

### 单元测试

- [ ] `SiTianSourceKind` 包含五个现有/新增字符串值，Pydantic 对 YAML/JSON 仍输出字符串，未知 kind 校验失败（`SC_01`、`SC_11`）。
- [ ] generic_chat scanner 仅选择普通通用聊天，按 thread_id 关联 metadata、manifest、JSONL，并生成 Analyzer 合同要求的 project/thread observations（`SC_01`、`SC_02`、`SC_03`）。
- [ ] `read_kongming_session_tail()` 按最新到最旧返回限定数量的 user/assistant 文本，跳过 system/tool/空正文/损坏行并执行字符截断（`SC_04`、`SC_10`）。
- [ ] 单记录损坏保留健康线程，根目录缺失经 `SiTianRunOnce` 写入 `failed_sources` 与 runtime error（`SC_05`）。
- [ ] 一个 source 的两个 cwd 生成两个 work items，同 cwd 的历史 project observations 只选择最新快照（`SC_06`）。
- [ ] 现有 `generic_channel`、Claude、Codex scanner 回归测试保持通过（`SC_11`）。

### Smoke 测试

- [ ] 使用真实 `write_thread_metadata()`、`FileSession.append()`、`SiTianRunOnce`、`SiTianRecordsStore` 和现有 Analyzer，fake 只替换外部 LLM；断言通用聊天正文进入 prompt，项目进入 `sitian_report.json`（`SC_07`、`SC_08`）。
- [ ] 冲突哨兵设置 metadata.cwd=`/metadata-wrong`、manifest.cwd=`/manifest-right`、metadata.name=`Title From Metadata`、JSONL user 正文=`Body From Session`，断言下游分别读取合同指定真源（`SC_02`、`SC_08`）。
- [ ] 运行司天目标 pytest、mypy、ruff、import-linter 和 `git diff --check`；import-linter 证明 `sitian` 未新增对 `hosts.web`/`sessions` 的生产依赖。

### E2E 测试

- 决策：需要
- 依据：功能跨 ThreadMetadata 与 FileSession 两个真实持久化 owner、司天批量进程、Analyzer/Store 和 Web 报告读取链；局部 scanner 测试无法证明最终用户能看到通用频道项目。
- [ ] 通过真实 generic_chat thread 元数据与 FileSession 历史生成输入，执行一轮司天分析，再通过真实 FastAPI `GET /api/sitian/report` 和前端 `SitianManager.open()` 链读取报告；报告展示该项目与 alert/session 证据，scheduled_task 和其他 backend 的哨兵正文均未出现（`SC_09`）。

## 测试驱动开发

1. `SC_01`、`SC_02`、`SC_03`、`SC_11` → 先写 source enum、通道过滤、thread_id 关联和冲突真源的红灯测试。
2. `SC_04`、`SC_10` → 先写 FileSession JSONL tail 的角色过滤、逆序限窗、损坏行和截断红灯测试。
3. `SC_05` → 先写根目录失败与单记录降级的红灯测试。
4. `SC_06` → 先写一个 source 两个 cwd 的 work item 隔离红灯测试。
5. 实现 `SiTianSourceKind`、Kongming 全局发现、tail reader、scanner 分派和多项目归并的最小代码。
6. `SC_07`、`SC_08` → 先写穿过真实 producer、RunOnce、Store 和 Analyzer 的 smoke，再补齐 payload 与报告链。
7. `SC_09` → 运行真实报告 API 与前端 manager E2E，更新配置示例和司天模块 README。
8. 重构后复跑 unit、Smoke、E2E、mypy、ruff、import-linter、x-spec validate 与 `git diff --check`。

## 对抗性审查记录

| Review | 预算 | 风险来源 | 查询 | 召回 ID | 复用 Scenario | 新增 Scenario | CLI |
|---|---|---|---|---|---|---|---|
| ARV-1 | standard | 无 | 功能关键词：司天、generic_chat、ThreadMetadata、FileSession、session_reader、project/thread observations、批量扫描、thread_id 关联、多项目归并；Risk：metadata 与 Session JSONL 真源漂移、损坏或缺失文件导致跨频道误采集、漏采集、重复项目归并，聊天正文泄漏或全量读取造成性能问题 | 无 | 无 | 无 | exit=1; matches=0; error=DEPENDENCY_RESOLUTION_ERROR; message=offline cache lacks sentence-transformers/torch |

## Scenarios

### Scenario SC_01: 有效通用聊天生成标准 observations

- **GIVEN** Kongming home 下存在一个 `backend_kind=generic_chat`、`thread_kind=chat` 的 metadata，对应 manifest.cwd=`/proj/a` 和包含 user/assistant 消息的 FileSession JSONL
- **WHEN** `SiTianScanSource` 扫描 kind=`generic_chat`
- **THEN** 返回一个 entity_key=`/proj/a` 的 project observation 和一个 entity_key=thread_id 的 thread observation；两者 cwd 相同，project.recentSessions 与 thread 的 recentUserMessages/recentAssistantMessages 均包含限定后的正文
- 测试层：unit
- 依据：用户任务、`J6`、`J7`
- 来源：initial-spec

### Scenario SC_02: 冲突值按字段真源关联

- **GIVEN** 同一 thread 的 metadata.cwd=`/metadata-wrong`、metadata.name=`Title From Metadata`，manifest.cwd=`/manifest-right`，JSONL 最新 user 正文=`Body From Session`
- **WHEN** generic_chat scanner 按 thread_id 构造 observations
- **THEN** project/thread cwd 均为 `/manifest-right`，thread title 为 `Title From Metadata`，recentUserMessages 为 `Body From Session`；metadata cwd 与正文均未替代合同指定真源
- 测试层：unit
- 依据：`J4`、`J13`
- 来源：initial-spec

### Scenario SC_03: 通道、业务类型和时间窗过滤准确

- **GIVEN** metadata 集合同时包含 generic_chat/chat、generic_chat/scheduled_task、claude_code/chat、codex/chat，且对应 JSONL 文件时间分别位于或超过 recent_session_window_days
- **WHEN** 扫描 generic_chat source
- **THEN** 只输出时间窗内的 generic_chat/chat；scheduled_task、其他 backend 和过期 chat 的 thread id、正文、evidence refs 均未进入 observations
- 测试层：unit
- 依据：`J5`、`J10`
- 来源：initial-spec

### Scenario SC_04: FileSession 尾部读取保持有界

- **GIVEN** JSONL 前部含大量 message records，尾部交错 user、assistant、system、tool、空正文和损坏行，scanner 配置 user=2、assistant=1、max_chars=5
- **WHEN** 调用 `read_kongming_session_tail()`
- **THEN** 从最新到最旧返回两条 user 和一条 assistant，正文各最多为 5 个原字符加省略号；system/tool/空正文/损坏行均未进入结果，读取沿用固定块逆序迭代器
- 测试层：unit
- 依据：`J3`、`J10`
- 来源：initial-spec

### Scenario SC_05: 局部损坏降级且根目录错误可见

- **GIVEN** 一个可读根目录含一条健康 thread 与若干损坏 metadata、缺 manifest、缺 JSONL 的 thread，另一个 source.path 指向缺失根目录
- **WHEN** 分别通过 `SiTianRunOnce` 扫描两个 source
- **THEN** 可读根目录只生成健康 thread 的 observations 且 source 成功；缺失根目录进入 `failed_sources`，对应 runtime state 为 error 并含可定位路径的错误文本
- 测试层：unit
- 依据：`J12`
- 来源：initial-spec

### Scenario SC_06: 多项目 work item 保持隔离

- **GIVEN** 同一 generic_chat source 的 observations 包含 cwd `/proj/a` 与 `/proj/b`，并包含 `/proj/a` 的两次 project 快照及各自 thread
- **WHEN** `SiTianMaterializeState` 归并状态
- **THEN** 生成两个 work items；`/proj/a` 使用较新 project 快照且只包含 a 的 thread id，`/proj/b` 只包含 b 的 thread id
- 测试层：unit
- 依据：`J8`
- 来源：initial-spec

### Scenario SC_07: 现有 Analyzer 消费通用聊天合同

- **GIVEN** generic_chat scanner 产出的 project/thread observations 含最近 user/assistant 正文，外部 LLM fake 记录收到的 request 并返回有效 SiTianReport JSON
- **WHEN** 现有 `sitian_analyze()` 分析这些 observations
- **THEN** LLM request 的项目 sessions 包含对应 thread id 与正文，返回报告包含该 project；Analyzer 生产接口和报告 schema 保持现状
- 测试层：smoke
- 依据：`J6`
- 来源：initial-spec

### Scenario SC_08: 真实持久化生产者贯穿 RunOnce 与报告

- **GIVEN** 测试使用真实 `write_thread_metadata()` 与 `FileSession.append()` 写出普通通用聊天，`SiTianRunOnce` 使用真实 scanner、materializer、RecordsStore、Analyzer 和 fake 外部 LLM
- **WHEN** 执行一轮扫描分析
- **THEN** observations.jsonl 含该 project/thread，workspace_state 含该项目 work item，sitian_report.json 含同一 project，scan snapshot 的 source 与 observation 数量和实际产物一致
- 测试层：smoke
- 依据：用户任务、`J1`、`J13`
- 来源：initial-spec

### Scenario SC_09: 用户从现有报告入口看到通用频道分析

- **GIVEN** `SC_08` 的报告写入 Web 配置指向的 output_subdir，前端司天 store 处于关闭且无报告状态
- **WHEN** 用户触发现有 `SitianManager.open()`
- **THEN** manager 经真实 `GET /api/sitian/report` 取得报告，弹窗展示 generic_chat 项目与 session 证据；其他 backend 与 scheduled_task 的哨兵正文均未出现，加载态最终结束且 error/noReport 为空
- 测试层：e2e
- 依据：用户任务、`J2`、`J14`
- 来源：initial-spec

### Scenario SC_10: 采集边界排除非聊天与超限内容

- **GIVEN** FileSession 同时含 system 指令、user 附件 metadata、assistant tool_calls、tool_result 和超过 max_chars 的 user/assistant 正文
- **WHEN** generic_chat scanner 生成 observations 并由 Analyzer 构造 prompt
- **THEN** observations 与 prompt 只含截断后的 user/assistant content；system、tool_result、附件对象和 tool_calls 均未出现
- 测试层：unit
- 依据：`J3`、`J10`
- 来源：initial-spec

### Scenario SC_11: 新 source kind 保持现有配置与扫描语义

- **GIVEN** 分别构造五种合法 source kind 和一个未知 kind，并为现有四种 scanner 准备原有 fixture
- **WHEN** Pydantic 校验、JSON dump 与 `SiTianScanSource` 分派执行
- **THEN** 五种合法 kind 序列化为稳定字符串，未知 kind 校验失败；现有四种 scanner 的 observations 与改动前 fixture 一致，`generic_channel` 仍执行工作区文件扫描
- 测试层：unit
- 依据：`J7`、`J11`
- 来源：initial-spec
