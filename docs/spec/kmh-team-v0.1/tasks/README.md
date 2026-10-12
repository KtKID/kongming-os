# kmh-team 任务分配

功能规格已由用户确认；技术设计 v0.1-1 经用户要求“走x-req dev verify-spec”确认。任务按下表顺序执行，公共协议在首个任务建立，后续引用既有接口。每个 feat 的全部场景归一个任务所有。

spec SHA-256：`da9d0e50c2428ff12e33bd9db8406342465cc0ce500a656a96984dda4c50c6ac`。tech-design v0.1-1 原文 SHA-256：`29166ae488ecbff34c4a0b4591d43c6b050ab24e23bb58913473504ff03dcbf0`。

| 任务 | 承接 feat | 场景数 | 清单行数 |
|---|---|---|---|
| [task-role-library](task-role-library/dev-checklist.md) | feat01 | 6 | 2 |
| [task-team-config](task-team-config/dev-checklist.md) | feat02, feat05 | 17 | 2 |
| [task-team-execution](task-team-execution/dev-checklist.md) | feat03, feat04, feat07 | 18 | 3 |
| [task-team-transcript](task-team-transcript/dev-checklist.md) | feat06, feat08 | 18 | 2 |

总计 8 个 feat、59 个场景、9 行。高风险行必须具有可定位的 smoke/Web/重启执行证据；dev-report 保留验证结论，对应 test 与执行记录提供场景结果映射。

四个任务的执行清单与 dev-report 已闭合，开发证据集中在 [evidence.md](evidence.md)。tech-design 实施对齐节记录实际接口位置，原确认正文保持上述 hash；spec 及 constraints 内容保持原基线。任务报告中的测试子集共享真实 smoke，测试数与场景数分别统计。
