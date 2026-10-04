# message-runtime-v0.1

> 状态：方案确认
> 目标：统一 generic / Claude / Codex 三条聊天链路的发送、接收、历史回放与渲染边界。

## 系统目标

当前 Web 聊天能力已经有通用入口层，频道内的消息收发和历史处理仍然分散在多套脚本里。这个 spec 把消息运行时拆成稳定的公共层和 provider 专有层，先统一发送、接收、历史合并与数据流渲染边界，再为下一版接入 `Streamdown` 留出替换面。

## 最小可用路径

用户在 `web/src/pages/Chat.tsx` 的输入区提交文本、图片、思考等级等公用输入 → `ChatManager` 组装 `SendRequest(common + provider)` → 对应 `*ChatProvider` 生成频道 wire frame → `NetworkManager` 发送原始帧 → 后端 provider route / service 返回流式帧 → `ChatManager` 把历史与实时帧归一化成 `ChatEvent` → `ChatTimelineStore` 合并为统一时间线 → `ChatRenderAdapter` 产出当前 UI 所需数据 → `ClaudeCodeView` / `CodexView` / Generic View 只负责展示。

> 这条链路覆盖本轮 P0。`Streamdown` 接入、后端 provider 合并、现有 JSONL parser 收编属于后续演进。

## 范围边界

**包含**：
- 前端消息运行时的公共边界定义
- `NetworkManager`、`ChatManager`、`ChatTimelineStore`、`ChatRenderAdapter` 的职责切分
- 公用发送结构与 provider 独有结构的组合方式
- Claude / Codex / Generic 三个 provider 的对外接口约束
- 首发创建、历史加载、实时流渲染的统一时序

**不包含**：
- 后端 `route.py` / `service.py` 的跨频道合并
- `Streamdown` 真实接入实现
- 旧视图样式和消息卡片视觉重设计
- 非聊天用途的 scheduler / approval / shell socket 收编

## 模块导航

| 模块 | 状态 | 文档 | 是否可进 task | 说明 |
|------|------|------|---------------|------|
| `NetworkManager` | 开发中 | [02-module-breakdown.md](./02-module-breakdown.md) | 否 | Claude 已接入，Generic 与 Codex 仍待收编 |
| `ChatManager` | 方案确认 | [02-module-breakdown.md](./02-module-breakdown.md) | 是 | 新的公共聊天管理器，对外收口 send / receive / history |
| `ChatTimelineStore` | 方案确认 | [04-data-and-state.md](./04-data-and-state.md) | 是 | 统一时间线状态机，负责历史与流式合并 |
| `ChatRenderAdapter` | 方案确认 | [04-data-and-state.md](./04-data-and-state.md) | 是 | 当前 UI 投影层，下一版可替换为 Streamdown adapter |
| `ChatProvider` | 方案确认 | [02-module-breakdown.md](./02-module-breakdown.md) | 是 | 各频道自己的 wire 协议与历史接口适配层 |

## 文档导航

- [架构图](./architecture.html)（浏览器双击打开）
- [目标与完成标准](./01-goals-and-boundaries.md)
- [模块设计 + 接口 + 数据结构](./02-module-breakdown.md)
- [核心流程](./03-core-workflows.md)
- [数据模型与状态](./04-data-and-state.md)
- [验证策略与演进](./05-validation-and-evolution.md)
- [Task 映射](./90-task-map.md)

## 当前建议

1. 先落 `web/src/chat/types.ts` 与 `web/src/chat/providers/*`，把发送输入结构和 provider 边界固定下来。
2. 再落 `ChatManager` 与 `ChatTimelineStore`，先统一发送、接收、历史合并。
3. 最后把 `ClaudeCodeView`、`CodexView` 和 Generic 视图改成薄壳组件，渲染数据只从 `ChatRenderAdapter` 取。
