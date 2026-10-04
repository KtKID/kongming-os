# 模块拆分

## 模块总览

| 模块 | 职责 | 依赖 | 状态 | 备注 |
|---|---|---|---|---|
| Command Core | 解析输入、区分 text/command、定义结果模型 | `host.session_bridge`、`core.result` | 可进入 x-req | 共享主入口 |
| Command Registry | 合并 builtin + custom，按宿主返回可见命令 | `config_loader`、文件系统 | 可进入 x-req | 查找与过滤层 |
| Command Executors | 执行 `prompt` / `action` / `interactive` 命令 | `SessionEngine`、`HostAdapter` | 可进入 x-req | 行为核心 |
| Host Integration | 把共享 command 层接到 CLI 和 Web | `src/cli`、`src/web`、`SessionBridge` | 可进入 x-req | 接线层 |
| Command UX | 宿主侧候选面板、参数提示、交互流程 | `web/src/components`、`prompt_toolkit` | 部分可进入 x-req | Web 先行 |

## 模块详情

### 模块 1：Command Core

**状态**：可进入 x-req

**职责**：定义 command 主链的数据结构和解析入口，把原始输入分成普通文本或命令调用。

**包含范围**：

- `CommandDefinition`、`ParsedInput`、`CommandInvocation`、`CommandResult`
- slash parser
- text / command 分流
- `CommandService.handle_input(...)`

**不包含范围**：

- 宿主 UI
- 具体命令注册
- 具体命令执行实现

**依赖**：

- `src/host/session_bridge.py`
- `src/host/base.py`
- `src/core/result.py`

**风险与讨论点**：

- 当前 `SessionBridge.run_once()` 只接受文本，v0.1 需要引入新的共享入口。
- 解析错误和未知命令的返回格式需要在 CLI 与 Web 间保持一致。

**task 建议**：

- 建议 task 名：`command-core-v0.1`
- 是否进入 x-req：是
- 原因：这是整个 command 模块的稳定边界和共享入口。

### 模块 2：Command Registry

**状态**：可进入 x-req

**职责**：把 builtin commands 和 custom commands 合并成一份 catalog，并提供查找、alias、宿主过滤能力。

**包含范围**：

- builtin command 定义
- custom command 读取
- alias 匹配
- `host_visibility=cli|web|both`
- 按 cwd / workspace 解析 custom commands

**不包含范围**：

- 命令执行
- slash 输入补全 UI

**依赖**：

- `config_loader`
- workspace 文件系统

**风险与讨论点**：

- v0.1 需要限制 custom commands 的作用域，避免一开始出现 user / workspace / project 多级覆盖。
- `/review` 这类 builtin 名称需要保留优先级。

**task 建议**：

- 建议 task 名：`command-registry-v0.1`
- 是否进入 x-req：是
- 原因：共享 catalog 是 Web/CLI 复用的前提。

### 模块 3：Command Executors

**状态**：可进入 x-req

**职责**：执行三类命令，并把结果统一收敛成 `CommandResult`。

**包含范围**：

- `prompt` command：展开成专用 prompt，再进入 runtime 主链
- `action` command：后端直接执行
- `interactive` command：共享状态机，宿主分别渲染
- `/review` builtin action executor

**推荐实现**：

- `prompt` 命令执行器只产出“替换后的用户输入”，然后继续调用 runtime。
- `action` 命令执行器直接在后端完成逻辑，再返回结果文本和结构化 payload。
- `interactive` 命令执行器只维护步骤、参数和完成条件，不持有 Web 专属组件。

**关键边界**：

- `prompt` 负责“改写输入”。
- `action` 负责“直接做事”。
- `interactive` 负责“驱动交互流程”。
- `/review` 属于 `action`，不属于 `prompt`。

**不包含范围**：

- Web slash 候选面板
- CLI 行编辑增强

**依赖**：

- `src/executors/agent_runtime/session_engine.py`
- `src/host/base.py`
- reviewer runtime 相关模块

**风险与讨论点**：

- `interactive` 命令如果过早做成前端私有逻辑，会破坏 Web/CLI 共用目标。
- `/review` 需要明确审查对象是当前 workspace / staged diff / working tree diff。

**task 建议**：

- 建议 task 名：`command-executors-v0.1`
- 是否进入 x-req：是
- 原因：这是命令能力的行为中心。

### 模块 4：Host Integration

**状态**：可进入 x-req

**职责**：把共享 command 层接到 CLI 和 Web 的现有输入链路里。

**包含范围**：

- `SessionBridge` 接入 `CommandService`
- CLI 输入接线
- Web WS 帧和结果回放
- 命令失败 / 未知命令 / 交互等待的宿主翻译

**不包含范围**：

- 命令注册规则
- 命令内部业务逻辑

**依赖**：

- `src/host/session_bridge.py`
- `src/cli/main.py`
- `src/web/ws.py`

**风险与讨论点**：

- Web 当前只有 `user.input`，v0.1 需要决定是新增 `command.invoke` 帧，还是在后端统一先 parse。
- CLI 和 Web 的结果展示格式需要统一一个最小 contract。

**task 建议**：

- 建议 task 名：`command-host-integration-v0.1`
- 是否进入 x-req：是
- 原因：共享逻辑只有真的接入宿主后才成立。

### 模块 5：Command UX

**状态**：方案确认

**职责**：提供 slash 候选、参数提示和交互式命令界面。

**包含范围**：

- Web：输入 `/` 打开候选面板
- Web：命令参数 hint
- CLI：首版保留纯文本输入；高级 typeahead 后置
- `interactive` 命令的宿主渲染组件

**不包含范围**：

- 共享 parser / registry / executor

**依赖**：

- `web/src/components/Composer.tsx`
- CLI 输入组件

**风险与讨论点**：

- Web 交互可以先做完整，CLI 先只保留可执行，不要求一开始就有 typeahead。
- 交互式命令在 CLI 和 Web 的视觉形态可以不同，状态机必须共用。

**task 建议**：

- 建议 task 名：`command-web-ux-v0.1`
- 是否进入 x-req：部分
- 原因：Web 候选面板可直接进 x-req，CLI 高级输入增强应留到后续版本。
