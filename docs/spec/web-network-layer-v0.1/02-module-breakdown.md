# 02 Module Breakdown

## 文件清单（v0.1 新建）

### 后端 `src/network/`

| 文件 | 类 / 导出 | 职责 |
| --- | --- | --- |
| `__init__.py` | 仅 `__all__` 导出 `NetworkManager`、`get_network_manager` | 模块入口 |
| `manager.py` | `class NetworkManager` + `get_network_manager()` 单例工厂 | 连接注册 / channel 路由 / lifecycle |
| **`heartbeat.py`** | **`class Heartbeat`** | **单连接心跳状态机**（per-connection 实例）；纯传输层无 channel 知识 |
| `tools.py` | 私有工具函数（连接清理、帧 schema 常量等）| **import-linter 红线：只允许 network/ 内 import** |

### 前端 `web/src/network/`

| 文件 | 类 / 导出 | 职责 |
| --- | --- | --- |
| `index.ts` | 仅 re-export `networkManager` | 模块入口 |
| `manager.ts` | `class NetworkManager` + `export const networkManager` 单例 | socket 池 / channel 管理 / visibilitychange 集中化 |
| **`heartbeat.ts`** | **`class Heartbeat`** | **单连接心跳状态机**（per-connection 实例）；同形态镜像后端 |
| `tools.ts` | 私有工具函数（reconnect 退避、ping/pong 帧 builder）| **eslint 红线：只允许 network/ 内 import** |
| `__tests__/` | vitest 单测 | 包含多 Heartbeat 实例并发测试 |

## 三层职责切片

```
NetworkManager (channel-aware, lifecycle)
    │
    │  per-connection 创建 / 销毁
    ↓
Heartbeat (channel-agnostic, 一连接一实例)
    │
    │  原语调用
    ↓
tools (纯函数 / 常量, network 内私有)
```

### Heartbeat 设计（**核心：多连接共用一脚本**）

按"心跳要单独脚本，将来多频道共用，做好多心跳连接并发扩展性"原则：

- **一个 `Heartbeat` 实例 = 一条连接的心跳状态机**（不是全局单例）
- `NetworkManager` 持有 `Map<connection_id, Heartbeat>`，N 连接 = N 个 Heartbeat 实例并存
- Heartbeat 类**纯被动**：内部不知道 socket、不知道 channel 类型，只通过 hooks 回调与外界交互
- 同一个 Heartbeat 类**前端后端各一份镜像**（接口同形态、TypeScript / Python 两套实现）

```python
# src/network/heartbeat.py（设计草图）

class HeartbeatHooks(Protocol):
    def is_open(self) -> bool: ...                       # 底层 socket 是否可写
    async def send_ping(self, ts_ms: int) -> None: ...   # 发一帧 ping
    async def close_for_reconnect(self) -> None: ...     # maxMissed 时主动断
    async def on_latency(self, rtt_ms: int) -> None: ... # RTT 回调（可选）

class Heartbeat:
    """单连接心跳；NetworkManager per-connection 实例化。"""

    def __init__(self, config: HeartbeatConfig, hooks: HeartbeatHooks) -> None: ...
    async def start(self) -> None: ...
    async def stop(self) -> None: ...
    async def handle_pong(self, ts_ms: int) -> None: ...  # 收到 pong 时调
    async def probe(self) -> None: ...                    # 立即发 ping
    @property
    def latency_ms(self) -> int | None: ...
```

```ts
// web/src/network/heartbeat.ts（设计草图）

export interface HeartbeatHooks {
  isOpen(): boolean;
  sendPing(ts: number): void;
  closeForReconnect(): void;
  onLatency?(ms: number): void;
}

export class Heartbeat {
  constructor(config: HeartbeatConfig, hooks: HeartbeatHooks);
  start(): void;
  stop(): void;
  handlePong(ts: number): void;
  probe(): void;
  get latencyMs(): number | null;
}
```

**v0.1 后端简化**：后端是 server 角色（被动响应 client 发的 ping），所以 `Heartbeat` 后端实现**只用 `handle_inbound_frame(frame) -> response | None`** 处理 inbound ping 并返回应回的 pong；不需要主动发 ping。但接口预留双向能力，v0.3 如果改成 server-push ping 不用动 client 端。

### NetworkManager 职责（v0.1 最小集）

```
后端 NetworkManager:
  ├─ 维护 connections: dict[conn_id, ConnectionInfo]
  ├─ 维护 heartbeats: dict[conn_id, Heartbeat]
  ├─ register(channel, ws) → conn_id        ← claude WS endpoint 调
  ├─ unregister(conn_id)                    ← onclose 时调
  ├─ handle_inbound(conn_id, frame)         ← 拦 ping 帧走 heartbeat；其他帧路由 channel handler
  └─ send(conn_id, frame)                   ← 业务侧发消息走这里

前端 NetworkManager:
  ├─ 维护 sockets: Map<conn_id, WebSocket>
  ├─ 维护 heartbeats: Map<conn_id, Heartbeat>
  ├─ openChannel(channel, threadId) → SocketHandle
  ├─ closeChannel(conn_id)
  ├─ on(channel, listener) / off(channel, listener)
  ├─ visibilitychange 监听（切回前台对所有 heartbeat 调 probe()）
  └─ 状态聚合 → connectionStatusStore
```

## tools 脚本（私有工具）

按你要求"必要时新增一个 tools 脚本放网络层工具函数，只允许 network 范围内调用"：

| `src/network/tools.py` 可能放的东西 | `web/src/network/tools.ts` 可能放的东西 |
| --- | --- |
| `safe_send_json(ws, payload)` —— 失败连接清理通用逻辑（抄自现有 fanout）| `buildPingFrame(ts) / buildPongFrame(ts)` —— 帧构造 |
| `make_connection_id()` —— UUID/uuid7 等 | `parseHeartbeatFrame(raw)` —— 解析 + 判别 |
| `WS_HEARTBEAT_FRAME_SCHEMA` 常量 | `exponentialBackoff(retryCount)` —— 重连退避计算 |

**严格规则**：tools 里的东西**只服务 `network/manager` 和 `network/heartbeat`**；如果某个工具发现要被业务层调用（如 claude_code/service.py），说明它**不属于 network 层**，应该重新评估归属。

## Import 边界（强制）

### 后端（import-linter）

项目根 `.importlinter` 文件已有 Contract 1-10。本次**追加 Contract 11 + 12**；同时**必须先**把 `network` 加进文件顶部 `[importlinter]::root_packages` 列表，否则两个 contract 不会被加载：

```ini
; 文件顶部已有的 [importlinter] 段，root_packages 列表追加 network：
[importlinter]
root_packages =
    core
    tools
    context
    executors
    host
    cli
    safety
    observability
    config_loader
    memory
    prompts
    evolution
    scheduler
    web
    network                    ; ← 新加这一行
source_paths = src
include_external_packages = True

; ---------------------------------------------------------------------------
; Contract 11: network 不依赖业务层
; ---------------------------------------------------------------------------
[importlinter:contract:network-self-contained]
name = network must not depend on business modules
type = forbidden
source_modules =
    network
forbidden_modules =
    web

; ---------------------------------------------------------------------------
; Contract 12: network.tools 仅 network 包内部可见
; ---------------------------------------------------------------------------
[importlinter:contract:network-tools-private]
name = network.tools is private to network package
type = forbidden
source_modules =
    core
    tools
    context
    executors
    host
    cli
    safety
    observability
    config_loader
    memory
    prompts
    evolution
    scheduler
    web
forbidden_modules =
    network.tools
```

`network-self-contained` 简化为禁 `network → web`：业务层全部在 `web` 包下，禁掉一条粗线比枚举 9 个子模块鲁棒（v0.2 收编旧 broadcaster 时不需要回头改这个 contract）。

### 前端（eslint）

项目用 **flat config**（`web/eslint.config.js`），非旧的 `.eslintrc.cjs`。在现有 `tseslint.config(...)` 数组里**追加两个配置对象**：

```js
// web/eslint.config.js
export default tseslint.config(
  // ... 现有配置 ...

  // 1) 业务层默认禁止 import @/network/tools
  {
    files: ["src/**/*.{ts,tsx}", "tests/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/network/tools", "@/network/tools/*"],
              message: "@/network/tools 是 network 包私有工具，只允许 @/network/ 内部 import",
            },
          ],
        },
      ],
    },
  },

  // 2) network 包内部解除该限制
  {
    files: ["src/network/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
);
```

flat config 用**后置配置覆盖前置**的语义，所以"解除限制"的对象必须放在"限制"的对象**后面**。
