# cron-delivery-v0.3

> 状态：方案确认中
> 目标：给 cron 模块（v0.2 已上）补一层独立的 delivery 层 + web 管理页，让 cron 触发结果"看得见、能管理"，而不是悄悄落到 jsonl 里没人看。

## 系统目标

cron v0.2 解决了"任务能定时跑"的问题，但留下两个用户体感断档：

1. **跑了等于没跑**：fresh agent 跑完只把 `final_message_excerpt` 落到 `.kongming/cron/runs/*.jsonl`，CLI 终端不显示，web 也没地方看。`silent_marker_enabled: true` 默认开，等于"主动静默"。
2. **任务无法管理**：除了让 LLM 调 schedule_tool 创建之外，没有任何"看 / 暂停 / 删"的入口。用户要查"我之前那个 50 分提醒到底跑没跑"只能去 `.kongming/cron/scheduled_tasks.json` 翻 JSON。

v0.3 一次性解决这两件事 —— 加 delivery 层 + 加 web `/cron` 页。

## 范围边界

**包含**：

- delivery 层抽象：硬编码 `Literal["web", "cli"]` 两个 channel；不做 Protocol 插件化
- 投递目标统一为"系统消息池"（不再绑定 thread）；web 端走独立路由 `/cron` 的「触发记录」tab
- web `/cron` 页：「任务列表」+「触发记录」两 tab，看 / 暂停 / 删除
- 顶部入口按钮 + 未读红点（lastSeenRunAt → 现在之间有 completed run 即亮）
- CLI delivery：下次提示符前 flush 模式
- schedule_tool 输入 schema 加 `delivery.channel`（target 概念取消）
- store schema v2 → v3 migration（带 `.v2.bak.<ts>` 备份）
- v0.2 隐性 bug 一并修：fresh session 不落盘问题

**不包含**：

- feishu / email / Slack / 远端 push 等扩展 channel（保留接口位但不实现）
- web 表单创建 cron 任务（仍然只让 LLM 通过 schedule_tool 自然语言创建）
- cron 列表页的"修改任务"（只能暂停 / 删除 / 重建）
- 跨用户 / 跨 workspace 的 cron 共享
- thread 过滤 / 任务分组 / 多用户隔离
- 流式投递（cron 永远非流式，结果一次性 final_message）

## 模块导航

| 模块 | 状态 | 文档 | 是否可进 task | 说明 |
|------|------|------|---------------|------|
| M1 数据契约 & 迁移 | 方案确认 | [02-module-breakdown.md#m1](./02-module-breakdown.md#m1-数据契约--迁移) | ✅ 是 | schema v3 / RunRecord 字段 / Delivery 结构 |
| M2 fresh session 落盘修复 | 方案确认 | [02-module-breakdown.md#m2](./02-module-breakdown.md#m2-fresh-session-落盘修复) | ✅ 是 | v0.2 隐性 bug，独立 task 先修 |
| M3 ExecutionBridge delivery 路由 | 方案确认 | [02-module-breakdown.md#m3](./02-module-breakdown.md#m3-executionbridge-delivery-路由) | ✅ 是 | 跑完 → 路由 → 投递 → 写状态 |
| M4 Web Delivery（系统消息池）| 方案确认 | [02-module-breakdown.md#m4](./02-module-breakdown.md#m4-web-delivery系统消息池) | ✅ 是 | 落盘 + WS 广播 + 红点状态 |
| M5 CLI Delivery（提示符 flush）| 方案确认 | [02-module-breakdown.md#m5](./02-module-breakdown.md#m5-cli-delivery提示符-flush) | ✅ 是 | 不打断输入，下次提示符前打印 |
| M6 Web REST API（cron 管理） | 方案确认 | [02-module-breakdown.md#m6](./02-module-breakdown.md#m6-web-rest-apicron-管理) | ✅ 是 | 4 endpoint + 2 WS event |
| M7 Web 前端（/cron 页）| 方案确认 | [02-module-breakdown.md#m7](./02-module-breakdown.md#m7-web-前端cron-页) | ✅ 是 | 独立路由 + 两 tab + 红点 |
| M8 schedule_tool 协议升级 | 方案确认 | [02-module-breakdown.md#m8](./02-module-breakdown.md#m8-schedule_tool-协议升级) | ✅ 是 | input schema 加 delivery |

8 个模块全部可进 x-req（无未决边界），按依赖顺序拆 task 即可。

## 文档导航

- [目标与边界](./01-goals-and-boundaries.md)
- [模块拆分](./02-module-breakdown.md)
- [核心流程](./03-core-workflows.md)
- [数据与状态](./04-data-and-state.md)
- [验证与演进](./05-validation-and-evolution.md)
- [Task 映射](./90-task-map.md)

## 当前建议

1. **建议直接拆 8 个 task** 进入 x-req → x-plan → x-dev 流程，依赖顺序 `M1 → M2 → M3 → (M4 ∥ M5) → M6 → M7 → M8`
2. **M2 优先级最高**：v0.2 隐性 bug，单独先修能立即提高 cron 可调试性，独立 commit
3. **建议合并 M4 + M5 + M3 为同一个 task**：三者通过 RunRecord delivery 字段强耦合，分开做反而要互相 stub
4. **M8 留到最后**：依赖 M3 的 delivery 路由稳定后再改 schedule_tool 输入 schema，避免协议变更两次
5. **总工作量预估 10-14 小时**（比初估 8-12 略上调，因为 M2 这个隐性 bug 排查 + 修复成本要单算 1-2 小时）

## 已锁定的设计决策（不可推翻）

| # | 决策 | 选定 | 理由 |
|---|---|---|---|
| 1 | 触发后呈现 | 独立系统消息区 | cron 任务和创建会话不一定有关系，强行进 thread 会污染历史 |
| 2 | delivery 模型 | 硬编码 `Literal["web", "cli"]` | 当前只两 channel，过度抽象成本高 |
| 3 | cron 列表页位置 | 独立路由 `/cron` | cron 是跨 thread 资源，独立页符合资源模型 |
| 4 | LLM 回复模式 | 非流式 | cron 用户不在场，不需要打字感 |
| 5 | channel 范围 | web + cli | 远端 push 留接口位但不做 |
| 6 | 列表页功能 | 看 + 暂停 + 删除 | LLM 自然语言创建已够用，表单不优 |
| 7 | target 概念 | 取消 | 不绑定 thread，所有结果统一进系统消息池 |
| 8 | UI 容器整合 | `/cron` 两 tab + 红点 | 不做单独通知中心 UI，复用 `/cron` 页 |
