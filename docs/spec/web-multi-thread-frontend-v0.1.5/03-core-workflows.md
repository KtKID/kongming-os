# 核心流程

## 1. 进程启动

```
uv run uvicorn web.app:app --host 0.0.0.0 --port 8080
  ↓
web.app.create_app(config)
  ├─ load_config()                            ← 现有 config_loader（含新增 web 段）
  ├─ ThreadManager(config)
  │    ├─ 扫 cfg.session.backend 列出可恢复 thread（仅元数据 / 不预热 cell）
  │    ├─ 启动闲置回收后台 task：asyncio.create_task(self._idle_eviction_loop())
  │    └─ 注册 uvicorn shutdown hook → aclose_all()
  ├─ 装 auth 中间件
  ├─ 装 REST routers / WS endpoint
  └─ mount StaticFiles("/assets", web/dist/assets)
     mount StaticFiles("/", web/dist/，with html=True 做 SPA fallback)
```

关键点：
- 启动时**不**预热任何 ThreadCell（懒启动是核心约定）
- 内存中只有 ThreadManager 单例 + 它持有的元数据列表
- `aclose_all()` 在 SIGTERM 时遍历 cells，逐个 `await runtime.aclose()` 释放 httpx pool

## 2. 用户登录

```
浏览器 GET /  →  FastAPI 返回 web/dist/index.html  →  React 启动
React 检查 GET /api/auth/me
  ├─ 200：cookie 有效 → 跳 /chat
  └─ 401：跳 /login

用户提交 POST /api/auth/login {"password": "..."}
  ├─ web.auth 校验：bcrypt.verify(input, stored_hash)
  ├─ 成功：set Cookie: session=<signed_token>; HttpOnly; SameSite=Lax
  │        [secure 属性按 request.url.scheme == 'https' 自动加]
  └─ 失败：429 + 退指数（防爆破，5次后锁 5min）

后续所有 /api/* 和 /ws/* 走中间件验 cookie：
  - 无效：API 401 / WS 1008（Policy Violation）关闭
  - 有效：放行
```

session secret：
- 来源优先级：env `KONGMING_WEB_SECRET` > `.kongming/web/session_secret`（首次启动随机生成 + 文件权限 0600）
- 重启不变（用户不被强踢）

password：
- 首次启动从 env `KONGMING_WEB_PASSWORD` 读 → bcrypt hash → 落 `.kongming/web/password.hash` → unset env
- 改密码：删 `.kongming/web/password.hash`，重启时再次从 env 读。v0.1.5 不做"改密码"UI

## 3. 列出 thread + 新建 thread

```
React 进入 /chat → useThreads hook 拉数据：
  GET /api/threads
    └─ ThreadManager.list_threads() → list[ThreadMetadataDTO]
       字段：id / name / preset_id / created_at / updated_at / message_count / is_alive

  GET /api/presets
    └─ 从 cfg.web.llm_presets 返回 list[LLMPresetDTO]
       字段：id / display_name / model_name / base_url（脱敏的描述用，不回 api_key）

UI：左侧 thread 列表（按 updated_at 倒序）+ "新建 thread" 按钮

用户点 "新建 thread"：
  弹 NewThreadDialog（Tailwind + shadcn dialog + Framer Motion）
    字段：thread name / preset 下拉
  提交：POST /api/threads {name, preset_id}
    └─ ThreadManager.create_thread(name, preset_id)
       ├─ 生成 thread_id = "thread-<hex12>"
       ├─ 落盘 .kongming/web/threads/{id}/metadata.json
       └─ 返回 ThreadMetadataDTO
  React 收到 → 跳转 /chat/<thread_id>
```

关键：**create_thread 不 boot ThreadCell**——只建元数据。Cell 在用户首次发消息（或建 WS 连接）时才懒启动。

## 4. 一轮对话（懒启动 + 流式 + 审批）

```
React 路由 /chat/<thread_id>：
  ├─ GET /api/threads/<id>/history → 拉历史消息（用于显示）
  ├─ 建 WebSocket 连接 WS /ws/threads/<id>?cookie=...
  │    └─ web-app-shell.ws.handle_connect(thread_id, ws):
  │       ├─ 验 cookie
  │       ├─ ThreadManager.boot_or_attach(thread_id)
  │       │   ├─ 已有 cell：替换 cell.adapter.ws = new ws；不重启 runtime
  │       │   └─ 没有 cell（首次或被 evict）：
  │       │       ├─ 加 lock 防并发 boot
  │       │       ├─ 读元数据拿 preset_id
  │       │       ├─ build SessionEngine（按 preset 配置 provider / api_key / base_url）
  │       │       ├─ Session = build_session(cfg, thread_id, bootstrap)
  │       │       │   会从 file/sqlite 自动 load 历史
  │       │       ├─ WebHostAdapter(ws, pending_approvals_dict)
  │       │       ├─ EventSinks = [JsonlTraceSink(per-thread path), WSEventSink(ws)]
  │       │       ├─ SessionBridge(runtime, adapter, session_id=thread_id, echo_final_content=False)
  │       │       └─ ThreadCell 装好登记到 self.threads[thread_id]
  │       ├─ 注册 ws 到 cell（断开时移除）
  │       └─ async for frame in ws: dispatch(frame, cell)

用户在 composer 框里输入并提交：
  React 推 WS：{"kind": "user.input", "text": "...", "request_id": "<uuid>"}
  后端 dispatch：
    asyncio.create_task(cell.bridge.run_once(text))
    │
    ├─ runtime.run("hello", session_id=thread_id)
    │    ├─ 把 user 消息 append 到 Session
    │    ├─ Runner 进入 turn loop
    │    └─ 流式响应每来一个 chunk：
    │       │ EventSink fan-out（runner 内部）：
    │       │  ├─ JsonlTraceSink.emit({content.delta, ...})
    │       │  └─ WSEventSink.emit(...) → ws.send_json({kind:"content.delta", delta:"...", turn:1, seq:N, timestamp_ms:...})
    │       │ React 端 useWS 收到 → 追加到当前 turn 的 message
    └─ run_once 返回，包错误处理 + token usage

  WSEventSink 在 turn.end 时 emit usage：
    ws.send_json({kind:"usage", prompt_tokens, completion_tokens, total_tokens, turn:1})

如果 runtime 内部要执行某个 ask 工具（比如 shell）：
  SafetyGatedApproval → 命中 ask → 调 WebHostAdapter.prompt_approval(req)
    │
    ├─ future = asyncio.Future()
    ├─ pending_approvals[req.call_id] = future
    ├─ ws.send_json({kind:"approval.request", call_id, tool_name, arguments, reason, turn})
    └─ approved = await future

React 端：
  收到 approval.request → 弹 ApprovalDialog（modal blocking）
  用户点"允许"或"拒绝"：
  WS 推 {"kind": "approval.ack", "call_id": "...", "approved": true|false}

后端 dispatch：approval.ack → resolve future
  pending_approvals.pop(call_id).set_result(approved)
  → WebHostAdapter.prompt_approval 醒来返回 → runtime 继续
```

**并发隔离**：thread A 和 thread B 各自有独立 task，asyncio 在它们之间交错调度；A 的 await 给 B 让出 CPU 时间。**前提**：LLM endpoint 本身能并发处理（kongming 这层不卡）。

## 5. WS 重连（用户刷页面 / 网络抖动）

```
旧 WS 断开：
  ThreadManager 把 cell.adapter.ws 标 closed=True，但 cell 不销毁
  pending_approvals 里如有 future：v0.1.5 简化 → 等用户重连后超时 reject（暂定 60s）

用户回来：
  React 重新 mount → 新 WS connect → ThreadManager.boot_or_attach(thread_id)
    └─ 命中已有 cell → 替换 ws 引用：cell.adapter.ws = new_ws
       cell.event_sinks 里的 WSEventSink 同步换 ws

进行中的 turn：
  - 老 ws 已断，期间产生的 content.delta 已经落地到 JsonlTraceSink
  - 新 ws 接上后只看到后续帧；之前漏掉的内容不重发
  - v0.1.5 简化：刷页面后已发 turn 的中间内容看不到（但最终 final 在历史里）
  - v0.1.6+ 可以在 boot_or_attach 里发一帧 "history.snapshot" 把当前 turn 已积累内容补上
```

## 6. 闲置回收

```
ThreadManager._idle_eviction_loop（后台 task，每 60s 跑一次）：
  now = time.time()
  for thread_id, cell in self.threads.items():
      if now - cell.last_active_at >= 30 * 60:
          await self._evict_cell(thread_id)

_evict_cell：
  ├─ 取消 pending approvals（resolve future = False）
  ├─ ws.send_json({"kind":"cell.evicted", "reason":"idle"}) 通知前端
  ├─ ws.close() 关 WS
  ├─ runtime.aclose()  释放 httpx pool 等
  └─ del self.threads[thread_id]

last_active_at 更新点：
  - WS 入帧（任意 kind）
  - WS 出帧（runtime 在产出 → user 在看）
  - REST 显式访问 thread（GET /api/threads/{id}/history 等）
```

前端体验：
- thread 被 evict 后 React 收到 cell.evicted → 弹 toast "thread 已休眠（30 分钟无活动），下次发消息会自动恢复"
- 用户继续在该 thread 下发消息：useWS 自动重连 → ThreadManager 重新 boot cell → 恢复

## 7. 管理页

```
React /manage:
  ├─ GET /api/manage/cells → list[CellSummaryDTO]
  │    字段：thread_id / thread_name / preset_id / created_at / last_active_at / current_turn / pending_approval_count / status (idle/running/awaiting_approval)
  ├─ 每 5s 自动 refetch（或开一条专用 WS /ws/manage 订阅，v0.1.5 用 polling 就够）
  └─ 每行有 "停止" 按钮：POST /api/manage/cells/{id}/stop
       └─ ThreadManager.evict_cell(thread_id, reason="manual_stop")
```

v0.1.5 管理页只展示 + 停。v0.1.6+ 加：
- 资源占用（token 累计 / API 调用数 / 内存占用估算）
- 强制取消当前 turn（要内核加 cancel 能力）
- 调整 idle 超时

## 8. 关闭服务（uvicorn shutdown）

```
SIGTERM → uvicorn 进入 shutdown：
  FastAPI shutdown event → ThreadManager.aclose_all()
    └─ for cell: 同 _evict_cell 但不 send WS 通知（连接已关）
       runtime.aclose()
       cancel 所有后台 task
       cancel idle_eviction_loop

历史数据：
  - 已经增量落 file/sqlite，重启后仍可恢复
  - in-flight turn 的中间状态丢失（v0.1.5 不持久化 in-flight）
```

## 9. 数据持久化全图

```
.kongming/
├─ web/
│   ├─ session_secret             ← cookie 签名 secret（0600 权限）
│   ├─ password.hash              ← bcrypt 密码哈希（0600 权限）
│   └─ threads/
│       └─ <thread_id>/
│           ├─ metadata.json      ← name / preset_id / created_at / ...
│           └─ trace.jsonl        ← per-thread JsonlTraceSink 输出
├─ sessions/                      ← 现有 file backend
│   └─ <thread_id>/
│       └─ <thread_id>.jsonl      ← 消息历史
└─ kongming.sqlite                ← 现有 sqlite backend（可选用）
```

`thread_id` 同时是 `session_id`——简化 mental model，不引入两层 ID。
