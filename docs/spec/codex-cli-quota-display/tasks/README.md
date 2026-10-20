---
description: Codex 额度展示任务分配、确认基线和逐项验收入口。
---

# Codex 额度展示任务

2026-10-20 用户确认技术设计，授权 req、dev、verify，并追加 spec C1–C3。执行顺序为详情页与共享读取，再做输入框和显示设置。规格与设计的内容基线记录于 `baselines.json`。

| task | 承接范围 | 用例 |
| --- | --- | --- |
| [task-quota-details](task-quota-details/dev-checklist.md) | feat01 场景1–6，feat02 场景1–4；C1–C3 | T01–T07、T19 |
| [task-quota-composer](task-quota-composer/dev-checklist.md) | feat03 场景1–10，feat04 场景1–9；C1–C3 的浏览器消费与模拟边界 | T08–T18，并引用 T03、T19 |

真实账号验证只读、低频。账号失效与切换采用模拟通知；账号登出、注销操作属于测试禁止项。

## 交付记录

- [详情页与共享读取](task-quota-details/dev-report.md)
- [输入框与显示设置](task-quota-composer/dev-report.md)
- [技术符合性验收](tech-verification.md)

两份清单共8行、规格29个场景完成。根回归538项、聚焦验收26项通过；三个含账号登出调用的用例依用户限制排除。实际环境与模拟边界以各报告为准。


## 统一界面跟进

[统一额度界面](task-quota-ui.md) 维护本轮 UI 调整的局部设计、前后基线和验收；26项聚焦回归、交付对账与技术验收通过。

## 超时修复与接口记录

[超时修复报告](../../../../reports/fix/fix-report-20261020-181000.md)记录浏览器 30 秒截止、冷却等待终态、CLI 初始账号通知处理及真实 Web 验证。最终回归 80 项通过，覆盖宿主额度、客户端及原有 Codex 模块；此前 26 项和根回归 538 项按各自历史基线保留。参考插件接口、字段映射和公共服务统一见[接口接入清单](../tech-design.md#quota-interface-map)。截图和原始运行记录保留在本地，仓库保存规格、验收结论及脱敏摘要。
