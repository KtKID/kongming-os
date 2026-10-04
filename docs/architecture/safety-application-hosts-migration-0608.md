# Safety / Application / Hosts 目录迁移计划 0608

状态：未执行。

本文接续 [code-directory-migration-0608.md](code-directory-migration-0608.md)。上一轮已经完成 `sessions`、`prompting`、`tools/runtime`、`tools/builtin`、`web` 包内子域、`infrastructure`、`runtime_assembly`、`core.contracts` package。下一轮只处理三块：`safety/` 二级拆分、`application/` 用例层、`hosts/` 顶层宿主目录。

## 架构决定

```text
保留 src/core/，core -> kernel 迁移已归档。
保留 src/ 单层 package 布局，src/kongming_agent/ namespace 包迁移已废弃。
新增 src/application/，承接任务级用例编排。
新增 src/hosts/，承接 CLI / Web / shared host adapter。
runtime_assembly/ 继续作为 SessionEngine composition root，只负责 build / fork / runtime 装配。
core/runner.py 继续作为唯一 turn loop。
```

目标结构：

```text
src/
  application/
    agent_workflows/
      manager.py
      context.py
      strategies/
        base.py
        description.py
        manager.py
        parallel.py
        map_reduce/
    subagents/
      manager.py
      permissions.py
    scheduled_runs/
      execution_bridge.py
    agent_runs/
      start_agent_run.py

  safety/
    approval/
      chain.py
      default_rules.py
      decision_engine.py
      manager.py
      rules.py
      types.py
    boundaries/
      path_trie.py
      resolver.py
    grants/
      persister.py
      store.py
    policies/
      capability.py
      permission.py
    guards/
    auto_approval/
    inbox/
      event_sink.py
      helpers.py

  hosts/
    shared/
      base.py
      session_bridge.py
      memory_refresh_sink.py
    cli/
      main.py
      repl.py
      approval.py
      approval_manager_sink.py
      adapter.py
      stream_sink.py
      cron_delivery.py
    web/
      app.py
      run.py
      ctl.py
      routers/
      websocket/
      threads/
      workspace/
      whiteboard/
      approvals/
      integrations/
```

## 进度记录

| 日期 | 阶段 | 状态 | 代码提交 | 说明 |
|---|---|---|---|---|
| 2026-06-08 | 阶段 0：基线确认 | 已完成 | 本阶段提交 | 记录当前 import、lint、测试状态 |
| 2026-06-08 | 阶段 1：`safety/` 二级拆分 | 已完成 | `1d92436` | 把 approval / boundaries / grants / policies / inbox 从 safety 顶层拆出 |
| 2026-06-08 | 阶段 2：`application/` 用例层 | 已完成 | `65ba72a`, `8d2ff1c` | 把 workflow / subagent / scheduled run 编排从装配层和 scheduler 中抽出 |
| 2026-06-08 | 阶段 3：`hosts/` 顶层宿主目录 | 未执行 | — | 把 cli / host / web 收敛到 hosts 子域 |
| 2026-06-08 | 阶段 4：总体验收与文档回写 | 未执行 | — | 更新 AGENTS、模块 README、架构合约和发布入口 |

## 阶段 0：基线确认

目标：确认下一轮迁移起点，避免把旧缓存目录或既有本地改动混进阶段结果。

执行：

```bash
rtk git status --short --branch
rtk rg -n '^\s*(from|import)\s+safety\.' src tests --glob '*.py'
rtk rg -n '^\s*(from|import)\s+runtime_assembly\.(workflow|strategies|subagent)' src tests --glob '*.py'
rtk rg -n '^\s*(from|import)\s+(cli|host|web)\.' src tests --glob '*.py'
rtk uv run ruff check src tests
rtk uv run pytest tests/unit/test_arch_contracts.py -v
rtk uv run lint-imports --config .importlinter
```

记录：

```text
safety 顶层 import 命中数量：180
runtime_assembly workflow / subagent import 命中数量：62
cli / host / web 顶层 import 命中数量：658
ruff check src tests：通过
pytest tests/unit/test_arch_contracts.py -v：10 passed
import-linter 通过状态：11 kept, 0 broken
非本任务本地改动清单：
  .importlinter
  AGENTS.md
  docs/approval/cli-approval-manager/01-goals-and-boundaries.md
  docs/approval/cli-approval-manager/05-validation-and-evolution.md
  docs/code-directory-migration-0608.md
  docs/kongming-agent-v1-minimal/10-contracts.md
  docs/kongming-agent-v1-minimal/11-v1-file-layout.md
  docs/modules/Web前端/README.md
  docs/modules/会话/README.md
  docs/modules/司天/README.md
  docs/modules/命令行/README.md
  docs/modules/安全/README.md
  docs/modules/安全/approval-flow-current-state.html
  docs/modules/定时任务/README.md
  docs/modules/宿主/README.md
  docs/modules/执行器/README.md
  docs/modules/提示组装/README.md
  docs/modules/核心/README.md
  docs/modules/观测/README.md
  docs/modules/记忆/README.md
  docs/modules/进化/README.md
  docs/modules/配置加载/README.md
  docs/代码重构建议0608.md
  scripts/web-build.sh
```

验收：

```text
基线命令结果已记录。
迁移范围已锁定为 safety / application / hosts。
src/kongming_agent namespace 包保持废弃状态。
core -> kernel 保持退出状态。
```

## 阶段 1：`safety/` 二级拆分

目标：把安全域从散列顶层文件拆成审批、边界、授权、策略、收件箱五个子域。`guards/` 和 `auto_approval/` 已经具备子域形态，本阶段保留并只更新引用。

目标结构：

```text
src/safety/
  __init__.py
  approval/
    __init__.py
    chain.py
    default_rules.py
    decision_engine.py
    manager.py
    rules.py
    types.py
  boundaries/
    __init__.py
    path_trie.py
    resolver.py
  grants/
    __init__.py
    persister.py
    store.py
  policies/
    __init__.py
    capability.py
    permission.py
  inbox/
    __init__.py
    event_sink.py
    helpers.py
  guards/
  auto_approval/
```

文件迁移表：

| 当前文件 | 目标文件 |
|---|---|
| `src/safety/chain.py` | `src/safety/approval/chain.py` |
| `src/safety/default_rules.py` | `src/safety/approval/default_rules.py` |
| `src/safety/decision_engine.py` | `src/safety/approval/decision_engine.py` |
| `src/safety/approval_manager.py` | `src/safety/approval/manager.py` |
| `src/safety/approval_rules.py` | `src/safety/approval/rules.py` |
| `src/safety/types.py` | `src/safety/approval/types.py` |
| `src/safety/boundary_resolver.py` | `src/safety/boundaries/resolver.py` |
| `src/safety/_path_trie.py` | `src/safety/boundaries/path_trie.py` |
| `src/safety/grant_store.py` | `src/safety/grants/store.py` |
| `src/safety/_grant_persister.py` | `src/safety/grants/persister.py` |
| `src/safety/capability_policy.py` | `src/safety/policies/capability.py` |
| `src/safety/permission_policy.py` | `src/safety/policies/permission.py` |
| `src/safety/inbox_event_sink.py` | `src/safety/inbox/event_sink.py` |
| `src/safety/inbox_helpers.py` | `src/safety/inbox/helpers.py` |

import 改写示例：

```python
from safety.approval_manager import get_approval_manager
from safety.approval_rules import ApprovalRules
from safety.boundary_resolver import BoundaryResolver
from safety.capability_policy import CapabilityPolicy
from safety.permission_policy import PermissionPolicy
```

改为：

```python
from safety.approval.manager import get_approval_manager
from safety.approval.rules import ApprovalRules
from safety.boundaries.resolver import BoundaryResolver
from safety.policies.capability import CapabilityPolicy
from safety.policies.permission import PermissionPolicy
```

同步更新：

```text
safety/__init__.py 继续导出公共门户，供 runtime_assembly.session_engine 使用。
.importlinter Contract 3 / 4 / 6 / 9 / 12 中 safety 路径改到新子包。
tools-no-direct-safety-policy 禁止 safety.policies / safety.boundaries / safety.grants / safety.approval.decision_engine。
pyproject.toml per-file ignores 中 src/safety/chain.py 改到 src/safety/approval/chain.py。
tests/unit/safety/* import 全量改写，测试目录可按 approval / boundaries / grants / policies 分组。
docs/modules/安全/README.md 更新子域职责和门户。
docs/kongming-agent-v1-minimal/10-contracts.md 更新安全域依赖边界。
docs/kongming-agent-v1-minimal/11-v1-file-layout.md 更新安全域文件职责。
AGENTS.md 代码地图和 Tool Runtime policy 约束同步更新。
```

验证：

```bash
rtk rg -n '^\s*(from|import)\s+safety\.(approval_manager|approval_rules|boundary_resolver|capability_policy|permission_policy|grant_store|decision_engine|default_rules|types|inbox_event_sink|inbox_helpers)(\.|\s|$)' src tests --glob '*.py'
rtk uv run ruff check src tests
rtk uv run pytest tests/unit/safety -v
rtk uv run pytest tests/unit/tools/runtime/test_approval.py tests/unit/test_native_runtime.py -v
rtk uv run lint-imports --config .importlinter
```

执行记录：

```text
旧 safety 顶层实现模块 import 命中：0
ruff check src tests：通过
pytest tests/unit/safety -v：174 passed
pytest tests/unit/tools/runtime/test_approval.py tests/unit/test_native_runtime.py -v：17 passed
lint-imports --config .importlinter：11 kept, 0 broken
代码提交：1d92436 refactor(safety): split safety modules into subdomains
```

验收：

```text
safety 顶层实现模块 import 命中为 0。
safety/__init__.py 公共入口可用。
Tool Runtime 仍无法直接 import safety 内部 policy / guard / grant 实现。
SessionEngine 安全链装配通过。
```

## 阶段 2：`application/` 用例层

目标：把跨模块任务级编排从装配层和领域模块中抽出。`runtime_assembly/` 继续只做 SessionEngine 装配；`application/` 承接 workflow/subagent/scheduled-run 等可被 CLI/Web/Tool 调用的用例。

### 阶段 2A：Workflow / Subagent 编排迁移

目标结构：

```text
src/application/
  __init__.py
  agent_workflows/
    __init__.py
    manager.py
    context.py
    strategies/
      __init__.py
      base.py
      description.py
      manager.py
      parallel.py
      map_reduce/
        __init__.py
        artifacts.py
        contracts.py
        input_materializer.py
        mapper.py
        planner.py
        reducer.py
        strategy.py
        validator.py
  subagents/
    __init__.py
    manager.py
    permissions.py
```

文件迁移表：

| 当前文件 | 目标文件 |
|---|---|
| `src/runtime_assembly/workflow/manager.py` | `src/application/agent_workflows/manager.py` |
| `src/runtime_assembly/workflow/context.py` | `src/application/agent_workflows/context.py` |
| `src/runtime_assembly/strategies/*` | `src/application/agent_workflows/strategies/*` |
| `src/runtime_assembly/subagent_manager.py` | `src/application/subagents/manager.py` |
| `src/runtime_assembly/subagent_permissions.py` | `src/application/subagents/permissions.py` |

设计约束：

```text
application/ 可以编排 core / sessions / prompting / tools / safety / runtime_assembly 的公开入口。
application/ 不能新增 turn loop。
application/ 不能复制 SessionEngine.build() 装配逻辑。
SubAgentManager 只通过 SessionEngine 的公开属性和 Runner.run() 入口执行子 agent。
tools/agent_workflow_tool.py 只持有 AgentWorkflowHandle，handle 绑定 application.agent_workflows.AgentWorkflowManager。
```

同步更新：

```text
全仓 runtime_assembly.workflow / runtime_assembly.strategies / runtime_assembly.subagent_* import 改为 application.*。
runtime_assembly/__init__.py 只继续导出 SessionEngine。
.importlinter root_packages 添加 application。
.importlinter layered-dependency-direction 添加 application 层，位置建议为 hosts/web/cli 之下、runtime_assembly 之上。
pyproject.toml packages / sdist include 添加 src/application。
pyproject.toml isort known-first-party / coverage source 添加 application。
tests/unit/test_agent_workflow_* 路径和 monkeypatch 字符串改为 application.*。
docs/modules/执行器/README.md 把 workflow/subagent 从 runtime_assembly 职责中移出。
新增或更新 docs/modules/用例层/README.md，说明 AgentWorkflowManager / SubAgentManager 入口。
AGENTS.md 代码地图新增 application 模块。
```

验证：

```bash
rtk rg -n '^\s*(from|import)\s+runtime_assembly\.(workflow|strategies|subagent_manager|subagent_permissions)(\.|\s|$)' src tests --glob '*.py'
rtk uv run ruff check src tests
rtk uv run pytest tests/unit/test_agent_workflow_manager.py tests/unit/test_agent_workflow_strategy_manager.py -v
rtk uv run pytest tests/unit/test_agent_workflow_map_reduce.py tests/e2e/test_map_reduce_live_minimax.py -v
rtk uv run pytest tests/unit/test_native_runtime.py tests/unit/tools/builtin/test_skill_tool.py -v
rtk uv run lint-imports --config .importlinter
```

执行记录：

```text
旧 runtime_assembly workflow / strategies / subagent import 命中：0
ruff check src tests：通过
pytest tests/unit/test_agent_workflow_manager.py tests/unit/test_agent_workflow_strategy_manager.py -v：24 passed
pytest tests/unit/test_agent_workflow_map_reduce.py tests/unit/test_map_reduce_contracts.py -v：36 passed
pytest tests/unit/test_native_runtime.py tests/unit/tools/builtin/test_skill_tool.py -v：25 passed
pytest tests/e2e/test_map_reduce_live_minimax.py -v：1 skipped（需 KONGMING_E2E_REAL_MODEL=1）
lint-imports --config .importlinter：11 kept, 0 broken
代码提交：65ba72a refactor(application): move workflows and subagents into use case layer
```

验收：

```text
runtime_assembly 下 workflow / strategies / subagent 源码目录已迁出。
SessionEngine 仍是唯一 runtime composition root。
AgentWorkflowManager 归 application.agent_workflows。
SubAgentManager 归 application.subagents。
```

### 阶段 2B：Scheduled Run 用例迁移

目标：把定时任务执行桥中的跨模块 run 编排抽到 application，scheduler 保留 cron domain / store / ticker / parser。

目标结构：

```text
src/application/
  scheduled_runs/
    __init__.py
    execution_bridge.py
    inactivity_watchdog.py
```

文件迁移表：

| 当前文件 | 目标文件 |
|---|---|
| `src/scheduler/execution_bridge.py` | `src/application/scheduled_runs/execution_bridge.py` |

同步更新：

```text
scheduler/runtime_factory.py 改为装配 application.scheduled_runs.execution_bridge。
scheduler 包只保留 domain / store / ticker / parser / policy / delivery。
.importlinter scheduler-no-web 保持，新增 scheduler 只依赖 application 的白名单或调整层级。
tests/unit/scheduler/test_execution_bridge_* 迁到 tests/unit/application/scheduled_runs 或改 import。
docs/modules/定时任务/README.md 更新：执行用例归 application，定时领域归 scheduler。
```

验证：

```bash
rtk rg -n '^\s*(from|import)\s+scheduler\.execution_bridge(\.|\s|$)' src tests --glob '*.py'
rtk uv run ruff check src tests
rtk uv run pytest tests/unit/scheduler/test_execution_bridge_*.py tests/unit/scheduler/test_runtime_factory.py -v
rtk uv run pytest tests/e2e/test_scheduler_e2e.py tests/e2e/test_cron_create_e2e.py -v
rtk uv run lint-imports --config .importlinter
```

执行记录：

```text
旧 scheduler.execution_bridge import 命中：0
ruff check src tests：通过
pytest tests/unit/scheduler/test_execution_bridge_*.py tests/unit/scheduler/test_scheduler_execution_bridge.py tests/unit/scheduler/test_runtime_factory.py -v：65 passed
pytest tests/e2e/test_scheduler_e2e.py tests/e2e/test_cron_create_e2e.py -v：18 passed
lint-imports --config .importlinter：11 kept, 0 broken
代码提交：8d2ff1c refactor(application): move scheduled run execution bridge
```

验收：

```text
scheduled run 的 Runner.run 编排归 application。
scheduler 保持定时任务领域模块。
cron run 工具裁剪、watchdog、审批包装行为保持。
```

## 阶段 3：`hosts/` 顶层宿主目录

目标：把宿主入口和宿主适配统一收到 `hosts/`。CLI、Web、共享 HostAdapter 不再散落在 `cli/`、`host/`、`web/` 三个顶层包。

XSpace 集成硬约束：`hosts.web` 必须成为可被 Tauri sidecar 启动的稳定宿主入口。XSpace 只依赖 console script、stdout/status 契约、health endpoint 和 app data 目录；XSpace 避免绑定 kongming 源码目录结构。

目标结构：

```text
src/hosts/
  __init__.py
  shared/
    __init__.py
    base.py
    session_bridge.py
    memory_refresh_sink.py
  cli/
    __init__.py
    main.py
    repl.py
    approval.py
    approval_manager_sink.py
    adapter.py
    stream_sink.py
    cron_delivery.py
  web/
    __init__.py
    app.py
    run.py
    ctl.py
    static.py
    app_support/
    approvals/
    auth/
    dashboard/
    integrations/
    protocol/
    routers/
    shared/
    threads/
    uploads/
    usage/
    websocket/
    whiteboard/
    workflow/
    workspace/
```

文件迁移表：

| 当前路径 | 目标路径 |
|---|---|
| `src/host/base.py` | `src/hosts/shared/base.py` |
| `src/host/session_bridge.py` | `src/hosts/shared/session_bridge.py` |
| `src/host/memory_refresh_sink.py` | `src/hosts/shared/memory_refresh_sink.py` |
| `src/host/cli_adapter.py` | `src/hosts/cli/adapter.py` |
| `src/host/cli_stream_sink.py` | `src/hosts/cli/stream_sink.py` |
| `src/cli/main.py` | `src/hosts/cli/main.py` |
| `src/cli/repl.py` | `src/hosts/cli/repl.py` |
| `src/cli/approval.py` | `src/hosts/cli/approval.py` |
| `src/cli/approval_manager_sink.py` | `src/hosts/cli/approval_manager_sink.py` |
| `src/cli/cron_delivery.py` | `src/hosts/cli/cron_delivery.py` |
| `src/web/*` | `src/hosts/web/*` |

入口同步：

```text
pyproject.toml project.scripts:
  kongming = "hosts.cli.main:main"
  kongming-web = "hosts.web.run:main"
  kongming-web-ctl = "hosts.web.ctl:main"

start.sh / scripts/* / tests 中的 python -m cli.main 改为 python -m hosts.cli.main。
python -m web.run 改为 kongming-web 或 python -m hosts.web.run。
python -m web.ctl 改为 kongming-web-ctl 或 python -m hosts.web.ctl。
web.app:create_app 改为 hosts.web.app:create_app。
```

XSpace sidecar 交付契约：

```text
稳定启动入口：kongming-web --host 127.0.0.1 --port 60000 --home <xspace-app-data>/kongming
稳定控制入口：kongming-web-ctl start|stop|restart|status|log --home <xspace-app-data>/kongming
端口配置：XSpace 打包默认 web.port=60000；配置文件、KONGMING_WEB_PORT、--port 均可覆盖。
显式动态端口：--port 0 由 OS 分配空闲端口，用于本地 smoke 或多实例测试。
ready 输出：启动成功后 stdout 输出单行 JSON，字段至少包含 type / host / port / url / pid / health_url / home。
status 文件：同一份 ready payload 写到 <home>/web/server.json，供 Tauri 轮询兜底。
health endpoint：公开 GET /health；保留 GET /api/health。
静态资源：后端用包内路径解析前端产物，禁止依赖当前工作目录定位 web/dist。
前端产物：默认继续使用仓库根 web/dist；打包形态可通过 --dist-dir 或 env 指向 bundled resource。
运行时数据：配置、日志、session db、startup.json、server.json 全部写入 --home / KONGMING_HOME 指定目录。
代码约束：端口只来自配置、环境变量或启动参数；业务逻辑保持无硬编码端口常量。
smoke：启动 kongming-web 后 health 200，Tauri WebView 打开 url 返回首页 HTML。
```

同步更新：

```text
.importlinter root_packages 添加 hosts，移除 cli / host / web。
.importlinter web.protocol 合约改为 hosts.web.protocol。
.importlinter web app shell 合约改为 hosts.web.app / hosts.web.routers / hosts.web.websocket.routes。
.importlinter scheduler-no-web / evolution-no-web / usage-token / whiteboard-isolation 全量改路径。
pyproject.toml packages / sdist include 移除 src/cli / src/host / src/web，添加 src/hosts。
pyproject.toml isort known-first-party / coverage source 同步。
web static 解析从源码 cwd 假设改为包内资源 / 显式 dist_dir；迁移过程保持 web/dist 开发产物路径可用。
tests 全仓 import 改写。
AGENTS.md 代码地图把 CLI / host / web 合并到 hosts，保留 Web 前端文档链接。
docs/modules/宿主/README.md 改为 hosts/shared + hosts/cli + hosts/web。
docs/modules/Web前端/README.md 路径改到 src/hosts/web。
docs/xspace-tauri-kongming-migration.md 作为 XSpace sidecar 契约文档同步更新。
docs/kongming-agent-v1-minimal/10-contracts.md 和 11-v1-file-layout.md 同步宿主边界。
```

验证：

```bash
rtk rg -n '^\s*(from|import)\s+(cli|host|web)(\.|\s|$)' src tests --glob '*.py'
rtk uv run ruff check src tests
rtk uv run pytest tests/unit/cli tests/unit/web tests/unit/test_session_bridge.py tests/unit/test_cli_adapter.py -v
rtk uv run pytest tests/integration/web tests/e2e/test_cli_integration.py -v
rtk uv run python -m hosts.cli.main --help
tmp_home="$(mktemp -d)"
rtk uv run kongming-web --host 127.0.0.1 --port 0 --home "$tmp_home" --once-ready-json > "$tmp_home/ready.jsonl" 2> "$tmp_home/web.log" &
web_pid=$!
sleep 2
rtk uv run kongming-web-ctl status --home "$tmp_home"
rtk curl "$(jq -r '.health_url' "$tmp_home/web/server.json")"
kill "$web_pid"
rtk uv run lint-imports --config .importlinter
```

验收：

```text
cli / host / web 顶层源码目录已迁入 hosts。
kongming CLI entry point 指向 hosts.cli.main。
Web create_app / run / ctl 入口可导入。
web 前端静态目录和 web/dist 查找逻辑保持。
SessionBridge 与 HostAdapter 归 hosts.shared。
kongming-web / kongming-web-ctl console script 可用。
web.port=60000 是 XSpace 默认配置值，启动参数和环境变量可覆盖。
--port 0 显式动态端口会输出 ready JSON 并写 server.json。
GET /health 和 GET /api/health 都返回 200。
所有运行时写入落在 --home / KONGMING_HOME 下。
XSpace smoke 通过：启动服务、health 成功、WebView 打开首页。
```

## 阶段 4：总体验收与文档回写

目标：把阶段 1-3 的代码迁移结果写回项目级规则和模块文档。

执行：

```bash
rtk git status --short --branch
rtk rg -n '^\s*(from|import)\s+safety\.(approval_manager|approval_rules|boundary_resolver|capability_policy|permission_policy|grant_store|decision_engine|default_rules|types|inbox_event_sink|inbox_helpers)(\.|\s|$)' src tests --glob '*.py'
rtk rg -n '^\s*(from|import)\s+runtime_assembly\.(workflow|strategies|subagent_manager|subagent_permissions)(\.|\s|$)' src tests --glob '*.py'
rtk rg -n '^\s*(from|import)\s+(cli|host|web)(\.|\s|$)' src tests --glob '*.py'
rtk uv run ruff check src tests
rtk uv run pytest tests/unit/test_arch_contracts.py -v
rtk uv run lint-imports --config .importlinter
```

文档回写：

```text
AGENTS.md：更新代码地图、import 白名单、CLI/Web 入口说明。
docs/kongming-agent-v1-minimal/10-contracts.md：更新 application / hosts / safety 子域边界。
docs/kongming-agent-v1-minimal/11-v1-file-layout.md：更新文件级职责表。
docs/modules/安全/README.md：更新 safety 二级域。
docs/modules/用例层/README.md：新增 application 模块文档。
docs/modules/宿主/README.md：更新 hosts/shared / hosts/cli / hosts/web。
docs/modules/Web前端/README.md：更新 hosts/web 路径。
docs/code-directory-migration-0608.md：追加本轮迁移完成记录。
```

总体验收：

```text
safety 顶层实现模块清零。
runtime_assembly 只保留 SessionEngine 与纯装配 helper。
application 承接 workflow / subagent / scheduled run 用例。
hosts 承接 CLI / shared host / Web 宿主入口。
core -> kernel 保持退出状态。
src/kongming_agent namespace 包保持废弃状态。
```

## 推荐执行顺序

1. 阶段 0：基线确认
2. 阶段 1：`safety/` 二级拆分
3. 阶段 2A：`application/agent_workflows` + `application/subagents`
4. 阶段 2B：`application/scheduled_runs`
5. 阶段 3：`hosts/` 顶层宿主目录
6. 阶段 4：总体验收与文档回写

推荐先做 `safety/` 二级拆分。它的文件归属清晰，能先把安全域边界稳定下来，再处理 application 和 hosts 这种跨模块迁移。
