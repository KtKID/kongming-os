# Command Module v0.1

> 状态：方案确认中
> 目标：建立一套 Web 和 CLI 共用的 command 模块，让 slash command 成为宿主无关的一等能力。

## 系统目标

这套 command 模块解决三个问题：

- 把“普通文本”与“命令输入”分成两条清晰链路。
- 让 Web 和 CLI 复用同一份命令定义、解析、执行逻辑。
- 先落一条可直接触发子 agent review 的内置命令 `/review`。

这个版本优先交付一条稳定闭环：

- 普通文本继续走现有 agent 主链路。
- slash command 先进入共享 command 层。
- command 层根据命令类型走不同执行器。
- 宿主只负责输入和结果渲染。
- 第一批先只放一条可用命令 `/review`，验证整条链路。

## 文档结构说明

本目录按独立方案目录保存，主文档集采用 x-spec 的最小骨架：

- `README.md`
- `02-module-breakdown.md`
- `90-task-map.md`

当前额外保留两份扩展文档：

- `03-core-workflows.md`
- `04-data-and-state.md`

保留原因很直接：

- 这套系统有明确的输入分流和命令执行链。
- 这套系统有共享 command 模型和交互状态。

当前不展开：

- `01-goals-and-boundaries.md`
- `05-validation-and-evolution.md`

## 当前状态

当前仓库已经有一条 Web 和 CLI 共享的执行汇合点：

- CLI 通过 `CLIAdapter.read_input()` 读入文本，再由 `SessionBridge.run_loop()` 调 `run_once()`。
- Web 通过 `user.input` WS 帧收到文本，再由 `cell.bridge.run_once()` 执行。
- `SessionBridge.run_once()` 当前只接受原始文本，没有 command 解析和路由层。

当前仓库也有两个明确空缺：

- 没有宿主无关的 command registry / parser / executor。
- 没有“立即触发子 agent review”的内置 action command。

## 目标状态

v0.1 的目标状态是把 command 放到共享执行层：

```text
raw input
  -> CommandParser
  -> text | command
  -> text: runtime.run(...)
  -> command: CommandRegistry.lookup(...)
  -> CommandExecutor dispatch
  -> HostRenderer emits CLI/Web result
```

宿主边界保持明确：

- `HostAdapter` 负责输入输出。
- `CommandService` 负责解析、查找、执行。
- `SessionBridge` 负责把 command 主链和 runtime 主链串起来。
- `CommandUX` 负责 slash 候选、参数提示和交互式面板。

## 范围边界

**第一批包含**：

- Web 和 CLI 共用的 command 数据模型。
- 共用的 slash parser。
- builtin command registry。
- `/review` 内置 action command。
- `SessionBridge`、CLI、Web 的共享接线闭环。

**第二批包含**：

- workspace 级 custom commands。
- Web 侧 slash 候选面板。
- 参数提示和结果卡片。

**后续范围**：

- CLI 高级 typeahead。
- MCP / plugin / remote command 合流。
- 命令管理后台。
- 跨 workspace 的用户级 command 同步。
- 完整的交互式命令组件库。

## 模块导航

| 模块 | 状态 | 文档 | 是否可进 task | 说明 |
|---|---|---|---|---|
| Command Core | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-1command-core) | 是 | 输入解析、结果模型、主调度入口 |
| Command Registry | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-2command-registry) | 是 | builtin + custom 合并、按宿主过滤 |
| Command Executors | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-3command-executors) | 是 | `prompt` / `action` / `interactive` 三类执行 |
| Host Integration | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-4host-integration) | 是 | `SessionBridge`、CLI、Web 接线 |
| Command UX | 部分可进 x-req | [模块拆分](./02-module-breakdown.md#模块-5command-ux) | 部分 | Web 先做，CLI 高级交互后置 |

## task 导航

- [command-core-v0.1](../../dev-pipeline/tasks/command-core-v0.1/README.md)
- [command-registry-v0.1](../../dev-pipeline/tasks/command-registry-v0.1/README.md)
- [command-review-action-v0.1](../../dev-pipeline/tasks/command-review-action-v0.1/README.md)
- [command-host-integration-v0.1](../../dev-pipeline/tasks/command-host-integration-v0.1/README.md)

## 文档导航

- [模块拆分](./02-module-breakdown.md)
- [核心流程](./03-core-workflows.md)
- [数据与状态](./04-data-and-state.md)
- [Task 映射](./90-task-map.md)

## 当前建议

1. 第一批目标是完整打通 `raw input -> parser -> registry -> executor -> host result` 闭环，并只放一条内置命令 `/review`。
2. `/review` 放在 `action` 类型，直接复用独立 reviewer runtime 思路，不走 prompt 展开。
3. Web 侧 slash 候选面板作为第二批收口，CLI 先只支持输入 `/command args`。
4. custom commands 留到第二批，避免在闭环未稳定前引入多级覆盖规则。
