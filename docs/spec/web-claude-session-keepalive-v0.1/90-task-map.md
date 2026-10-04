# 90 Task Map

## 优先级（v0.1，已按用户痛点反转旧版）

| Priority | Task | Scope | 原子性 |
| --- | --- | --- | --- |
| **P0** | Claude WS app-level heartbeat | `claude-ws.ts` 加心跳状态机 + `route.py::_dispatch` 加 ping 处理 | **前后端必须同 commit** |
| **P0** | visibilitychange 立即重探 | `useClaudeCodeWS.ts` 加监听 + `claude-ws.ts` 加 `probe()` 方法 | 纯前端可独立 |
| **P0** | latency 真值上报 | `claude-ws.ts` 加 `onLatency` 回调 + `useClaudeCodeWS.ts` 把 RTT 传给 `setClaudeWs`（替换硬编码 `null`） | 跟 P0 心跳一起做 |
| **P1** | 顶栏 Claude 连接球渲染验收 | `Layout.tsx` 已有逻辑，验证 latency 数字显示，必要时补 `ConnectionIndicator` props | UI 验证 |
| **P1** | 配置真源接线 | `useClaudeCodeWS.ts` 调 `useHeartbeatConfig()` 传给 socket 构造函数 | 跟 P0 心跳一起做 |

## 已落地（不在本次实施清单内）

- ✅ `connectionStatusStore.claudeWs*` 字段
- ✅ `useClaudeCodeWS` 调 `setClaudeWs`（但 latency 传 null）
- ✅ `useHeartbeatConfig` hook（被 generic_chat 复用，本次复用即可）
- ✅ `SessionManager.is_active` / `replace_writer`（v0.2 才用，本次不动）

## 推到 v0.2（另建 spec）

- ❌ reconnect 后 `check-session-status` 自动调用
- ❌ `replace_writer` 续接活跃 run
- ❌ `claude_history` backfill 已落盘内容
- ❌ history vs live 去重规则

## task 包结构（v0.1 待建）

建议 1 个 task 包覆盖 P0 三项（同 commit 上线）+ 1 个 task 包覆盖 P1：

```
dev-pipeline/tasks/
  claude-ws-keepalive-v0.1/         # P0 三项打包：心跳 + visibilitychange + latency
    README.md
    dev-checklist.md
    diagram.html
  claude-ws-indicator-v0.1/         # P1 顶栏渲染验收（可选拆分）
    README.md
    dev-checklist.md
```

或者 P0 + P1 合并成单 task 包 —— 由 x-req skill 在开搞时决定。

## 已落地（本次提交覆盖 P0 + 2 个 P1）

- Claude 顶栏连接球
- Claude app-level heartbeat（`ping/pong` + RTT + missed pong 重连）
- reconnect 后自动 `check-session-status`，活跃 session 走 `replace_writer` 续接
