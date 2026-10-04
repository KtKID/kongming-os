# 代码目录迁移计划 0608

本文基于 [代码重构建议0608.md](代码重构建议0608.md) 制定纯代码目录迁移步骤。范围聚焦 `src/` Python 包、import 路径、`.importlinter`、打包清单、测试与模块文档。x-space / Tauri / WebView / sidecar 打包路径见 [xspace-tauri-kongming-migration.md](xspace-tauri-kongming-migration.md)。

## 迁移目标

```text
src/
  core/                         # 保留内核语义与协议真源
  sessions/                     # 原 context 中的 session 历史、持久化、发现、恢复
  prompting/                    # 原 context 中的 prompt assembly、instruction、compaction、skill loading
    assembly/
    instructions/
    compaction/
    skills/
    context_sources/
  tools/
    runtime/                    # ToolRegistry、BaseBuiltinTool、approval adapter
    builtin/                    # file / shell / memory / schedule / evolution / skill tools
  web/
    routers/
    websocket/
    threads/
    workspace/
    whiteboard/
    approvals/
    integrations/
      claude_code/
      codex/
    dashboard/
    uploads/
    protocol/
  executors/                    # 阶段 4 再拆 llm providers / runtime assembly
  infrastructure/               # 阶段 4 引入：config / tracing / llm providers
  runtime_assembly/             # 阶段 4 引入：全局 composition root
```

核心取舍：

- `core/` 先保留。当前 `AGENTS.md`、`.importlinter`、测试都围绕 `core/contracts.py` 与 `core/runner.py` 建立。
- `src/prompts/` 继续作为纯模板包。Python prompt assembly 代码迁到 `prompting/`。
- 每个阶段全仓更新 import，旧路径清零。开发期接口尚未稳定，迁移以直接改代码为准。
- 每个阶段都更新 `.importlinter`、`pyproject.toml`、测试、模块文档。

本轮保留 / 推迟 / 退出项：

```text
保留 core 顶层包名，core -> kernel 评估结论为维持现状。
保留 src/ 单层 package 布局，src/kongming_agent/ namespace 包迁移已废弃。
保留 web 顶层包名到下一轮 hosts/web 迁移计划。
保留 cli 顶层入口到下一轮 hosts/cli 迁移计划。
application/ 用例层进入下一轮安全域 / 用例层 / 宿主层迁移计划。
```

## 阶段 0：迁移前基线

目标：确认当前代码和规则状态，给后续每个阶段提供对比基线。

执行：

```powershell
git status --short
rg -n '(^|\s)(from|import)\s+context(\.|\s|$)|context\.' src tests --glob "*.py"
rg -n '(^|\s)(from|import)\s+tools\.(base|registry|approval|file_tools|shell_tool|memory_tool|schedule_tool|evolution_write_tool)(\.|\s|$)|tools\.(base|registry|approval|file_tools|shell_tool|memory_tool|schedule_tool|evolution_write_tool)' src tests --glob "*.py"
rg -n '(^|\s)(from|import)\s+web\.' src tests --glob "*.py"
ruff check src tests
pytest tests/unit/test_arch_contracts.py -v
lint-imports --config .importlinter
```

记录：

```text
context import 命中数量
tools 旧模块 import 命中数量
web 顶层模块 import 命中数量
import-linter 当前通过状态
```

验收：

```text
基线命令结果已记录
工作树中的非本任务改动已识别
迁移分支或 worktree 已准备
```

## 阶段 1：拆 context 为 sessions / prompting

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

### 文件迁移表

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

### import 改写

```text
from context.session_store import build_session
  -> from sessions.session_store import build_session

from context.file_session import FileSession
  -> from sessions.file_session import FileSession

from context.input_assembler import InputAssembler
  -> from prompting.assembly.input_assembler import InputAssembler

from context.history_compactor import HistoryCompactor
  -> from prompting.compaction.history_compactor import HistoryCompactor

from context.skill_loader import load_skill_specs
  -> from prompting.skills.skill_loader import load_skill_specs
```

### 同步更新

`.importlinter`：

```text
root_packages 添加 sessions / prompting
root_packages 移除 context
core forbidden_modules 添加 sessions / prompting
layered-dependency-direction 中 context 替换为 sessions | prompting
SessionEngine / Scheduler 的 context ignore_imports 改成 sessions / prompting
web app shell forbidden_modules 添加 sessions / prompting
network-tools-private source_modules 添加 sessions / prompting
```

`pyproject.toml`：

```text
wheel packages 添加 src/sessions / src/prompting
wheel packages 移除 src/context
sdist include 添加 src/sessions / src/prompting
sdist include 移除 src/context
isort known-first-party 添加 sessions / prompting，移除 context
coverage source 添加 sessions / prompting，移除 context
ruff per-file ignores 中 context 路径替换为新路径
```

测试和文档：

```text
tests/unit/test_arch_contracts.py 中 context 合约改为 sessions / prompting 合约
tests/unit/context/* 目录按新归属改名
docs/modules/上下文/ 拆为 docs/modules/会话/ 与 docs/modules/提示组装/
docs/kongming-agent-v1-minimal/10-contracts.md 更新依赖边界
docs/kongming-agent-v1-minimal/11-v1-file-layout.md 更新文件职责
AGENTS.md 代码地图更新
```

### 验证

```powershell
rg -n '(^|\s)(from|import)\s+context(\.|\s|$)|context\.' src tests --glob "*.py"
ruff check src tests
pytest tests/unit/test_input_assembler.py tests/unit/test_history_compactor.py -v
pytest tests/unit/test_file_session.py tests/unit/test_sqlite_session.py tests/unit/test_session_discovery.py -v
pytest tests/unit/test_skill_loader.py tests/unit/test_skill_assemble.py -v
pytest tests/unit/test_instruction_loader.py tests/unit/test_prompts_loader.py tests/unit/test_runtime_context.py -v
pytest tests/unit/context/test_input_assembler_media.py tests/unit/test_skill_materializer.py -v
pytest tests/unit/test_web_run_factory.py tests/unit/test_web_cron_prompt_dump.py -v
pytest tests/e2e/test_cli_integration.py tests/e2e/test_file_session_integration.py -v
pytest tests/unit/test_arch_contracts.py -v
lint-imports --config .importlinter
```

验收：

```text
context import 命中为 0
src/context 目录已移除
Session 相关代码只归 sessions
Prompt / instruction / skill loading 相关代码只归 prompting
CLI / Web / Scheduler / SessionEngine 入口可导入
```

## 阶段 1.5：prompting 二级拆分

阶段 1 完成后，立即把 `prompting/` 再拆一层，避免它成为新的宽泛目录。

### 目标结构

```text
src/prompting/
  __init__.py
  assembly/
    __init__.py
    input_assembler.py
    runtime_context.py
  instructions/
    __init__.py
    instruction_loader.py
    prompts_loader.py
  compaction/
    __init__.py
    history_compactor.py
  skills/
    __init__.py
    skill_loader.py
  context_sources/
    __init__.py
    sitian_context.py
```

目录职责：

```text
assembly：组装最终 LLM 输入
instructions：加载系统指令和 prompt 模板
compaction：历史压缩
skills：skill 发现与注入
context_sources：SiTian 等额外上下文来源
```

### import 改写

```text
from prompting.input_assembler import InputAssembler
  -> from prompting.assembly.input_assembler import InputAssembler

from prompting.runtime_context import build_runtime_context_text
  -> from prompting.assembly.runtime_context import build_runtime_context_text

from prompting.instruction_loader import InstructionLoader
  -> from prompting.instructions.instruction_loader import InstructionLoader

from prompting.prompts_loader import materialize_and_load_prompts
  -> from prompting.instructions.prompts_loader import materialize_and_load_prompts

from prompting.history_compactor import HistoryCompactor
  -> from prompting.compaction.history_compactor import HistoryCompactor

from prompting.skill_loader import load_skill_specs
  -> from prompting.skills.skill_loader import load_skill_specs

from prompting.sitian_context import build_sitian_context_text
  -> from prompting.context_sources.sitian_context import build_sitian_context_text
```

### 同步更新

```text
.importlinter ignore_imports 精确到 prompting.* 子包
pyproject.toml ruff per-file ignores 更新到新路径
tests/unit/prompting/* 目录按二级归属调整
docs/modules/提示组装/README.md 更新二级目录职责
AGENTS.md 代码地图更新 prompting 二级目录
```

### 验证

```powershell
rg -n '(^|\s)(from|import)\s+prompting\.(input_assembler|runtime_context|instruction_loader|prompts_loader|history_compactor|skill_loader|sitian_context)(\.|\s|$)|prompting\.(input_assembler|runtime_context|instruction_loader|prompts_loader|history_compactor|skill_loader|sitian_context)' src tests --glob "*.py"
ruff check src tests
pytest tests/unit/test_input_assembler.py tests/unit/test_instruction_loader.py tests/unit/test_prompts_loader.py -v
pytest tests/unit/test_history_compactor.py tests/unit/test_skill_loader.py tests/unit/test_sitian_context.py -v
lint-imports --config .importlinter
```

验收：

```text
prompting 顶层实现模块 import 命中为 0
assembly / instructions / compaction / skills / context_sources 边界清晰
src/prompts 继续只含模板和空 __init__.py
```

### 进度记录

| 日期 | 阶段 | 状态 | 代码提交 | 说明 |
|---|---|---|---|---|
| 2026-06-08 | 阶段 1：`context -> sessions / prompting` | 已完成 | `1ad9677` | 已完成代码拆包、import 改写、架构规则和测试更新 |
| 2026-06-08 | 阶段 1.5：`prompting` 二级拆分 | 已完成 | `d541f8b` | 已完成 `assembly / instructions / compaction / skills / context_sources` 二级拆分 |
| 2026-06-08 | 阶段 2：`tools -> runtime / builtin` | 已完成 | `19d01e2` | 已完成工具 runtime / builtin 二级拆分、import 改写、测试归属调整 |
| 2026-06-08 | 阶段 3 第一批：WebSocket | 已完成 | `dce1b41` | 已完成 `web.websocket` 子域拆分、WS import 改写、WS 相关测试验证 |
| 2026-06-08 | 阶段 3 第二批：Threads | 已完成 | `979eaf3` | 已完成 `web.threads` 子域拆分、thread import 改写、thread 相关测试验证 |
| 2026-06-08 | 阶段 3 第三批：Workspace / Whiteboard | 已完成 | `64330ca` | 已完成 `web.workspace` / `web.whiteboard` 子域拆分、相关测试验证 |
| 2026-06-08 | 阶段 3 第四批：Approvals / Integrations | 已完成 | `5d0f931` | 已完成 `web.approvals` / `web.integrations` 子域拆分、相关测试验证 |
| 2026-06-08 | 阶段 3 第五批：Auth / Shared / App Support / Usage | 已完成 | `b650e21` | 已完成 `web.auth` / `web.shared` / `web.app_support` / `web.usage` 子域拆分、相关测试验证 |
| 2026-06-08 | 阶段 4：Infrastructure / Runtime Assembly | 已完成 | `0e12814` | 已完成 `infrastructure.config` / `infrastructure.llm_providers` / `infrastructure.tracing` / `runtime_assembly` 拆分、全仓 import 改写、架构规则更新 |
| 2026-06-08 | 阶段 5：Contracts Package | 已完成 | `c0649a0` | 已完成 `core.contracts` package 拆分，公共 import 路径保持 `from core.contracts import ...` |
| 2026-06-08 | 阶段 6：`core -> kernel` 命名评估 | 已评估，退出迁移范围 | — | 当前保留 `core` 命名，后续迁移计划聚焦 safety / application / hosts |

## 阶段 2：重组 tools 为 runtime / builtin

### 目标结构

```text
src/tools/
  __init__.py
  runtime/
    __init__.py
    approval.py
    base.py
    registry.py
  builtin/
    __init__.py
    file_tool.py
    shell_tool.py
    memory_tool.py
    schedule_tool.py
    evolution_write_tool.py
    skill_tool.py
```

### 文件迁移表

| 当前文件 | 目标文件 |
|---|---|
| `src/tools/base.py` | `src/tools/runtime/base.py` |
| `src/tools/registry.py` | `src/tools/runtime/registry.py` |
| `src/tools/approval.py` | `src/tools/runtime/approval.py` |
| `src/tools/file_tools.py` | `src/tools/builtin/file_tool.py` |
| `src/tools/shell_tool.py` | `src/tools/builtin/shell_tool.py` |
| `src/tools/memory_tool.py` | `src/tools/builtin/memory_tool.py` |
| `src/tools/schedule_tool.py` | `src/tools/builtin/schedule_tool.py` |
| `src/tools/evolution_write_tool.py` | `src/tools/builtin/evolution_write_tool.py` |
| `src/tools/builtin/skill_tool.py` | 保持 `src/tools/builtin/skill_tool.py` |

### import 改写

```text
from tools.base import BaseBuiltinTool
  -> from tools.runtime.base import BaseBuiltinTool

from tools.registry import ToolRegistry
  -> from tools.runtime.registry import ToolRegistry

from tools.approval import AutoAllowApproval
  -> from tools.runtime.approval import AutoAllowApproval

from tools.file_tools import ReadFileTool
  -> from tools.builtin.file_tool import ReadFileTool

from tools.shell_tool import ShellTool
  -> from tools.builtin.shell_tool import ShellTool

from tools.schedule_tool import build_schedule_tool
  -> from tools.builtin.schedule_tool import build_schedule_tool
```

`tools/__init__.py` 继续作为公共聚合入口，内部改为从新路径导入。使用范围受限：

```text
业务内部代码使用精确路径：
from tools.runtime.registry import ToolRegistry
from tools.builtin.file_tool import ReadFileTool

CLI / Web / 测试 / 外部宿主可以使用聚合入口：
from tools import ToolRegistry
```

聚合入口用于宿主入口和外部消费，内部实现用精确路径表达边界。调用方示例：

```python
from tools import ToolRegistry, ReadFileTool, ShellTool
```

### 同步更新

```text
.importlinter Contract 4 source_modules 仍为 tools
.importlinter 中 tools.schedule_tool ignore_imports 改为 tools.builtin.schedule_tool
pyproject.toml per-file ignores 路径替换为 tools/runtime 与 tools/builtin
测试文件名按新模块归属调整
docs/modules/工具/README.md 更新工具 runtime / builtin 边界
```

### 验证

```powershell
rg -n '(^|\s)(from|import)\s+tools\.(base|registry|approval|file_tools|shell_tool|memory_tool|schedule_tool|evolution_write_tool)(\.|\s|$)|tools\.(base|registry|approval|file_tools|shell_tool|memory_tool|schedule_tool|evolution_write_tool)' src tests --glob "*.py"
ruff check src tests
pytest tests/unit/tools/runtime/test_base.py tests/unit/tools/runtime/test_registry.py -v
pytest tests/unit/tools/builtin/test_file_tool.py tests/unit/tools/builtin/test_shell_tool.py -v
pytest tests/unit/tools/builtin/test_memory_tool.py tests/unit/tools/builtin/test_schedule_tool.py -v
pytest tests/unit/tools/runtime/test_approval.py tests/unit/tools/runtime/test_approval_action.py -v
lint-imports --config .importlinter
```

验收：

```text
旧 tools 子模块 import 命中为 0
Tool runtime 文件只归 tools/runtime
内置工具实现只归 tools/builtin
tools/__init__.py 公共聚合入口可用
```

## 阶段 3：web 包内按子域重组

先在 `web/` 包内重组，保留 `web.app:create_app`、`python -m web.ctl`、`web.run`、`web/dist` 和现有 HTTP / WS 协议。

### 目标结构

```text
src/web/
  app.py
  ctl.py
  run.py
  static.py
  auth/
    middleware.py
    secrets.py
  shared/
    reconnectable_writer.py
    session_manager.py
  protocol/
  routers/
  websocket/
    routes.py
    event_sink.py
    fanout.py
    thread_status.py
    cron.py
  threads/
    manager.py
    cell.py
    metadata.py
    types.py
  workspace/
    model.py
    git.py
    shell.py
  whiteboard/
    manager.py
    store.py
  approvals/
    auto/
    global_inbox/
  integrations/
    claude_code/
    codex/
  dashboard/
  uploads/
  usage/
  workflow/
  app_support/
    app_lock.py
    startup_progress.py
    slash_candidates_loader.py
    path_utils.py
    llm_protocol.py
```

### Web 子域规则

```text
web/routers 只做 HTTP 参数解析、鉴权、调用 service、返回 response。
web/threads 负责 thread 业务状态。
web/workspace 负责 workspace 模型和操作。
web/whiteboard 负责 whiteboard 状态和存储。
web/websocket 负责 WS 连接、fanout、event sink。
web/integrations 负责 Claude Code / Codex 等外部频道。
web/app_support 负责 app shell 辅助模块，不承载业务状态。
```

import 方向：

```text
web/routers 可以 import web/threads、web/workspace、web/whiteboard、web/approvals。
web/threads、web/workspace、web/whiteboard 禁止 import web/routers。
web/protocol 继续零 sibling 依赖。
web/app.py 继续作为 FastAPI 装配入口。
```

### 第一批迁移：WebSocket

| 当前文件 | 目标文件 |
|---|---|
| `src/web/websocket/routes.py` | `src/web/websocket/routes.py` |
| `src/web/websocket/event_sink.py` | `src/web/websocket/event_sink.py` |
| `src/web/websocket/fanout.py` | `src/web/websocket/fanout.py` |
| `src/web/websocket/thread_status.py` | `src/web/websocket/thread_status.py` |
| `src/web/websocket/cron.py` | `src/web/websocket/cron.py` |

验证：

```powershell
pytest tests/unit/web -k "ws or websocket or thread_status" -v
pytest tests/integration/test_interrupt_multi_tab_fanout.py tests/integration/test_full_log_smoke.py -v
lint-imports --config .importlinter
```

### 第二批迁移：Threads

| 当前文件 | 目标文件 |
|---|---|
| `src/web/threads/manager.py` | `src/web/threads/manager.py` |
| `src/web/threads/cell.py` | `src/web/threads/cell.py` |
| `src/web/threads/metadata.py` | `src/web/threads/metadata.py` |
| `src/web/threads/types.py` | `src/web/threads/types.py` |

验证：

```powershell
pytest tests/unit/web -k "thread or metadata" -v
pytest tests/integration/test_interrupt_then_resume.py -v
lint-imports --config .importlinter
```

### 第三批迁移：Workspace / Whiteboard

| 当前文件 | 目标文件 |
|---|---|
| `src/web/workspace.py` | `src/web/workspace/model.py` |
| `src/web/workspace_git.py` | `src/web/workspace/git.py` |
| `src/web/workspace_shell.py` | `src/web/workspace/shell.py` |
| `src/web/whiteboard_manager.py` | `src/web/whiteboard/manager.py` |
| `src/web/whiteboard_store.py` | `src/web/whiteboard/store.py` |

同步更新：

```text
web.routers.workspace_git / workspace_shell / whiteboard 的 import
.importlinter whiteboard-isolation contract
docs/modules/Web前端/README.md
```

验证：

```powershell
pytest tests/unit/web -k "workspace or whiteboard" -v
pytest tests/integration/web -k "workspace or whiteboard" -v
lint-imports --config .importlinter
```

### 第四批迁移：Approvals / Integrations

| 当前路径 | 目标路径 |
|---|---|
| `src/web/approvals/auto/` | `src/web/approvals/auto/` |
| `src/web/approvals/global_inbox/` | `src/web/approvals/global_inbox/` |
| `src/web/integrations/claude_code/` | `src/web/integrations/claude_code/` |
| `src/web/integrations/codex/` | `src/web/integrations/codex/` |

同步更新：

```text
.importlinter Contract 6 ignore_imports
.importlinter usage-token-encapsulation source_modules
tests/integration/web/approvals/global_inbox 路径与 import
docs/modules/Web前端/README.md
```

验证：

```powershell
pytest tests/integration/web/approvals/global_inbox -v
pytest tests/integration/web/integrations/claude_code -v
pytest tests/unit/web/integrations/codex -v
pytest tests/unit/web/integrations/claude_code -v
lint-imports --config .importlinter
```

### 第五批迁移：Auth / Shared / App Support / Usage

| 当前路径 | 目标路径 |
|---|---|
| `src/web/auth.py` | `src/web/auth/middleware.py` |
| `src/web/auth_secrets.py` | `src/web/auth/secrets.py` |
| `src/web/_shared/` | `src/web/shared/` |
| `src/web/usage_token_v2/` | `src/web/usage/usage_token_v2/` |
| `src/web/cron_delivery.py` | `src/web/app_support/cron_delivery.py` |
| `src/web/startup_progress.py` | `src/web/app_support/startup_progress.py` |
| `src/web/slash_candidates_loader.py` | `src/web/app_support/slash_candidates_loader.py` |
| `src/web/host_adapter.py` | `src/web/app_support/host_adapter.py` |
| `src/web/llm_protocol.py` | `src/web/app_support/llm_protocol.py` |
| `src/web/path_utils.py` | `src/web/app_support/path_utils.py` |
| `src/web/_app_lock.py` | `src/web/app_support/app_lock.py` |

同步更新：

```text
.importlinter Contract 6 web app shell source_modules / forbidden_modules / ignore_imports
.importlinter usage-token-encapsulation source_modules / forbidden_modules
tests/unit/web/auth* / usage_token* / dashboard config imports
docs/modules/Web前端/README.md
```

验证：

```powershell
pytest tests/unit/test_web_auth_secrets.py tests/unit/test_web_auth_middleware.py tests/unit/test_web_routers_auth.py tests/unit/test_web_startup_progress.py tests/unit/test_web_host_adapter.py tests/unit/test_web_app_lifespan.py tests/unit/test_web_app_lifespan_scheduler.py tests/unit/web/test_path_utils.py tests/unit/web/test_cron_delivery.py tests/unit/web/usage/usage_token_v2/test_manager.py tests/unit/web/usage/usage_token_v2/test_derive_generic.py tests/unit/web/usage/usage_token_v2/test_derive_codex.py tests/unit/web/usage/usage_token_v2/test_derive_claude.py tests/unit/web/dashboard/config/test_router.py tests/unit/web/dashboard/config/test_restart.py tests/unit/web/dashboard/config/test_manager.py tests/unit/web/dashboard/config/test_schema.py tests/unit/web/dashboard/config/test_router_endpoints.py tests/unit/web/dashboard/config/test_writer.py -v
pytest tests/integration/web -k "usage or auth or global_inbox" -v
lint-imports --config .importlinter
```

### web 阶段总验收

```powershell
rg -n '(^|\s)(from|import)\s+web\.(ws|ws_event_sink|ws_fanout|thread_status_ws|cron_ws|thread_manager|thread_cell|thread_metadata|workspace|workspace_git|workspace_shell|whiteboard_manager|whiteboard_store|auto_approval|global_approvals|claude_code|codex|auth|auth_secrets|usage_token_v2|_shared|cron_delivery|startup_progress|slash_candidates_loader|host_adapter|llm_protocol|path_utils|_app_lock)(\.|\s|$)|web\.(ws|ws_event_sink|ws_fanout|thread_status_ws|cron_ws|thread_manager|thread_cell|thread_metadata|workspace|workspace_git|workspace_shell|whiteboard_manager|whiteboard_store|auto_approval|global_approvals|claude_code|codex|auth|auth_secrets|usage_token_v2|_shared|cron_delivery|startup_progress|slash_candidates_loader|host_adapter|llm_protocol|path_utils|_app_lock)' src tests --glob "*.py"
ruff check src tests
pytest tests/unit/web -v
pytest tests/integration/web -v
python -m web.ctl status
lint-imports --config .importlinter
```

验收：

```text
web 顶层杂散模块 import 清零
web.app / web.run / web.ctl 入口保持可导入
HTTP router 注册路径保持稳定
WebSocket 路径保持稳定
web/routers 保持薄 HTTP 胶水层
```

## 阶段 4：拆 infrastructure 与 runtime_assembly

本阶段处理外部适配、基础设施命名和全局装配层归属。`session_engine.py` 属于 composition root，放到 `runtime_assembly/`，与 `infrastructure/` 平级。

### 目标结构

```text
src/
  infrastructure/
    __init__.py
    config/
      __init__.py
      loader.py
      models.py
      errors.py
      paths.py
    llm_providers/
      __init__.py
      base.py
      openai_responses.py
      anthropic_messages.py
      anthropic_stream_parser.py
      openai_compat_stream_parser.py
      media_adapter.py
      provider_factory.py
      raw_dump.py
      reasoning.py
      sse_reader.py
    tracing/
      __init__.py
      trace_sink.py
      prompt_debug_dump.py

  runtime_assembly/
    __init__.py
    session_engine.py
    runtime_factory.py
```

### 文件迁移表

| 当前路径 | 目标路径 |
|---|---|
| `src/config_loader/*` | `src/infrastructure/config/*` |
| `src/executors/llm/*` | `src/infrastructure/llm_providers/*` |
| `src/executors/agent_runtime/session_engine.py` | `src/runtime_assembly/session_engine.py` |
| `src/observability/*` | `src/infrastructure/tracing/*` |

### 同步更新

```text
全仓 import 替换
.importlinter root_packages 添加 infrastructure，移除 executors / observability / config_loader
runtime_assembly 添加 root package
SessionEngine 白名单改为 runtime_assembly.session_engine
scheduler.runtime_factory / evolution reviewer runtime import 改写
pyproject.toml packages / sdist include 更新
pyproject.toml isort known-first-party / coverage source 更新
.importlinter Contract 3/5/6/7/8/9/12 全量检查和改写
AGENTS.md SessionEngine 白名单和 reasoning adapter 规则更新
docs/kongming-agent-v1-minimal/10-contracts.md 更新 SessionEngine 边界
docs/kongming-agent-v1-minimal/11-v1-file-layout.md 更新文件职责
docs/modules/执行器/ 与 docs/modules/观测/ 合并或改名
```

### 验证

```powershell
rg -n '(^|\s)(from|import)\s+(executors|observability|config_loader)(\.|\s|$)|(executors|observability|config_loader)\.' src tests --glob "*.py"
ruff check src tests
pytest tests/unit/test_native_runtime.py tests/unit/test_anthropic_provider.py tests/unit/test_base_llm_provider_client.py -v
pytest tests/unit/test_config_loader.py tests/unit/test_trace_sink.py -v
pytest tests/unit/scheduler tests/unit/test_evolution_reviewer_runtime.py -v
lint-imports --config .importlinter
```

验收：

```text
外部适配代码归 infrastructure
runtime assembly 与 core runner 边界清晰
CLI / Web / Scheduler / Evolution 装配入口可导入
```

## 阶段 5：协议真源升级为 contracts package

本阶段是架构规则修订。先改规则，再改代码。

### 规则更新

```text
AGENTS.md：协议单一真源从 src/core/contracts.py 调整为 src/core/contracts/
docs/kongming-agent-v1-minimal/10-contracts.md：更新协议边界描述
.importlinter：跨模块共享协议来源改为 core.contracts package
tests/unit/test_arch_contracts.py：同步合约测试
```

### 目标结构

```text
src/core/contracts/
  __init__.py
  llm_provider.py
  tool_runtime.py
  session.py
  approval.py
  event_sink.py
  prompt_assembly.py
  streaming.py
```

### 拆分建议

| 新文件 | 内容 |
|---|---|
| `llm_provider.py` | `LLMProvider` / `LLMRequest` / `LLMResponse` / `LLMStreamChunk` |
| `tool_runtime.py` | `Tool` / `ToolCall` / `ToolResult` / `ToolContext` / `ToolLookup` |
| `session.py` | `Session` |
| `approval.py` | `ApprovalProvider` / `ApprovalRequest` / `ApprovalDecision` / `ApprovalAction` |
| `event_sink.py` | `Event` / `EventSink` |
| `prompt_assembly.py` | `InstructionSource` / `AssembledInput` / `MessageCompactor` |
| `streaming.py` | stream-only helper types |

`core/contracts/__init__.py` 作为协议 package 公共入口：

```python
from core.contracts.llm_provider import LLMProvider, LLMRequest, LLMResponse
from core.contracts.tool_runtime import Tool, ToolContext, ToolResult
```

调用方继续使用：

```python
from core.contracts import LLMProvider, Tool, EventSink
```

### 验证

```powershell
rg -n '(^|\s)(from|import)\s+core\.contracts\.(approval|event_sink|llm_provider|prompt_assembly|session|streaming|tool_runtime)(\.|\s|$)|core\.contracts\.(approval|event_sink|llm_provider|prompt_assembly|session|streaming|tool_runtime)' src tests --glob "*.py" --glob "!src/core/contracts/**"
ruff check src tests
pytest tests/unit/test_arch_contracts.py tests/unit/test_core_runner_basic.py -v
pytest tests/unit/test_native_runtime.py tests/e2e/test_plain_chat.py -v
lint-imports --config .importlinter
```

验收：

```text
协议 package 是新的单一真源
core 保持零 sibling 依赖
Runner 仍是唯一 turn 推进逻辑
调用方公共 import 路径保持 core.contracts
direct submodule import 命中为 0
```

## 阶段 6：顶层 core -> kernel 命名评估，退出迁移范围

`core -> kernel` 是全仓包名迁移，影响 `AGENTS.md`、`.importlinter`、测试、文档和大量 import。当前结论是保留 `core` 顶层包名，该阶段归档为废弃迁移项。

`src/kongming_agent/` namespace 包迁移同样归档为废弃迁移项。当前继续使用 `src/` 下单层 package 布局，保留 `core` / `tools` / `web` / `cli` 等既有顶层 import 形态。

历史候选目标（已归档，保留供追溯）：

```text
src/kernel/   # 已退出：当前保留 src/core/
  agent_run/
  messaging/
  contracts/
  agent_spec.py
  errors.py
  session.py
```

执行前置条件：

```text
阶段 1-5 已完成
core.contracts package 已稳定
import-linter 合约已迁到 package 级规则
文档和测试对 core 名称的依赖已收敛
core 内部继续膨胀，agent_run / messaging / contracts 边界已经稳定
迁移后的文档同步成本可控
```

验收：

```text
rg -n "^from core|^import core" src tests --glob "*.py" 命中为 0
kernel 零 sibling 依赖合约通过
Runner 唯一 run loop 合约通过
```

## 总体验收清单

每个阶段完成后执行：

```powershell
git status --short
ruff check src tests
pytest tests/unit/test_arch_contracts.py -v
lint-imports --config .importlinter
```

关键阶段额外执行：

```powershell
pytest tests/unit -k "session_engine or input_assembler or file_session or tools or web" -v
python -m hosts.web.ctl status
python -m hosts.cli.main --help
```

目录迁移全部完成后的结构检查：

```powershell
rg -n '(^|\s)(from|import)\s+(context|executors|observability|config_loader)(\.|\s|$)|(context|executors|observability|config_loader)\.' src tests --glob "*.py"
rg -n '(^|\s)(from|import)\s+tools\.(base|registry|approval|file_tools|shell_tool|memory_tool|schedule_tool|evolution_write_tool)(\.|\s|$)|tools\.(base|registry|approval|file_tools|shell_tool|memory_tool|schedule_tool|evolution_write_tool)' src tests --glob "*.py"
rg -n '(^|\s)(from|import)\s+web\.(ws|ws_event_sink|ws_fanout|thread_manager|thread_cell|thread_metadata|workspace|workspace_git|workspace_shell|whiteboard_manager|whiteboard_store)(\.|\s|$)|web\.(ws|ws_event_sink|ws_fanout|thread_manager|thread_cell|thread_metadata|workspace|workspace_git|workspace_shell|whiteboard_manager|whiteboard_store)' src tests --glob "*.py"
```

## 推荐执行顺序

1. 阶段 1：`context -> sessions / prompting`
2. 阶段 1.5：`prompting` 二级拆分
3. 阶段 2：`tools -> runtime / builtin`
4. 阶段 3 第一批：`websocket`
5. 阶段 3 第二批：`threads`
6. 阶段 3 第三批：`workspace / whiteboard`
7. 阶段 3 第四批：`approvals / integrations`
8. 阶段 3 第五批：`auth / shared / app_support / usage`
9. 阶段 4：`infrastructure + runtime_assembly`
10. 阶段 5：`core/contracts.py -> core/contracts/`
11. 阶段 6：`core -> kernel` 已评估并退出迁移范围

第一轮交付只做阶段 1。阶段 1 完成并验证后，阶段 1.5 紧接执行，避免 `prompting/` 在早期形成宽泛目录。
