---
description: Codex CLI Trace 已确认方案的任务顺序、功能和用例责任索引，新增插件统一位于 packages/codex-cli-trace。
---

# Codex CLI Trace 开发任务

[功能规格](../spec.md)与[技术设计](../tech-design.md)于 2026-10-15 经用户确认，新增插件目录为 `/Volumes/machub_app/proj/kongming-os/packages/codex-cli-trace/`。本次拆解覆盖 11 个功能、56 个场景和 27 个设计用例，4 个 task 已完成开发，18/18 行通过；逐项执行证据见[验证记录](evidence/verification.md)。

Spec 基线：`dd4f42bde6efacfdbc32b2992834a6bfccd0c01e499db4a0d5fc78efa30fe01b`。技术设计基线：`0.1-confirmed1`，`46a898077c462a62d93a7d09dbebca88e148c713a7683c9dc36e6d3c5eabc778`。

| 顺序 | 任务                                                                | 负责功能                                                       | 设计用例                                                                            | 清单行数 | 高风险行       |
| ---- | ------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------- | -------------- |
| 1    | [插件基础与共享协议](task-trace-foundation/dev-checklist.md)        | 公共技术支撑                                                   | 构建与协议支撑                                                                      | 2        | None           |
| 2    | [独立会话记录查看](task-session-trace-view/dev-checklist.md)        | feat01、feat02、feat03、feat05、feat06、feat07、feat08、feat10 | T01、T02、T03、T04、T05、T06、T10、T11、T12、T13、T14、T15、T16、T17、T18、T23、T24 | 8        | T1、T6、T7、T8 |
| 3    | [用量统计与文件增量更新](task-trace-usage-refresh/dev-checklist.md) | feat04、feat09                                                 | T07、T08、T09、T19、T20、T21、T22                                                   | 4        | T2、T3、T4     |
| 4    | [当前会话记录导出](task-session-trace-export/dev-checklist.md)      | feat11                                                         | T25、T26、T27                                                                       | 4        | T2、T3、T4     |

先完成公共包与协议，再实现独立的会话查看能力，随后补齐用量与文件更新，最后完成导出。各 task 的开发结果记录在同目录 dev-report.md，规格对账与技术验收按各 task 的明确责任范围执行。

C1–C6 的机制与用例关系以技术设计追溯表为准：C6 由查看任务的 T1/T8 承接用例 T01 的包位置与独立装载核对；其余用例按上表主责任分配。实现完成以各 task 的 dev-report 与后续验收记录为依据。

四个 task 的 x-verify-spec 对账均已通过：基础 2 行、查看 8 行、用量/更新 4 行、导出 4 行；技术结果见[验收报告](../verify-tech.md)。最终插件测试 42/42，既有回归按证据索引分批通过。
