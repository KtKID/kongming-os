# 核心流程

## 总体链路

`file session` 的主流程分成两段：

1. CLI 生成稳定 bootstrap 元数据
2. Runtime 在首次真实写消息时 materialize 文件 session

这个拆分同时保持早期元数据可得性和当前 runtime 延迟创建模型。

## 流程 1：CLI 到 Runtime 的初始化链路

1. CLI 执行 `load_config()`
2. CLI 执行 `InstructionLoader.load(...)`
3. CLI 执行 `InstructionLoader.render(...)`
4. CLI 计算 `instruction_text_hash`
5. CLI 生成 `session_id`
6. CLI 组装 `SessionBootstrap`
7. CLI 创建 `session_factory = make_session_factory(cfg.session, bootstrap)`
8. Runtime 持有 `session_factory`
9. Runtime 首次调用 `session_factory(session_id)` 创建 `FileSession`

## 流程 2：FileSession 首次 materialize

1. `FileSession.__init__(...)` 完成内存初始化
2. `materialized = False`
3. 首次 `append()` 先调用 `materialize()`
4. `materialize()` 创建 session 目录
5. `materialize()` 写入 `manifest.json`
6. `materialize()` 准备 `<session_id>.jsonl`
7. `append()` 继续把当前消息直接写入 `<session_id>.jsonl`
8. 后续消息全部进入 append-only 路径

## 流程 3：单条消息追加

1. 如果 session 尚未 materialize，先执行 `materialize()`
2. 生成 `message_id`
3. 使用当前 `last_message_id` 作为 `parent_message_id`
4. 取当前 `next_seq`
5. 组装 JSONL record
6. append 到 `messages.jsonl`
7. 更新 `last_message_id`
8. 更新 `next_seq`

## 流程 4：恢复与容错

1. 启动时顺序扫描 `messages.jsonl`
2. 恢复最后一个有效 `seq`
3. 恢复最后一个有效 `message_id`
4. 如尾行损坏，跳过损坏尾行并保留前序完整记录
5. 后续写入从 `next_seq = last_seq + 1` 继续

## 流程 5：校验

`validate()` 聚焦三类检查：

- `seq` 连续性
- `parent_message_id` 链完整性
- `message_id` 唯一性

校验结果用于恢复告警和后续诊断扩展。
