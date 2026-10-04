# 90 Task Map

## v0.1 任务包（**唯一一个**）

`dev-pipeline/tasks/network-layer-claude-keepalive-v0.1/` —— A + B1 合一，单个 PR 单个 commit。

### 任务范围细分（仅供任务包内部 dev-checklist 拆分参考，不是分开 PR）

| 步骤 | 后端 | 前端 |
| --- | --- | --- |
| **1. 新建 network 包骨架** | 建 `src/network/{__init__,manager,heartbeat,tools}.py` 空骨架 | 建 `web/src/network/{index,manager,heartbeat,tools}.ts` |
| **2. 实现 Heartbeat 类** | `heartbeat.py::Heartbeat`（server 侧：handle_inbound_frame）| `heartbeat.ts::Heartbeat`（client 侧：start/stop/handlePong/probe）|
| **3. 实现 NetworkManager** | `manager.py::NetworkManager` + `get_network_manager()` 单例 | `manager.ts::NetworkManager` + module-level singleton + visibilitychange 监听 |
| **4. tools 脚本** | `tools.py`（safe_send_json 等）| `tools.ts`（buildPingFrame / exponentialBackoff 等）|
| **5. import 边界配置** | `.importlinter` 的 `root_packages` 追加 `network` + 末尾加 Contract `network-self-contained` / `network-tools-private`（项目当前 Contract 1-10，新加为 11/12 位置）| `web/eslint.config.js`（flat config，非 `.eslintrc.cjs`）`tseslint.config(...)` 追加业务层禁 `@/network/tools` + `src/network/**` 解除限制 overrides |
| **6. 接入 Claude 频道** | `src/web/integrations/claude_code/route.py::_dispatch` 改为通过 `network_manager.register()` 注册 + `handle_inbound()` 路由 | `web/src/lib/claude-ws.ts::ClaudeCodeSocket` 改为不直接 new WebSocket，而是从 `useClaudeCodeWS` 调 `networkManager.openChannel("claude", threadId)` |
| **7. latency 上报** | （后端无需）| 让真实 RTT 灌入 `connectionStatusStore.claudeWsLatencyMs`，替换硬编码 `null` |
| **8. 测试** | pytest 单测（heartbeat / manager / route 接入 / import 边界）| vitest 单测 + playwright e2e |

## 优先级表（dev-checklist 用）

| Priority | Item | Scope |
| --- | --- | --- |
| **P0** | Heartbeat 类（前后端各一份）| 步骤 2 |
| **P0** | NetworkManager 类（前后端各一份）| 步骤 3 |
| **P0** | claude 频道接入 + 治痛点 | 步骤 6 |
| **P0** | latency 真值上报 | 步骤 7 |
| **P0** | tools 脚本 + import 边界生效 | 步骤 4 + 5 |
| **P0** | 单测 + e2e 全过 | 步骤 8 |
| **P1** | 顶栏 latency 数字渲染验收 | UI 验证 |

## 不属于本 task 包（v0.2 单独建包）

| 推到 task 包 | 内容 |
| --- | --- |
| `network-manager-generic-channel-v0.2/` (B1'-generic) | 第一段只接 generic：`/ws/threads/{threadId}` 已迁到 `NetworkManager.openChannel("generic", threadId)`；旧 `ThreadSocket/useWS/useStreamingRender` 前端链路已删除，endpoint、心跳、重连、listener 隔离能力由 NetworkManager 覆盖 |
| `network-layer-other-channels-v0.2/` (B1'-remaining) | 接 codex / thread-status / scheduler / workspace-shell + 删剩余内联心跳；generic 完成后再推进 |
| `network-layer-broadcaster-sweep-v0.2/` (B2) | 收编 3 个旧 broadcaster；废弃 `ApprovalInboxBroadcaster` / `CronWSBroker` / `thread_status_ws` 旧类 |
| `protocol-frame-type-unify-v0.1/` (C1，已完成 commit e1111ec/0936aec/f4af88e) | claude/codex 业务协议（`llm_protocol.py` 6 个 TypedDict + claude_code/codex normalizer/route/jsonl_history/approval/service + 前端对应 union + ClaudeCodeView/CodexView 白名单）。实际 ~38 文件 |
| `protocol-frame-type-residual-v0.1/` (C1.5 + C2 合并) | 剩余所有 wire 协议字段统一：generic 业务 union（`WSFrameC2S/S2C`）+ 心跳帧（`PingFrame`/`PongFrame`）+ SSE 进度帧 + `auto_approval_state` 跨通道 helper + `thread_status_ws` 出站 + `cron_ws/cron_delivery` + `global_approvals/broadcaster` + `ws_event_sink._translate`。约 40-50 文件，1 工作日 |
| `web-claude-session-resume-v0.2/` | reconnect 后自动 check-session-status + replace_writer + history backfill |

## 依赖图

```
v0.1: network-layer-claude-keepalive-v0.1 (本次)
        │ 测试通过 + 验证 5min 不掉线
        ├──→ v0.2: network-manager-generic-channel-v0.2  (B1'-generic)
        │          └──→ v0.2: network-layer-other-channels-v0.2  (B1'-remaining)
        └──→ v0.2: network-layer-broadcaster-sweep-v0.2  (B2)

独立轨道（不依赖 network 改造，任何时候都可做）:
        └──→ v0.1 或 v0.2: protocol-frame-type-unify-v0.1  (C)
```
