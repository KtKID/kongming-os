# 数据与状态

## 存储结构

推荐目录结构如下：

```text
<store_path>/<session_id>/
  manifest.json
  <session_id>.jsonl
```

结构原则：

- 每个 session 一个独立目录
- `manifest.json` 保存稳定的会话级元数据
- `<session_id>.jsonl` 保存 append-only 消息流

示例：

```text
<store_path>/cli-ab12cd34/
  manifest.json
  cli-ab12cd34.jsonl
```

## SessionBootstrap

`SessionBootstrap` 是 CLI 阶段先产出的初始化元数据包。它承载“已经可得、且整个 session 生命周期内保持稳定”的信息。

推荐字段：

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

字段语义：

- `agent_name`：本次运行的 agent 名称
- `model_name`：本次会话模型
- `instruction_sources`：指令来源列表
- `instruction_text_hash`：`InstructionLoader.render(...)` 最终结果的哈希
- `created_at`：session 逻辑创建时间
- `cwd`：启动目录
- `app_version`：当前程序版本号，可选

## bootstrap 到 manifest 的映射

`bootstrap` 先保存在内存中的 `FileSession.bootstrap`，首次 `materialize()` 时写入 `manifest.json`。

映射关系如下：

- `bootstrap.agent_name` -> `manifest.agent_name`
- `bootstrap.model_name` -> `manifest.model_name`
- `bootstrap.instruction_sources` -> `manifest.instruction_sources`
- `bootstrap.instruction_text_hash` -> `manifest.instruction_text_hash`
- `bootstrap.created_at` -> `manifest.created_at`
- `bootstrap.cwd` -> `manifest.cwd`
- `bootstrap.app_version` -> `manifest.app_version`

`manifest.json` 还会补充 session 文件格式字段：

- `schema_version`
- `session_id`
- `format`

## manifest.json

首版建议保持最小但完整：

```json
{
  "schema_version": "0.1.1",
  "session_id": "cli-ab12cd34",
  "created_at": 1776742816.609,
  "agent_name": "kongming-agent",
  "model_name": "v1mini",
  "instruction_sources": [
    "project:README.md",
    "project:CLAUDE.md",
    "user:cli-override"
  ],
  "instruction_text_hash": "sha256:7c3c2d6e6a2d4ab497c1cba6f1d4d8b4c0cfe4d4a8f1c4f3b7d90b3f31f4c221",
  "cwd": "E:\\xgt\\proj\\agent-proj\\kongming-agent",
  "app_version": "0.1.1",
  "format": "cli-ab12cd34.jsonl"
}
```

字段语义：

- `schema_version`：manifest schema 版本
- `session_id`：session 主键
- `created_at`：session 创建时间
- `agent_name`：agent 名称
- `model_name`：模型名称
- `instruction_sources`：指令来源列表
- `instruction_text_hash`：渲染后 instruction 文本哈希
- `cwd`：启动目录
- `app_version`：程序版本号，可选
- `format`：当前消息文件名

设计原则：

- manifest 只保存稳定元数据
- schema 版本与本次方案版本同步
- 可变运行态信息继续保留在 `trace` 或 `audit`

## session 消息文件

消息文件使用 `<session_id>.jsonl`，每行一条消息记录。

记录格式如下：

```json
{
  "schema_version": "0.1.1",
  "session_id": "cli-ab12cd34",
  "model_name": "claude-sonnet-4-5",
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

字段语义：

- `schema_version`：record schema 版本
- `session_id`：所属 session
- `model_name`：本条消息所属会话使用的模型名称（来自 `bootstrap.model_name`）
- `message_id`：当前消息唯一标识
- `parent_message_id`：上一条成功写入消息的 id
- `created_at`：当前消息写入时间
- `message`：与现有 `Message` 序列化结构对齐的负载

`message` 子对象建议对齐当前消息结构：

- `role`
- `content`
- `tool_calls`
- `tool_call_id`
- `name`
- `metadata`

## ID 与链路规则

推荐规则如下：

- `message_id` 使用 UUIDv4
- `parent_message_id` 指向当前 session 中上一条已成功写入的消息
- 第一条消息的 `parent_message_id = null`
- `<session_id>.jsonl` 本身承担物理顺序

当前版本不再引入 `seq`。

原因如下：

- append-only 文件天然具备物理顺序
- 当前业务恢复依赖消息链，不依赖额外顺序号
- v0.1.1 保持最小闭环更稳

## 状态模型

### FileSession 内存状态

初始化阶段建议维护以下状态：

- `session_id`
- `bootstrap`
- `materialized = False`
- `last_message_id = None`

推荐补充的路径状态：

- `session_dir`
- `manifest_path`
- `messages_path`

状态说明：

- `session_id`：当前会话主键
- `bootstrap`：首次 materialize 时要写入 manifest 的稳定元数据
- `last_message_id`：上一条已成功落盘消息的 id
- `session_dir`：当前 session 目录
- `manifest_path`：manifest 文件路径
- `messages_path`：消息文件路径

### materialize 后状态

完成 `materialize()` 后：

- session 目录已存在
- `manifest.json` 已写入
- `<session_id>.jsonl` 已可追加
- `last_message_id` 已同步到当前文件状态
- 后续消息全部按 append-only 方式写入

## 一致性规则

- `<session_id>.jsonl` 永远 append-only
- `message_id` 全局唯一
- `parent_message_id` 指向上一条成功落盘消息
- 第一条消息的 `parent_message_id = null`
- 允许最后一行部分写入，恢复时跳过损坏尾行

## 恢复与容错

恢复阶段建议执行以下动作：

- 打开 `<session_id>.jsonl`
- 从尾部找到最后一个有效 record
- 恢复最后一个有效 `message_id`
- 将其设置为 `last_message_id`

容错策略如下：

- 允许最后一行部分写入
- 跳过损坏尾行
- 保留前序所有完整记录
- `manifest.json` 采用完整内容一次写入
- `<session_id>.jsonl` 永远 append-only

## 数据结构例子

### 例子 1：还没发送第一句 message

这个阶段的关键点如下：

- CLI 已经产出 `bootstrap`
- Runtime 已经创建了 `FileSession` 对象
- `FileSession` 还处于 `materialized = false`
- 磁盘层还没有 session 文件

CLI 侧产出的 `SessionBootstrap`：

```json
{
  "agent_name": "kongming-agent",
  "model_name": "v1mini",
  "instruction_sources": [
    "project:README.md",
    "project:CLAUDE.md",
    "user:cli-override"
  ],
  "instruction_text_hash": "sha256:7c3c2d6e6a2d4ab497c1cba6f1d4d8b4c0cfe4d4a8f1c4f3b7d90b3f31f4c221",
  "created_at": 1776742816.609,
  "cwd": "E:\\xgt\\proj\\agent-proj\\kongming-agent",
  "app_version": "0.1.1"
}
```

Runtime 中 `FileSession` 的内存状态：

```json
{
  "session_id": "cli-ab12cd34",
  "bootstrap": {
    "agent_name": "kongming-agent",
    "model_name": "v1mini",
    "instruction_sources": [
      "project:README.md",
      "project:CLAUDE.md",
      "user:cli-override"
    ],
    "instruction_text_hash": "sha256:7c3c2d6e6a2d4ab497c1cba6f1d4d8b4c0cfe4d4a8f1c4f3b7d90b3f31f4c221",
    "created_at": 1776742816.609,
    "cwd": "E:\\xgt\\proj\\agent-proj\\kongming-agent",
    "app_version": "0.1.1"
  },
  "materialized": false,
  "last_message_id": null,
  "session_dir": "~\\.kongming\\sessions\\cli-ab12cd34",
  "manifest_path": "~\\.kongming\\sessions\\cli-ab12cd34\\manifest.json",
  "messages_path": "~\\.kongming\\sessions\\cli-ab12cd34\\cli-ab12cd34.jsonl"
}
```

这个时点的磁盘层状态：

```text
~\.kongming\sessions\
```

当前还没有生成 `cli-ab12cd34/manifest.json` 和 `cli-ab12cd34/cli-ab12cd34.jsonl`。

### 例子 2：已经发送过内容

这个例子假设：

- 用户发了一句：`你好，帮我总结一下当前项目结构`
- 助手回复了一句
- `FileSession` 已经完成 `materialize()`

运行中的 `FileSession` 内存状态：

```json
{
  "session_id": "cli-ab12cd34",
  "bootstrap": {
    "agent_name": "kongming-agent",
    "model_name": "v1mini",
    "instruction_sources": [
      "project:README.md",
      "project:CLAUDE.md",
      "user:cli-override"
    ],
    "instruction_text_hash": "sha256:7c3c2d6e6a2d4ab497c1cba6f1d4d8b4c0cfe4d4a8f1c4f3b7d90b3f31f4c221",
    "created_at": 1776742816.609,
    "cwd": "E:\\xgt\\proj\\agent-proj\\kongming-agent",
    "app_version": "0.1.1"
  },
  "materialized": true,
  "last_message_id": "4d9545d7-c4d3-4cb4-b45c-4b8bb7b9054e",
  "session_dir": "~\\.kongming\\sessions\\cli-ab12cd34",
  "manifest_path": "~\\.kongming\\sessions\\cli-ab12cd34\\manifest.json",
  "messages_path": "~\\.kongming\\sessions\\cli-ab12cd34\\cli-ab12cd34.jsonl"
}
```

`manifest.json`：

```json
{
  "schema_version": "0.1.1",
  "session_id": "cli-ab12cd34",
  "created_at": 1776742816.609,
  "agent_name": "kongming-agent",
  "model_name": "v1mini",
  "instruction_sources": [
    "project:README.md",
    "project:CLAUDE.md",
    "user:cli-override"
  ],
  "instruction_text_hash": "sha256:7c3c2d6e6a2d4ab497c1cba6f1d4d8b4c0cfe4d4a8f1c4f3b7d90b3f31f4c221",
  "cwd": "E:\\xgt\\proj\\agent-proj\\kongming-agent",
  "app_version": "0.1.1",
  "format": "cli-ab12cd34.jsonl"
}
```

`cli-ab12cd34.jsonl`：

第 1 行：

```json
{"schema_version":"0.1.1","session_id":"cli-ab12cd34","model_name":"v1mini","message_id":"b5cca32c-f1a8-428e-8ae7-46dcfbb80bda","parent_message_id":null,"created_at":1776742817.102,"message":{"role":"user","content":"你好，帮我总结一下当前项目结构","tool_calls":null,"tool_call_id":null,"name":null,"metadata":{}}}
```

第 2 行：

```json
{"schema_version":"0.1.1","session_id":"cli-ab12cd34","model_name":"v1mini","message_id":"4d9545d7-c4d3-4cb4-b45c-4b8bb7b9054e","parent_message_id":"b5cca32c-f1a8-428e-8ae7-46dcfbb80bda","created_at":1776742818.441,"message":{"role":"assistant","content":"当前项目结构分为 CLI 入口、Runtime、Session 存储、Observability 和测试目录五个主要部分。","tool_calls":null,"tool_call_id":null,"name":null,"metadata":{}}}
```

磁盘目录结构：

```text
~\.kongming\sessions\cli-ab12cd34\
  manifest.json
  cli-ab12cd34.jsonl
```
