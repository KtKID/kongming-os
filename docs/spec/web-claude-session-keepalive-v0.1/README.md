# web-claude-session-keepalive-v0.1（已并入 web-network-layer-v0.1）

> ⚠️ **本 spec 已并入更大的网络层架构 spec。请去 [docs/web-network-layer-v0.1/](../web-network-layer-v0.1/README.md) 查看现行版本。**

## 历史背景

本目录是 5/19 ([`3e42ac8`](#)) 提出的最早保活方案，范围仅限 Claude 频道单频道保活，但 spec 内部存在以下软肋（在并入前的 review 中暴露）：

- 心跳被 spec 安排为内嵌在 `ClaudeCodeSocket` 里，违反"模块边界清晰，相关函数收拢"——实际项目内已有 3 处散落的心跳实现（`ThreadSocket` / `useThreadStatusWS` / 现要为 claude 加的第三处），重复
- 后端已有 3 个独立 broadcaster（`ApprovalInboxBroadcaster` / `CronWSBroker` / `thread_status_ws`）功能高度重叠，但本 spec 完全没提如何收编
- 字段命名混用 `kind` / `type`，本 spec 未规范

新 spec [`web-network-layer-v0.1`](../web-network-layer-v0.1/README.md) 把 keepalive 作为更大网络层抽象的**第一个落地切片**（仅 Claude 频道），同时为 v0.2 收编其他频道 / 收编旧 broadcaster / 协议字段统一预留了清晰路径。

## 本目录文件留作参考

- `01-goals-and-boundaries.md` — 旧版目标与边界
- `02-module-breakdown.md` — 旧版模块拆分
- `03-core-workflows.md` — 旧版时序图
- `04-data-and-state.md` — 旧版状态字段
- `05-validation-and-evolution.md` — 旧版验证
- `90-task-map.md` — 旧版 task map
- `architecture.html` — 旧版 mermaid

**这些文件不再维护，仅供历史追溯。**
