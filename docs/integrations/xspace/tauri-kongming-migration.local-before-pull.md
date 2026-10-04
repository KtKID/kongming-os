# x-space Tauri 集成与代码结构迁移步骤

本文定义 kongming-agent 集成到 x-space Tauri 桌面端的迁移步骤。目标是让 x-space 通过 WebView 打开 kongming-agent Web UI，并由本地 Python 后端承载 agent runtime、API、WebSocket、session、trace 和配置管理。

## 目标状态

```text
x-space Tauri app
  ├─ 主 WebView：x-space 壳层
  ├─ 子 WebView：kongming-agent Web UI
  └─ Rust backend manager
       ├─ 启动 kongming-agent Python 后端
       ├─ 注入 KONGMING_CONFIG / KONGMING_HOME / KONGMING_WEB_PORT
       ├─ 等待 /api/health 就绪
       └─ 关闭或重启 Python 后端

kongming-agent Python backend
  ├─ FastAPI app：web.app:create_app
  ├─ Web 控制入口：python -m web.ctl
  ├─ 静态产物：web/dist
  ├─ agent runtime：core / executors / tools / safety / scheduler / evolution
  └─ 运行数据：x-space app data 下的 kongming home
```

## 稳定外部契约

x-space 只依赖以下契约：

| 契约 | 说明 |
|---|---|
| 启动命令 | 开发期可用 `python -m web.ctl start --no-build`，发布期使用桌面专用启动器 |
| 健康检查 | `GET /api/health` 返回 200 后创建子 WebView |
| 访问 URL | `http://127.0.0.1:<port>/` |
| 运行目录 | `KONGMING_HOME=<xspace app data>/kongming/home` |
| 配置文件 | `KONGMING_CONFIG=<xspace app data>/kongming/config/setting.yaml` |
| 端口注入 | `KONGMING_WEB_PORT=<free port>` |
| 静态资源 | FastAPI 从 `web/dist` 托管 SPA |

kongming-agent 内部包名、文件名、目录结构可以迁移，x-space 侧只感知启动命令和 URL。

## x-space 打包内容

### Python 代码包

发布包需要带上 kongming-agent 后端可导入的 Python 包。当前 `pyproject.toml` 的 wheel / sdist 列表需要补齐以下运行包：

```text
src/core
src/tools
src/context            # 迁移后替换为 src/sessions + src/prompting
src/executors
src/host
src/cli
src/safety
src/observability
src/config_loader
src/memory
src/prompts
src/web
src/sitian
src/scheduler
src/evolution
src/network
src/commands
src/devtools
```

`src/devtools` 可作为可选包处理。Web 全量日志开启时需要它。

### Web 静态产物

发布包需要带上：

```text
web/dist/index.html
web/dist/assets/*
web/dist/brand/*       # 存在时一起带上
```

打包前执行：

```powershell
npm --prefix web ci
npm --prefix web run build
```

### 配置与模板资源

发布包需要带上：

```text
config/setting.yaml
src/prompts/templates/AGENT.md
src/prompts/templates/TOOLS.md
src/prompts/templates/USER.md
src/prompts/templates/SITIAN_ANALYZER.md
src/web/approvals/auto/default_rules.yaml
```

首次启动时复制到 x-space app data，再由 `KONGMING_CONFIG` 和 `KONGMING_HOME` 指向运行副本。

## 阶段 0：当前状态确认

在 kongming-agent 仓库执行：

```powershell
git status --short
python -m web.ctl status
npm --prefix web run build
python -m web.ctl start --no-build
curl.exe http://127.0.0.1:55000/api/health
```

在 x-space 仓库执行：

```powershell
cd E:\xgt\proj\x-space\client
pnpm build
cd src-tauri
cargo check
```

验收标准：

```text
kongming-agent Web 后端可启动
web/dist 可生成
x-space Tauri 壳层可编译
```

## 阶段 1：沉淀桌面后端启动契约

### kongming-agent 侧

新增桌面启动入口，建议路径：

```text
src/web/desktop_backend.py
```

职责：

```text
读取 KONGMING_CONFIG
读取 KONGMING_HOME
读取 KONGMING_WEB_HOST / KONGMING_WEB_PORT
校验 web/dist/index.html
启动 uvicorn web.run 或 web.app:create_app
向 stdout 输出 JSON ready 事件
```

建议 ready 事件：

```json
{"type":"kongming_web_ready","url":"http://127.0.0.1:55000/","port":55000,"pid":12345}
```

保留 `python -m web.ctl` 作为开发期控制入口。x-space 开发期可以继续用它，发布期切到桌面启动器。

### x-space 侧

新增 Rust backend manager，建议路径：

```text
client/src-tauri/src/kongming_backend.rs
```

职责：

```text
分配本机空闲端口
准备 app data 目录
复制默认配置
启动 Python 后端进程
读取 ready JSON
轮询 /api/health
返回 WebView URL
应用退出时清理子进程
```

建议 Tauri command：

```text
start_kongming_backend() -> KongmingBackendStatus
stop_kongming_backend() -> KongmingBackendStatus
get_kongming_backend_status() -> KongmingBackendStatus
```

验收标准：

```text
x-space 可启动 kongming-agent 后端
x-space 可拿到 URL
子 WebView 可打开 kongming-agent 首页
应用退出后 Python 进程清理完成
```

## 阶段 2：拆分 context

先拆 `context`，因为它位于 Tauri 集成的运行数据和 prompt 组装边界上。

### 目标结构

```text
src/
  sessions/
    __init__.py
    file_session.py
    session_bootstrap.py
    session_discovery.py
    session_store.py

  prompting/
    __init__.py
    history_compactor.py
    input_assembler.py
    instruction_loader.py
    prompts_loader.py
    runtime_context.py
    sitian_context.py
    skill_loader.py
```

### 迁移表

| 当前文件 | 目标文件 |
|---|---|
| `src/context/file_session.py` | `src/sessions/file_session.py` |
| `src/context/session_bootstrap.py` | `src/sessions/session_bootstrap.py` |
| `src/context/session_discovery.py` | `src/sessions/session_discovery.py` |
| `src/context/session_store.py` | `src/sessions/session_store.py` |
| `src/context/history_compactor.py` | `src/prompting/history_compactor.py` |
| `src/context/input_assembler.py` | `src/prompting/input_assembler.py` |
| `src/context/instruction_loader.py` | `src/prompting/instruction_loader.py` |
| `src/context/prompts_loader.py` | `src/prompting/prompts_loader.py` |
| `src/context/runtime_context.py` | `src/prompting/runtime_context.py` |
| `src/context/sitian_context.py` | `src/prompting/sitian_context.py` |
| `src/context/skill_loader.py` | `src/prompting/skill_loader.py` |

### 同步改动

更新 import：

```text
from context.session_store import build_session
  -> from sessions.session_store import build_session

from context.input_assembler import InputAssembler
  -> from prompting.input_assembler import InputAssembler

from context.skill_loader import load_skill_specs
  -> from prompting.skill_loader import load_skill_specs
```

更新配置：

```text
.importlinter
pyproject.toml wheel packages
pyproject.toml sdist include
tests/unit/test_arch_contracts.py
docs/modules/*
AGENTS.md 代码地图
```

建议在迁移 PR 内保留 `src/context/__init__.py` 的短期 re-export，标注迁移截止版本；开发期接口尚未稳定时也可以直接一次性全仓改 import。

### 验证命令

```powershell
ruff check src tests
pytest tests/unit/test_input_assembler.py tests/unit/test_history_compactor.py tests/unit/test_file_session.py tests/unit/test_sqlite_session.py -v
pytest tests/unit/test_arch_contracts.py -v
lint-imports --config .importlinter
```

验收标准：

```text
session 相关代码只从 sessions 导入
prompt assembly 相关代码只从 prompting 导入
SessionEngine.build 继续装配 InputAssembler 和 HistoryCompactor
Web / CLI / Scheduler 入口通过新路径运行
```

## 阶段 3：开发期联调

开发期使用源码软链接或本地 editable install。

推荐环境变量：

```powershell
$env:XSPACE_KONGMING_WEB_CMD = "python -m web.ctl start --no-build"
$env:XSPACE_KONGMING_WEB_CWD = "E:\xgt\proj\agent-proj\kongming-agent"
$env:KONGMING_CONFIG = "C:\Users\Administrator\AppData\Roaming\com.xspace.dev\kongming\config\setting.yaml"
$env:KONGMING_HOME = "C:\Users\Administrator\AppData\Roaming\com.xspace.dev\kongming\home"
$env:KONGMING_WEB_PORT = "0"
```

x-space backend manager 需要支持两种模式：

```text
dev-source：使用 XSPACE_KONGMING_WEB_CMD / CWD 启动源码
bundled：使用 Tauri resources 内的 Python backend 启动
```

验收标准：

```text
pnpm tauri dev 可启动 x-space
Kongming tab 可打开
/api/health 返回 200
WebSocket 聊天链路可发起一轮 generic chat
日志落到 x-space app data 下
```

## 阶段 4：发布期打包

发布期使用复制产物，降低软链接和 editable install 的路径漂移风险。

推荐资源布局：

```text
client/src-tauri/resources/kongming/
  python/
    python.exe 或 python runtime
  app/
    core/
    tools/
    sessions/
    prompting/
    executors/
    web/
    ...
  web_dist/
    index.html
    assets/
  config/
    setting.yaml
```

Tauri 配置需要加入 resources 或 external binary 策略。Windows 首版可以先用 resources + Rust `Command` 启动内置 Python。

发布构建步骤：

```powershell
cd E:\xgt\proj\agent-proj\kongming-agent
npm --prefix web ci
npm --prefix web run build
python -m pytest tests/unit/test_input_assembler.py tests/unit/test_file_session.py -v

cd E:\xgt\proj\x-space\client
pnpm build
pnpm tauri build
```

验收标准：

```text
安装包包含 kongming Python backend
安装包包含 web/dist
首次启动复制默认 config
Kongming tab 从本地后端打开
卸载或退出不会留下活动 Python 子进程
```

## 阶段 5：重组 web 内部目录

完成 x-space 开发期联调后，再重组 `src/web` 内部目录。

建议目标：

```text
src/web/
  app.py
  desktop_backend.py
  routers/
  websocket/
  threads/
  workspace/
  whiteboard/
  approvals/
  usage/
  integrations/
    claude_code/
    codex/
  dashboard/
  uploads/
  protocol/
```

迁移策略：

```text
保持 web.app:create_app
保持 python -m web.ctl
保持 /api/health
保持 /ws/* 协议
保持 web/dist 静态托管
```

验收标准：

```text
x-space 无需改启动命令
x-space 无需改 WebView URL
kongming-agent import-linter 通过
web 相关单测和至少一轮 Web startup smoke 通过
```

## 风险与处理

| 风险 | 处理 |
|---|---|
| editable install 指向旧源码 | 发布期使用复制产物；开发期启动前检查 `_editable_impl_*.pth` |
| 端口被 Windows 保留 | x-space 分配空闲端口并通过 `KONGMING_WEB_PORT` 注入 |
| `web/dist` 缺失 | backend manager 启动前检查 `index.html` |
| 配置写到 kongming-agent checkout | 强制注入 `KONGMING_CONFIG` 和 `KONGMING_HOME` |
| wheel 缺运行包 | 补齐 `pyproject.toml` packages / sdist include |
| WebView 子进程残留 | x-space backend manager 持有 child handle 并在退出钩子清理 |

## 推荐交付顺序

1. kongming-agent：新增桌面后端启动契约文档和最小 `desktop_backend.py`。
2. kongming-agent：拆 `context` 为 `sessions` / `prompting`，更新 import 和架构规则。
3. x-space：新增 `kongming_backend.rs`，开发期通过源码命令启动。
4. x-space：新增 Kongming tab 创建流程，打开本地后端 URL。
5. kongming-agent：补齐 `pyproject.toml` 打包清单和 Web dist 校验。
6. x-space：把 Python backend、配置模板、`web/dist` 纳入 Tauri release resources。
7. kongming-agent：重组 `web` 内部子域，保持外部契约稳定。

最先执行阶段 1 和阶段 2。它们直接稳定 x-space 集成入口，也能把后续目录重构对桌面端的影响压到启动契约内部。
