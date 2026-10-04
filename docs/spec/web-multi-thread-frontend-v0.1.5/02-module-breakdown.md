# 模块拆分

## 模块总览

| 模块 | 职责 | 依赖 | 状态 | v0.1.5 surface | v0.1.6+ 扩展点 |
|---|---|---|---|---|---|
| web-app-shell | FastAPI app + auth + static + 路由装配 | thread-manager / ws-protocol / 现有 config_loader | 方案确认 | 登录登出 / REST 路由 / 静态服务 | OAuth / 多用户 |
| thread-manager | fleet 管理、懒启动、闲置回收、持久化扫描 | 现有 SessionEngine / Session / context.session_discovery | 方案确认 | dict[thread_id, ThreadCell] + 30min idle GC | 共享 provider 池 / per-thread 资源限额 |
| web-host-adapter | WebHostAdapter + WSEventSink + ApprovalFuture map | core.contracts / host.base / ws-protocol | 方案确认 | write_output / notify_event / prompt_approval（Future） | tool stream 渲染 / interrupt / partial cancel |
| ws-protocol | WS / REST 帧 schema + JSON 序列化 + Pydantic 校验 | 无（纯协议） | 方案确认 | input / content.delta / reasoning.delta / tool.call.* / approval.request / approval.ack / token usage | typed RPC（v0.1.6+ 改 JSON-RPC 类似 codex） |
| frontend | React + Vite + TS + Tailwind + shadcn/ui + Docker 构建 | ws-protocol（消费） | 方案确认 | 登录页 / thread 列表 / chat 屏 / 新建 dialog / 管理页 | per-thread 设置 UI / 自定义 prompt 模板 / 工具开关 |

## 模块详情

### 模块 1：web-app-shell

**职责**：FastAPI 应用层。装配 auth 中间件、静态资源服务、REST 路由、WS 路由，把请求路由到 ThreadManager / WebHostAdapter。

**包含范围**：
- `src/web/app.py` — `create_app(config) -> FastAPI`，按现有 `Config` 装配
- `src/web/auth/middleware.py` — session cookie + 密码登录；password hash 用 `passlib[bcrypt]` 或 stdlib `hashlib.scrypt`（避选项）
- `src/web/routers/threads.py` — REST 路由：`GET /api/threads` / `POST /api/threads` / `PATCH /api/threads/{id}` / `DELETE /api/threads/{id}` / `GET /api/threads/{id}/history`
- `src/web/routers/presets.py` — `GET /api/presets` 返回 setting.yaml 里配置的 LLM 列表
- `src/web/routers/auth.py` — `POST /api/auth/login` / `POST /api/auth/logout` / `GET /api/auth/me`
- `src/web/routers/manage.py` — 管理页 REST：`GET /api/manage/cells`（活的 ThreadCell 列表）/ `POST /api/manage/cells/{id}/stop`
- `src/web/ws.py` — WS 端点 `WS /ws/threads/{id}`，建连即调 ThreadManager.attach
- `src/web/static.py` — 把 `web/dist/` 挂为静态资源；fallback 到 `index.html` 实现 SPA 路由
- 入口：`uv run uvicorn web.app:app --host 0.0.0.0 --port 8080`，新增 `make web` target

**不包含范围**：
- 业务逻辑（属于 thread-manager）
- 帧序列化（属于 ws-protocol）
- 浏览器侧任何代码（属于 frontend）

**依赖**：
- `thread-manager`（构造时注入单例）
- `ws-protocol`（路由层用 Pydantic 模型校验帧）
- 现有 `config_loader.Config`（拿到 server / auth / preset / persistence 配置）

**风险与讨论点**：
- **auth 持久化**：单用户，但 cookie session secret 不能每次重启变（否则用户被强制登出）。建议 secret 来自 `KONGMING_WEB_SECRET` env 或 `.kongming/web/session_secret`（首次启动随机生成并落盘，权限 0600）
- **CORS**：dev 模式可能需要开 CORS（前端 vite dev server 在 :5173），生产 bundled 模式不需要。在 config 里加 `web.dev_mode: bool` 开关
- **密码存储**：单用户场景，密码哈希存 `.kongming/web/password.hash`（首次启动从 env `KONGMING_WEB_PASSWORD` 读明文 → 哈希落盘 → 清空 env），避免明文到处飘
- **HTTPS**：v0.1.5 局域网内可不做（cookie 走 http），但 `secure` 属性要根据 `request.url.scheme` 自动设置，避免后续上 nginx 反代时不兼容

**v0.1.5 surface**：上面"包含范围"全部
**v0.1.6+ 扩展**：OAuth / 多用户 / 二次验证 / WebAuthn 用同一个 router 层接入

**task 建议**：
- 建议 task 名：`web-app-shell-v0.1.5`
- 是否进入 x-req：是（前提是 ws-protocol 已有初版）
- 原因：路由实现要消费 ws-protocol 的 Pydantic 模型；先有协议契约再写 router 不会反复改

---

### 模块 2：thread-manager

**职责**：fleet 总管。维护 `dict[thread_id, ThreadCell]`，负责懒启动、闲置回收、启动时扫盘列出可恢复 thread、提供给 WS / REST 路由的统一访问面。

**包含范围**：
- `src/web/thread_manager.py` — `ThreadManager` 类
- `src/web/thread_cell.py` — `ThreadCell` dataclass：runtime / bridge / adapter / sinks / created_at / last_active_at / status
- `src/web/thread_metadata.py` — 落盘的 thread 元数据：id / name / preset_id / created_at / messages_count / last_active_at
  - 单用户系统，元数据落 `.kongming/web/threads/{thread_id}/metadata.json`
  - 历史复用现有 `cfg.session.backend`（file / sqlite）
- ThreadManager 关键方法：
  - `async def boot_or_attach(thread_id) -> ThreadCell` — 懒启动入口
  - `async def create_thread(name, preset_id) -> ThreadMetadata` — 只建元数据，不建 cell
  - `async def rename_thread(thread_id, new_name)`
  - `async def delete_thread(thread_id)` — 删元数据 + 删历史 + evict cell
  - `async def evict_idle()` — 后台 task 周期扫描 30min 闲置回收
  - `async def aclose_all()` — uvicorn shutdown 钩子，aclose 所有 runtime
  - `def list_threads() -> list[ThreadMetadata]` — REST `GET /api/threads` 数据源
  - `def list_cells() -> list[CellSummary]` — REST 管理页数据源
- 后台任务：`asyncio.create_task(self._idle_eviction_loop())` 在 startup event 启动

**不包含范围**：
- HTTP / WS 路由（属于 web-app-shell）
- 单 cell 内部 sinks 装配的细节（属于 web-host-adapter）
- 持久化后端实现（复用 context/session_store / context/file_session）

**依赖**：
- 现有 `SessionEngine.build(...)`
- 现有 `context.session_discovery` 用来扫已有 session
- 现有 `Session` 类（按 backend 选实现）
- `web-host-adapter`（构造 ThreadCell 时把 adapter / sinks 装进去）

**风险与讨论点**：
- **并发懒启动**：两个 WS 同时连同一 thread_id（极端场景 — 用户连点两次），要避免 boot 两次。用 `asyncio.Lock` per thread_id，或者用 `asyncio.Event` 表示"正在 boot"
- **启动时扫盘的成本**：sqlite backend 用一条 SQL 即可拿元数据；file backend 要扫 N 个目录。N 大时启动慢，加 `LIMIT 50` 默认值
- **闲置回收和正在等审批的 cell**：如果 cell 卡在 `prompt_approval` 等用户回应，30min 没活动是否回收？建议**回收时主动 reject 所有 pending approval**（resolve future with False）+ WS 推一条 thread.evicted 让前端关掉弹窗
- **WS 重连**：用户刷页面会断 WS，断了不应立即销毁 cell（否则刷新等于丢上下文）；保留 cell 直到 idle GC，新 WS 接上即可

**v0.1.5 surface**：上面"包含范围"全部
**v0.1.6+ 扩展**：
- per-thread 资源限额（max_messages / max_tokens / token usage 监控）
- 跨进程持久化 cell 状态（v0.1.5 重启 = 丢内存中 cell，历史还在；v0.1.6+ 可考虑把 in-flight turn 也持久化）
- 共享 provider pool（同一 LLM preset 的 N 个 thread 共享一个 httpx client）

**task 建议**：
- 建议 task 名：`thread-manager-v0.1.5`
- 是否进入 x-req：是
- 原因：依赖只在内核层（已稳定），是后端 backbone，先完成才能启 web-app-shell

---

### 模块 3：web-host-adapter

**职责**：HostAdapter 的 web 实现。把"runtime → 用户"和"用户 → runtime"两个方向翻译成 WebSocket 帧 / Future 配对。

**包含范围**：
- `src/web/app_support/host_adapter.py` — `WebHostAdapter(HostAdapter)`：
  - `read_input` — **永不调用**（web 不用 run_loop），实现里 raise `NotImplementedError("web not using run_loop")`
  - `write_output(text)` — 把 text 包成 ws-protocol 的 `assistant.final` 帧推 WS
  - `notify_event(event)` — 通常不用（事件走 WSEventSink），保留作为 fallback
  - `prompt_approval(req)` — 创建 `Future`，存进 `pending_approvals[req.call_id]`，推 ws-protocol 的 `approval.request` 帧 → await future → 返回 bool
  - `close()` — resolve 所有 pending future 为 False（拒绝），断 WS
- `src/web/ws_event_sink.py` — `WSEventSink(EventSink)`：
  - 把每个 `Event` 翻成 ws-protocol 的对应帧推 WS
  - `content.delta` / `reasoning.delta` / `tool.call.start` / `tool.call.end` / `approval.request` / `approval.decision` / `error` / `turn.start` / `turn.end` 等
  - 单 thread cell 私有，`ws` 引用允许在重连时被 ThreadManager 替换
- `src/web/approval_routing.py` — WS 入帧 `approval.ack` 时，按 `call_id` 找 future 并 resolve

**不包含范围**：
- WS 帧 schema 定义（属于 ws-protocol）
- ThreadCell 装配（属于 thread-manager）
- 浏览器侧弹窗 UI（属于 frontend）

**依赖**：
- `core.contracts.HostAdapter / EventSink / ApprovalRequest / Event`
- `host.base.HostAdapter`
- `ws-protocol`（每条帧的 Pydantic 模型）

**风险与讨论点**：
- **WS 重连后 pending future 怎么办**：推荐"保留 future 直到 ack 或 cell 销毁"——重连后前端如果还想审批，可以查 `GET /api/threads/{id}/pending-approvals` 拿到列表恢复弹窗。v0.1.5 简化为"重连不恢复弹窗，超时自动 reject"
- **WS 写入失败**：`ws.send_text` 在客户端断开时会 raise；adapter 要 catch 并标记自己 `closed=True`，下次 `write_output` 直接吞掉，避免 cell 内部炸
- **事件顺序**：runtime 内部 `EventSink.emit` 是 await 串行的，所以 WS 推送顺序天然有序；但浏览器收到的顺序仍然受 TCP 影响 — 让 frontend 按 `(turn, seq)` 重排
- **`echo_final_content`**：ThreadCell 装配 SessionBridge 时传 `False`，因为 WSEventSink 已经把 content.delta 实时推过了，`run_once` 末尾再 echo 等于二次发送

**v0.1.5 surface**：上面"包含范围"全部
**v0.1.6+ 扩展**：
- partial tool stream 渲染（要先升级现有 `tool.call.*` 事件粒度）
- 中断 / cancel 当前 turn（要在 runner 加 cancel hook）
- 多 sink 投递（同一 thread 推到管理页 + chat 页两个 WS）

**task 建议**：
- 建议 task 名：`web-host-adapter-v0.1.5`
- 是否进入 x-req：是
- 原因：可以和 thread-manager 合一个 task（互相依赖紧），也可以拆开。建议合并以减少接口反复

---

### 模块 4：ws-protocol

**职责**：定义 WS / REST 的所有帧 schema，提供 Pydantic 模型 + JSON 序列化约定。是其它模块（含 frontend）的接口契约。

**包含范围**：
- `src/web/protocol/ws_frames.py` — WS 双向帧：
  - C2S：`{"kind": "user.input", "text": "..."}` / `{"kind": "approval.ack", "call_id": "...", "approved": true}` / `{"kind": "ping"}`
  - S2C：`assistant.final` / `content.delta` / `reasoning.delta` / `tool.call.start` / `tool.call.end` / `approval.request` / `approval.decision` / `usage` / `error` / `turn.start` / `turn.end` / `pong` / `cell.evicted`
  - 公共字段：`turn`、`seq`（per-turn 单调递增，让 frontend 重排）、`timestamp_ms`
- `src/web/protocol/rest_models.py` — REST 请求 / 响应 Pydantic 模型：
  - `ThreadMetadataDTO` / `CreateThreadRequest` / `RenameThreadRequest` / `LLMPresetDTO` / `LoginRequest` / `CellSummaryDTO`
- `src/web/protocol/__init__.py` — re-export 给 router / adapter / frontend 共用
- 配套：`web/src/protocol.ts` — 前端这边的 TS 类型声明（手写或从 Pydantic schema 生成；v0.1.5 手写避免引 codegen）

**不包含范围**：
- 路由实现（属于 web-app-shell）
- 协议消费方实现（属于其它模块）

**依赖**：无（纯协议层）

**风险与讨论点**：
- **协议版本化**：v0.1.5 不做版本字段，v0.1.6+ 加 `protocol_version` field 在握手帧里
- **Schema 漂移**：Pydantic 和 TS 两份手写，**单元测试覆盖每个帧的 round-trip**（Python 序列化 → JSON → 解析 → Python 等价对象），TS 侧靠 review 保证一致
- **二进制传输**：仅 JSON 文本帧，不引 binary（图片附件 v0.1.6+ 再说）

**v0.1.5 surface**：上面"包含范围"全部
**v0.1.6+ 扩展**：
- 多媒体附件帧（图片 / 文件）
- JSON-RPC 风格 request-id 模式（向 codex 看齐）
- 协议版本协商

**task 建议**：
- 建议 task 名：`ws-protocol-v0.1.5`
- 是否进入 x-req：是（**第一个开始**）
- 原因：所有其它模块都消费它，先钉死可避免反复对接

---

### 模块 5：frontend

**职责**：浏览器端 React 应用 + Docker 构建管线。

**包含范围**：
- `web/` 目录（项目根，和 `src/` 平级）：
  - `web/package.json` — React 19 + Vite 5 + TS 5 + Tailwind 4 + shadcn/ui + Framer Motion + zustand（状态管理）+ react-router
  - `web/Dockerfile.build` — `node:20-alpine` 基础镜像，跑 `npm ci && npm run build`，产出 `web/dist/`
  - `web/.gitignore` — `dist/`、`node_modules/`
  - `web/vite.config.ts` — base path、proxy 到本地 FastAPI（dev 用）
  - `web/tailwind.config.ts` — 把设计语言里的 design tokens（spacing / typography / color / motion）固化成 Tailwind theme
  - `web/src/`：
    - `main.tsx` / `App.tsx` — 入口 + 路由
    - `pages/Login.tsx` / `pages/Chat.tsx` / `pages/Manage.tsx` / `pages/NotFound.tsx`
    - `components/ThreadList.tsx` / `components/MessageList.tsx` / `components/Composer.tsx` / `components/ApprovalDialog.tsx` / `components/NewThreadDialog.tsx`
    - `hooks/useWS.ts` — WebSocket 连接管理 + 自动重连
    - `hooks/useThreads.ts` — REST 拉取 thread 列表 + 创建 / 重命名 / 删除
    - `lib/protocol.ts` — 帧类型声明（对应 `src/web/protocol/`）
    - `lib/design-tokens.ts` — 字号 / 间距 / 阴影 / easing 等（被 tailwind 配置消费）
    - `styles/globals.css` — Tailwind base + CSS variables（dark mode）

**不包含范围**：
- 后端任何代码
- WS / REST schema 定义（消费 ws-protocol，不定义）

**依赖**：
- `ws-protocol`（消费帧 schema）
- 浏览器：Chrome / Safari / Firefox 最新两个版本（v0.1.5 不兼容 IE / 老 Edge）

**风险与讨论点**：
- **shadcn/ui 复制 vs 安装**：shadcn 是"copy components into your repo"模式，不是 npm 包。组件代码会进 `web/src/components/ui/`。需要在 README 里说明 shadcn cli 用法
- **打包体积**：React + Tailwind + Framer Motion + shadcn 起步 ~300KB（gzipped ~100KB），单用户局域网完全够
- **Tailwind 4 vs 3**：Tailwind 4 已稳定，CSS-first config 更简单；建议直接 4
- **dist/ 路径**：FastAPI 的静态服务挂哪里？建议 `/assets/*` 走静态、`/` 走 SPA fallback（serve `index.html`）
- **dev 模式 CORS**：vite 跑 :5173，要么 vite proxy `/api/* /ws/*` 到 :8080，要么 FastAPI 开 CORS。推荐前者
- **Apple HIG 资源版权**：可以参考设计语言、不能直接抄 SF Symbols / 特定按钮样式。用 lucide-react 替代 SF Symbols；按钮自己设计
- **流式打字机性能**：高频 `content.delta` 帧（每 token 一帧）时，避免每帧 `setState` 触发整树重渲染——用 ref + requestAnimationFrame 批量渲染

**v0.1.5 surface**：上面"包含范围"全部
**v0.1.6+ 扩展**：
- per-thread 设置 panel（自定义 prompt 模板 / 工具开关 / 审批模式）
- 主题切换 UI（v0.1.5 跟随系统）
- 移动端响应式
- 多语言 i18n
- chat 历史搜索 / 跳转

**task 建议**：
- 建议 task 名：`frontend-v0.1.5`
- 是否进入 x-req：是（前提是 ws-protocol 已稳定）
- 原因：frontend 工作量最大，但和后端解耦充分，可以和后端模块并行开发
