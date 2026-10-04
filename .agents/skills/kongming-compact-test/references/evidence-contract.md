# Kongming Compact Evidence Contract

执行 `kongming-compact-test` 时读取本文件。它固定可审计证据和判定边界，避免把 UI 提示、缓存变化或单次模型回答误当成压缩成功。

## 1. FileSession 记录

Session 文件：

```text
<kongming_home>/sessions/<thread_id>/<thread_id>.jsonl
```

有效 checkpoint 至少包含：

- `schema_version`
- `record_type=context_checkpoint`
- `checkpoint_version`
- `session_id`
- `checkpoint_id`
- `parent_checkpoint_id`
- `source_revision`
- `trigger`
- `model_preset_id`
- `model_name`
- `context_window_tokens`
- `estimated_input_tokens`
- `threshold_tokens`
- `prompt_version`
- `replacement_history`
- `usage`
- `created_at`

`history()` 对应 raw transcript；`context_snapshot()` 对应最新有效 checkpoint replacement 加 checkpoint 后新增消息。两者语义同时成立。

## 2. 三类请求

### 压缩前普通请求

包含完整 system、active context、当前 user 和普通 tools。记录最后一次普通请求的 message roles、message count 和 usage。

### Summary 请求

内容等于同一个 assembler 生成的完整 model-visible context，再追加一条内部 compaction prompt。合同：

- 当前 thread 的 provider/model/reasoning
- `tools=()`
- 成功响应必须是完整文本终态
- summary 生成成功后才允许 checkpoint CAS commit

### 压缩后普通请求

system prompt 由 InputAssembler 每次重新注入，因此 system 应继续存在并与压缩前一致。对话部分读取 checkpoint active context；FileSession raw transcript继续完整保存。

## 3. 摘要质量

必须直接读取 `replacement_history` 最后一条内部 summary，检查：

- 主要语言与用户日常语言一致。
- 所有测试新事实精确存在。
- 当前目标、关键决策、约束、证据、工具结果、未完成工作和下一步足以继续任务。
- summary 没有把推测写成已确认事实。

接受结构化列表、Markdown 表格和自然语言。事实判定应忽略 `KEY = value` 的空格和表格分隔符。

## 4. 事件与 lineage

Trace 文件：

```text
<kongming_home>/sessions/<thread_id>/trace.jsonl
```

成功链路：

```text
history.compact.started
  → summary provider request/response
  → FileSession checkpoint CAS commit
  → history.compact.completed
  → next normal run consumes replacement
```

`history.compact.completed` 的 checkpoint id 必须与 FileSession 记录相同。`stale`、`failed`、`insufficient_reduction` 和 `context_overflow_before_compaction` 都属于明确失败终态。

## 5. Usage 判定

只使用 provider-reported usage。优先字段：

- `input_total_tokens`
- `cache_read_tokens`
- `output_total_tokens`
- `reasoning_tokens`
- `total_tokens`

缓存读取代表 provider 复用相同前缀。压缩后保留 system prompt 和 tools schema 时，缓存读通常维持一个固定底座。发布判定关注：

1. active context 已由 checkpoint replacement 接管。
2. input 总量或可变历史规模下降。
3. summary 事实完整。
4. 后续请求继续成功。

## 6. 通过矩阵

| 维度 | 必需证据 | 失败信号 |
|---|---|---|
| 触发 | UI 命令或 trigger E2E + started event | 命令进入 raw transcript、事件缺失 |
| 持久化 | FileSession checkpoint record | 只有 UI 成功提示、checkpoint 缺失 |
| 摘要 | 直接读取 replacement summary | 只靠后续模型回答 |
| 请求 | raw dump 中 model/tools/system/HTTP status | dump 未开启或请求形态错误 |
| Continuation | checkpoint 后正常 LLM run | active context 未被消费 |
| Usage | trace provider usage 前后值 | 只引用 UI 四舍五入数字 |
| 清理 | 服务和正式配置恢复 | 临时 catalog/config 留在正式 home |

任一必需维度缺失时使用“失败”“阻塞”或“证据不足”，避免输出完整通过。
