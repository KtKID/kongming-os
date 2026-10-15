---
description: Codex CLI Trace 的自动测试、真实会话、浏览器与导出执行证据索引。
---

# 验证证据

2026-10-15，在 macOS、Node 25.6.1、pnpm 11.7.0 上执行。规格基线为 `dd4f42bde6efacfdbc32b2992834a6bfccd0c01e499db4a0d5fc78efa30fe01b`；设计为 `0.1-confirmed1`、`46a898077c462a62d93a7d09dbebca88e148c713a7683c9dc36e6d3c5eabc778`。用户已确认新增插件位于 `packages/codex-cli-trace/`，并授权 req、dev、verify。代码和测试内容基线见 [baseline.json](baseline.json)。

## 自动执行

| ID | 实际执行 | 结果与责任 |
| --- | --- | --- |
| V01 | 根目录 `pnpm --config.verify-deps-before-run=false --filter @kmh/codex-cli-trace build`、`typecheck`、`lint`、`format:check` | 全部退出 0；Host/Client 均构建，严格类型与格式检查通过 |
| V02 | `node --test --test-concurrency=1 packages/codex-cli-trace/test/*.test.mjs` | 最终 42/42，失败、跳过均为 0；日志位于本机 `.kongming/trace-evidence/package-tests.log` |
| V03 | 使用隔离临时 `CODEX_HOME` 运行根 `pnpm --config.verify-deps-before-run=false --config.enable-pre-post-scripts=false test` | 282 项中 281 项通过；Web HMR 临时工程漏链接新包导致 1 项失败。补齐 fixture 后，`node --test tests/runtime/web-plugin-hmr.test.mjs` 1/1 通过，并在最终 profile 再次通过。相邻及既有回归共 248 项通过；新增插件最终 42 项独立复测通过 |
| V04 | 根目录 `pnpm --config.verify-deps-before-run=false lint` | 所有 9 个 KMH 包和启动脚本检查退出 0；随后变动的 trace 包再次运行 lint 通过 |
| V05 | 锁文件更新与供应链校验 | pnpm lockfile-only install 退出 0，147 项供应链校验通过；保留现有模块目录，为新增包使用已安装依赖 |

根脚本的本次执行跳过重复 pretest 构建，以保留正在运行的其他插件；trace 产物已单独构建。上述命令的单次配置只影响该命令。

## 设计用例与测试实际内容

测试目录为仓库根 `packages/codex-cli-trace/test/`。编号指向已确认设计中的唯一用例主定义。

| 用例 | 证据 | 实际观察 |
| --- | --- | --- |
| T01、T04 | bindings/source/web 测试；B01、B06、A02 | 独立读取、空关联、坏对应关系、文件头不符、重复候选与越根链接；路由释放与读取资源归零 |
| T02、T18 | reader/web/client 测试；B02 | 文件读取失败可恢复；详情失败保留列表和筛选，错误位于详情；整体失败保留最后成功内容 |
| T03、T05、T11 | projector/client 测试；B01、B03、B05 | 最新/进行中默认选择、主动回看稳定；A 迟到响应受取消保护，B 呈现空态；历史 low/high 与源一致 |
| T06、T12、T14 | projector 测试；B01 | 开始/返回缺失保持待确认；失败 read 与成功重试分开；技能调用 1 次，翻译文件调用 4 次 |
| T07、T08、T09 | usage 测试；A02、B01 | 两轮总量 115295/307513；缓存 56832/237568；重复响应一次计数；累计快照独立核对，部分字段和冲突显式保留 |
| T10、T13、T15 | projector/query 测试；B01、B03 | 文件行序、明确 ID 合并与多来源；开发者角色保持原名；未知类型、可见摘要和原文可查；超 8000 字符、跨读取块中文搜索和详情完整 |
| T16 | projector 测试；A02、B01 | 总耗时 14812/37341 ms、首输出 11571/9904 ms；工具纳秒正确换算；0 保留、缺失为空、计时冲突有说明和多来源 |
| T17 | query 测试；B01 | 完整内容末尾命中，类别与异常交叉过滤，分页命中可达，清空恢复；概览保持全回合 |
| T19、T21 | reader 测试；B04 | 中文半行等待完整后计一次；重复快照保持令牌，替换/截短/同长度改写失效，显式重新读取恢复 |
| T20、T22 | reader/client 测试；B04、B05 | 可控时钟验证串行轮询、隐藏暂停及取消；barrier 验证重叠读取和卸载等待；两独立子进程各自读取并归零；当前阅读位置与选择保留 |
| T23、T24 | source/query/export 测试；B01、A01 | 行号/字节范围与原文一致，源变化拒绝旧位置；中间坏行之后的完整回合继续可读，坏行原文保留 |
| T25、T26、T27 | export/client/web 测试；A01、B07 | 导出两轮全部完整行和长记录；固定截止排除并发追加，半行说明、坏 UTF-8 base64；改写/取消/缺关联失败；准备阶段也纳入插件卸载等待 |

有效红灯包括：初始请求协议接受空 ID、初始读取器始终返回空态、用量概览为空、上下文抢占用户回合标题、计时零值被冲突值覆盖、开发者消息误标、导出内容缺失，导出准备阶段未被卸载等待，刷新间隔超过系统定时器范围，预先取消请求仍创建读取操作，自有协议缺少显式 nativeTurnId，以及导出解码丢失 UTF-8 BOM。对应断言通过后保留在测试中。增量读取、查询与来源等先前共享支撑已有实现的部分，先补集成验证并记录实际通过结果。浏览器额外发现窄窗详情无法直接阅读、跳到最新的选择被延迟状态更新覆盖、切换回合短暂显示上一轮详情，修复后按 B03/B04/B01 重测通过。

## 浏览器步骤与观察

B01：实际 Chrome 打开 `http://127.0.0.1:60000/`，选择「测试调用 Codex CLI插件」→「Codex Trace」。切换问候与翻译回合，分别显示 gpt-5.6-luna low/high、2/5 次响应、1/4 次调用和源耗时。选择「仅异常」只显示 limit=4000 失败，概览仍显示翻译整轮的 4 次调用；清除后可看成功读取/写入/读回。打开原文显示该调用的 3 个来源，查询与明细保留原值。最终切换回合时详情先显示选择提示，再装载新轮内容。实际控制台 error 记录为空。截图位于本机 `.kongming/trace-evidence/session-trace.png`。

B02：本机隔离验收页使用真实 TraceView、DSH Button/Toast/主题、Fetch 路由和临时文件读取器。打开记录，注入 entry 失败后选择文件调用：列表、概览保留，详情显示可重试原因；解除后重试成功。再注入 snapshot 失败：原记录和最后成功时间保留；解除后重新读取成功。文件读取器的故障恢复另由 reader 集成测试覆盖。

B03：在隔离页以 420×900 打开文件调用，详情出现「返回记录列表」，返回后保留原选中项；切换测试页深浅主题均可阅读。验收页面自身的主题不改变用户 KMH 偏好。截图为本机 `/private/tmp/codex-cli-trace-light.png`、`codex-cli-trace-narrow-detail.png`；视口覆盖已复位。

B04：在隔离页停留失败调用，追加文件记录；下一次读取出现「有新记录」，原选中项、详情及列表 scrollTop 保持。点击「跳到最新」后显示追加内容。曾观察到跳转保留旧选中项，捕获跳转标记并加入查询代后复测成功。半行、停止增长、源变化的细节由真实临时文件集成测试补充。

B05：隔离页启用 snapshot barrier，依次切 B→A→B，再释放 A 的迟到请求；B 保持「当前会话暂无 Codex CLI 记录」，导出按钮禁用。页面装卸取消请求与计时，独立时钟测试核对后续回调停止；宿主取消与两个进程的资源释放由真实文件测试覆盖。

B06：临时关闭实际 profile 中 trace 实例，浏览器的「Codex Trace」标签移除，「对话」「轨迹」「上下文」仍可使用；恢复实例后同一历史可查。读取器/路由集成在执行插件缺席的环境中运行，直接读取保留的对应关系与 CLI 文件。临时装卸和监听配置已移除；实际 Web PID 57269 保持运行。

B07：隔离页注入 export 503，再点导出：全局 Toast 显示读取失败，已有内容和选择保留，按钮恢复可操作。HTTP 错误、坏 JSON、流取消与源变更另由 client/export 集成断言覆盖。成功下载以 A01 的实际磁盘文件核对。

## 真实历史与导出

A01：从实际 KMH 的翻译回合页面点击「导出记录」。浏览器显示「记录已交给浏览器保存」。已保存文件为用户指定的文稿目录：

`/Users/kid/Documents/codex-cli-trace-session-6cf9ce86-f53d-4b21-b92b-10bba76f492e-20261015T054923550Z.json`

本机校验使用 TraceExportSchema 解析文件，从 records 重建原始字节，再与当前 CLI 来源的 `[0, completeByteEnd)` 比较。结果：2 轮、61 条完整记录、408851 字节、汇总 422808 token；字节相同，SHA-256 相同：`3736679b43c1f1fd994ccbe4f293160ebd917fb28e05513595097dc3f3b48e94`。即使页面只显示一轮或异常筛选，导出仍包含两轮全部完整原文。浏览器下载事件监听曾超时，实际文稿目录文件和内容核验提供最终磁盘证据。

A02：最终构建直接通过同一 TraceReader/export 模块只读核查真实历史，读取前后分别计算 CLI 文件及对应关系文件摘要。两份来源保持相同；导出摘要与 A01 一致；dispose 后 readers=0、inFlight=0。本机数值和资源结果位于 `.kongming/trace-evidence/real-session-check.json`。原始个人记录与导出文件保留在本机，仓库收录测试使用脱敏合成记录。

## 验证边界

本次覆盖已确认的本地 JSONL 和现有对应关系链路，包含实际 Web 展示与磁盘导出。未来 CLI 保存格式通过未知类型和缺口说明保留原文；已有数据中缺少的耗时、用量或技能事实按缺失显示。验证结果对应所列基线和本机版本。

A03：字段对齐后，通过最终构建的同一 exportTrace/TraceExportSchema 再次生成完整文件，按用户明确要求以独占新文件方式保存至文稿目录：`/Users/kid/Documents/codex-cli-trace-session-6cf9ce86-f53d-4b21-b92b-10bba76f492e-20261015T061120180Z.json`。再次核对 61 行、408851 字节、422808 token、两个显式 nativeTurnId 及相同 SHA-256。本机证据为 `.kongming/trace-evidence/final-export-check.json`。A01 的浏览器下载文件保持原样。

V06：对最终运行服务发起无登录信息的 snapshot 请求，返回 HTTP 401；实际已登录浏览器可读。认证边界沿用既有连接服务。最终协议字段对齐后实际 Web 再次加载并显示同一轮数值与可用详情。
