---
description: 当前 KMH 插件规格、实施记录和待评审方案的入口，按各规格声明的范围与状态使用。
---

# Spec 索引

当前插件的使用方法与限制见各包 README；本索引列出现行规格、任务记录和待评审方案。规格中的验收目标按对应任务核对实际实现。

| Spec | 状态 | 说明 |
| --- | --- | --- |
| [kmh-team-v0.1](./kmh-team-v0.1/spec.md) · [技术设计](./kmh-team-v0.1/tech-design.md) | 开发完成 | 功能规格与技术设计已确认；[任务交付记录](./kmh-team-v0.1/tasks/README.md)包含实现范围及场景证据 |
| [kmh-mobile-butler-v0.1](./kmh-mobile-butler-v0.1/spec.md) | 待评审 | 移动端管家统一委派给 Codex 或 ZCode，遵循用户选择并接收执行报告 |
| [Codex CLI provider](codex-cli-provider/spec.md) | 现行规格 | 提示与工具接入、原生能力、审批、进度与产物验收；使用方法见[包说明](../../packages/codex-cli/README.md) |
| [CLI 工具开关选择器](cli-tools-selector/spec.md) · [技术设计](cli-tools-selector/tech-design.md) | 规格与技术设计已确认（2026-10-14），开发中 | 独立插件 cli-tools-selector，在 Codex 插件详情页查看与切换工具开关；承接 Codex CLI provider 的 C1、C4 与 feat05 |
| [ZCode CLI provider](zcode-cli-provider/spec.md) | 部分交付，提示与宿主工具待接入 | 原生会话中继、登录与验证；实现差异见规格说明，使用方法见[包说明](../../packages/zcode-cli/README.md) |
| [模型请求停止与状态监督](kmh-zcode-cli-request-supervision/spec.md) | 规格与实施记录 | 请求状态、停止确认、挂起与证据，按[开发记录](kmh-zcode-cli-request-supervision/tasks/task-request-state/dev-report.md)核对交付范围 |
| [KMH SDK 审批桥接](kmh-sdk-approval/spec.md) | 待评审 | SDK 客户端审批与 KMH 维护归属 |
| [Agent OS 第一版服务接入](agent-os-v1/README.md) | 待评审 | 服务适配插件、统一入口与长期愿景，按文中已确认方向和待评审设计分别使用 |
