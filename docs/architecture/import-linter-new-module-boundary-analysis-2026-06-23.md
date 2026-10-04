# import-linter 新模块边界增补分析

日期：2026-06-23

## 结论

当前 `.importlinter` 对 `core`、`tools`、`hosts.web.protocol`、Web app shell、scheduler、evolution、usage token、whiteboard、network 已形成有效边界。实际执行结果为：

```text
Analyzed 468 files, 2743 dependencies.
Contracts: 11 kept, 0 broken.
```

需要增补规则。当前建议删除规则数量为 0。

## 当前未覆盖模块

`src/` 下已有 3 个顶层包没有进入 `.importlinter` 的 `root_packages`：

- `commands`
- `sitian`
- `devtools`

这些包已经参与运行链路。`commands` 被 CLI / Web shared path 使用，`sitian` 被 Web router 和配置系统使用，`devtools` 被 Web 调试接口使用。它们继续游离在 import-linter 外，会让后续跨层依赖漂移绕开机器检查。

## application 内部边界

`application` 现在承载 4 个子域：

- `application.agent_workflows`
- `application.subagents`
- `application.scheduled_runs`
- `application.web_search`

现有全局 layer 只把 `application` 作为一个整体处理，无法约束这些子域之间的门户关系。

当前合理方向是：

- `AgentWorkflowManager` 持有 workflow 生命周期、策略分发、manifest、audit、result 和 report 收口。
- `AgentWorkflowStrategyManager` 持有 strategy 注册、list、describe、run 分发。
- `SubAgentManager` 持有 child session、child `AgentSpec`、tool scope 和子 agent 执行。
- strategy 包只实现各自 mode 的状态机和 artifact 逻辑。
- Web viewer 只读 workflow 产物并投影 DTO。

当前漂移点：

- `application.agent_workflows.strategies.*` 在策略末尾局部 import `application.agent_workflows.manager.AgentWorkflowResult`。
- `hosts.web.research_source_provider` 直接 import `application.agent_workflows.strategies.deep_research.contracts` 和 `dedupe`。
- `hosts.cli.main` 直接 import `application.agent_workflows.strategies.roundtable_review.presets`。

这些路径可以运行，但会让 host 层绑定 strategy 内部文件形状，也会让 strategy 反向依赖总 manager。

## 建议新增规则

### 1. root packages 全量登记

把 `commands`、`sitian`、`devtools` 加入 `.importlinter` 顶部 `root_packages`。

目标：所有 `src/` 顶层 Python 包都进入 import 图。

### 2. subagent 独立边界

新增 contract：`application.subagents` 禁止直接 import：

- `application.agent_workflows`
- `hosts`
- `tools`
- `scheduler`
- `evolution`

理由：subagent 是 child-run 门户，公开面应稳定在 `SubAgentManager`、`SubAgentTask`、`SubAgentRun` 和权限模型。workflow 可以编排 subagent，subagent 自身保持独立执行能力。

### 3. workflow 应用层边界

新增 contract：`application.agent_workflows` 禁止直接 import：

- `hosts`
- `tools`
- `runtime_assembly`
- `safety`
- `scheduler`

理由：workflow 是应用编排层，执行依赖应通过 `SubAgentManager`、`WorkflowExecutionContext`、注入 provider 和公开 DTO 进入。Tool schema、Web route、SessionEngine 装配保持在外层。

### 4. strategy 禁止反向依赖 manager

新增 contract：`application.agent_workflows.strategies` 禁止 import `application.agent_workflows.manager`。

落地前置：

- 将 `AgentWorkflowResult`、`SubAgentReportProjection` 等结果模型迁到 `application.agent_workflows.models` 或 `application.agent_workflows.contracts`。
- strategy 从新模型模块 import result DTO。
- `AgentWorkflowManager` 继续负责写 manifest、audit 和目录分配。

理由：strategy 应依赖运行上下文与结果模型，manager 负责注册和编排。这个边界能防止新 strategy 直接调用 manager 内部方法。

### 5. workflow viewer 只读边界

新增 contract：`hosts.web.workflow_viewer` 禁止 import：

- `application`
- `runtime_assembly`
- `tools`
- `safety`
- `scheduler`

理由：viewer 是只读投影层，数据来源是 `sessions/<thread_id>/agent-workflows/<workflow_id>/` 下的既有产物。它应读取 `workflow.json`、`audit.jsonl`、`result.json`、`reports/index.json`、`agents/*/subagent.json` 和 child session JSONL，输出 Web DTO。

### 6. agent workflow router 走 viewer manager

新增 direct-only contract：`hosts.web.routers.agent_workflows` 禁止直接 import：

- `hosts.web.workflow_viewer.artifact_reader`
- `hosts.web.workflow_viewer.conversation_loader`
- `hosts.web.workflow_viewer.usage_projector`
- `hosts.web.workflow_viewer.adapters`

允许路径：

- `hosts.web.routers.agent_workflows -> hosts.web.workflow_viewer`
- `hosts.web.routers.agent_workflows -> hosts.web.workflow_viewer.manager`

理由：router 只做 HTTP 参数校验和错误映射，读取、投影、诊断逻辑集中在 `WorkflowRunViewerManager`。

### 7. SiTian 观察者边界

新增 contract：`sitian` 禁止直接 import：

- `hosts.web`
- `runtime_assembly`
- `tools`
- `scheduler`
- `application`

理由：SiTian 是工作区观察者系统，公开入口应是 `SiTianRunOnce`、`SiTianRunLoop`、`SiTianReadState`、`SiTianRecordsStore` 和配置/模型。Web route 可以调用 SiTian 公开入口，SiTian 保持宿主无关。

### 8. devtools 基础设施边界

新增 contract：`devtools` 禁止直接 import：

- `hosts.web`
- `application`
- `tools`
- `scheduler`
- `evolution`

理由：devtools 应保持调试工具属性，避免吸收业务层对象后变成隐式装配入口。

### 9. commands 宿主无关边界

新增 contract：`commands` 禁止运行时 import：

- `hosts`
- `runtime_assembly`

落地前置：

- `commands.service` 当前只在 `TYPE_CHECKING` 中引用 `HostAdapter` 和 `SessionEngine`。
- 可以用轻量 `Protocol` 或 `object` 类型清掉这两个类型引用。

理由：commands 是 slash 命令解析与服务层，应由 host 注入 runtime delegate 和 host_kind。命令模块本体保持宿主无关。

## 建议落地顺序

1. 补 `root_packages`：`commands`、`sitian`、`devtools`。
2. 加低风险 direct-only 规则：workflow viewer router、subagent 独立边界、workflow 应用层边界。
3. 拆出 `application.agent_workflows.models`，移走 strategy 对 `manager.AgentWorkflowResult` 的反向 import。
4. 改 Web Deep Research provider 和 CLI roundtable preset import，让 host 层只消费策略包公共入口。
5. 加 strategy 内部封装规则和 viewer 只读规则。
6. 处理 `infrastructure.config.models -> sitian.config` 的配置归属：保留精确白名单，或把 SiTian 配置模型迁入 `infrastructure.config.sitian_models`。

## 架构判断

这次增补的主线是把“模块已经形成的门户”变成机器约束：

- workflow 执行入口集中在 `AgentWorkflowManager`。
- workflow strategy 只表达 mode 状态机。
- subagent 执行入口集中在 `SubAgentManager`。
- Web workflow viewer 只读产物。
- commands、sitian、devtools 进入 import-linter 管辖。

推荐先做 root package 全量登记和 direct-only 规则，再推进模型拆分。这样能先扩大机器检查覆盖面，同时把需要小重构的 strategy/SiTian 配置边界放到后续独立提交。
