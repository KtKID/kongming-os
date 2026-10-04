# 验证与演进

## 1. 验收目标

v0.1.9 的验收目标很明确：

- 主任务输出稳定。
- child reviewer 能在后台运行。
- 进化养料能进入统一队列。
- `evolution_write` 能稳定写入 review record 和养料队列。
- review 失败不会污染主链路。

## 2. 测试分层

## 2.0 Hermes 测试参考

`v0.1.9` 的测试设计直接参考 Hermes 已有测试，优先借鉴这些文件：

- `other/hermes-agent/tests/tools/test_memory_tool.py`
- `other/hermes-agent/tests/run_agent/test_run_agent.py`
- `other/hermes-agent/tests/tools/test_skill_manager_tool.py`
- `other/hermes-agent/tests/tools/test_skill_size_limits.py`

这些参考用例的作用：

- `TestMemoryStoreSnapshot`：验证“冻结快照”和“活态写入”分离，防止 reviewer 写入后污染当前主链 prompt。
- `TestMemoryToolDispatcher`：验证专用工具的参数校验和错误分支，防止 `evolution_write` 在坏 payload 下静默写脏数据。
- `TestMemoryNudgeCounterPersistence`：验证跨多次 run 的计数器不被意外重置，防止 `evolution.state.json` cadence 失真。
- `skill_manage create/patch/edit` 与 size-limit 用例：验证“工具直写资产”的 schema、名称、路径、体积、去重和边界，防止 `evolution_write` 变成无约束落盘口。

### 2.1 单元测试

**Evidence Selection**

- 只取最近窗口时 turn 映射正确。
- tool 结果摘要后仍保留关键证据。
- 用户纠正 turn 能被保留。
- 参考 Hermes：`TestMemoryStoreSnapshot`
  作用：保持“证据窗口是副本”，防止主 session 和 review session 混写。

**Reviewer Payload**

- 合法 payload 能解析为 `ReviewResult`。
- 缺失 `evidence_turns` 或 `confidence` 的养料被拒绝。
- 参考 Hermes：`TestMemoryToolDispatcher`
  作用：把参数缺失、字段非法、未知 action 的失败路径在工具层拦住。

**Evolution Write Tool**

- `ReviewResult` 写入 `reviews/<run_id>.json` 成功。
- `evolution-nutrients.jsonl` append 成功。
- 养料去重 key 生效。
- 幂等重试不会重复写。
- 参考 Hermes：`test_create_duplicate_blocked`、`test_create_invalid_name`、`test_create_over_limit`
  作用：覆盖去重、名称约束、体积上限，防止养料文件无限膨胀或出现不可升级脏数据。

**Learning State**

- run_count 和 user_turn_count 更新正确。
- 每 N 次 run 触发 review。
- 参考 Hermes：`TestMemoryNudgeCounterPersistence`
  作用：验证 cadence 状态跨多次 run 持续有效，不在 preamble 中被重置。

**Child Reviewer Runtime**

- review session 与主 session 隔离。
- reviewer runtime 的 tool 白名单只包含 `evolution_write`。
- `try/finally` 保证 runtime 回收和 `pending_reviews` 注销。
- 参考 Hermes：后台 review agent 共享主上下文但独立执行的链路
  作用：防止 reviewer 泄露普通工具能力，防止 reviewer 结束后留下孤儿任务。

### 2.2 集成测试

- `SessionEngine.run()` 完成后能触发后台 review。
- review 成功时 `.kongming/evolution/reviews/<run_id>.json` 写入成功。
- review 成功时 `evolution-nutrients.jsonl` 追加成功。
- `SessionEngine.aclose()` 会等待 pending review drain。
- drain 超时会发事件并继续关闭 provider。
- 参考 Hermes：`_turns_since_memory` 跨 `run_conversation` 持续存在
  作用：验证主链多次 run 后，review 触发条件和后台任务调度仍保持稳定。

## 3. 风险与控制

| 风险 | 影响 | 控制方式 |
|---|---|---|
| reviewer 过度记录 | 养料污染 | confidence threshold + evidence_turns 必填 |
| reviewer 漏掉高价值流程 | 养料缺失 | 保留 review record，后续可重放 |
| review payload 不稳定 | 后台失败 | strict schema + failed event |
| 退出过快 | review 丢失 | `aclose()` drain timeout |
| 养料队列膨胀 | 后续难筛 | 去重 key + append-only review record |

## 4. 推荐灰度策略

第一阶段：

- 打开 review record。
- 打开进化养料队列。

第二阶段：

- 增加更严格的 trigger。
- 增加更严格的 confidence threshold。

## 5. 演进路线

### 5.1 v0.1.9 完成态

- `after-run child review`
- evidence-based selection
- evolution nutrient queue
- evolution_write tool
- config + events + tests

### 5.2 下一阶段

- 进化养料去重和聚合。
- 流程型进化养料 promote 成正式 `SKILL.md`。
- 事实型进化养料 promote 成 memory。
- review prompt 优化和更细的 trigger。

### 5.3 更后续阶段

- pre-compact flush。
- external memory provider。
- candidate dashboard。
