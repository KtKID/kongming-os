# generic-new-thread-v0.1

> 状态：历史首版
> 目标：让 Web 通用频道支持“点加号进入空白页，首条消息落盘后创建真实 thread”的新建会话体验。
> 后续版本：当前开发需求以 [generic-new-thread-v0.2](../generic-new-thread-v0.2/) 为准。

## 系统目标

通用频道的新建入口从弹窗式预创建改为延迟创建。用户点击左侧通用频道加号后进入一个新的空白对话页，页面没有历史消息，只有居中的现有 Composer 形态；用户发送第一句话后，后端完成请求解析、字段校验、cwd 解析，并在第一条 user message 持久化成功时创建真实 thread，再进入后续 LLM 流程。

## 最小可用路径

用户点击通用频道加号 → 前端进入 `/chat` 的 generic pending 状态 → 页面居中展示 Composer + 新页专属项目选择按钮 → 用户发送第一句话 → 后端校验 `preset_id / text / cwd` → 按选择项目或用户 home 解析 cwd → 持久化第一条 user message 并写入业务可见 thread metadata → 返回真实 `thread_id` → 前端跳转 `/chat/{thread_id}` 并接入现有 generic WS 时间线。

这条链路涉及的模块是 P0；图片首发、手动选择新项目目录、旧 thread 迁移属于后续增强。

## 范围边界

**包含**：
- 通用频道左侧加号进入空白新对话页
- 空白页只显示居中 Composer，复用当前聊天框和已有附属组件
- 空白页 Composer 底部新增项目选择按钮
- 项目下拉只来自当前已存在 thread 的有效 `cwd`
- 选择项目等价于设置新 thread 的 `cwd`
- 未选择项目时使用后端进程用户 home 作为 `cwd`
- 首条 user message 持久化成功时创建真实 thread
- Claude / Codex 频道保留现有 pending 创建流程

**不包含**：
- 旧 thread 的项目字段迁移或补齐
- 从下拉里新增新项目目录
- 空白页首发图片附件闭环
- thread 列表视觉重设计
- Claude / Codex 新建流程重构

## 模块导航

| 模块 | 状态 | 文档 | 是否可进 task | 说明 |
|------|------|------|---------------|------|
| `GenericPendingThreadEntry` | 可进入 x-req | [02-module-breakdown.md](./02-module-breakdown.md) | 是 | 通用频道加号进入空白页，维护 pending generic 状态 |
| `GenericEmptyThreadView` | 可进入 x-req | [02-module-breakdown.md](./02-module-breakdown.md) | 是 | 居中 Composer、项目按钮、首发交互 |
| `ThreadProjectSelector` | 可进入 x-req | [04-data-and-state.md](./04-data-and-state.md) | 是 | 从已有 thread metadata 派生 cwd 项目候选 |
| `FirstMessageThreadCreator` | 方案确认 | [02-module-breakdown.md](./02-module-breakdown.md) | 是 | 后端收口首条消息、metadata、session 持久化和启动流程 |
| `GenericFirstMessageProtocol` | 方案确认 | [04-data-and-state.md](./04-data-and-state.md) | 是 | REST/内部 DTO 与创建状态机 |

## 文档导航

- [图集：架构/流程/时序/状态/数据](./diagrams.html)（浏览器双击打开）
- [目标与完成标准](./01-goals-and-boundaries.md)
- [模块设计 + 接口 + 数据结构](./02-module-breakdown.md)
- [核心流程](./03-core-workflows.md)
- [数据模型与状态](./04-data-and-state.md)
- [验证策略与演进](./05-validation-and-evolution.md)
- [Task 映射](./90-task-map.md)

## 当前建议

先拆一个 x-req task：`generic-new-thread-first-message`。这个 task 同时覆盖前端 pending 空白页、项目选择按钮、后端首发创建入口和协议测试；其中后端首发入口是最高风险点，建议先用单元测试固定“返回真实 thread 前第一条 user message 已落盘”。
