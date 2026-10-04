# Task Map

## 模块 → Task 映射

| 模块 | 建议 task 名 | 是否创建 task | 前置依赖 | x-req 准入条件 | 当前状态 |
|---|---|---|---|---|---|
| ws-protocol | `web-ws-protocol-v0.1.5` | 是（**优先**） | 无 | 无（纯协议层） | 可进入 x-req |
| thread-manager | `web-thread-manager-v0.1.5` | 是 | ws-protocol 初版 | LLMPreset schema 已确认 | 可进入 x-req |
| web-host-adapter | `web-host-adapter-v0.1.5` | 是（**可与 thread-manager 合并**） | ws-protocol 初版 | 与 thread-manager 接口对齐 | 可进入 x-req |
| web-app-shell | `web-app-shell-v0.1.5` | 是 | thread-manager / web-host-adapter / ws-protocol | 上面三个完成 | 可进入 x-req |
| frontend | `web-frontend-v0.1.5` | 是（**可与 web-app-shell 并行**） | ws-protocol 锁定 | 设计 token 落到 tailwind config | 可进入 x-req |

## 推荐推进顺序

```
[t0] ws-protocol-v0.1.5
        ├─ Pydantic 模型 + TS 类型（手写）
        ├─ round-trip 单测
        └─ 文档：每个帧的 contract

[t1] thread-manager-v0.1.5 + web-host-adapter-v0.1.5（合并 task 推荐）
        ├─ ThreadCell + ThreadManager
        ├─ WebHostAdapter + WSEventSink + ApprovalFutureMap
        ├─ 懒启动 / 闲置回收 / 持久化扫描
        └─ 单测：并发 boot / evict / approval future / WS 断重连

[t2] web-app-shell-v0.1.5
        ├─ FastAPI app + auth 中间件 + cookie session
        ├─ REST routers（threads / presets / auth / manage）
        ├─ WS endpoint + dispatch
        ├─ Static mount + SPA fallback
        └─ 单测 + 集成测（真起 TestClient + websocket）

[t3] web-frontend-v0.1.5（可与 t2 并行）
        ├─ Vite + Tailwind 4 + shadcn/ui + Framer Motion 脚手架
        ├─ Login / Chat / Manage 三个页面
        ├─ useWS / useThreads hooks
        ├─ 设计 token 固化到 tailwind config
        ├─ Docker 构建管线（make web-build）
        └─ Playwright e2e（基础 happy path）

[t4] e2e + 文档回写（详见下方"v0.1.5 收尾文档同步清单"）
        ├─ 真实启动 uvicorn 跑 5 个 thread 并发场景
        ├─ docs/modules/web/README.md 按现有惯例编写
        ├─ docs/modules/宿主/README.md 补充 WebHostAdapter 一段
        ├─ CLAUDE.md 加 src/web/ 行 + 数据流段同步
        └─ docs/kongming-agent-v1-minimal/ 同步合约变更（HostAdapter 在 web 端语义补充）
```

## v0.1.5 收尾文档同步清单（t4 阶段照此 checklist 走）

参考既有惯例（`8028465 docs(modules): 按 v0.1.3 新代码同步 10 份模块文档 + CLAUDE.md`），v0.1.5 实现完成后用一个收尾 commit 集中做 docs 同步。spec（本目录）保持不动作为设计期权威——modules 里的文档是各自模块视角的局部图，不复制全景。

### 1. 新增 `docs/modules/web/README.md`

按现有模块文档模板组织（参考 `docs/modules/命令行/README.md` / `docs/modules/宿主/README.md`），至少包含：

- **设计理念**：web 是 v0.1.5 引入的第二个宿主壳（CLI 之后），单进程多 thread + 懒启动 + 闲置回收
- **代码索引**（按 src/web/ 下的实际文件列表，每个文件一句话职责）：
  - `app.py` / `auth.py` / `host_adapter.py` / `ws_event_sink.py` / `thread_manager.py` / `thread_cell.py` / `thread_metadata.py` / `protocol/*.py` / `routers/*.py` / `ws.py`
- **依赖与边界**：消费 `core.contracts` / `host.base` / `executors.agent_runtime` / `context` / `config_loader`；不被任何 sibling 反向 import
- **本模块视角的部署图**（仅形态 2 + 3A，不画形态 1 / 3B）：
  ```
  Browser / Mac.app（远程） ─WS─→ FastAPI (src/web/) ─→ SessionEngine × N
  ```
- **已知漂移**：spec 里写但落地有出入的地方（如果有）

### 2. 扩展 `docs/modules/宿主/README.md`

现有 `docs/modules/宿主/README.md` 描述了 CLIAdapter / HostAdapter 协议。v0.1.5 完成后补两段：

- **WebHostAdapter**：列入 HostAdapter 实现表，注明 `read_input` 不被使用（web 不走 run_loop）、`prompt_approval` 走 Future map 异步配对
- **未来扩展指引**：链回 spec README 的"未来宿主扩展"段，让宿主层文档显式记录 Mac native 两条路径

### 3. 更新 `CLAUDE.md`（保持 ≤ 200 行约束）

- **代码地图表格**新增一行：
  ```
  | `src/web/` | FastAPI + WS 多 thread web 宿主 + ThreadManager 懒启动闲置回收 | docs/modules/web/ |
  ```
- **数据流段**：CLI 数据流不动；如果想加 web 数据流，单独起一段或链向 spec README 的"架构概览"，**不展开完整图**（CLAUDE.md 不放完整部署图，链回 spec）
- **已知文档漂移段**：清掉本次同步已经修复的条目；如果新增漂移，加一行

### 4. 更新 `docs/kongming-agent-v1-minimal/10-contracts.md`

如果 v0.1.5 实现期对协议层有变更（很可能不会，因为 spec 设计上不动现有 contracts），同步：

- `HostAdapter` 协议的 web 端语义补充：`read_input` 在事件驱动宿主里允许 raise NotImplementedError；`prompt_approval` 允许通过 Future map 异步实现
- 如果 EventSink 因为 web 多 thread 路由考虑加了 session_id 字段（**当前 spec 决定不加**），则同步

### 5. 更新 `docs/kongming-agent-v1-minimal/11-v1-file-layout.md`

新增 `src/web/` 段落，列文件级职责。如果只想极简，可以加一行 "详见 docs/modules/web/" 链接过去。

### 6. 部署图归属总图

| 内容 | 落在哪 | 视角 |
|---|---|---|
| 完整 5 形态部署图（CLI / Web / Mac 远程 / Mac 嵌内核 / 并存） | spec README（本目录） | 全景 |
| 形态 2 + 3A 局部图（web 后端 + 浏览器/Mac 远程客户端） | `docs/modules/web/README.md` | web 模块视角 |
| 形态 1 + 3B 局部图（CLIAdapter + 未来 MacAdapter） | `docs/modules/宿主/README.md`（v0.1.6+ 真做 Mac 时再加 3B） | host 适配器视角 |
| 简短文字 + 链接 | CLAUDE.md | 顶层导航 |

**约定**：完整图只在 spec 里更新，modules 里的局部图按模块视角自己维护。一张图不维护两个地方。

### 7. 提交节奏

参考 `8028465` / `cc2821e` 的拆分：
- 单独一个 commit 做 docs 同步（不掺杂代码）
- commit message 风格：`docs(modules): 按 v0.1.5 web 模块同步 N 份文档 + CLAUDE.md`
- 用 `git-commit-separator` skill 把"代码 / 开发文档"两类 commit 分开

## Task 准入清单（进 x-req 前必须确认）

### ws-protocol-v0.1.5

- [ ] LLMPreset 在 setting.yaml 的字段最终确认（见 04-data-and-state.md §1）
- [ ] WS 帧 kind 列表是否完整（v0.1.5 范围内是否还有遗漏）
- [ ] REST 端点列表是否完整（threads / presets / auth / manage 四组）
- [ ] 是否需要在 v0.1.5 里就预留 protocol_version 字段（**当前方案：不预留**）

### thread-manager-v0.1.5 + web-host-adapter-v0.1.5

- [ ] idle_timeout 默认值 1800s 是否合适
- [ ] pending_approval_timeout 默认值 60s 是否合适
- [ ] WS 重连后是否恢复 in-flight turn 的中间内容（**当前方案：不恢复**）
- [ ] thread_id 命名规范 `thread-<hex12>` 是否够避免和 cli session id 冲突

### web-app-shell-v0.1.5

- [ ] 密码初始化流程（env 读一次后清空）的 UX 是否能接受
- [ ] CSRF 防御方案（SameSite=Lax + X-Requested-With）是否够
- [ ] HTTPS 是否在 v0.1.5 强制（**当前方案：不强制**）
- [ ] auth 失败锁定策略（5 次 / 5min）是否合适

### web-frontend-v0.1.5

- [ ] React 19 + Tailwind 4 是否就这么定（兼容性窗口）
- [ ] shadcn/ui 是否就用最新版（注意 Tailwind 4 兼容性）
- [ ] 设计 token 是否通过设计评审（用 design-qbs skill 走一遍）
- [ ] dark mode 默认是否跟随系统（**当前方案：跟随**）
- [ ] e2e 选 Playwright 还是 Cypress（**当前方案：Playwright**，已和 webapp-testing 工具对齐）

## v0.1.5 完成定义（DoD）

满足以下全部即视为 v0.1.5 ready：

1. `make web-build` 在干净环境（仅 Docker）成功产出 `web/dist/`
2. `make web` 起 uvicorn，浏览器访问 `http://localhost:8080` 跳登录页
3. 登录后能：列 thread / 新建 / 重命名 / 删除 / 进入 chat / 流式对话 / 审批弹窗 / 看管理页 / 停某个实例
4. 同时开 3+ thread 并发对话不互相阻塞
5. 重启 uvicorn 后所有 thread 历史可恢复
6. 闲置 30min 自动回收，回来发消息能续跑
7. 所有模块单测覆盖率 ≥ 70%（按现有项目标准）
8. Playwright e2e happy path 通过
9. `docs/modules/web/README.md` 完整描述 src/web/ 各文件
10. `CLAUDE.md` 代码地图加 `src/web/` 行

## 不进入 v0.1.5 的事项（v0.1.6+ 待办）

- per-thread system prompt 模板自定义
- per-thread 工具开关 / 审批模式（always allow 等）
- 多用户隔离 + OAuth
- 移动端 / 响应式
- chat 历史搜索 / 跳转
- 共享 LLM provider pool（同 preset 多 thread 共享 httpx）
- 中断当前 turn / partial cancel
- WS 重连后恢复 in-flight 内容
- WS 加密协商 / 协议版本字段
- 多媒体附件帧
- 主题切换 UI
- i18n
- 强制取消 / token 累计监控（管理页 v0.1.6+）
