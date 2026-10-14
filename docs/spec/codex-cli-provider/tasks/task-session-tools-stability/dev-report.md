# task-session-tools-stability · dev-report

> 本文保存原仓的开发与验收记录。原始日志和临时证据位于原执行环境；其中的通过结果归属该次运行。OS 当前固定底座的依赖状态见 [仓库入口](../../../../../README.md#当前依赖状态)。

> task: docs/spec/codex-cli-provider/tasks/task-session-tools-stability/dev-checklist.md
> 日期: 2026-10-13
> 范围与确认: [req 分配](req-allocation.md)，用户确认 v0.3 后授权“同意 走req dev，verify”。

## 结果

六行任务均完成。本轮承接 18 个场景、C1–C5、8 个设计条目和 10 个设计用例。普通新建采用创建时的工具，续聊恢复原编号和原工具；Selector 的实际启停保持 Codex 独立运行。

根目录完整回归 242/242 通过，0 跳过，退出码 0。随后新增的 A/B 新建用例 1/1 通过；加强后的老会话 C/D 执行用例 1/1 通过。包内 47 个不同用例均有通过记录；新增和加强的测试分别复跑，其余测试沿用本次总回归结果。六行中的五个高风险行均有真实 CLI、profile 或文件验证。

类型检查、根目录 lint（含七个 KMH 包）、本轮修改的 11 个生产代码及包文件的格式检查、修改范围的 Git 空白检查均通过。整包格式检查退出码 1，报出 8 个本轮未修改文件的已有格式问题，见末节。

## 验证证据

场景回指以 [开发清单](dev-checklist.md) 各行和 [req 分配](req-allocation.md) 为准；设计用例主定义在 [tech-design](../../tech-design.md)。以下每行承接清单同号行的全部场景。

| 任务行 / 约束 / 设计 / 用例 | 有效红灯或采用方式 | 最终结果与证据 | 局限 |
|---|---|---|---|
| T1；C1、C2、C3；D02、D08；用例 T1、T4、T5 | 最初文件测试 0/3：首条消息前记录丢失、坏文件被清空、失败写入被内存接受。修复后用实际文件复验。 | 文件测试 3/3；收到原生编号后制造实际保存失败，`thread/start` 1 次、`turn/start` 0 次、模型请求 0 次，保留原文件。旧记录缺工具信息时恢复抛 `CODEX_SESSION_STATE_INCOMPLETE`，编号和文件保持。故障证据（原执行记录 `recovery-save-final.log`）；总回归也通过这两项。 | 故障使用隔离文件；生产记录保留。 |
| T2；C1、C4；D01、D03、D07；用例 T1、T3、T8 | 初始真实 profile 的两项关键测试 0/2：改开关后原编号被更换，创建后修改开关使首轮工具变空。夹具缺服务导致的更早失败单列为环境问题。 | 甲创建时 A/B/C，之后默认只打开 D，C 真实执行成功；此时强制调用 D 被拒绝，D 执行 0 次。全关后甲仍 A/B/C、S1。加强后的记录（原执行记录 `old-tools-final.log`）。实际 Selector 装卸通过，Codex 原 fiber、原编号保持，恢复后可读取已保存的新默认。装卸记录（原执行记录 `selector-fixed.log`）。 | 模型响应由本地服务提供；工具策略、执行、配置保存、插件生命周期均运行真实实现。 |
| T3；C1、C2、C3；D02、D04、D09；用例 T2、T3、T4、T6、T11 | 原续聊实际新建会话，见 T2 红灯；删除历史重建和截断路径后复验。 | 新建乙传 A/B，S2 与甲的 S1 独立，甲续聊仍 A/B/C；实际创建 2 次、普通续聊无分叉。A/B 记录（原执行记录 `new-a-b-final.log`）。真实 JSONL 持久化重启且没有共享 cliTools 服务，原编号和原工具保持；超过 600 字的输入尾标完整到达、原输入保持单份。官方恢复后的普通进度和原生文件修改仍工作。全量日志（原执行记录 `all-verification.log`）及其 profile artifacts。 | 真实模型长上下文压缩触发观察保持单独未验证；本轮发送完整输入及复用历史已验证。 |
| T4；C5；D05；用例 T17、T18 | 初次分叉两项 0/2，定位到原有完成回合编号未赋值；修复后两项通过，最终总回归再次通过。 | 完成回合后通过官方 `thread/fork(lastTurnId)` 分叉，子会话保留源工具，父编号保持，继承历史单份。编辑首条输入使用 `beforeTurnId`，完整替换输入只发送一次，原输入排除，父记录保留。见全量日志中 fork、editing 两项及对应 artifacts。 | 回合内精确事件切点按已确认设计保留未验证；无法精确定位时明确报错。 |
| T5；C4；D07；用例 T8 | 文案采用真实页面检查；Selector 使用真实插件装卸，沿用已有配置入口。 | 127.0.0.1:3080 → 插件 → Codex CLI，实际显示“工具开关仅对普通新建会话生效；已有会话保留创建时的工具”。原生技能提示为下一回合生效。页面证据（原执行记录 `tool-scope-browser.png`）。Selector 关闭时修改 Config，新建乙使用新默认、续聊甲使用原选择；重启 Selector 读取保存值。 | 实际页面核对提示；配置编辑和装卸在隔离 profile 中验证。 |
| T6；C1–C5；D01–D05、D07–D09；全部十个用例 | 更新仓库旧测试中“重建历史、清空坏记录”的断言，补齐公开夹具接口；配置 schema 的客户端闭包错误修复后实际序列化校验通过。 | `pnpm --config.verify-deps-before-run=false test`：242/242、0 跳过、退出码 0；包含 46 个 Codex 包用例。新增 T2 与加强 T3 分别 1/1、退出码 0。包 typecheck、lint 退出码 0；修改的 11 个文件格式退出码 0。全量日志（原执行记录 `all-verification.log`）、类型（原执行记录 `typecheck-final.log`）、根目录 lint（原执行记录 `root-lint-final.log`）、包 lint（原执行记录 `lint-final.log`）、范围内格式（原执行记录 `changed-format-final.log`）。 | 整包格式现状与延期项见下文；全量绿灯只代表本次实际执行结果。 |

## 代码与输入基线

工作目录为 Kongming 根目录，HEAD 为 `d1c62af1649f4dff2088ddf516dc12c96d3356e0`，保留原工作区修改。最终 19 个涉及文件的 SHA-256 见 代码基线（原执行记录 `final-source-hashes.json`）；初始内容副本在同一临时证据目录。实际环境为 Node v25.6.1、官方 Codex CLI 0.162.0-alpha.17.2。测试的配置、原生会话、文件和模型服务均在隔离目录；测试监听回环端口所需的宿主执行已获自动审核允许。

当前 spec 与 [spec 副本](baselines/spec.md) 一致，SHA-256 为 `edcb81f838d0c9630859595f21ef8f45ed3a084a6c9cf069c12314588a3b0b40`；当前技术设计与 [设计副本](baselines/tech-design.md) 一致，SHA-256 为 `414f844570b2bda71d211cbc6d78bdba368b6f20dd57b9e0298cf354c5a48d4e`。

## 已有问题与未验证范围

- T6 的范围外格式现状：整包 `format:check` 报出 `client/index.ts`、`client/ToolRecords.tsx`、`cursor.ts`、`isolation.ts`、`native-tools/catalog.ts`、`tool-registry.ts`、`web.ts`、`tsconfig.host.json` 八个未修改文件。保留原工作区内容。整包检查日志（原执行记录 `package-format-final.log`）。
- D05 回合内精确事件分叉、T6 真实模型长上下文压缩，沿用已确认设计的单独未验证状态。普通完成回合分叉、编辑首条输入、新建和原编号续聊已有实际证据。
- 旧记录缺原工具信息时明确恢复失败并保留数据；升级影响已写入包 README 的“会话工具记录升级”。
