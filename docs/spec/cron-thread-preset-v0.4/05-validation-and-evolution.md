# 验证与演进

## 一、验证策略

### 单元测试

| 模块 | 测试文件 | 覆盖点 |
|------|---------|--------|
| M1 | `tests/unit/scheduler/test_domain_v4.py` | 新字段构造 + 校验 + 序列化 |
| M1 | `tests/unit/scheduler/test_scheduler_store.py` | v3→v4 迁移 + 新字段持久化 |
| M2 | `tests/unit/scheduler/test_execution_bridge.py` | `_resolve_llm` preset 查找 + 兜底 |
| M3 | `tests/unit/web/test_cron_delivery.py` | 双通道投递 + thread 追加失败降级 |
| M4 | `tests/unit/tools/test_schedule_tool.py` | origin_thread_id 继承 + preset 继承 |
| M5 | `tests/unit/scheduler/test_execution_bridge.py` | trace sink 挂载 + 移除 + 文件生成 |

### 集成验证

| 场景 | 步骤 | 期望 |
|------|------|------|
| thread 创建 + 触发 + 投递 | 在 web thread 创建 cron → 等触发 → 检查 thread 消息 | thread 里出现 cron 结果 |
| CLI 创建 + 触发 | CLI 创建 cron → 等触发 | origin_thread_id=None，只走 cron 广播 |
| preset 正确性 | 用 preset-A thread 创建 cron → 触发 → 检查 trace | trace 里 LLM 调用用的是 preset-A 的模型 |
| 兜底 preset | 旧任务 preset_id="" → 触发 | 用全局默认模型，不报错 |
| thread 已删除 | 创建 cron → 删除来源 thread → 触发 | cron 正常跑，thread_delivered=False |

### lint / typecheck

```bash
make lint          # ruff check + import-linter
make typecheck     # mypy
make test-unit     # pytest tests/unit -v
```

## 二、演进路径

### v0.5 潜在方向

| 方向 | 说明 | 前置 |
|------|------|------|
| AgentProfile 一等公民 | 把 preset_id + instructions + tool_names 打包为 AgentProfile | v0.4 preset_id 已在 task 级建立 |
| cron 对话历史回看 | 在 web UI 点击 cron run → 弹出完整对话（读 trace jsonl） | v0.4 trace 落盘已就绪 |
| 远端 delivery channel | feishu / Slack / email 投递 | v0.3 DeliverySink ABC 已有扩展点 |
| retry 机制 | `retry_limit` 字段生效 | v0.1 已定义字段，未实现 |
| cron 任务 web 表单创建 | `/cron` 页加"新建任务"表单 | 不依赖 v0.4 |

### 从 v0.4 到 v0.5 的迁移预期

- v0.4 新增字段（`origin_thread_id` / `preset_id` / `thread_delivered`）在 v0.5 保留
- AgentProfile 引入后，`preset_id` 可能演化为 `agent_profile_id`，但语义兼容（都是"用什么配置跑"）
- schema 升级预期 v4 → v5，迁移策略延续增量补字段模式
