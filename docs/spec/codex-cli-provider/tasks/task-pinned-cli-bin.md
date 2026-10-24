---
description: 将当前官方 Codex CLI 固定在插件 bin 中，保留精确版本检查，并验证新版工具清单及现有会话接入。
---

# 固定插件自有 Codex CLI 运行包

> 归属模块：packages/codex-cli，官方 CLI 接入与工具策略
> 功能文档：[Codex CLI provider](../spec.md#feat07-独立分享)
> spec: docs/spec/codex-cli-provider/spec.md
> 范围：feat07 场景2、5；回归 feat02 场景5、6及现有工具隔离
> tech-design: 本文件②精简技术设计
> 创建：2026-10-22
> 状态：实现完成；完整回归保留1项既有失败，交付对账未通过

## ① 需求与变更

用户本轮明确授权：“把当前新版本放到插件的bin目录里，然后改引用指定吧，注意版本号仍然要作为校验项”。固定当前本机 `0.163.0-alpha.10.2` 完整运行包，默认程序由插件解析，版本检查与工具兼容验证继续执行。登录与会话数据沿用原机制。本任务只改 KMH 自有包及引用该包的 profiles。

需求基线为提交 `c98c94b11744d212690f7c2f73eb02a00505e04b` 的 feat07 场景2和本轮用户原话；原正文为“可通过配置指定可执行文件路径，插件按声明行为工作”。旧默认 command 为 `codex`，各主要 profile 显式指向桌面应用。工作区已有修改单独保留。

本次修改 feat07 场景2，新增场景5；[变更记录](../spec.md#变更记录)回链本任务。恢复回合准备沿用 feat02 场景5、6。

## ② 精简技术设计

| 设计 | 范围 | 实现安排 | 验证 |
|------|------|----------|------|
| D1 | feat07 场景2、5 | 将桌面应用当前完整 CLI 运行包复制到 `packages/codex-cli/bin/0.163.0-alpha.10.2/darwin-arm64/`；运行包保留本地并纳入包发布文件清单。`bin/version` 统一记录固定版本；`bin/codex` 启动前读取实际完整版本，与固定值精确比较，版本不符或文件缺失时结束。 | 对比复制前后哈希、真实 --version；用独立临时目录注入版本失配和缺文件 |
| D2 | feat07 场景2、5 | Config 默认从自身包目录解析 `bin/codex`；主要 profiles 使用此默认值；显式 command 覆盖继续可用。聊天、账号、额度和探针共用该配置。版本展示保留完整 alpha 版本。 | 配置默认值和打包清单检查、当前 profile 展开及插件回归 |
| D3 | feat02 场景5、6 | 从固定 CLI 的真实本地模型请求采集工具声明，生成0.163工具清单，核对工具关闭时的声明省略和执行拒绝。旧清单保留。测试默认使用插件固定程序。 | native-controls 与 tool-policy 的真实 CLI + 本地模型 fixture |

依据为本轮授权、现有 Config / connectCodex / discoverNativeTools 调用链与根 AGENTS.md。R1：自有包解析路径；R2：沿用工具清单 Zod schema；R3：现有官方进程协议保持；R4：固定版本由 bin/version 单点维护；R5：统一使用“固定 CLI 运行包”；R6：沿用具名超时；R7：启动检查结束后 exec 官方程序，真实退出码与信号继续由现有子进程管理。遵循 dev-ts、kmh-doc、kmh-prose-standard、kmh-ci-test-reliability；子模块保持原状。

## ③ 测试用例与变化

| 用例 | 类型 | 范围 / 设计 | 前提、操作和预期 | 位置 |
|------|------|-------------|----------------|------|
| T1 | 新增 | feat07 场景2、5；D1、D2 | 默认 command 指向插件 bin，真实固定程序报告0.163完整版本，发布清单包含启动器和运行包 | pinned-cli.test.mjs |
| T2 | 新增 | feat07 场景2；D1 | 在临时目录放入错误 alpha 版本或缺少运行包；启动器拒绝并输出明确原因 | pinned-cli.test.mjs |
| T3 | 新增 | feat07 场景2；D1 | 临时目录中版本一致，启动器原样传递参数和退出状态 | pinned-cli.test.mjs |
| T4 | 修改 | feat07 场景5；D3 | 原生声明清单比较改为当前固定版本；声明与真实请求一致 | native-controls.test.mjs |
| T5 | 沿用回归 | feat02 场景5、6；D3 | 命令执行、文件修改、查看图片关闭时，真实 CLI 拒绝工具执行；未知版本继续报错 | native-controls、tool-policy |
| T6 | 新增 | feat07 场景2；D2 | 插件详情状态保留实际完整 alpha 版本 | pinned-cli.test.mjs |

用例变化：新增4项、修改1项、沿用回归1组、删除0项；框架执行数量在⑤单列。

## ④ 技术实现

1. 完整运行包复制到 D1 目录，46个文件共340,775,935字节，逐文件 SHA-256 与来源一致；主程序 SHA-256 为 `1afb28c01d7d49e892bd75f11076b10f1451e34e0ee308a95e5ab7f69f9c84fe`。
2. `bin/codex` 读取 `bin/version`，每次执行前精确核对 `codex-cli 0.163.0-alpha.10.2`。参数、退出码与进程信号经 exec 保持。完整程序目录被 Git 忽略，包发布白名单包含整个 bin。
3. Config 从自身 package.json 所在目录解析启动器。Web、mobile、sdk-mobile 移除桌面程序路径，mobile-assistant 保留显式环境变量覆盖，其余情况使用插件默认值。status 保留完整 alpha 版本，并把部署 env 传给版本读取进程。
4. 用固定副本的真实本地模型请求采集0.163清单；五项声明与旧版本逐项一致。旧版本清单保留，新版隔离经过真实 CLI 验证。
5. 测试宿主和主仓 CLI smoke 默认指向固定副本，显式 `KMH_CODEX_BINARY` 仍可作比较验证。README 记录当前平台、运行包部署前提、版本失配与缺文件恢复入口。

实际文件：`.gitignore`；本 spec 及本任务；`packages/codex-cli/README.md`、`package.json`、`src/config.ts`、`src/status.ts`、`bin/{codex,version,README.md,runtime-receipt.json}`；新版 `vendor/native-tools` JSON；`test/pinned-cli.test.mjs`、`test/native-controls.test.mjs`、两份 `test/support/*harness.mjs`；四个上述 profiles 的 patch；`tests/runtime/codex-cli.test.mjs`。源码改动范围按 D1–D3执行。`bin` 完整运行包为本机部署产物。已有 kmh-remote 修改和 Web profile 的其他用户修改保持原状；DSH 子模块保持原状。

## ⑤ 验证结果

执行目录为仓库根目录，环境为 macOS arm64、Node v25.6.1。代码基线为①的 HEAD 加本轮差异；相关文件哈希与日志保存在本机忽略目录 `.kongming/codex-pin-20261022/`。需求与设计使用本任务①②③及本轮用户明确授权，行为编号保持一致。

### 本次开发验证

| 用例 / 场景 | 有效红灯或取证理由 | 实际命令 / 操作 | 结果与证据 |
|-------------|-------------------|----------------|------------|
| T1–T3，feat07 场景2、5 | 实现前新测试默认 command 仍为系统路径，固定启动器缺失 | `node --test packages/codex-cli/test/pinned-cli.test.mjs` | 实现前5项失败，见 `kmh-codex-pin-red-20261022.log`；补入T6后共6项，实现后6/6通过，精确 alpha 失配、缺文件、参数及真实退出码均核对 |
| T4，feat07 场景5 | 原生发现直接复现用户的缺 JSON 错误 | 原 native-controls 测试以桌面程序运行，再使用固定副本运行清单采集用例 | 基线8项中7通过、1失败，错误与用户一致；从固定副本真实请求生成新版清单，五项声明逐项与原版一致；日志 `baseline`、`capture` |
| T5，feat02 场景5、6 | 复用现有真实执行拒绝与 profile Agent loop | `node --test --test-concurrency=1 packages/codex-cli/test/native-controls.test.mjs packages/codex-cli/test/tool-policy.test.mjs` | 26/26通过、0跳过，覆盖工具拒绝、错误版本、刷新恢复与原生会话恢复；日志 `native` |
| T6，feat07 场景2 | 旧 status 只保留三段版本，目标要求保留完整版本 | pinned-cli 中实际运行版本检查，并检查网页 | 完整显示 `0.163.0-alpha.10.2`；最终根测试包含6项 pinned-cli 测试且全部通过 |
| D1、D2 发布包含性 | 用真实打包白名单取证 | 在包目录执行 `npm pack --dry-run --json --ignore-scripts` | exit 0，128个文件，包含启动器、固定版本、完整主程序与新版清单；日志 `pack.json`；只生成清单 |
| Web 实际运行 | 使用既有运行服务，验证实际部署 | Chrome 插件详情中点击测试连接；观察进程程序路径 | 页面显示完整版本、已登录、原生工具开关正常，连接测试于2026-10-22 16:34:50通过；观察到实际程序来自插件 bin 目录；本机证据 `browser-connection.png`、`live-path.json` |

隔离模型 fixture 监听回环地址，初次沙箱运行遇到 `listen EPERM`，同一命令在允许回环监听的环境继续验证。测试以独占临时目录隔离 CODEX_HOME 和模型服务，线上连接测试使用用户现有账号。完整原始日志文件名均以 `kmh-codex-pin-` 开头。

### 既有功能回归

| 检查 | 实际结果 | 证据 / 边界 |
|------|----------|-------------|
| `pnpm test` | exit 1；573项，572通过、1失败、0跳过 | `full` 日志；唯一失败为 `stream-reasoning.test.mjs:94` 的原生日志 summary，实际 none、预期 auto |
| 以原桌面应用路径运行唯一失败用例 | exit 1，复现相同断言 | `KMH_CODEX_BINARY=<原桌面程序> node --test --test-name-pattern='selected effort matches' packages/codex-cli/test/stream-reasoning.test.mjs`；日志 `original`，证明该现象也存在于改动前程序路径 |
| `pnpm lint`、启动器 shell 语法、测试脚本语法 | exit 0 | `lint` 日志及 `sh -n`、`node --check` |
| `pnpm --filter @kmh/codex-cli typecheck` | exit 0 | `typecheck` 日志 |
| 包级 `format:check` | exit 1，4个既有文件 | `src/isolation.ts`、`src/native-tools/catalog.ts`、`src/tool-registry.ts`、`tsconfig.host.json`；本轮保持这些文件原状 |
| 本轮改动的 TS、包清单、README 与新增测试格式检查 | exit 0 | 显式路径 Prettier 检查通过 |
| 本轮差异的 `git diff --check`、文档链接核对 | exit 0 | 本任务、bin说明的链接均解析到实际文件 |

### 功能文档与变更索引

feat07 场景2、5与变更记录已同步；正文和任务双向链接通过核对。状态注明完整回归的既有失败，原始范围和验收标准保持。

### 公共验收回执

- x-verify-spec：对账不通过。①的本轮用户授权、HEAD可读旧定义、feat07场景2/5与③T1–T6均能定位，五段结构、变更记录双向链接、用例覆盖与日志对应已核对；根回归573项中1项失败，依门禁规则保留未通过状态。本轮对账本身只核对记录，测试执行由开发和技术验收分别提供。
- x-verify-tech：固定程序技术项通过，完整门禁结论为失败，原因是必需根回归保留1项既有失败。验收独立重跑 pinned-cli 与 native-controls，共14/14通过、0跳过，日志 `verify-tech`。逐项证据见下表；本轮额外验收测试为0。

| 技术项 | 方法与观察 | 结论 |
|--------|------------|------|
| D1、R4、R7：固定版本、拒绝、进程转交 | 运行真实固定程序，并在独占临时目录保留真实启动器、替换其目标CLI；6项测试核对完整alpha版本、拒绝失配/缺文件、参数与退出码 | 通过 |
| D2、R1、R5：路径与调用归属 | 代码审查 Config从自身包定位bin；四个profiles使用默认值，显式覆盖保留；聊天、账号、额度、隔离与版本读取均沿用同一command；网页进程路径观察落在固定目录 | 通过 |
| D3、R2、R3：工具声明和进程协议 | 新清单由真实请求采集、沿用现有Zod校验；8项native-controls复核实际声明及执行拒绝；进程协议字段和schema保持原状 | 通过 |
| R6：具名配置 | 代码审查沿用已有startup/probe/cleanup超时；新增退出码78属于启动校验协议；固定版本由version文件读取 | 通过 |
| 平台、发布与作用范围 | macOS arm64包逐文件哈希一致，打包清单包含完整程序与新清单；其他平台有明确错误及显式配置入口；DSH子模块无本次差异 | 通过 |
| 严格类型、代码与文字检查 | typecheck、根lint、变更路径Prettier、差异空白与本任务文档链接检查通过；包级format的4项既有问题单列保留 | 通过，范围限本次改动 |
| 必需完整回归 | pnpm test为572/573；相同摘要断言在原桌面程序路径重现 | 失败，范围外既有问题保留 |

### 结论与未决

本轮功能和原始报错恢复已验证，完整回归保留一项既有失败。摘要用例实际得到的原生 summary 为 none、预期为 auto；任务范围内保持既有断言和生产摘要逻辑。包级格式检查的4个既有文件保持原状。后续处理该摘要兼容问题时应同时核对原生会话日志与真实模型请求中的 summary 字段。
