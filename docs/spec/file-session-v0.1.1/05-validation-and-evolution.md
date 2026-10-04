# 验证与演进

## 目标

本文件定义 `file session v0.1.1` 的验证策略、测试用例、灰度路径和后续演进路线。

当前方案基线如下：

- session 存储目录为 `~\.kongming\sessions\<session_id>\`
- session 目录下包含 `manifest.json` 和 `<session_id>.jsonl`
- 首次 `append()` 触发 `materialize()`
- `manifest.json` 保存稳定 bootstrap 信息
- `<session_id>.jsonl` 保存 append-only 消息流
- 消息链只使用 `message_id` 和 `parent_message_id`
- 当前版本不引入 `seq`
- 当前版本不引入 `pending_buffer`

## 验证原则

- 先保主链路可用，再补边界容错
- 先验证单进程正确性，再验证恢复与重开行为
- 先验证 `file` backend，再做 `memory` 和 `sqlite` 回归保护
- 测试断言优先覆盖“文件结构、消息链、恢复行为、Runner 集成”

## 测试分层

### 单元测试

验证 `FileSession` 自身的数据结构和文件行为：

- 初始化
- 首次 materialize
- append-only 写入
- history 读取
- clear 清空
- 损坏尾行恢复

### 集成测试

验证 `Runner`、`build_session()`、`FileSession` 三者协作：

- `_seed_messages()` 的 system 注入行为
- resume 场景下 system 去重
- LLM 请求前的 history 拼装
- backend 切换行为

### 回归测试

验证新 backend 接入后，旧行为保持稳定：

- `memory` backend 不受影响
- `sqlite` backend 不受影响
- `trace` 链路不受影响

## 测试用例

### 用例 1：创建 FileSession 对象时不落盘

**目的**

验证 session 对象创建和文件 materialize 分离。

**前置条件**

- 提供 `session_id`
- 提供完整 `SessionBootstrap`
- `~\.kongming\sessions\<session_id>\` 尚不存在

**步骤**

1. 构造 `FileSession(session_id, bootstrap, root_dir=~\.kongming\sessions)`
2. 不调用 `append()`
3. 检查对象状态和文件系统

**预期结果**

- `materialized = false`
- `last_message_id = null`
- session 目录不存在
- `manifest.json` 不存在
- `<session_id>.jsonl` 不存在

**中文解释**

这个用例验证“创建对象”和“创建文件”是两件事。只启动 CLI 或只创建 session 对象时，磁盘层应该保持干净，首条真实消息才触发落盘。

### 用例 2：首次 append 触发 materialize 并直接写入当前消息

**目的**

验证首次 `append()` 的主链路闭环。

**前置条件**

- 新 session
- `materialized = false`

**步骤**

1. 创建 `FileSession`
2. 构造一条 `Message.system(...)` 或 `Message.user(...)`
3. 调用 `append(message)`
4. 检查目录、manifest、jsonl 文件

**预期结果**

- session 目录被创建
- `manifest.json` 被写入
- `<session_id>.jsonl` 被创建
- 当前消息已经写入 jsonl 第一行
- `materialized = true`
- `last_message_id` 等于第一条消息的 `message_id`

**中文解释**

这个用例验证当前方案里最关键的一点：没有缓冲层，首条消息直接驱动 materialize，然后立刻落盘。只要这条链路成立，整个 file session 方案就站住了。

### 用例 3：manifest.json 包含完整 bootstrap 字段

**目的**

验证 `bootstrap -> manifest` 映射完整且无遗漏。

**前置条件**

- `SessionBootstrap` 含完整字段

**步骤**

1. 创建 `FileSession`
2. 调用首次 `append()`
3. 读取 `manifest.json`

**预期结果**

`manifest.json` 至少包含以下字段：

- `schema_version`
- `session_id`
- `created_at`
- `agent_name`
- `model_name`
- `instruction_sources`
- `instruction_text_hash`
- `cwd`
- `app_version`
- `format`

并且字段值与 `bootstrap` 一致。

**中文解释**

这个用例验证 manifest 的职责边界。manifest 存的是稳定 bootstrap 信息，所以任何字段缺失都会让恢复、排障和审计价值下降。

### 用例 4：消息记录包含完整字段

**目的**

验证 `<session_id>.jsonl` 的 record schema 完整。

**前置条件**

- 已 append 至少一条消息

**步骤**

1. 读取 `<session_id>.jsonl` 第一行
2. 解析 JSON
3. 校验字段集合

**预期结果**

record 至少包含：

- `schema_version`
- `session_id`
- `message_id`
- `parent_message_id`
- `created_at`
- `message`

`message` 子对象至少包含：

- `role`
- `content`
- `tool_calls`
- `tool_call_id`
- `name`
- `metadata`

**中文解释**

这个用例验证“每一行都是一条完整消息记录”。后续恢复和链路校验都依赖这个最小完备结构。

### 用例 5：消息链 parent_message_id 正确串联

**目的**

验证消息链的逻辑完整性。

**前置条件**

- 同一 session 中连续 append 3 条消息

**步骤**

1. append 第 1 条消息
2. append 第 2 条消息
3. append 第 3 条消息
4. 读取 jsonl 全部记录

**预期结果**

- 第 1 条消息 `parent_message_id = null`
- 第 2 条消息 `parent_message_id = 第 1 条 message_id`
- 第 3 条消息 `parent_message_id = 第 2 条 message_id`

**中文解释**

当前方案去掉了 `seq`，所以消息链完整性完全靠 `message_id + parent_message_id`。这个用例是新的主校验用例。

### 用例 6：history() 返回 append 顺序一致的完整历史

**目的**

验证 `history()` 的基本读取正确性。

**前置条件**

- 已写入多条消息，角色包含 `system / user / assistant / tool`

**步骤**

1. 依次 append 多条消息
2. 调用 `history()`
3. 对比返回列表和写入顺序

**预期结果**

- 返回消息条数正确
- 返回顺序与 append 顺序一致
- 返回消息内容与写入内容一致

**中文解释**

Runner 依赖 `history()` 作为上下文输入。只要 `history()` 顺序错，LLM 的上下文就会错。

### 用例 7：重开同一 session 后，消息链能继续续写

**目的**

验证恢复入口正确恢复最后一条消息链。

**前置条件**

- 某 session 已有历史消息
- 关闭当前对象后，用同一 `session_id` 重新构造 `FileSession`

**步骤**

1. 第一轮写入两条消息
2. 销毁当前 `FileSession`
3. 使用同一 `session_id` 新建 `FileSession`
4. 再 append 一条新消息
5. 读取最后一条 record

**预期结果**

- 新消息成功写入原 jsonl
- 新消息的 `parent_message_id` 指向之前最后一条已落盘消息
- 不会出现链断裂

**中文解释**

这个用例验证 session 的核心价值：进程重启后还能续写，而不是重新开始一条新链。

### 用例 8：损坏尾行时 history() 仍能恢复前序消息

**目的**

验证 append-only 文件的尾部容错能力。

**前置条件**

- jsonl 已有至少两条完整消息

**步骤**

1. 手工在文件末尾写入一条半截 JSON
2. 调用 `history()`
3. 再 append 一条新消息
4. 读取最终 jsonl

**预期结果**

- `history()` 跳过损坏尾行
- 前两条完整消息仍可恢复
- 新消息可继续追加

**中文解释**

这个用例覆盖崩溃场景。append-only 文件最常见的问题就是最后一行没写完，系统必须能接受这种现实。

### 用例 9：clear() 后历史视图清空，后续重新起链

**目的**

验证 `clear()` 的行为边界。

**前置条件**

- session 已有历史消息

**步骤**

1. 调用 `clear()`
2. 读取 `history()`
3. append 一条新消息
4. 读取新写入记录

**预期结果**

- `history()` 返回空列表
- 新消息成为新的第一条消息
- 新消息 `parent_message_id = null`

**中文解释**

这个用例验证 clear 是“清空当前会话历史”，而不是把状态留成半清空。

### 用例 10：Runner 首次运行只注入一条 system

**目的**

验证 `_seed_messages()` 与 `FileSession` 的集成正确性。

**前置条件**

- `agent_spec.instructions` 非空
- 新 session

**步骤**

1. 调用 `Runner.run(...)`
2. 让 `_seed_messages()` 执行
3. 检查 session 历史和 jsonl 内容

**预期结果**

- 历史中只有一条 system
- 顺序为 `system -> user`
- jsonl 中只有一条 system 记录

**中文解释**

这个用例覆盖最容易出错的 Runner 集成点。只要 system 注入重复，整个上下文就会被污染。

### 用例 11：resume 后 Runner 不重复注入 system

**目的**

验证已有历史的 session 重新运行时，system 消息不会重复。

**前置条件**

- 同一 session 已存在一条 system 和若干历史消息

**步骤**

1. 使用同一 `session_id` 重新运行 `Runner.run(...)`
2. `_seed_messages()` 先调 `session.history()`
3. 检查最终历史

**预期结果**

- `_seed_messages()` 能识别已有 system
- 不新增第二条 system
- 只新增本轮 user 和后续 assistant/tool 消息

**中文解释**

这个用例直接保护你刚才指出的问题。它验证 `history()` 的语义和 Runner 的 system 去重逻辑是一致的。

### 用例 12：backend=file 接入后不影响 memory/sqlite 回归

**目的**

验证新增 backend 的兼容性边界。

**前置条件**

- 配置支持 `memory / sqlite / file`

**步骤**

1. 分别构造三种 backend
2. 运行相同的 append/history 流程
3. 比较行为差异

**预期结果**

- `build_session()` 能正确返回对应实现
- `memory` 仍保持原行为
- `sqlite` 仍保持原行为
- `file` 行为符合本方案定义

**中文解释**

v0.1.1 的策略是增量接入，不动旧分支。这条用例保护版本稳定性。

## 首批必做用例

首批最小闭环建议优先实现以下 6 条：

1. 用例 2：首次 append 触发 materialize 并直接写入当前消息
2. 用例 3：manifest.json 包含完整 bootstrap 字段
3. 用例 4：消息记录包含完整字段
4. 用例 5：消息链 `parent_message_id` 正确串联
5. 用例 8：损坏尾行时 history() 仍能恢复前序消息
6. 用例 11：resume 后 Runner 不重复注入 system

这 6 条覆盖：

- 主链路
- 数据结构
- 恢复能力
- Runner 集成

## 灰度路径

v0.1.1 建议采用显式配置灰度：

### 阶段 1：开发灰度

- 默认 backend 保持现状
- 只在开发环境显式开启 `backend=file`
- 核验 manifest 和 jsonl 是否符合预期

### 阶段 2：测试灰度

- 在测试环境运行多轮对话
- 覆盖重启续写、clear、损坏尾行恢复
- 对照 `sqlite` 行为做回归检查

### 阶段 3：小范围真实灰度

- 只让少量真实 session 使用 `backend=file`
- 保持 trace 独立，便于排查 session 层问题
- 不切换默认 backend

### 阶段 4：稳定后扩面

- 累积样本后扩大 `backend=file` 使用范围
- 确认恢复与历史上下文行为稳定
- 再讨论默认 backend 切换

## 演进路线

### v0.1.1

- 交付 `file session`
- 保持 `sqlite` 分支不动
- 不引入 `seq`
- 不引入 `pending_buffer`
- 用 `message_id + parent_message_id` 维护消息链

### 后续可演进方向

#### 方向 1：增加 session 校验报告

- 增加显式 `validate()` 输出
- 输出链断裂、重复消息、损坏尾行统计

#### 方向 2：增加样例 session 文件

- 在 docs 或 tests 下保存标准样例
- 让 schema 演进更容易对照

#### 方向 3：补充 instruction snapshot

- 当前只保存 `instruction_text_hash`
- 后续可追加独立 snapshot 文件
- 保持 session 主结构不污染

#### 方向 4：默认 backend 切换评估

- 在 file backend 稳定后评估是否切默认
- 切换前先保住 `sqlite` 回归和恢复用例

## 当前建议

下一步直接把“首批必做用例”拆成测试任务，优先写单元测试，再补 Runner 集成测试。
