---
description: 当前 KMH 插件规格、实施记录和待评审方案的入口，按各规格声明的范围与状态使用。
---

# Spec 索引

当前插件的使用方法与限制见各包 README；本索引列出现行规格、任务记录和待评审方案。规格中的验收目标按对应任务核对实际实现。

| Spec | 状态 | 说明 |
| --- | --- | --- |
| [Remote 访问记录](kmh-remote-access-records/spec.md) | 核心规格 v4，设计已确认；保存与查看已实现（2026-10-23） | 保存与本机查看两个功能，13 个场景各对应一条测试用例；[技术设计](kmh-remote-access-records/tech-design.md)与[开发验收记录](kmh-remote-access-records/tasks/README.md) |
| [kmh-team-v0.1](./kmh-team-v0.1/spec.md) · [技术设计](./kmh-team-v0.1/tech-design.md) | 开发完成 | 功能规格与技术设计已确认；[任务交付记录](./kmh-team-v0.1/tasks/README.md)包含实现范围及场景证据 |
| [kmh-mobile-butler-v0.1](./kmh-mobile-butler-v0.1/spec.md) | 待评审 | 移动端管家统一委派给 Codex 或 ZCode，遵循用户选择并接收执行报告 |
| [Codex CLI provider](codex-cli-provider/spec.md) | 现行规格 | 提示与工具接入、原生能力、审批、进度与产物验收；使用方法见[包说明](../../packages/codex-cli/README.md) |
| [Codex CLI 额度展示](codex-cli-quota-display/spec.md) · [技术设计](codex-cli-quota-display/tech-design.md) | 规格与设计已确认（2026-10-20），开发及验证完成 | 现有详情页查看额度、Credits 与重置卡，输入框额度跟随当前模型来源；[任务记录](codex-cli-quota-display/tasks/README.md)与[接口清单](codex-cli-quota-display/tech-design.md#quota-interface-map)包含低额度颜色提醒、限频和超时处理 |
| [Codex CLI Trace](codex-cli-trace/spec.md) | 规格与[技术设计](codex-cli-trace/tech-design.md)已确认（2026-10-15），[开发完成](codex-cli-trace/tasks/README.md)，[技术验收通过](codex-cli-trace/verify-tech.md) | 独立插件，在每个会话内查看与导出 CLI 历史、用量、工具与技能使用及原始记录；跟随本地文件更新 |
| [CLI 工具开关选择器](cli-tools-selector/spec.md) · [技术设计](cli-tools-selector/tech-design.md) | 规格与技术设计已确认（2026-10-14），开发中 | 独立插件 cli-tools-selector，在 Codex 插件详情页查看与切换工具开关；承接 Codex CLI provider 的 C1、C4 与 feat05 |
| [ZCode CLI provider](zcode-cli-provider/spec.md) | 部分交付，提示与宿主工具待接入 | 原生会话中继、登录与验证；实现差异见规格说明，使用方法见[包说明](../../packages/zcode-cli/README.md) |
| [模型请求停止与状态监督](kmh-zcode-cli-request-supervision/spec.md) | 规格与实施记录 | 请求状态、停止确认、挂起与证据，按[开发记录](kmh-zcode-cli-request-supervision/tasks/task-request-state/dev-report.md)核对交付范围 |
| [kmh-infra 服务插件 v0.1](kmh-infra-plugin-v0.1/spec.md) · [技术设计](kmh-infra-plugin-v0.1/tech-design.md) | 规格与技术设计已确认（2026-10-16），开发完成，[技术验收通过](kmh-infra-plugin-v0.1/verify-tech.md) | 侧栏 Infra 入口、内嵌 x-dash 面板、插件详情页配置与只读服务查询接入；[任务清单](kmh-infra-plugin-v0.1/tasks/)含逐项场景证据 |
| [聚合 Token 分析视图 v0.1](aggregated-token-analysis-view-v0.1/spec.md) · [技术设计](aggregated-token-analysis-view-v0.1/tech-design.md) | 规格与技术设计已确认（2026-10-18），开发完成，[技术验收](aggregated-token-analysis-view-v0.1/verify-tech.md)主要项通过、停用相关子场景待补；[任务清单](aggregated-token-analysis-view-v0.1/tasks/)含逐项证据 | 第三个服务插件 `@kmh/aggregated-token-analysis`：侧栏"Token 分析"入口、内嵌打开 x-token 的聚合 Token 分析页、插件详情页填写页面地址与加载超时；KMH 只展示、不加工数据 |
| [x-music 服务插件 v0.1](xmusic-plugin-v0.1/spec.md) · [调查记录](xmusic-plugin-v0.1/findings.md) | 第一阶段开发完成并验证（2026-10-18，侧栏入口 + 内嵌打开 Board）；第二阶段（MCP 工具、配置表单、超时提示）未排期 | 第四个服务插件 `@kmh/xmusic`：侧栏 x-music 入口、内嵌打开 Board（60070）；MCP 工具（streamable-http，3001）与配置表单列第二阶段，MCP 建议由 profile 直接声明实例接入 |
| [KMH SDK 审批桥接](kmh-sdk-approval/spec.md) | 待评审 | SDK 客户端审批与 KMH 维护归属 |
| [Agent OS 第一版服务接入](agent-os-v1/README.md) | 待评审 | 服务适配插件、统一入口与长期愿景，按文中已确认方向和待评审设计分别使用 |
