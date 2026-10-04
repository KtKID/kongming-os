# kongming-agent v1 Minimal

> 状态：方案确认中
> 目标：先做出一个宿主无关、能真正跑起来的最小通用 agent 内核，并用 CLI 作为第一个验证宿主

## 系统目标

这份文档只讨论 **v1 最小可运行版本**，不讨论完整 roadmap。

这里的“最小可运行”，指的是：

- 有自己的 loop 和 run state
- 第一批内嵌一个最简 in-memory session，足够支撑多轮 history
- 第一批在 Tool Runtime 内嵌最简 approval，至少能做 `y/n` 人工确认
- 能调用一小组 tools
- 能接一个模型 provider
- 能通过一个宿主真正跑起来
- 有最基本的审批和追踪（v1 第二批做 `EventSink` + 一个 JSONL trace sink；usage 聚合、audit 审计延到 v0.2+ 按需从 trace 派生）

它**不是**：

- Hermes 完整形态
- macOS 桌面应用本体
- 游戏专用 agent
- 多 provider / 多 runtime / 多 agent 的完整版

这版方案的目标不是做全，而是把最小闭环做对，并把后面会扩展的边界留干净。

## 范围边界

**包含**：

- 单 agent、单 run loop、单宿主验证路径
- 最小 tool runtime
- 最小 session/context
- 一个模型 provider 落地
- 一个宿主桥接实现，先用 CLI 跑通
- 最小 safety baseline
- 最小 observability baseline

**不包含**：

- 长期 memory 和自动记忆抽取
- MCP、plugins、coordinator、subagent
- 多模型智能路由
- 外部 runtime/vendor adapter 的正式接入
- macOS API、computer use、游戏 adapter 的正式实现
- 完整桌面 UI

## 模块导航

| 模块 | 状态 | 文档 | 是否可进 task | 说明 |
|---|---|---|---|---|
| Core Runtime | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-1coreruntime) | 是 | 这是最小闭环的主轴 |
| Tool Runtime | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-2tool-runtime) | 是 | v1 只保留最小工具总线和少量 builtin |
| Session Context | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-3session--context) | 是 | 只保留会话上下文，不做长期 memory |
| Model Executor | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-4model-executor) | 是 | v1 只落一个 provider，先跑通 |
| Host Bridge + CLI | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-5host-bridge--cli-shell) | 是 | CLI 只是第一个宿主，不是产品本体 |
| Safety Baseline | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-6safety-baseline) | 是 | 第一版先做 capability + permission + approval 最小闭环 |
| Observability Baseline | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-7observability-baseline) | 是 | 只做 `EventSink` + 一个 JSONL trace sink；usage / audit 延到 v0.2+ |

## 文档导航

- [模块拆分](./02-module-breakdown.md)
- [接口契约](./10-contracts.md)
- [文件布局](./11-v1-file-layout.md)
- [Task 映射](./90-task-map.md)

## 当前建议

这套 v1 方案应该拆分，而且只建议拆成上面 7 个模块。再少会把边界揉坏，再多就不再是“最小可运行”。

第一批最该先进入 x-req 的，是 `Core Runtime`、`Tool Runtime`、`Model Executor`、`Host Bridge + CLI`。这四块合起来才能构成第一个真正能跑的闭环。

这里有一个前提要写死：第一批虽然不单独做完整 `Session Context` 模块，但**必须**在 `Core Runtime` 里内嵌一个最小 `Session` 接口和 in-memory 实现。否则 loop 没有稳定 history 容器，`“第一批就能跑通闭环”` 这句话会变成隐含假设。

approval 也一样。第一批虽然不单独做完整 `Safety Baseline`，但**必须**在 `Tool Runtime` 里内嵌一个最小 approval 实现，至少能承接危险工具的人工确认。否则 tool 虽然能跑，但“最小可运行”会退化成没有安全边界的 demo。

对应地，第二批里的 `Session Context` 不再是“第一次引入 session”，而是把第一批已经存在的最简会话能力升级成工程版：

- 抽出正式的 `context/session_store.py`
- 增加历史压缩、规则加载、输入组装
- 把 in-memory 版本替换成可持久化、可恢复的实现

同样，第二批里的 `Safety Baseline` 也不是第一次引入 approval，而是在第一批默认交互实现的基础上，加上 capability / permission 两层策略和 guardrail 闭环。

## 边界硬规则

这是个重要项目，后面模块会越来越多，所以边界不能只靠人记。

- 跨模块共享的协议只允许定义在 `core/contracts.py`
- `core` 可以被所有模块导入，但 `core` 自己不能反向依赖 `context / tools / executors / safety / observability / host / cli`
- `context/session_store.py` 只能实现 `core/contracts.py` 里的既有 Session 协议，不能重新定义 Session
- `tools/approval.py` 在第一批只提供 approval 接口接入和默认交互实现；策略型 approval 留给第二批 `Safety Baseline`
- `session_engine.py` 是运行时装配层，不是第二个 runner；CLI 入口只能调用它，不能复制装配逻辑

这些规则的说明集中放在 [接口契约](./10-contracts.md)。后面进入实现阶段时，建议把其中最关键的依赖方向规则接进 CI。

`Session Context`、`Safety Baseline`、`Observability Baseline` 也应该进入 x-req，但排在第二批更合理，因为它们是把第一个闭环补成可持续迭代的最小工程版本。
