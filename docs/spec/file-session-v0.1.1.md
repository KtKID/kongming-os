# File Session v0.1.1 方案

## 目标

在 `v0.1.1` 引入基于文件的 session 持久化能力，服务于以下目标：

- 运行稳定优先，先把会话持久化从内存态推进到可恢复文件态
- 保留现有 `sqlite` 分支，不做删除和迁移
- 聊天记录、trace、audit 三条数据链路分离
- session 采用 append-only file 方案
- session 记录具备消息链关系，支持 `message_id` 和 `parent_message_id`
- 解决 CLI 阶段元数据已可得、Runtime 阶段才创建 session 的时序问题

本版本只交付 `file session`。`audit`、`trace`、`Instruction snapshot` 的结构保持后续迭代。

## 结论

采用以下结构：

- CLI 先产出 `bootstrap metadata`
- Runtime 延迟创建 session
- `FileSession` 首次 materialize 时一次性写入 `manifest.json`
- `FileSession` 首次 materialize 时刷出 `pending buffer`
- 会话消息写入 `messages.jsonl`
- 每条消息记录保存 `seq`、`message_id`、`parent_message_id`

这套方案直接借鉴 Claude Code 的处理原则：

- 启动阶段缓存稳定元数据
- 首条真实消息触发文件 materialize
- materialize 后统一落盘元数据和缓冲消息

## 设计边界

### session

session 负责：

- 会话级 bootstrap 信息
- 对话消息持久化
- 会话恢复
- 消息链校验

session 不负责：

- trace 事件流
- audit 审计流
- 运行观测聚合

### trace

trace 继续作为运行链路事件流，保持独立 sink。

### audit

audit 继续作为审计流，保持独立文件或独立 sink。

## 时序设计

新时序如下：

1. CLI 执行 `load_config()`
2. CLI 执行 `InstructionLoader.load(...)`
3. CLI 执行 `InstructionLoader.render(...)`
4. CLI 基于 rendered instruction 计算 `instruction_text_hash`
5. CLI 生成 `session_id`
6. CLI 组装 `SessionBootstrap`
7. CLI 构造 `session_factory = make_session_factory(cfg.session, bootstrap)`
8. Runtime 持有 `session_factory`
9. Runtime 首次调用 `session_factory(session_id)` 时创建 `FileSession` 对象
10. `FileSession` 初始只持有内存状态，不立刻创建目录和文件
11. 首次真正写入消息时触发 `materialize()`
12. `materialize()` 一次性完成：
    - 创建 session 目录
    - 写入 `manifest.json`
    - 准备 `messages.jsonl`
    - 刷出 `pending buffer`
13. 后续全部走 append-only 写入

这个时序同时满足两点：

- CLI 拿得到最早的稳定元数据
- Runtime 保留延迟创建 session 的现有模型

## 关键对象

### SessionBootstrap

`SessionBootstrap` 承载 CLI 阶段已经可得、且整个 session 内稳定的元数据。

推荐定义：

```python
from dataclasses import dataclass


@dataclass(frozen=True)
class SessionBootstrap:
    agent_name: str
    model_name: str
    instruction_sources: list[str]
    instruction_text_hash: str
    created_at: float
    cwd: str
    app_version: str | None = None
```

字段说明：

- `agent_name`: 本次 CLI 运行使用的 agent 名称
- `model_name`: 本次会话模型
- `instruction_sources`: 指令来源列表
- `instruction_text_hash`: 最终渲染 instruction 文本哈希
- `created_at`: session 逻辑创建时间
- `cwd`: 启动目录
- `app_version`: 可选版本号

### make_session_factory

推荐增加工厂闭包，把 CLI 已获得的 bootstrap 数据带进 Runtime。

```python
def make_session_factory(cfg: SessionConfig, bootstrap: SessionBootstrap):
    def factory(session_id: str) -> Session:
        return build_session(cfg, session_id=session_id, bootstrap=bootstrap)
    return factory
```

推荐保留 `Runtime` 当前只通过 `session_id` 获取 session 的调用方式，避免 Runtime 直接感知 bootstrap 细节。

### build_session

推荐扩展签名：

```python
def build_session(
    config: SessionConfig,
    session_id: str,
    bootstrap: SessionBootstrap | None = None,
) -> Session:
    ...
```

## 目录结构

推荐 session 存储结构：

```text
<store_path>/<session_id>/
  manifest.json
  messages.jsonl
```

说明：

- 每个 session 一个独立目录
- `manifest.json` 保存会话级稳定元数据
- `messages.jsonl` 保存 append-only 消息流

## manifest.json 定义

推荐首版采用“最小但完整”的 manifest：

```json
{
  "schema_version": "0.1.1",
  "session_id": "cli-ab12cd34",
  "created_at": 1776742816.609,
  "agent_name": "kongming-agent",
  "model_name": "v1mini",
  "instruction_sources": [
    "project/CLAUDE.md",
    "user/override"
  ],
  "instruction_text_hash": "sha256:...",
  "cwd": "E:\\xgt\\proj\\agent-proj\\kongming-agent",
  "format": "messages.jsonl"
}
```

字段定义：

- `schema_version`: manifest schema 版本
- `session_id`: session 主键
- `created_at`: session 创建时间
- `agent_name`: agent 名称
- `model_name`: 模型名称
- `instruction_sources`: 指令来源列表
- `instruction_text_hash`: 渲染后指令文本哈希
- `cwd`: 启动目录
- `format`: 当前消息文件格式

推荐原则：

- manifest 只存稳定元数据
- manifest 首版保持小而完整
- 可变运行态信息保持在 trace 或 audit 侧

## messages.jsonl 定义

每行一个消息记录，建议格式如下：

```json
{
  "schema_version": "0.1.1",
  "seq": 1,
  "session_id": "cli-ab12cd34",
  "message_id": "uuid-1",
  "parent_message_id": null,
  "created_at": 1776742816.700,
  "message": {
    "role": "user",
    "content": "hello",
    "tool_calls": null,
    "tool_call_id": null,
    "name": null,
    "metadata": {}
  }
}
```

字段定义：

- `schema_version`: record schema 版本
- `seq`: 物理追加顺序
- `session_id`: 所属 session
- `message_id`: 当前消息唯一标识
- `parent_message_id`: 前一条消息 id
- `created_at`: 当前消息写入时间
- `message`: 实际消息负载

`message` 子对象建议对齐当前 `Message` 序列化结构：

- `role`
- `content`
- `tool_calls`
- `tool_call_id`
- `name`
- `metadata`

## ID 与链路规则

推荐规则如下：

- `message_id` 使用 UUIDv4
- `parent_message_id` 指向当前 session 中上一条已成功写入消息
- 第一条消息的 `parent_message_id = null`
- `seq` 在单 session 内单调递增

推荐同时保存：

- `seq` 作为物理恢复主索引
- `message_id / parent_message_id` 作为逻辑链校验索引

这样具备两个好处：

- 恢复可以优先依赖简单稳定的顺序索引
- 校验可以识别链断裂、重复、跳接等问题

## FileSession 生命周期

### 初始化

`FileSession.__init__(...)` 只做内存初始化：

- 保存 `session_id`
- 保存 `bootstrap`
- 设置 `materialized = False`
- 设置 `pending buffer`
- 设置 `next_seq = 1`
- 设置 `last_message_id = None`

### materialize

`materialize()` 只执行一次，职责如下：

- 创建 session 目录
- 写入 `manifest.json`
- 确保 `messages.jsonl` 存在
- 如目录已存在，恢复 `next_seq` 和 `last_message_id`
- 刷出 `pending buffer`

### append

`append(message)` 执行顺序：

1. 如果尚未 materialize，先调用 `materialize()`
2. 生成 `message_id`
3. 取当前 `last_message_id` 作为 `parent_message_id`
4. 生成 `seq`
5. 组装 JSONL record
6. append 到 `messages.jsonl`
7. 更新 `last_message_id`
8. 更新 `next_seq`

### history

`history()` 顺序扫描 `messages.jsonl`，返回消息列表。

恢复原则：

- 读取完整行
- 跳过损坏尾行
- 返回可恢复部分

### validate

`validate()` 负责：

- 检查 `seq` 连续性
- 检查 `parent_message_id` 链完整性
- 检查重复 `message_id`
- 产出恢复告警结果

## pending buffer 设计

`pending buffer` 放在 `FileSession` 内部。

推荐原因：

- session 自身负责自己的落盘时机
- Runtime 继续只依赖 session 协议
- manifest 写入、message append、buffer flush 在同一个对象内闭环
- 恢复与校验逻辑集中

buffer 中保存的对象建议直接是“待写入的 record payload”或“待追加消息对象”，由 `materialize()` 时统一转换。

## 恢复与容错

### 恢复策略

- 启动时扫描 `messages.jsonl`
- 恢复最后一个有效 `seq`
- 恢复最后一个有效 `message_id`
- 后续消息从 `next_seq = last_seq + 1` 继续写入

### 容错策略

- 允许最后一行部分写入
- 读取时跳过损坏尾行
- 保留前序所有完整记录
- `manifest.json` 采用完整内容一次写入
- `messages.jsonl` 永远 append-only

### 校验策略

- `seq` 连续性决定物理完整性
- `parent_message_id` 决定逻辑链完整性
- 二者同时记录，便于后续 audit 或诊断接入

## 配置改动

推荐在 `SessionConfig.backend` 中新增：

- `memory`
- `sqlite`
- `file`

当前版本策略：

- 保留 `sqlite` 分支不动
- 新增 `file` backend
- 默认值保持现状
- 通过配置显式切换到 `file`

这能把风险控制在最小范围内。

## 与 trace / audit 的关系

本版本边界如下：

- `session`: 只保存聊天记录与 session 级 bootstrap 信息
- `trace`: 只保存运行过程事件
- `audit`: 只保存审计事件

推荐保持三者分离，原因如下：

- 恢复逻辑更简单
- 数据职责更清晰
- 后续扩展 audit 与 trace 不会反向污染 session 格式

## v0.1.1 实施任务

建议按以下顺序拆分：

1. 新增 `SessionBootstrap`
2. 新增 `make_session_factory`
3. 扩展 `build_session(..., bootstrap=...)`
4. 新增 `backend=file`
5. 实现 `FileSession`
6. 定义 `manifest.json` schema
7. 定义 `messages.jsonl` schema
8. 实现恢复与尾部损坏容错
9. 编写 e2e 与单元测试
10. 补充文档和样例 session 文件

## 测试清单

至少覆盖以下用例：

- 首次对话创建目录、manifest、messages 文件
- 多轮对话 `seq` 连续递增
- `parent_message_id` 串联正确
- 重启后继续追加，`seq` 正确续接
- `history()` 能恢复完整前序消息
- 尾行损坏时仍能恢复前序消息
- `sqlite` backend 回归不受影响
- trace 逻辑不受 session backend 切换影响

## 决策记录

当前已确认的决策如下：

- 保留 `sqlite` 分支，不做删除
- `trace` 与聊天记录分开
- session 使用 append-only file
- session 记录保存 `message_id` 与 `parent_message_id`
- 采用 `CLI bootstrap + Runtime lazy materialize` 时序
- `manifest.json` 保存稳定 bootstrap 信息
- `messages.jsonl` 保存消息记录流
- `v0.1.1` 先交付 file session

## 当前建议

后续直接进入 `x-req` 的模块拆分阶段，任务名建议使用 `file-session-v0.1.1`。
