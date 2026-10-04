# web-network-layer-v0.1

Web 网络层抽象：把分散在 6+ 处前端 `new WebSocket()` 和 3+ 处后端独立 broadcaster 的连接管理统一到 **`NetworkManager` 单例**，并把心跳逻辑下沉到**独立的 `Heartbeat` 脚本**（多连接共用）。

## v0.1 范围（严格守住）

```
[v0.1 本次]                                    [v0.2 之后]
┌─────────────────────────────┐               ┌─────────────────────────────┐
│ A  NetworkManager 骨架      │               │ B1' 其他频道接入            │
│    + Heartbeat 独立脚本     │               │     generic / codex /       │
│    + network/tools 私有     │   测试通过    │     thread-status /         │
│ B1 Claude 频道接入保活      │  ─────────▶   │     scheduler / shell       │
│    （治"1 分钟掉线"痛点）   │               │ B2  收编 3 个旧 broadcaster │
└─────────────────────────────┘               │ C   协议字段统一 frameType  │
                                              └─────────────────────────────┘
```

**v0.1 完成判定**：Claude 频道 5 分钟空闲不掉线 + 单测全过 + e2e 验证保活生效。在此之前**严格不动其他频道、不收编旧 broadcaster、不改协议字段**。

## 现状（NetworkManager 不是从零造，是收编 3 处散落）

后端已有：
- `src/web/ws_fanout.py::WebSocketFanout`（per-thread 多连接 fanout，**核心基础**）
- `src/web/approvals/global_inbox/broadcaster.py::ApprovalInboxBroadcaster` 单例
- `src/web/cron_ws.py::CronWSBroker` 单例
- `src/web/thread_status_ws.py` 模块级订阅者管理

这 3 个单例职责高度重叠（各自维护 `set[WebSocket]` + broadcast + 失败连接清理），v0.2 阶段 B2 统一收编。**v0.1 不碰**。

前端已有 6 处 `new WebSocket()`（`ws.ts` / `claude-ws.ts` / `codex-ws.ts` / `useThreadStatusWS.ts` / `scheduler/ws.ts` / `workspace-shell.ts`），v0.1 NetworkManager 只服务新增的 claude 路径。

## 文档导航

- [01-goals-and-boundaries.md](./01-goals-and-boundaries.md) — 范围、Success Criteria、Non-Goals
- [02-module-breakdown.md](./02-module-breakdown.md) — NetworkManager / Heartbeat / tools 三脚本职责
- [03-core-workflows.md](./03-core-workflows.md) — claude 保活完整时序图 + 多连接 Heartbeat 并发场景
- [04-data-and-state.md](./04-data-and-state.md) — 帧 schema + Heartbeat 状态字段 + import 边界规则
- [05-validation-and-evolution.md](./05-validation-and-evolution.md) — 测试矩阵 + 上线约束 + v0.2 演进路径
- [90-task-map.md](./90-task-map.md) — A+B1 task 拆分
- [architecture.html](./architecture.html) — 全景 mermaid

## 关键设计点（让你一眼看到）

1. **Heartbeat 是独立脚本**（`src/network/heartbeat.py` + `web/src/network/heartbeat.ts`），**不**内嵌在 NetworkManager 类里。每个连接一个 `Heartbeat` 实例，NetworkManager 持有 `Map<connection_id, Heartbeat>` —— **同时维护多连接心跳**就是 N 个独立实例并存，互不干扰
2. **Heartbeat 对 channel 一无所知**（不区分 claude / generic / codex），纯传输层逻辑；channel 业务知识只在 NetworkManager 层
3. **`tools.py` / `tools.ts` 是网络层私有工具**，import-linter + eslint 强制**仅 `network/` 内部可见**，业务层禁止 import
4. **v0.1 NetworkManager 是孤岛**（只服务 claude 一条线），不动现有 fanout / broadcaster / socket；v0.2 才"反向收编"
