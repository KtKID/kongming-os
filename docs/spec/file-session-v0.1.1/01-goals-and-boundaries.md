# 目标与边界

## 目标

`File Session v0.1.1` 的目标是把当前会话记录能力升级为可恢复的文件持久化能力，同时保持现有系统的调用模型稳定。

具体目标如下：

- 运行稳定优先，先交付最小可用的文件 session
- 保留 `sqlite` 分支，支持通过配置显式切换
- 让聊天记录、`trace`、`audit` 三条链路继续分层治理
- 在消息记录中建立物理顺序与逻辑父子链
- 解决 CLI 可获得稳定元数据、Runtime 才真正创建 session 的时序问题

## 核心价值

- 会话在进程重启后可以继续追加和恢复
- 文件结构直观，便于排障、诊断和样例沉淀
- append-only 写入模型简单稳定，适合首版落地
- `trace` 与 `audit` 保持独立，后续演进空间清晰

## 设计边界

### session

session 承担以下职责：

- 保存会话级 bootstrap 信息
- 持久化用户与助手消息
- 恢复历史消息
- 校验消息链完整性

session 的边界外内容：

- `trace` 事件流
- `audit` 审计流
- 运行观测聚合

### trace

`trace` 继续保存运行链路事件流，格式与 sink 保持独立。

### audit

`audit` 继续保存审计事件，文件与 sink 保持独立。

## 关键约束

- Runtime 继续通过 `session_id` 获取 session，接口习惯保持稳定
- `manifest.json` 只保存稳定元数据
- `messages.jsonl` 永远采用 append-only 写入
- 首版默认值保持现状，通过配置切换到 `backend=file`
- v0.1.1 交付面集中在 `file session`

## 当前阶段结论

- 该系统适合拆分
- 模块数量建议为 4 个
- 四个模块都具备进入 `x-req` 的基础
- `trace`、`audit`、instruction snapshot 继续停留在边界说明层
