# web-multi-thread-frontend (v0.1.5)

> 版本：v0.1.5
> 状态：方案确认（2026-04-26 通过）
> 目标：给 kongming-agent 增加一个 web 宿主壳，支持单用户多 thread 并发对话，每 thread 独立 SessionEngine，浏览器具备苹果级视觉质感
> 长期定位：web 是 v0.1.5 内的**第二个宿主壳**（CLI 之后），同时为未来 Mac / iOS / 第三方原生客户端预留接入路径

## 系统目标

- 让 kongming-agent 在浏览器里也能用，不只是 CLI
- 单用户能同时维持多个独立 thread（每 thread 不同上下文 / 不同 LLM / 不同历史），互不阻塞
- 局域网内可访问（带 auth），但**不**做用户级隔离
- 复用现有内核（`SessionEngine` / `Session` / `ApprovalProvider` / `EventSink`），不新增第二套 runtime
- 前端做出"苹果那种"质感：克制的字号阶梯、八进制 spacing、vibrancy、克制动效

## 范围边界

### 包含

- `src/web/` 模块：FastAPI app + WebSocket 路由 + REST 管理端点 + 简单 cookie session auth
- `web/` 前端工程：React + Vite + TS + Tailwind + shadcn/ui + Framer Motion，**Node 只在 Docker 里**，构建产物 `web/dist/` 不进 git
- ThreadManager：fleet 管理，每 thread 独立 SessionEngine，懒启动 + 30min 闲置回收 + 历史落盘
- WebHostAdapter：基于 WebSocket 实现 HostAdapter；approval 走 Future map 异步配对
- WSEventSink：把 runtime 事件按 thread 推送到对应浏览器
- 复用 SessionBridge.run_once（不复用 run_loop，因 run_loop 的阻塞读模型不适配 web）
- v0.1.5 用户能做的事：登录 / 登出、列出 thread、新建 thread（选 LLM preset + 起名字）、重命名 thread、删除 thread、聊天（流式）、审批弹窗、查看运行中实例（管理页）、停某个实例
- 后端服务化打包（`make web` 起 uvicorn；`make web-build` 走 Docker 构建前端）

### 不包含

- 多用户隔离（单用户系统，登录只是访问门禁）
- per-thread 自定义 system prompt 模板（v0.1.6+）
- per-thread 自定义工具开关 / 审批模式（v0.1.6+）
- thread 多人协作 / 实时多端同步（v0.1.6+）
- 移动端适配（仅桌面浏览器）
- OAuth / SSO（v0.1.5 用 session cookie + 密码）
- 国际化（仅中文）

## 模块导航

| 模块 | 状态 | 文档 | 是否可进 task | 说明 |
|---|---|---|---|---|
| web-app-shell | 方案确认 | [模块拆分 §1](./02-module-breakdown.md#模块-1web-app-shell) | 是 | FastAPI app + auth + static + 路由装配 |
| thread-manager | 方案确认 | [模块拆分 §2](./02-module-breakdown.md#模块-2thread-manager) | 是 | fleet 管理 / 懒启动 / 闲置回收 / 持久化扫描 |
| web-host-adapter | 方案确认 | [模块拆分 §3](./02-module-breakdown.md#模块-3web-host-adapter) | 是 | WebHostAdapter + WSEventSink + ApprovalFuture map |
| ws-protocol | 方案确认 | [模块拆分 §4](./02-module-breakdown.md#模块-4ws-protocol) | 是 | WS / REST 帧 schema + 序列化约定 |
| frontend | 方案确认 | [模块拆分 §5](./02-module-breakdown.md#模块-5frontend) | 是 | React + Tailwind + shadcn/ui + Docker 构建 |

## 文档导航

- [模块拆分](./02-module-breakdown.md) — 五个模块的职责 / 边界 / 依赖 / v0.1.5 字段 vs v0.1.6+ 扩展
- [核心流程](./03-core-workflows.md) — 启动 / 登录 / 新建 thread / 一轮对话 / 审批 / 闲置回收 时序
- [数据与状态](./04-data-and-state.md) — ThreadMetadata schema / 持久化 / 事件路由 / Future map / 安全约束
- [Task 映射](./90-task-map.md) — 模块 → task 名 → x-req 准入条件
- [媒体发送补充方案](./spec-media-input-README.md) — 图片发送落地、视频发送演进、附件协议与资产存储补充规划
- [sticky 侧栏补充方案](./spec-sticky-relay-README.md) — workspace 级白板、多卡片自由摆放、卡片即 markdown 文件
- [workspace 壳层补充方案](./spec-workspace-shell-README.md) — `Chat / Files / Git / Shell` 四 tab 工作区壳层、状态树、路由合同与 task 拆分

## 架构概览（速读版）

```
Browser（多 tab，每 tab 一个 thread + 一条 WS）
  │
  ▼
单 Python 进程（uvicorn + FastAPI）
  ├─ Auth 中间件 + 静态 web/dist/ + REST /api/* + WS /ws/threads/{id}
  ▼
ThreadManager（单例）
  └─ dict[thread_id, ThreadCell] + lazy boot + idle GC + 启动时扫盘
       │
       └─ ThreadCell（每 thread 私有装配）
            ├─ SessionEngine（独占 LLM provider / tools / safety）
            ├─ SessionBridge（仅复用 run_once，不用 run_loop）
            ├─ WebHostAdapter（write_output → WS / approval → Future）
            ├─ Session（落 file / sqlite）
            └─ EventSinks（JsonlTraceSink + WSEventSink）
```

详见 [核心流程](./03-core-workflows.md) 里的完整时序图和拆解视图。

## 设计语言（Apple 级质感目标）

- **Typography**：SF Pro / PingFang SC；阶梯 11/13/15/17/22/28/40；行高 1.4–1.6；字重克制（标题 600 / 正文 400 / 控件 500）
- **Spacing**：4/8/12/16/24/32/48/64 八进制，禁止奇数；chat 消息块外边距 ≥ 24
- **Color / Material**：backdrop-filter blur 做 vibrancy；primary 系统蓝 #007AFF / #0A84FF；Dark mode 一等公民
- **Motion**：禁用 `ease-in-out`；用 `cubic-bezier(0.32, 0.72, 0, 1)` 或 `cubic-bezier(0.4, 0, 0.2, 1)`；时长 150 / 250 / 350ms
- **质感细节**：双层阴影、圆角 8/12/16、1px 描边亮 `rgba(0,0,0,.06)` 暗 `rgba(255,255,255,.08)`、按钮按下 `scale(0.97)`、流式打字带光标闪烁
- **配套技术栈**：Tailwind + 自定义 design tokens、shadcn/ui（参考 Apple HIG，**不抄具体资源**）、Framer Motion 做 spring 动效

## 未来宿主扩展（v0.1.6+）

本 spec 在架构上预留了**两个互不重叠的扩展口**，让未来的 Mac / iOS / TUI / 第三方客户端不需要改动 v0.1.5 已落地的代码就能接入。

```
┌──────────────────────────────────────────────────────────────────┐
│ 口子 A：HostAdapter（嵌内核宿主）                                  │
│   src/host/base.py 定义的协议；CLI / Web 都是它的实现               │
│                                                                    │
│   适合：Mac standalone .app（嵌 Python 内核）                       │
│         Linux 桌面 app（同上）                                      │
│         未来游戏 / NPC bot（Python 内嵌）                            │
│                                                                    │
│   扩展方式：实现 HostAdapter 协议（≈ 100 行）                       │
│             参考 src/host/cli_adapter.py 或 src/web/app_support/host_adapter.py │
│                                                                    │
│   复用程度：内核 100% 不变（runtime / runner / safety / tools）     │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ 口子 B：ws-protocol（远程客户端）                                   │
│   src/web/protocol/ 定义的 WS / REST 帧 schema                     │
│                                                                    │
│   适合：Mac SwiftUI 原生客户端（连远程 web 服务）                    │
│         iOS / iPadOS 原生 app                                      │
│         TUI / 终端远程客户端                                        │
│         第三方集成（IDE 插件 / Slack bot / Discord bot）             │
│                                                                    │
│   扩展方式：用目标语言（Swift / Kotlin / Go / Rust ...）实现帧 schema │
│             一份 Codable / serde struct，就是一个完整客户端         │
│                                                                    │
│   复用程度：整个 web 后端 + 全部行为契约（流式 / 审批 / 重连）        │
└──────────────────────────────────────────────────────────────────┘
```

**两条路径互不排斥**——同一个 Mac SwiftUI 工程可以同时支持"远程模式"（走口子 B）和"本地模式"（走口子 A，嵌 Python 子进程），实现 local-first + cloud-sync 这种 Linear / Notion 风格的混合架构。

### Mac 原生客户端的具体路径对比

| 路径 | 触达口子 | 后端改动 | Mac 端工程 | 部署形态 | 工程量估算 |
|---|---|---|---|---|---|
| **A：Mac SwiftUI + 远程 WS 后端** | 仅口子 B | **零** | Swift WS 客户端 + SwiftUI UI | 用户家有 kongming server | ~ 2-4 周 |
| **B：Mac SwiftUI + 嵌入 Python 内核** | 仅口子 A | 加 `src/host/mac_adapter.py` ≈ 100 行 | Swift UI + Python.framework / PyOxidizer 打包 + PyObjC 或 stdio JSON-RPC bridge | 单 .app，离线可用 | ~ 1.5-3 月 |
| **C：A + B 混合（local-first + cloud）** | 同时用 A 和 B | 同 B | 同 B + 模式切换层 | .app 可联网也可离线 | ~ 3-6 月 |

**v0.1.5 不实现任何 Mac 工作**，只是把 spec 设计上保证后续做 Mac 时**不需要重构现有代码**。

### "原生"的具体含义（避免歧义）

- **属于"原生"**：SwiftUI / AppKit / SF Symbols / 系统 vibrancy / 原生菜单栏 / 原生快捷键 / 原生通知 / Metal 加速
- **不属于"原生"**：WKWebView 包 React、Electron、Tauri、React Native macOS

v0.1.5 的 web frontend（React + Tailwind）只服务浏览器，**不**会被 WKWebView 二次封装当成"伪 Mac app"——如果做 Mac 客户端，就重写 SwiftUI，不复用 React 代码。

### 内核约束（不可破坏）

为了保证两个口子长期可用，v0.1.5 实现期严格遵守：

- 内核（`src/core/` / `src/executors/` / `src/safety/` / `src/tools/`）**不**为任何特定宿主写特例代码
- 新增任何"宿主特性"代码，必须落到 `src/host/<adapter>` 或 `src/web/protocol/` 之一，不能跨界
- `HostAdapter` 协议字段在 v0.1.6+ 修改时，必须同步检查 CLI / Web 两个已存在实现都能改造（避免给后人挖坑）

## 当前建议（下一步）

1. **五个模块都已具备进入 x-req 的条件**——边界、依赖、v0.1.5 surface 都已锁定，没有遗留的"边界未定"
2. 推荐 **task 拆分顺序**（前三个有强依赖，后两个可并行）：
   1. `ws-protocol`：先把 WS / REST 帧 schema 钉死，是其它模块的接口契约
   2. `thread-manager` + `web-host-adapter`：后端核心，可以一起走 x-req（合一个 task 也合理）
   3. `web-app-shell`：把上述拼装成 FastAPI app + auth + 静态服务
   4. `frontend`：拿到 ws-protocol 后即可独立开发
3. 进入 x-req 之前，**先确认 `LLMPreset` 在 `setting.yaml` 里的 schema**（这是 ws-protocol 和 frontend 都要消费的契约），见 [数据与状态 §1](./04-data-and-state.md#1-llmpreset-schema)
4. 部分依赖项（fastapi / uvicorn / 一个 auth 工具）需要新增到 `pyproject.toml` 的 `[project.optional-dependencies] web = [...]`，**不进默认 sync**

## 与项目其它文档的关系

- `CLAUDE.md` 代码地图：v0.1.5 实现完成后回写新增 `src/web/` 行 + 链到 `docs/modules/web/README.md`
- `docs/kongming-agent-v1-minimal/10-contracts.md`：`HostAdapter` 协议在 web 端的语义补充（`read_input` 不被使用，`prompt_approval` 走 Future）需要在合约文档里加一段 web 适配说明
- `docs/modules/`：v0.1.5 落地后新增 `docs/modules/web/README.md`（按现有模块文档模板，不在 brainstorming 阶段写）
- `docs/safety-shell-intent-v0.1.5/`：与本 spec 同属 v0.1.5 release，互不冲突；如果 safety 端有协议级变更（比如新增审批字段），ws-protocol 需要相应同步

## 版本归属

- **v0.1.5**：本 spec 涵盖全部内容（5 个模块 + Apple 级前端质感 + Docker 构建管线）
- **v0.1.6+**：see [未来宿主扩展](#未来宿主扩展v016) 一节里的 Mac / iOS / 第三方客户端路径
