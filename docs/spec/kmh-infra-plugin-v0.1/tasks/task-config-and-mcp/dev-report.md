# task-config-and-mcp · dev-report

> task: docs/spec/kmh-infra-plugin-v0.1/tasks/task-config-and-mcp/dev-checklist.md
> 创建: 2026-10-16

## 结果

- task 测试：11/11 🟢 全绿
- 既有回归：通过（web-plugin-hmr 1 test / 1 pass，10.2s）
- 高风险行：2 行（T1 配置持久化、T5 子进程生命周期）均含真实链路验证——T1 走真实浏览器保存并回读 profile patch，T5 走真实模型回合调通工具并核对进程数

## 验证证据

| 任务行 / 场景 / C / D / 用例回指 | 红灯原因与证据（或未采用 TDD 的理由） | 最终验证方式与实际结果 / 证据位置 | 局限或待补项 |
|---|---|---|---|
| 行 T1；feat04 场景1；C1、C6、C7；D05、D11；用例 T3、T8、T12 | 新建模块，导入缺失不构成有效红灯（同前两个 task）；字段模型与槽位注册改为实现后补自动化 | ① 真实浏览器打开插件详情页：八个配置项全部渲染，值与默认值一致——`dashUrl=http://127.0.0.1:60010`、`tokenEnvVar=X_INFRA_MCP_TOKEN`、`pythonCommand=python3`、`mcpModuleDir=/Volumes/machub_app/proj/x-infra/x-infra-mcp`、`panelLoadTimeoutMs=8000`、`probeTimeoutMs=5000`、`toolCallTimeoutMs=60000`、接入开关为开（见 `evidence/config-form-fields.png`）。**三个数值字段可见可编辑**，说明 MadeMe 当年踩到的 transform 字段被 settings 链路丢弃的坑对原生 number 字段不成立，tech-design 待确认 1 就此关闭。② 单测（`test/infra-client.test.mjs`）：两个配置槽的键分别为 `@kmh/kmh-infra` 与 `@kmh/kmh-infra#kmh-infra`，注入 face 暴露 `edit`/`resetField`/`save`/`discard`，快照从配置取值（`dashUrl.text`、`panelLoadTimeoutMs.text="8000"`） | 只看了深色主题与英文界面（临时实例无语言偏好），浅色与中文界面归 task-distribution 的最终核对 |
| 行 T1；C6；高 | 同上 | 保存 `panelLoadTimeoutMs=2500` 后，临时 profile 的 patch 末尾出现 settings 覆盖条目 `- id: kmh-infra / config: {panelLoadTimeoutMs: 2500, …}`；刷新插件详情页读回 2500。**“配置持久化写错会影响 Web 下次启动”这条风险的实际路径走通了**：写入值经过表单校验后再落盘，非法值进不去 | 只验证了数值与地址两类；`mcpModuleDir`/`pythonCommand` 的文本写入未单独回读（同一字段模型与同一保存路径） |
| 行 T2；feat04 场景2；D01、D05 | 同上 | 真实浏览器把 `dashUrl` 改成 `not a url`：字段旁原位出现 "a legal http(s) URL is required"（见 `evidence/config-form-invalid-address.png`）；刷新后读回仍是 `http://127.0.0.1:60010`，**非法值没有被写进 profile patch** | 只测了“不是地址”一种非法形态；空串、非 http 协议、带内嵌凭据由 task-package-skeleton 的 `normalizeHttpUrl` 单测覆盖 |
| 行 T3；feat04 场景3；C6；D05；用例 T9 | 同上 | 真实浏览器点“Test connection”：结果为 `Dashboard：reachable（16ms）`（见 `evidence/test-connection-reachable.png`）。探测超时取当前草稿的 `probeTimeoutMs`，与面板加载超时各自独立 | 未单独构造“探测超时随 probeTimeoutMs 变化”的计时观察——该机制与 task-sidebar-and-panel 行 T4 已实测的“超时随配置变化”是同一段代码路径（都从草稿/配置读数值），此处只验证可达分支 |
| 行 T4；feat04 场景4；C1；D05；用例 T8 | 同上 | 真实链路：把 `tokenEnvVar` 改成环境里不存在的 `KMH_INFRA_NO_SUCH_TOKEN` 并保存成功（不阻塞），面板照常打开，助手查询回答“结论：身份校验错误”，运行日志出现 `level:"warn"` 的 `kmh-infra: 环境变量 KMH_INFRA_NO_SUCH_TOKEN 没有取值，服务查询会返回身份校验错误；暗号要在启动 KMH 之前设进环境`——**日志里只有变量名，没有暗号取值** | **一个需要写进文档的行为**：把该字段清空再保存，不会写入空值，而是让字段回落到下层（schema 默认），因此读回仍是 `X_INFRA_MCP_TOKEN`，保存按钮也因无改动而置灰。这是 settings 的 clear 语义（清除=恢复继承），不是缺陷；“留空”这一分支的实际效果等于沿用默认 |
| 行 T5；feat03 场景1、场景2；C1、C9、C12；D02；用例 T6、T14、T17 | 装配行为（重挂、卸载、环境传递）在实现前无法造出有意义的红灯——本行新建模块；改为实现后以可变 volatile 替身驱动同一段装配代码补覆盖 | ① 单测 `test/infra-mount.test.mjs` 8 tests / 8 pass：stdio 参数取自配置（`serverName=infra`、`args=["-m","x_infra_mcp.mcp_server"]`、`cwd`、`X_DASH_BASE_URL`）、**暗号由插件显式传进子进程**（并验证环境里没有该变量时不下发、只留一条告警且日志不含暗号）、关键参数变化触发重挂且旧实例先卸载、开关关闭即卸载两个子插件、关键参数为空则不挂载、`dispose` 幂等、暗号取值轮换也重挂、`failOnStartupError=false`。② 真实链路：新会话提问“本机现在有哪些服务在跑？”→ 助手调用 `mcp__infra__service_list` 并返回真实清单（online：mademe-web、x-token、x-stt、xmusic-board、agent-knowledge；offline：金融、x-health；unmonitored：z-glm-remote 外部链接），见 `evidence/assistant-service-list.png` | 单测用替身替代 loader 的取值管道，装配与判定走真实代码；未覆盖 mcp-client 自身重连策略（用 DSH 默认） |
| 行 T5；C12；高 | 非 TDD 行 | 本次验证期间通过表单改了约十次配置（触发同样次数的重挂），结束后系统里 x-infra-mcp 子进程数为 **1**（`pgrep -fl x_infra_mcp \| wc -l`）。正式的序列化进程数验证归 task-distribution 的用例 T17 | 单次观察，未按 T17 的序列口径逐步记录 |
| 行 T6；feat03 场景3–7；C1、C2、C8、C11；D07、D08；用例 T6、T13、T16 | 措辞引导是纯注册行为，实现前无可测产物（新建模块） | ① 单测：段落名为 `kmh-infra:mcp-guidance`、段位取 `MCP_SERVERS`、`interpolate=false`、正文覆盖 `invalid_token`/`service_auth_disabled`/`dash_unreachable`/`not_found`/`invalid_argument`/`unknown`/`duplicate_names`，且**不含地址、端口或凭据**。② 真实模型回合三种措辞：面板不可达时答“x-dash 面板没有在运行…这不代表本机没有登记过服务——只是当前查不到”（C2 成立）；暗号错时答“结论：身份校验错误”（C1 成立）；名字查不到时答“x-dash 面板里没有登记过名为 zzz-not-registered 的服务” | 措辞是模型遵从，不是硬校验；本轮每个状态各问一次，未做多问法重复。`unknown` 与 `duplicate_names` 两种状态没有现场构造（需要在面板刚起来/存在重名登记时提问），只有单测覆盖引导文本 |
| 行 T7；C3、C10；D02、D10 | 非 TDD 行，属边界核对 | 上游服务的工具面实测只有 `service_list` 与 `service_info` 两个（task-config-and-mcp 之前的协议探测），插件不新增任何工具；插件界面与面板上没有启停/修改/删除入口；插件自身的日志与提示词里不出现地址与凭据（见 T4、T6 的证据） | 只读边界由上游保证，本行核对的是“本插件没有把它扩宽” |
| 行 T8；feat04 场景5；C5、C6；D04；用例 T5、T10 | 非 TDD 行 | 真实链路：在插件详情页把 `dashUrl` 改成 `http://127.0.0.1:60099` 保存后，**同一实例、不重启**，助手下一轮查询即按新地址工作并报面板不可达；改回 60010 后恢复正常。面板侧的超时热生效已在 task-sidebar-and-panel 行 T4 实测 | 未做“面板与查询目标同时换过去”的单次连续观察（两者分别验证过，且共用同一配置项） |
| 行 T9；feat04 场景1–4；用例 T3、T9、T12（e2e） | 非 TDD 行 | 见行 T1–T4 的浏览器实测；全程无 pageerror | 见各行局限 |
| 行 T10；feat03 场景1–7；C1、C2、C8；用例 T6、T13、T15、T16（e2e） | 非 TDD 行 | 四种状态各一轮真实模型回合：正常清单、面板不可达、身份校验错误、名字查不到；问答文本与运行日志里都没有出现问号之后的凭据（服务地址在回答里是 `http://127.0.0.1:30000` 这种不含查询串的形态） | 停用后的措辞消失（C11 现场部分）归 task-distribution 的用例 T16 |
| 行 T11；feat03 场景1；C9；D09；用例 T14（e2e） | 非 TDD 行 | 三种构造：① `pythonCommand` 改成不存在的路径 → Web 照常可用、新会话照常跑完一轮（模型正常回答），插件只是工具不可用；② `dashUrl` 指向未监听端口（在行 T8 的同一轮里）→ 面板不可达且会话不受影响；③ `toolCallTimeoutMs=1` → 该次调用超时并重试成功，会话不中断。运行日志中本插件的记录是 `level:"warn"` 而非错误中断 | 三种构造均为一次性观察；未测“Python 进程启动后中途挂掉”的自愈（属 mcp-client 的重连策略，用 DSH 默认） |

## 验证环境说明

1. **仍在临时实例上验证，没有重启 127.0.0.1:60000。** 临时工作区 `/Users/kid/.kmh-os/tmp/kmh-infra-e2e`（`packages/*` 全符号链接、`bundles/dsh-web` 复制、profile 端口换成 60123、独立 `KMH_HOME`）。
2. **暗号的处理**：本次验证需要真实暗号才能走通正常查询。做法是从使用者已配置的 `~/.zshrc` 中读取该变量并**只注入临时实例的进程环境**；取值全程未打印（只打印长度 48），未写入任何文件，也未进入仓库或被跟踪文件。运行日志里出现的只有"变量名"。
3. **模型凭据**：临时 `KMH_HOME` 里用**符号链接**指向使用者的 `.credentials.yaml`，不复制明文；临时实例的会话与日志写在自己的临时目录里。
4. **观察到的界面细节（不是缺陷，供 README 记录）**：插件详情页里那一行 bundle 开关显示为未启用，而插件实际是通过 profile 的 cordis patch 挂载并正常工作的——两者是不同层面（"把 bundle 加进 profile" vs "profile 里已挂载的实例"）。MadeMe 是同样的形态。
5. **验证期间临时实例里的模型回合**：deepseek-flash，4 轮问答，无 pageerror。

## 未决

- 无 🔴 行。四项局限中，浅色主题与中文界面已在 [task-distribution 的跨 task 补齐](../task-distribution/dev-report.md#跨-task-补齐的核对浅色主题与中文界面)里核对通过，进程数序列由该 task 的用例 T17 核完（6 次改配置后仍为 1，停用为 0，重新启用为 1）；**仍未验证的两项**是：`unknown` 状态与 `duplicate_names` 重名的现场构造（只有引导段落的单测覆盖，未在真实回合里观察这两种措辞），以及 mcp-client 自身的重连自愈（用 DSH 默认策略，本插件不覆盖）。两者都不阻塞本 task 交付。
