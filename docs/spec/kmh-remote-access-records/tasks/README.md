---
description: Remote 保存与本机查看任务的需求分配及开发验收入口。
---

# Remote 访问记录任务

2026-10-23 用户回复“同意，走 req dev verify”，承接已确认的 spec v4 与技术设计。保存和查看共用记录约定、文件与查询链路，合并为一个可独立交付的任务。

[task-access-records-core](task-access-records-core/dev-checklist.md) 承接 feat01、feat02 的全部 13 个场景，共 15 行；T1 为公共约定与构建，T2—T14 为场景实现，T15 为 Remote 回归、浏览器和覆盖率对账。用例主定义见[技术设计](../tech-design.md)，确认时的可读内容保存在任务 baselines/。

| 场景         | 唯一用例 | 任务行 |
| ------------ | -------- | ------ |
| feat01 场景1 | SAVE-01  | T2     |
| feat01 场景2 | SAVE-02  | T3     |
| feat01 场景3 | SAVE-03  | T4     |
| feat01 场景4 | SAVE-04  | T5     |
| feat01 场景5 | SAVE-05  | T6     |
| feat01 场景6 | SAVE-06  | T7     |
| feat01 场景7 | SAVE-07  | T8     |
| feat01 场景8 | SAVE-08  | T9     |
| feat02 场景1 | VIEW-01  | T10    |
| feat02 场景2 | VIEW-02  | T11    |
| feat02 场景3 | VIEW-03  | T12    |
| feat02 场景4 | VIEW-04  | T13    |
| feat02 场景5 | VIEW-05  | T14    |

[开发结果](task-access-records-core/dev-report.md)包含逐场景证据与全仓检查限制；[技术验收](verify-tech-access-records.md)记录设计和规范核对。
