# 验证与演进

## 一、测试矩阵

### 单元测试（unit）

| 模块 | 测试文件 | 关键 case |
|---|---|---|
| M1 schema | `tests/unit/scheduler/test_schema_v3_migration.py` | v2→v3 迁移；v1→v3 链式；新字段默认值；unknown 抛错；round-trip |
| M1 domain | `tests/unit/scheduler/test_schedule_delivery.py` | DeliveryChannel enum；ScheduleDelivery from/to dict；非法 channel 拒绝 |
| M1 store | `tests/unit/scheduler/test_scheduler_store_v3.py` | list_recent_runs / mark_run_seen / count_unseen_runs |
| M2 session | `tests/unit/scheduler/test_fresh_session_persisted.py` | cron 跑完后能从磁盘 reload；messages.jsonl 完整性 |
| M3 bridge | `tests/unit/scheduler/test_delivery_dispatcher.py` | 路由 web vs cli；sink 不存在 skipped；sink 抛异常 failed；silent_marker 命中 skipped |
| M4 web sink | `tests/unit/web/test_cron_delivery_sink.py` | RunRecord 写盘；WS broadcast；broadcast 失败不影响落盘 |
| M5 cli sink | `tests/unit/cli/test_cron_delivery_sink.py` | buffer append；drain_pending 清空；并发 append 安全 |
| M6 REST | `tests/unit/web/test_cron_router.py` | 7 个 endpoint 各自 happy path + 鉴权 + 404 + 边界 |
| M7 前端 | `web/src/__tests__/Cron.test.tsx` | 列表渲染；暂停/删除按钮；红点状态机；WS 事件触发刷新 |
| M8 tool | `tests/unit/test_schedule_tool_delivery.py` | 默认推断；显式指定；非法值；caller_kind 缺失 fallback |

### 集成测试（integration / e2e）

| 场景 | 测试文件 | 描述 |
|---|---|---|
| Web 端到端投递 | `tests/e2e/test_cron_delivery_web_e2e.py` | 创建 task → 真 ticker tick → fresh agent run → WebSink → ws_broker → 客户端收到 cron.run.completed |
| CLI 端到端 flush | `tests/e2e/test_cron_delivery_cli_e2e.py` | 创建 task → 触发 → CliSink buffer → REPL drain_pending → stdout 含投递文本 |
| Schema 升级 e2e | `tests/e2e/test_scheduler_v2_to_v3_upgrade.py` | 准备 v2 数据 → 启动 v0.3 store → 验证迁移 + 任务可读 + ticker 正常 |
| Web 暂停/删除 | `tests/e2e/test_cron_pause_delete_e2e.py` | 创建 → 暂停 → 验证 ticker 跳过 → 恢复 → 验证 ticker 重新跑 → 删除 → 验证列表过滤 |
| 红点状态机 | `tests/e2e/test_cron_unseen_count_e2e.py` | 触发多个 run → unseen_count 增 → mark_seen → 归零 |

### 已有测试不动

- v0.2 的 `tests/unit/scheduler/test_scheduler_store.py`（schema v2 部分）→ 保留，作为回归
- v0.2 的 cron-test-coverage-hermes-align 16 项 → 全保留

## 二、灰度策略

v0.3 是单用户本地工具，没有真正的"灰度"。但有几个安全网：

1. **schema migration 自动备份**：v2 → v3 升级前先 `cp scheduled_tasks.json scheduled_tasks.json.v2.bak.<ts>`，runs 也整体复制
2. **delivery 失败不影响 cron run completed 状态**：dispatcher.deliver 抛异常只填 `delivery_error`，不让 cron 任务进入失败态
3. **WS broadcast 失败不阻塞 store 落盘**：先 store 后 WS，broadcast 抛异常 catch 住记 log，不影响 delivery_status=delivered
4. **CLI flush 失败不影响 REPL**：sink.drain_pending 抛异常 catch 住继续 prompt
5. **删除是软删除**：state=DELETED + enabled=False，runs 历史保留；用户后悔可手改 JSON 恢复

## 三、上线 checklist

- [ ] M1 schema migration 单测全过
- [ ] 拿真实 v0.2 数据跑 v3 启动 → 看备份文件存在 + 任务列表正确
- [ ] M2 fresh session 落盘 e2e 通过
- [ ] M3 dispatcher 单测覆盖 4 种 case（web/cli/no-sink/silent）
- [ ] M4 web 端 e2e：触发 → 浏览器收 WS → 列表实时更新
- [ ] M5 cli 端 e2e：触发 → 下次 prompt 前打印
- [ ] M6 REST 7 endpoint 全过 + 真前端可调
- [ ] M7 前端 lighthouse / 视觉走查 / 红点状态机走查
- [ ] M8 schedule_tool 三种 caller_kind 推断 case
- [ ] make test-unit 全过
- [ ] make test-e2e 全过（或显式列出 skipped 项）
- [ ] CLAUDE.md 模块导航更新（schedule 段落 + 模块状态行）
- [ ] TOOLS.md schedule 段落更新（delivery 字段使用指引）
- [ ] docs/agent-cron-module-v0.2/README.md 加"已被 v0.3 部分迭代"注脚

## 四、文档更新清单

| 文件 | 更新内容 |
|---|---|
| `CLAUDE.md` | scheduler 模块行加 v0.3 标记；约束 12 加 cron delivery 不连真 channel |
| `docs/modules/调度/README.md`（如有）| 模块导览更新为 v0.3 |
| `docs/agent-cron-module-v0.2/README.md` | 顶部加注："本文档为 v0.2 阶段记录，delivery 层与 web 管理页详见 cron-delivery-v0.3" |
| `src/prompts/templates/TOOLS.md` | schedule 工具段落加 delivery 字段说明 |
| `.kongming/prompts/TOOLS.md` | 用户重启后会自动从 templates 同步；如已物化需手 cp |
| `dev-pipeline/tasks/cron-delivery-v0.3-*/*.md` | 8 个 task 包内文档 |

## 五、演进路线（v0.3 之后）

### v0.3.x 补丁（如发现问题）

- delivery 失败重试机制（如果出现 web 客户端短暂离线导致投递落空的反馈）
- runs 历史 retention（按时间清理 fresh session messages）

### v0.4 候选

- **新 channel：feishu / email / Slack**：DeliveryChannel enum 加值，Dispatcher 加分支；要先评估远端集成成本
- **任务编辑**：列表页支持改 schedule / input / delivery（不改任务核心 ID，覆盖式更新）
- **任务分组 / 标签**：`tags: list[str]`，列表页按 tag 过滤
- **观测面板**：cron 触发成功率 / 平均延迟 / failure 分布
- **跨设备同步**：cron 数据 → 云端镜像（用户在多台机器看同一个 cron 列表）

### v1.0 候选

- 多用户隔离（如果 kongming 真的部署成多人服务）
- 任务模板（保存常用 cron 任务为模板，一键创建）
- 任务依赖链（task A 完成后触发 task B）

## 六、回归风险点

| 风险 | 影响面 | 缓解 |
|---|---|---|
| schema 迁移漏掉某个旧字段 | 用户数据丢失 | 自动备份 v2.bak；e2e 测试拿真实 v0.2 数据跑 |
| fresh session 落盘后 disk 爆满 | 系统不可用 | 文档说明 cleanup；后续加 retention |
| WS broadcast 性能（大量 cron 同时触发）| 前端卡顿 | broadcast 异步，不阻塞 deliver；前端 throttle |
| CLI buffer 溢出（用户长时间不输入）| 内存增长 | buffer cap 100 行，超出丢最旧 |
| 软删除 task 列表过长 | 列表 API 性能 | 默认过滤 state=DELETED；提供独立 trash 视图（v0.4） |
| schedule_tool 旧调用方未填 delivery | 默认推断不准 | caller_kind 缺失时默认 web（最常见） |
| 红点 unseen_count 与实际不一致 | 用户体感差 | WS 实时 + 30s poll 兜底；mark_seen 接口幂等 |

## 七、监控建议（运维参考）

```bash
# v0.3 可观测的几个量
ls .kongming/cron/runs/ | wc -l                           # 总 run 数
du -sh .kongming/sessions/sched-*                          # fresh session 占用
jq '.tasks | length' .kongming/cron/scheduled_tasks.json   # 当前 task 数
jq '[.tasks[] | select(.state == "deleted")] | length' \
   .kongming/cron/scheduled_tasks.json                     # 软删除 task 数

# delivery 失败率
grep -h "delivery_status" .kongming/cron/runs/*.jsonl \
  | jq -s '[.[] | select(.delivery_status == "failed")] | length'
```
