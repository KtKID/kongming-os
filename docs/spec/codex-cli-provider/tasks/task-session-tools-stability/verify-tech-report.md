# 技术验收 · 会话新建与复用

> 本文保存原仓的开发与验收记录。原始日志和临时证据位于原执行环境；其中的通过结果归属该次运行。OS 当前固定底座的依赖状态见 [仓库入口](../../../../../README.md#当前依赖状态)。

- 项目与范围：Kongming 的 task-session-tools-stability，19 个影响文件；承接范围见 [req 分配](req-allocation.md)。
- 设计与确认：[tech-design v0.3](../../tech-design.md)，本次对话用户“同意 走req dev，verify”；[确认版本副本](baselines/tech-design.md) SHA-256 `414f844570b2bda71d211cbc6d78bdba368b6f20dd57b9e0298cf354c5a48d4e`。
- 规范：项目 AGENTS.md、KMH 文档规范、dev-ts、x-tech-design 的 development-rules.md；下表对应 R1–R7。spec 与 [保存副本](baselines/spec.md) 一致，SHA-256 `edcb81f838d0c9630859595f21ef8f45ed3a084a6c9cf069c12314588a3b0b40`。
- 代码基线：HEAD `d1c62af1649f4dff2088ddf516dc12c96d3356e0` 加本次工作区增量；19 个影响文件含新增测试的最终 SHA-256 见 记录（原执行记录 `final-source-hashes.json`）。
- 环境：Kongming 根目录，Node v25.6.1、官方 Codex CLI 0.162.0-alpha.17.2；真实插件、官方 CLI、实际文件与 JSONL 持久化；模型响应由隔离本地服务提供。
- 结论：本轮确认的增量范围通过，18 项适用检查通过。整包格式门禁报出 8 个本轮未修改文件的问题；回合内精确事件分叉和真实模型压缩触发观察保留单独未验证状态。

## 设计检查

| 条目 / 用例 | 实现与核对方法 | 实际结果 |
|---|---|---|
| D01；T1、T2、T3 | `CodexToolPolicy.capture` 接收公开 `agent/created`，保存原选择；`untilPrepared` 读取保存记录。核对首条消息前修改默认，以及新旧会话请求。 | 创建后全关默认，首轮仍提供原工具；甲保留 A/B/C，关闭 C 后新建乙传 A/B。通过。 |
| D02；T1、T4、T5 | `SavedToolPolicySchema`、`CodexSessionStore`、`saveToolPolicy`、`recordBinding`。读写链以文件为来源；独立副本、串行保存、成功后更新缓存。 | 首条消息前记录冷读保留；实际 JSONL 宿主重启恢复原编号及工具；失败写入保持原缓存和文件。通过。 |
| D03；T3 | `ctx.tools.guard` 与保存的名称、来源、参数和 SDK 输出定义对照。使用真实执行器，关闭 C 后调用 C；新默认开启 D 时强制调用 D。 | C 实际执行 1 次，D 执行 0 次，原会话 A/B/C 保持。通过。 |
| D04；T1、T2、T3、T4、T6 | `CodexAdapter.drive`、`CodexTurn.start`。普通新建传 `dynamicTools`；续聊以保存的 `threadId` 调用 `thread/resume`。收到编号后等待保存，再调用 `turn/start`；核对输入与请求次数。 | S1 原编号保持；乙得到 S2；超过 600 字的尾标完整到达，旧输入单份；保存编号失败时业务请求 0 次。通过。 |
| D05 的回合前后切点；T17、T18 | `forkPlanOf` 使用保存的完成回合记录；`rebuild` 仅调用官方 `thread/fork`。核对父子编号、`lastTurnId` / `beforeTurnId` 和继承历史。 | 完成回合分叉与编辑首条输入均通过，源工具和父记录保留，输入与继承历史单份。回合内精确事件切点的限制单列于下文。 |
| D07；T8 | Codex 通过可选 `ctx.inject(['cliTools'])` 注册目录，直接拥有 Config、工具执行和恢复。实际 Selector Controller/UI 插件装卸，检查 Codex fiber、配置和请求；实际 Web 检查本地化提示。 | Selector 关闭时 Codex fiber 保持，甲仍 S1/原工具，乙采用新默认；重新启用读取保存值。无 cliTools 服务的冷启动也通过。页面生效提示正确。通过。 |
| D08；T5 | 文件 Zod 校验、`capture` 缺数据错误、官方恢复错误传播。移走隔离原生文件、提供损坏记录及缺工具信息的旧记录。 | 明确恢复错误、保存文件和原编号保留；恢复失败时业务新建 0 次。通过。 |
| D09；T11 | 普通恢复保持 S1；详细记录使用 CLI 实际通知，原生进度由现有通知投影。核对恢复后的实际原生文件修改、普通通知、会话编号。 | 原生修改实际落盘，恢复使用 S1，历史保持；普通续聊保持原会话。通过。 |

## 规范检查

| 条目 | 依据、实现和实际检查 | 结果 |
|---|---|---|
| R1 模块职责 | 语义审查 `index.ts`、`tool-policy.ts`、`adapter.ts`、`session-store.ts`、客户端及 package.json：插件自己的执行逻辑、公共配置编辑入口、可选目录服务各自归属清楚；生产导入使用公开包名；包内返回 index 的导入为 type-only。实际 Selector 装卸验证依赖方向。 | 通过；语义审查限本轮影响模块。 |
| R2 边界校验 | 新持久字段在 Zod 定义并推导类型；共享工具开关沿用已确认 Schemastery 定义，文件 codec 调用该定义；Config 联动检查在序列化后独立执行。坏文件测试、真实配置编辑及客户端 schema 往返测试均执行。 | 通过。 |
| R3 官方协议 | 用当前官方 CLI 的 `app-server generate-json-schema --experimental` 实际生成 schema，核对 `dynamicTools`、`experimentalRawEvents`、`threadId`、`lastTurnId`、`beforeTurnId`；`ThreadForkParams` 是本包受控同步的已用字段校验，两个位置互斥；实际 CLI 分叉通过。生成证据在 `/private/tmp/kmh-codex-rdv-20261013/official-schema-experimental`。 | 通过；字段依据为该受支持的实际 CLI 版本。 |
| R4 数据来源 | Config 拥有未来默认；`codex-bindings.json` 拥有会话工具及编号；缓存只接受文件成功写入，完成回合位置为原生分叉保留。文件故障、并发保存和真实重启测试执行。 | 通过。 |
| R5 命名 | 语义审查：KMH 标识用 sessionKey/session.id；原生会话用官方 threadId；原生回合用 turnId。文件内原生标识通过公开 brandString 恢复品牌类型。 | 通过。 |
| R6 配置 | 沿用 Config 的启动、请求、准备、清理时限，单位毫秒；删除普通历史的 600 字裁剪；准备失败以已有时限退出。实际有界错误、重试及长消息测试执行。 | 通过。 |
| R7 顺序和恢复 | `withSession` 保持会话排队；保存串行；新编号保存先于业务输入；异常保留旧记录；回执丢失明确报错。实际队列、取消、故障、原生工具和重启回归通过。 | 通过。 |
| 严格类型、公开接口与格式 | 本轮实际执行 host/browser typecheck、包 lint、修改的 11 个生产及包文件的 Prettier 检查、范围内 Git 空白检查；均退出码 0。公开品牌类型库已声明 peer/dev 依赖并离线同步锁文件。 | 通过；整包格式现状另列。 |
| 模型输入、日志与记录快照 | `cli-tools/turn-prepared` 记录实际提供的工具；事件标记 ignorable，真实 JSONL 冷恢复可读取。手工按已确认 T3 预期编写 owning expected 文件，再由真实 profile 比对；工具与编号记录通过。 | 通过；模型服务提供指定响应，执行和日志层均真实。 |
| 持久字段与客户端说明 | 包 README 记录旧数据缺字段的明确错误和恢复行为；JSDoc 说明保存顺序；提示走中英文 locale。实际 Web 详情页、客户端渲染及旧记录恢复测试通过。 | 通过。 |

## 实际执行证据

- 根目录 `pnpm --config.verify-deps-before-run=false test`：242/242，0 跳过，退出码 0，全量日志（原执行记录 `all-verification.log`）。
- T2 新增验收测试：1/1、退出码 0，A/B 新建记录（原执行记录 `new-a-b-final.log`）。T3 加强后复跑：1/1、退出码 0，老工具实际执行记录（原执行记录 `old-tools-final.log`）。这两项执行在各自最终测试内容上，生产代码与全量回归版本一致。
- 根目录 lint（含七个 KMH 包）退出码 0，日志（原执行记录 `root-lint-final.log`）。包类型检查和 lint 均退出码 0：类型（原执行记录 `typecheck-final.log`）、lint（原执行记录 `lint-final.log`）；本轮格式检查（原执行记录 `changed-format-final.log`） 退出码 0。
- 真实页面只读核对：工具生效提示截图（原执行记录 `tool-scope-browser.png`）。Selector 实际装卸和保存配置在隔离 profile 完成，记录（原执行记录 `selector-fixed.log`）。

`verify-deps-before-run=false` 只阻止 pnpm 在现有模块布局上自动重新安装依赖，实际测试、类型和 lint 门禁均执行。回环监听的宿主执行已获自动审核允许。测试目录保留通信及原生记录供复查，实际子进程和本地模型服务已由测试回收。

## 范围与限制

- 本轮范围内失败：无。
- 范围外已知检查失败：整包 `format:check` 退出码 1，八个本轮未修改文件有原有格式问题，名单见 [开发报告](dev-report.md)，原始日志（原执行记录 `package-format-final.log`）。本轮涉及文件的格式检查通过。
- 保留的未验证项：D05 回合内精确事件切点、T6 真模型长上下文压缩触发观察，均由已确认设计单独保留；已验证范围为普通新建、原编号复用、完成回合切点和编辑首条输入。
- 不适用：自有 Python 协议生成、DSH Session 代际/SDK 投影变更；本轮保存字段属于 Codex 自有绑定文件，DSH 数据格式和 SDK 保持现有版本。
- 待确认：无。新增测试和加强验证 位于 [tool-policy.test.mjs](../../../../../packages/codex-cli/test/tool-policy.test.mjs) 与 [session-store.test.mjs](../../../../../packages/codex-cli/test/session-store.test.mjs)，固定预期位于 [session-tools.expected.json](../../../../../packages/codex-cli/test/fixtures/session-tools.expected.json)。

结论覆盖所列增量、基线和实际证据。细粒度分叉和真实压缩的验证状态保持独立记录。
