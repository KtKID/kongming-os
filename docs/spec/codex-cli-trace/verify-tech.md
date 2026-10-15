---
description: Codex CLI Trace 已确认技术设计的实现符合性验收结果。
---

# Codex CLI Trace 技术验收

2026-10-15，范围为四个 task 的 KMH 插件、接入配置和相关测试，承接 D01–D11、C1–C6 与 T01–T27。用户已确认技术设计并授权 req/dev/verify。功能规格和设计内容基线沿用[任务索引](tasks/README.md)；源码基线为 Git `ee49ba08ec4d35dc6fdbcab0e180f54fff63e658` 加[39 个相关文件的内容指纹](tasks/evidence/baseline.json)，文件集合 SHA-256 为 `26fd55d6b5f287d3464ca5bc5e02f4f28612dabbf74cd29f9532a69618636586`。

整体通过：14 项适用检查通过，失败 0，未验证 0；R3 跨语言协议按已确认设计不适用。验证使用 macOS、Node 25.6.1、pnpm 11.7.0、已有 CLI 0.162.0-alpha.17.2 保存的记录。执行命令、测试机制、浏览器步骤和文件摘要见[证据索引](tasks/evidence/verification.md)。

## 适用项证据

| 设计/规范 | 实际代码与审查方法 | 实际结果与证据 | 结论 |
| --- | --- | --- | --- |
| D01；R1；C1/C6；根 AGENTS | package exports、src/index.ts/apply、profile 的独立实例；审查依赖及 ctx.effect 所有权 | 包位于指定 packages；执行插件缺席的 Host/文件集成可读；B06 实际装卸移除/恢复标签，T22 取消与归零。浏览器 bundle 检查保持文件与子进程模块在 Host | 通过 |
| D02；R2/R5；C2/C5 | protocol 唯一 Zod 边界，bindings/source 当前 ID 与文件头核对，web 请求严格校验，client 使用同一协议 | KMH sessionId、CLI nativeSessionId/nativeTurnId、条目 entryId 分开；T03/T04、坏字段与越根链接通过，实际未认证 HTTP 返回 401，已登录 Web 可读 | 通过 |
| D03；C2 | TraceView 按 session 取消请求，chooseTurn 保持选择；当前 session 守卫和回合详情清理 | T03/T05/T06、B01/B03/B05；默认、主动回看、窄窗和延迟 A→B 均通过，回合切换先清空旧详情 | 通过 |
| D04；R4；C3 | projector 唯一响应去重、逐字段求和、最后有效回合累计快照核对；token_count 独立来源 | T07–T09；真实 115295/307513 token、缓存 56832/237568；重复累计、0、部分字段和冲突均按来源显示；A02/A03 与原文一致 | 通过 |
| D05；C3 | project 按行序、明确 ID 合并，角色和可见摘要按保存值命名，未知记录保留来源 | T10–T13；B01 实际 low/high、失败恢复可查，开发者消息和完成后未归属记录的回归通过 | 通过 |
| D06；C3 | 详情保留完整参数/返回及多份 raw，kmh-skill 与文件工具按明确名称分开；JSX 文本渲染 | T14/T15、query 长文本/中文跨块集成和 B01；问候技能 1 次，翻译工具 4 次，长返回保留原文入口 | 通过 |
| D07；C3 | 使用 CLI duration_ms、time_to_first_token_ms、工具 secs/nanos；计时条目提供来源 | T16、A02/B01；0/缺失/冲突分别处理，源耗时与首输出数值一致 | 通过 |
| D08；R7；C3 | reader.timeline 完整事实查询及分页，detail 按来源范围重读；请求取消和独立错误区 | T17/T18、B01/B02；过滤不改变概览，长结果末尾可命中，详情故障保留列表并重试恢复 | 通过 |
| D09；R6/R7；C1/C5 | readLines 完整行边界、内存读取代、串行 poll、idle/abort/dispose；权威常量及配置范围 | T19–T22；中文半行、替换/截短、重复/并发、预取消、两独立进程、隐藏/关闭和阅读位置通过；刷新上限防止系统计时器溢出 | 通过 |
| D10；R4；C3/C5 | SourceRef 行号/字节区间、原文 digest 核对，未知/损坏/缺口有来源 | T23/T24；坏行后继续读取，改变源拒绝旧代；A02 真实源及绑定哈希保持 | 通过 |
| D11；R4/R7；C4/C5 | exportTrace 固定截止、两遍字节校验、坏 UTF-8 base64、BOM 原样保留；流纳入 reader 生命周期；receiveExport 完整校验后保存 | T25–T27；并发追加、长记录、坏行/半行、截短/改写、取消/卸载通过。A01 浏览器磁盘下载；A03 最终文稿 JSON 61 行、408851 字节、422808 token，摘要与来源一致 | 通过 |
| 严格 TS 与公开包导入 | Host/Client 严格 tsconfig、z.infer、公开 DSH 包入口；实际运行 build/typecheck/lint | 全部退出 0；最终 42/42 测试通过，零跳过；浏览器实际装载与控制台无 error | 通过 |
| UI/文档规范 | dsh-client-ui-ux、kmh-doc、kmh-prose-standard；现有主题 token、Button/Toast、shell.overlay、会话槽位及包 README 单点说明 | B01–B07 覆盖深浅、窄窗、反馈与选择；配置/使用说明归包 README，profile 与插件索引链接；源文件与执行状态保持 | 通过 |
| 测试可靠性 | kmh-ci-test-reliability；私有 mkdtemp、可控时钟/barrier、独立进程及清理等待；根 HMR 测试 | 最终包内 42/42；既有回归 248 项分批通过。HMR fixture 的漏包问题修复后实际启动/热更新两次通过，保留既有工作区及并发修改 | 通过 |

R3 不适用：新协议的生产端、消费端与校验都属于本插件的 TypeScript 代码；CLI JSONL 保持外部输入适配的定位，与已确认设计一致。

## 验收闭环与限制

技术检查先发现预取消请求仍分配读取操作、协议原生回合标识命名偏差，以及 UTF-8 BOM 导出字节丢失。分别回到开发增加入口取消检查、统一自有 ID 字段、保持 BOM；目标断言均先失败，随后连同全包回归通过。相应测试保留在 reader/source/export 测试文件，源码与新增测试已计入最终内容基线。

验收以当前配置、已保存字段和所列用例为范围。未来 CLI 格式、现有文件中缺失的事实通过未知类型/缺口说明呈现。完整个人导出和截图保留在证据索引列出的本机目录。现有服务持续运行，临时验收配置已移除；提交与推送仍由用户授权决定。
