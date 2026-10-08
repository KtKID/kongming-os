---
description: ZCode CLI 0.16.9 的参数失败根因、现有接入的会话与历史问题，以及本地官方源码中的扩展入口调查。
---

# task-zcode-session · dev-report

> task: docs/spec/kmh-session-suspend-plugin/tasks/task-zcode-session/dev-checklist.md
> 创建: 2026-10-08

## 结果

- 清单：T1 🔴，T2–T6 待执行；原生 session 增量、KMH 提示与工具控制的联合验收继续调查。
- 2026-10-08 源码复核修正 T1 表述：会话复用在协议面成立（create/send/resume 齐全，跨进程恢复已证实），红灯的准确含义是 KMH 掌环模式缺 systemPrompt 注入口、工具结果回注口与 generateText 会话绑定；kmh 全量路径缓存实测为零。协议边界、实测数据与出路 A/B 见[源码核实报告](../../../zcode-cli-provider/tasks/provider/reports/research/research-report-20261008-zcode-session-cache.md)。
- 真实 CLI 诊断：6 个子用例全部通过。原 session 跨进程恢复保留两条消息；现有 raw 接口接受 KMH 系统提示、工具声明和关联工具结果；官方 MCP 发现一个 KMH 工具。模型请求数为零。
- 安装版 CLI 回环诊断：新增 1 项用例通过，4 次本机模拟模型请求确认同目录会话隔离、重启后的原生 session 请求头，以及 raw 消息独立和原生历史缺口。真实账号和远端 provider 请求为零。
- 既有回归：ZCode 运行时 48/48 通过；`pnpm --filter @kmh/zcode-cli build`、`pnpm lint`、新增 smoke 的语法与格式检查通过。
- 当前 CLI：`0.16.9`；文件 SHA256 为 `fad4c35c4c36ec210d8a06d3fa0e77de23c8545e2eb6ff90aea1eb38d1e6275f`。测试使用临时 HOME、存储和日志目录，账号目录为空，官方 provider 注册数量为零。
- 高风险行：T2–T6 等待实现及真实模型、取消和重启验收；缓存命中尚待真实模型 usage 验证。

## 失败根因

初版测试将 raw 模型入口的消息与工具字段传入另一套 Session 接口；该接口的严格参数解析直接返回 `-32602`。这个结果确认被测字段在被测方法中的限制。原测试把三个未经定义的参数方案直接写成功能验收条件，随即将参数错误扩大成整体接入阻塞，调查范围需要覆盖实际扩展入口。

| 接口                     | 真实结果                                                                                                               | 结论范围                                                            |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `session/create`         | 对 `systemPrompt`、`tools` 返回 `-32602`                                                                               | 这两个内联字段属于该入口的未知参数                                  |
| `session/send`           | 对包含关联工具结果的 `messages` 返回 `-32602`                                                                          | 该入口接收用户输入，并进入原生 Agent 循环                           |
| `workspace/generateText` | 对 `sessionId` 返回 `-32602`；KMH 的 system/user/assistant/tool 消息及工具声明通过解析，随后在隔离环境的模型选择处失败 | 原有 KMH 消息协议保持有效；该方法通过 workspaceKey 查找活跃 runtime |
| `mcp/list`               | 本地 stdio MCP 完成连接，发现 `kmh_echo`，toolCount 为 1                                                               | 公开工具扩展入口可用；完整工具执行续接另行验收                      |

本机发布文件和官方源码中的 `generateWorkspaceTextImpl` 均使用调用方传入的消息数组构成本次模型输入。通过 `workspaceKey` 复用 runtime 后，消息历史仍由调用方提供；仅传入新增消息会丢失此前上下文。MCP 工具进入原生 Agent 循环；KMH 的系统提示与外层循环控制继续作为联合验收要求。

测试入口为 `ZCODE_CLI_FILE=/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs node --test tests/smoke/zcode-session-compatibility.test.mjs`。当前命令通过，含义是接口行为已被诊断确认；feat08 的增量、工具执行和真实缓存用量仍待功能验收。安装路径不同的环境通过 `ZCODE_CLI_FILE` 和可选的 `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` 指向发布文件与内置模型配置。

## 当前接入的源码根因

现有 [`runtime.ts`](../../../../../packages/zcode-cli/src/runtime.ts) 的 `raw()` 每次启动一个 `app-server`，注册账号模型配置，生成结束后关闭连接并回收子进程。`generate()` 中的 KMH sessionId 用于解析工作目录，模型请求通过 `workspace/generateText` 发出。该链路尚未建立 KMH 会话到原生 session 的持久绑定。[`protocol.ts`](../../../../../packages/zcode-cli/src/protocol.ts) 的 `projectRequest()` 遍历完整消息数组，并在每次请求中携带系统提示与全部工具声明。这解释了既有消息和工具调用可以正常工作的原因，也确认了当前会话复用与增量要求的实现缺口。

下列源码路径均位于本地 `other/ZCode/`。分析覆盖严格参数定义、实际方法实现、恢复读取和扩展点消费，结论限定于 commit `29628c9acdb81b703bbd4080c207a0e7ce5e276e`。

| 源码位置                                                                                                                     | 确认的行为                                                                                                   | 对接含义                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `packages/shared/src/zcode-protocol/index.ts:1559,1731,2075`                                                                 | create 接收模型、MCP 和工具过滤；send 接收用户文本及附件；raw 接收 system/user/assistant/tool 消息与工具声明 | 内联系统提示和工具结果属于 raw 消息入口；三个方法各自按严格参数定义解析           |
| `apps/zcode-cli/packages/bootstrap/src/zcode-protocol/server-operations.ts:1918,2410`                                        | send 按 sessionId 找到原 app，调用 sendInput；已有活动 prompt 时返回错误                                     | 原生增量输入可用；legacy inputId 用作输入关联，KMH 仍需负责重复继续和并发投递准入 |
| `apps/zcode-cli/packages/core/src/runtime/methods/turn-tools.ts:180`                                                         | 原生循环调用 executeTools，并持久保存工具结果后继续生成                                                      | MCP 可以承载 KMH 工具，完整循环仍由 ZCode 驱动                                    |
| `apps/zcode-cli/packages/bootstrap/src/zcode-protocol/server-operations.ts:2743`                                             | raw 按 workspaceKey 查找首个活跃 app；缺少活跃 app 时临时创建并在 finally 关闭                               | 同目录的多个会话需要明确隔离身份；workspaceKey 的复用只解决 app 选择              |
| `apps/zcode-cli/packages/core/src/runtime/methods/workspace-generate-text.ts:139`                                            | raw 从 input.messages 复制模型输入，直接调用 model.generateText；历史组装由调用方负责                        | 保持进程或先 resume 都仍需单独实现 raw 历史管理                                   |
| `apps/zcode-cli/packages/core/src/runtime/methods/resume.ts:70`                                                              | resume 根据同一 sessionId 读取 sessionStore.messages 并重建原生历史                                          | 恢复依赖已保存的原生消息；raw 调用继续使用自己的 input.messages                   |
| `apps/zcode-cli/packages/adapters/src/plugins/index.ts:106`、`apps/zcode-cli/packages/core/src/runtime/methods/hooks.ts:109` | 插件支持 MCP、技能、命令和 hooks；outputStyles/settings 被标记为未支持；hook 上下文追加到消息历史            | 已查插件能力提供上下文追加和工具扩展，联合接入仍缺 raw 增量与外部循环续接入口     |
| `apps/zcode-cli/packages/adapters/src/model/runner-attribution.ts:27`                                                        | 模型请求的 x-session-id 来自原生 runtime 的 sessionId                                                        | 原生身份会进入上游请求；缓存是否使用这个头需由真实 provider usage 验证            |

`operationId` 属于 raw 请求的活动取消标识，服务端完成后会移除对应 AbortController。恢复确认游标和持久去重仍需要实现。V4 命令具有单独的 commandId 准入与持久查询机制；当前 KMH raw 链路使用的是 legacy 模型生成入口。

## 进程内扩展入口调查

本次调查直接读取现有 `other/ZCode`；CLI 子项目版本为 `0.16.9`，源码工作区保持干净。`node scripts/check-workspace-freshness.mjs --no-fetch` 通过，当前 main 与本地 origin/main 一致。此前重复下载到 `/tmp/kmh-zcode-source` 的目录及 `/tmp/kmh-zcode-source.tar.gz` 已删除，约释放 158 MB；两个路径均确认不存在。SDK 依赖安装已经停止，本次源码分析未下载依赖。

`apps/zcode-cli/packages/bootstrap/src/index.ts` 导出 `createZCodeApp`，`app/types.ts:123` 提供 sessionId、resume、runtimeConfig、sessionStore 和 providerRegistry。`app/runtime-config.ts:118` 透传 runtimeConfig，包括 systemPrompt；`core/src/runtime/types.ts:326` 的工具执行器注入属于直接构造 AgentRuntime 的依赖，createZCodeApp 自己组装该依赖。两层入口需要分别核对。

`@zcode/bootstrap/package.json` 声明 `private: true`，依赖多个官方工作区包。它是源码内的进程内模块；已安装的单文件 CLI 通过 app-server 暴露协议。源码类型存在、发布文件接受参数、联合功能可用分别需要证据。源码中的 customSystemPrompt 路径仍经过 ContextBuilder，后者保留 ZCode 身份等原生上下文；直接设置该字段仍需核对完整模型输入。

候选桥接入口需要在插件维护的进程中固定原生 sessionId、接收增量、保存消息及确认进度，并将组装后的消息交给官方模型生成模块，由 KMH 执行工具和外层循环。现有 generateWorkspaceText 自身只处理当次消息，ensureSessionPersistedForExternalActivity 只保证 session 记录存在；这两个函数的组合仍需补齐消息历史持久化。候选尚未实现，包装方式和原生存储兼容性继续调查，T1 保留联合验收失败状态。

已找到候选所需的存储表达能力：`apps/zcode-cli/packages/contracts/src/interfaces/session-store.port.ts:824,1129` 的 SessionEntryInfo 允许自定义 type 与 JSON data，saveSessionEntry/sessionEntries 支持按同一原生 sessionId 写入与按类型读取。`adapters/src/storage/session-store/repositories/session-entries.ts` 的 SQLite 实现直接保存这些记录；插件自定义记录可以沿用现有表结构。候选可将首次系统提示与工具版本、每次新增消息、模型结果和接收确认分别保存成追加记录，通过包含 sessionId 的稳定记录 ID 保持跨会话隔离。该方案仍需验证崩溃时的待确认处理、原生会话恢复与模型输入重建；协议暴露、构建分发和真实缓存验收保持未完成。

源码 `bootstrap/src/app/session-facade.ts:396` 的 generateWorkspaceText 直接调用 runtime 的同名方法，跳过 prepareResume。`create-app.ts:502` 中 options.resume 的惰性恢复在用户执行入口触发，显式 app.resume() 提供独立恢复入口。因此，候选只传入 sessionId 与 resume: true 后直接执行 raw，仍缺少恢复前置步骤和历史读取。

分发入口也已核对：`cli/scripts/build.mjs:226` 以 `cli/src/main.ts` 打包单文件 CJS，main.ts 顶层调用 main()；该入口运行 CLI 主程序。`bootstrap/package.json` 的 exports 属于另一个源码工作区包，需要独立构建与分发。`__zcode-plugin-host` 加载插件模块的 main()，没有向该模块传入 app/runtime；它承载独立 MCP 服务。进程内桥接的交付范围需要包含自己的入口及官方模块依赖。

## 安装版 CLI 的回环验证

新增诊断使用已安装的同一 CLI 文件，隔离 HOME、配置、存储与日志，在 127.0.0.1 随机端口运行普通自定义 provider。凭据和模型响应均为合成数据。定向入口为 `ZCODE_CLI_FILE=/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs node --test --test-name-pattern=loopback tests/smoke/zcode-session-compatibility.test.mjs`；本轮执行通过。沙箱先对官方 Unix socket 和本机 HTTP 监听返回 EPERM，宿主权限重跑完成验证。

| 实际操作                                                               | 观察结果                                                                       | 结论                                                                     |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| 创建持久原生 session S，raw 依次发送 system + 第一条输入、仅第二条输入 | 两次上游 x-session-id 均对应 S；第二次请求体只有第二条输入                     | 现有安装版可复用 raw 的原生身份；raw 调用之间由调用方提供历史            |
| 在同一目录创建另一个原生 session，使用不同 workspaceKey 发 raw 请求    | 第三次请求头对应第二个原生 session                                             | workspaceKey 可用于同目录会话路由，KMH 当前按 cwd 填写此键的方式需要更新 |
| 结束 CLI，重新启动并 session/resume 原 S，再发送一条 raw 输入          | 第四次请求头继续对应 S；请求体只有此次输入；恢复的原生消息仍只有预先导入的两条 | 原生身份跨进程可恢复；raw 交流需要另外实现历史追加、持久化和确认         |

回环验证覆盖真实 CLI 和 HTTP 请求组装，模型响应与 usage 来自固定 fixture。真实 Coding Plan 工具续接、缓存命中和崩溃后的确认进度保持未验收。

Coding Plan 与公开源码还存在一项已观察差异：最初将隔离的 Coding Plan provider 指向本机 HTTP 时，安装版返回 `Client signing handshake requires HTTPS.`，请求在模拟模型端点收到业务请求前失败。发布文件包含 ClientRequestSigningV4Manager、签名密钥缓存和 codingPlanSignature 配置。对当前本地源码的 CLI、provider 和 provider-node 全文检索尚未找到这些实现；源码 `adapters/src/model/model-execution.ts:45,162` 的执行配置与构造器也未声明它们。版本号相同只能作为版本记录，公开源码构建与安装版的 Coding Plan 行为需要独立验收。源码桥接继续保留候选状态，正式接入必须保留并验证官方账号、签名与权益通道。

## 未决

- T1 · 联合功能验收继续调查 · 已完成：原生输入与工具、raw 生成、恢复与插件消费链路，进程内入口的恢复和分发，以及安装版回环模型验证。原生身份复用已有实际证据；raw 增量历史、确认进度和 Coding Plan 联合接入继续调查。
- 调查范围修正 · 使用 other/ZCode 与已安装 CLI；重复下载的源码和归档已删除，依赖安装已停止。
- 测试接入修正 · 三个未知字段的拒绝改为协议诊断断言，联合功能状态继续保留 T1 🔴；MCP stdio 参数按官方定义省略 type 字段。诊断全部通过与功能验收分别报告。
- 测试接入修正 · 官方 create/resume 的会话身份位于 `result.session.sessionId`；空会话采用惰性持久化，恢复对照改用官方导入的固定文本，模型请求数保持为零。

## 本轮追加核对

本地 shared/src/zcode-protocol/index.ts:1559、2075、3563 分别定义严格的 session/create、workspace/generateText 和方法清单；公开方法清单保持原有能力范围。V4 command.ts:81 的 sendText 仍接收用户文本与原生执行选项，model-execution.ts 的 modelExecution 仅提供单次鉴权、记忆提取和子代理约束。这些字段继续缺少 KMH 系统提示、内联工具和工具结果增量历史入口。Q02 继续以增量历史、KMH 外层循环与安装版 Coding Plan 联合验收为完成标准；源码与安装版签名能力的差异保持单独记录。
