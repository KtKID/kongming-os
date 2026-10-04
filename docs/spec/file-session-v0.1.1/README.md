# File Session v0.1.1

> 状态：可拆 task
> 目标：在 v0.1.1 为 kongming-agent 引入基于文件的 session 持久化能力，并保持现有 runtime 模型与 sqlite 分支稳定。

## 系统目标

`file session` 方案服务四个直接目标：

- 把会话持久化从内存态推进到可恢复的文件态
- 保持 `sqlite` backend 共存，控制首版切换风险
- 让聊天记录、`trace`、`audit` 三条数据链路继续分离
- 建立可恢复、可校验、可演进的消息链模型

本版本交付范围聚焦 `file session`。`audit`、`trace`、`instruction snapshot` 的结构继续沿既定边界独立演进。

## 范围边界

**包含**：

- CLI 阶段 `SessionBootstrap` 的生成与传递
- Runtime 延迟创建 `FileSession`
- `manifest.json` 与 `messages.jsonl` 的文件结构
- append-only 消息写入、恢复、链路校验
- `backend=file` 的配置接入和兼容性验证

**不包含**：

- `trace` 事件流格式调整
- `audit` 审计流格式调整
- `sqlite` backend 的删除、迁移或重构
- instruction snapshot 的扩展存储设计

## 模块导航

| 模块 | 状态 | 文档 | 是否可进 task | 说明 |
|------|------|------|---------------|------|
| Bootstrap 与 Session 工厂 | 可进入 x-req | `./02-module-breakdown.md#模块-1bootstrap-与-session-工厂` | 是 | 解决 CLI 与 Runtime 的元数据衔接 |
| FileSession 存储与落盘生命周期 | 可进入 x-req | `./02-module-breakdown.md#模块-2filesession-存储与落盘生命周期` | 是 | 建立目录、manifest、首条 append 触发 materialize、append-only 写入 |
| 消息链模型与恢复校验 | 可进入 x-req | `./02-module-breakdown.md#模块-3消息链模型与恢复校验` | 是 | 固化 `seq`、`message_id`、`parent_message_id` 规则 |
| Backend 接入与兼容性验证 | 可进入 x-req | `./02-module-breakdown.md#模块-4backend-接入与兼容性验证` | 是 | 接入 `backend=file` 并覆盖回归测试 |

## 文档导航

- [目标与边界](./01-goals-and-boundaries.md)
- [模块拆分](./02-module-breakdown.md)
- [核心流程](./03-core-workflows.md)
- [数据与状态](./04-data-and-state.md)
- [Task 映射](./90-task-map.md)

## 当前建议

1. 先按四个模块分别进入 `x-req`，保持 task 粒度与风险边界一致。
2. `Bootstrap 与 Session 工厂`、`FileSession 存储与落盘生命周期` 适合作为首批 task，它们共同形成主链路骨架。
3. `消息链模型与恢复校验` 在 schema 固化后单独推进，便于集中验证恢复与损坏尾行容错。
4. `Backend 接入与兼容性验证` 作为收口模块推进，保证 `sqlite`、`trace`、现有 runtime 行为稳定。

## 来源

- 原始方案文档：[file-session-v0.1.1.md](/E:/xgt/proj/agent-proj/kongming-agent/docs/file-session-v0.1.1.md)
