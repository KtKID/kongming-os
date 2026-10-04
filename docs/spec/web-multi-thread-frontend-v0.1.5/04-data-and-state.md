# 数据与状态

## 1. LLMPreset schema

setting.yaml 新增段（建议）：

```yaml
web:
  enabled: true
  host: "0.0.0.0"
  port: 8080
  dev_mode: false
  cors_origins: []           # dev_mode=true 时填 ["http://localhost:5173"]
  idle_timeout_seconds: 1800
  pending_approval_timeout_seconds: 60
  llm_presets:
    - id: "openai-default"
      display_name: "OpenAI GPT-4"
      provider: "openai_compatible"
      base_url: "https://api.openai.com/v1"
      model: "gpt-4-turbo"
      api_key_env: "OPENAI_API_KEY"   # 从 env 读，不写明文
      reasoning_effort: null
    - id: "anthropic-default"
      display_name: "Claude Sonnet"
      provider: "anthropic"
      base_url: "https://api.anthropic.com"
      model: "claude-sonnet-4-6"
      api_key_env: "ANTHROPIC_API_KEY"
      reasoning_effort: null
    - id: "local-vllm"
      display_name: "本地 vLLM"
      provider: "openai_compatible"
      base_url: "http://127.0.0.1:8000/v1"
      model: "qwen-coder-7b"
      api_key_env: null               # 本地 endpoint 无需 key（命中 127.x 跳过校验）
      reasoning_effort: null
```

Pydantic 模型在 `config_loader/models.py` 加 `WebConfig` + `LLMPreset`。`api_key_env` 字段是用来取 env，不直接落 api_key 明文到 yaml。

`/api/presets` 返回时：脱敏 api_key（只回 id / display_name / model / base_url 摘要 / 是否需要 key），**不回 api_key 本身**。

## 2. ThreadMetadata schema

落盘文件：`.kongming/web/threads/<thread_id>/metadata.json`

```json
{
  "id": "thread-a1b2c3d4e5f6",
  "name": "代码助手 A",
  "preset_id": "openai-default",
  "created_at": 1745683200.0,
  "updated_at": 1745683500.0,
  "message_count": 12,
  "schema_version": 1
}
```

Pydantic：

```python
class ThreadMetadata(BaseModel):
    id: str
    name: str
    preset_id: str
    created_at: float
    updated_at: float
    message_count: int
    schema_version: Literal[1] = 1
```

`message_count` / `updated_at` 由 ThreadManager 在 turn.end 时增量回写（用一个去抖 task 防频繁 IO）。

## 3. ThreadCell（内存中）

```python
@dataclass
class ThreadCell:
    thread_id: str
    metadata: ThreadMetadata
    runtime: SessionEngine
    bridge: SessionBridge
    adapter: WebHostAdapter
    event_sinks: list[EventSink]
    pending_approvals: dict[str, asyncio.Future[bool]]   # call_id -> future
    last_active_at: float
    boot_lock: asyncio.Lock                              # 防并发 boot
    status: Literal["idle", "running", "awaiting_approval", "evicting"]
    current_run_task: asyncio.Task | None                # 当前 in-flight run_once task
```

不在 cell 里存：
- 消息历史（在 `runtime._sessions[thread_id]` 里，runtime 内部管）
- WS 实例（在 `adapter.ws` 里，重连可换）

## 4. 事件路由约束

由于 `core.contracts.Event` 没有 `session_id` 字段，**只有 run_id**，那么"按 thread_id fan-out"这件事在 runner 端是做不到的。我们的方案规避这个问题：

**每个 ThreadCell 自带一组私有 EventSinks**，不是全局共享 sinks。装配 SessionEngine 时，`event_sinks=[per_cell_jsonl, per_cell_ws_sink]` 只针对这一个 cell 的 runtime 注册。

这样 cell-A 的 runtime 推出来的 event 只会被 cell-A 的 sinks 看到，cell-B 看不到，**根本不需要按 session_id 路由**。

⚠️ 这种做法的代价：N 个 cell × M 个 sinks = N×M 个 EventSink 实例。但 sinks 都是轻量对象（一个 path / 一个 ws 引用），不是问题。

## 5. PendingApprovalMap

```python
pending_approvals: dict[str, asyncio.Future[bool]] = {}
# key = ApprovalRequest.call_id（runner 内部分配的唯一 id）
# value = Future，由 prompt_approval 创建，approval.ack 入帧时 resolve
```

约定：
- 一个 call_id **最多一个** future（runner 不会对同一 call_id 多次问 ask）
- future 必须 always be resolved（False 即拒绝），不能让 runtime 永远卡住
- 三种 resolve 路径：
  1. WS 入帧 approval.ack → resolve(approved bool)
  2. cell evict → resolve(False) for all
  3. WS 断开后超过 `pending_approval_timeout_seconds`（默认 60s）→ resolve(False)
- WS 重连后 v0.1.5 不恢复弹窗（前端会重新 mount），用户体感：刷页面 = 等于拒绝当前审批

## 6. 持久化与 Session backend 的关系

复用现有 backend，`thread_id` 直接当 `session_id`：

| backend | 历史路径 | 适用场景 |
|---|---|---|
| `memory` | 不落盘 | 测试 / 临时玩 |
| `file` | `.kongming/sessions/<thread_id>/<thread_id>.jsonl` | 默认；单用户友好 |
| `sqlite` | `.kongming/kongming.sqlite` 的 `messages` 表 | 想集中索引时 |

ThreadManager 启动时扫盘：
- 优先以 `cfg.session.backend` 为准，扫对应 backend
- 同时扫 `.kongming/web/threads/` 下所有元数据
- 取交集（元数据存在 + 历史也存在）作为可恢复 thread 列表

漂移情况处理：
- 元数据存在但历史没了 → 当作"空 thread"列出，用户进入即从空白开始
- 历史存在但元数据没了 → 不主动恢复（避免认领不属于 web 的 CLI session），但管理页提供 "import legacy session" 按钮（v0.1.5 不做）

## 7. 安全约束

| 项 | v0.1.5 做法 | 备注 |
|---|---|---|
| Auth | session cookie + bcrypt 密码 | 单用户场景够用 |
| Cookie 属性 | HttpOnly + SameSite=Lax + Secure（按 https 自动） | 防 XSS / CSRF 基础 |
| CSRF | 默认依靠 SameSite=Lax；mutating 端点（POST/PATCH/DELETE）额外要求 `X-Requested-With: XMLHttpRequest` header | 简单防御 |
| WS 鉴权 | WS 建连时验 cookie；不接受 query 参数传 token | 标准做法 |
| api_key 暴露面 | 只在后端读 env；REST 不返回 | 客户端拿不到 LLM 密钥 |
| 文件权限 | session_secret / password.hash 设 0600 | 防同机其它账号 |
| 频率限制 | 登录失败 5 次锁 5min（per-IP） | 防爆破 |
| HTTPS | v0.1.5 由部署方决定（局域网 http 也行；上 nginx 反代加 TLS） | 不强制 |
| 工具审批 | 每个 ask 都弹窗，不可全局 always allow（v0.1.6+） | v0.1.5 必须保持，避免高危工具被自动放行 |
| 输入大小 | WS 单帧 ≤ 1MB；REST body ≤ 1MB | 防 DoS |
| Path traversal | thread_id 严格匹配 `^thread-[a-f0-9]{12}$` | 防止用户传 `../` 攻击 metadata 路径 |

## 8. 失效 / 异常状态

| 状态 | 触发 | 处理 |
|---|---|---|
| LLM endpoint 不可达 | provider 抛 httpx.ConnectError | runner 记 error event → WSEventSink 推 `error` 帧 → 前端显示气泡 "连接失败，可重试"，**不**销毁 cell |
| LLM endpoint 401 | api_key 错 | 同上，错误信息清晰 |
| LLM 回复超长 / 卡住 | 现有 `cfg.llm.timeout_seconds` 兜底 | 抛 timeout → 同上 |
| Runtime 内部 panic | runner 包 `core.errors.ToolError` / `LLMError` | 仍走 result.error 路径，cell 仍可继续后续 turn |
| WS 写入失败 | ws.send 抛 `ConnectionClosed` | adapter / sink 标 closed=True；runtime 当前 turn 继续跑（输出落 trace），下次帧静默丢 |
| 启动时元数据损坏 | metadata.json 解析失败 | 跳过该 thread，启动日志记 warning，UI 列表里不显示 |
| 历史损坏 | jsonl 一行解析失败 | session_store 已有容错（跳过坏行），不改 |
| 并发 boot 同一 thread | 两 WS 同时 connect | boot_lock 串行，第二个连接等第一个 boot 完直接 attach |

## 9. 测试策略（每模块都需要）

### ws-protocol

- 每个帧的 round-trip：Pydantic → JSON → 解析回 Pydantic → 等价
- 字段缺失 / 类型错误的拒绝行为
- 协议版本兜底（虽然 v0.1.5 不带 version 字段，留个 unit test 钩子）

### thread-manager

- create_thread 落 metadata + boot 是分离的
- boot_or_attach 并发安全（启 100 个 task 同时调，断言只 build 一次 runtime）
- evict_idle 命中 30min 阈值
- evict_cell 时 pending_approvals 全部 resolve(False)
- aclose_all 在 N 个 cell 时也能 graceful 收场

### web-host-adapter

- prompt_approval 创建 future + 推 ws + 等 resolve 三步全验证
- WS 断后 write_output / notify_event 不抛
- ApprovalRequest.call_id 不重复（依赖 runner，但 adapter 侧加防护：同 call_id 第二次 prompt_approval 抛断言）

### web-app-shell

- auth 登录失败爆破锁定 / 成功后 cookie 设置
- WS 未鉴权时返 1008
- create_thread → list_threads 端到端
- 静态资源 SPA fallback：`GET /not-a-route` 返回 index.html

### frontend

- 单元测试覆盖核心 hooks（useWS / useThreads）
- 流式打字机渲染性能：模拟 1000 个 content.delta 帧 < 1s 完成渲染
- 设计 token 一致性：tailwind config 与 design-tokens.ts 字号 / 间距吻合（snapshot 测）
- e2e（Playwright）：登录 → 建 thread → 发消息 → 看到流式回复 → 关闭

### 跨模块 e2e（最后做）

- 真实启动 uvicorn + headless Chromium，跑 5 个 thread 并发对话场景
- 闲置 30min（用 monkey patch 改成 5s）触发 evict，前端能看到 toast
