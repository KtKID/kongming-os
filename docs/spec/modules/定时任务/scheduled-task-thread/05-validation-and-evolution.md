# 验证策略与演进

## 验证策略

### Smoke / E2E 验收入口

- **Smoke 路径**：启动 Web → 创建一个 cron 任务 → 返回 DTO 含 `thread_id` → 左侧出现“定时任务”分组 → 点击任务行打开对应 thread。
- **E2E 路径**：创建短周期任务 → 等待触发 → 验证绑定 thread 历史含 user 输入和 assistant 输出 → `/ws/cron` 或按需刷新能看到 run 完成 → thread history 没有重复追加的最终消息。
- **进入 x-req 的规则**：x-req README 明确拆出后端字段/路由/执行/前端/验证小节；dev-report 必须列出 pytest、vitest 和 smoke/e2e 证据。

### 单元测试

- **覆盖模块**：M1 store/domain、M2 manager/provisioning、M3 execution bridge、M4 metadata/router、M5 frontend store/component。
- **框架**：pytest、vitest。
- **重点场景**：
  - `ScheduledTask.thread_id` roundtrip。
  - 旧 payload 通过 `target.metadata["thread_id"]` 和 `delivery.target` 回填。
  - thread metadata v1-v10 lazy migration 默认 `thread_kind="chat"`。
  - create cron route 先创建 thread，再落 task。
  - create task 失败时补偿 thread。
  - `ExecutionBridge` 使用 `task.thread_id` 作为 session。
  - 绑定 thread run 跳过 target append，保留 cron 广播。
  - scheduler API 映射 `thread_id -> threadId`。
  - ThreadList 分组展示 scheduled_task threads。

### 集成测试

- **端到端链路**：Web create cron task → ThreadManager metadata → Store task → ExecutionBridge run → thread history → scheduler UI open thread。
- **环境要求**：外部 LLM 使用 fake provider 或 stub runner；Web route 使用真实 FastAPI TestClient；前端使用现有 vitest setup。
- **触发方式**：x-dev 阶段按 dev-report 命令复跑；x-verify 阶段逐条复验。

### 手动验证

- **必须人工过的场景**：左侧“定时任务”分组视觉层级、Clock 图标、任务行打开 thread 的跳转目标、创建后列表刷新。
- **验收人**：主 agent 审核 smoke/e2e 证据，用户复核 Web 交互。

## 测试覆盖要求

| 模块 | 最低覆盖 | 重点文件 |
|------|----------|---------|
| M1 scheduler domain/store contract | store roundtrip + 3 条回填路径 | `tests/unit/test_scheduler_store.py` 或相邻 scheduler store 测试 |
| M2 scheduler manager/provisioning | 成功、thread 创建失败、task 创建失败补偿 | 新增 scheduler manager 单测 |
| M3 execution bridge session binding | session_id 绑定、audit thread_id、delivery skip | `tests/unit/scheduler/test_scheduler_execution_bridge.py` 或相邻测试 |
| M4 web thread metadata/REST contract | metadata v11、DTO、route create | `tests/unit/web/test_threads*.py`、`tests/unit/web/test_cron*.py` |
| M5 frontend navigation | API mapping、ThreadList 分组、row open thread | `web/src/modules/scheduler/__tests__/*`、`web/src/components/*test*` |
| M6 smoke/e2e | 创建到触发到打开历史 | x-req/dev-report 记录真实步骤 |

## 演进路线

### 短期（本轮 task）

- [ ] 增加 `ScheduledTask.thread_id` 和兼容读取。
- [ ] 增加 thread metadata v11 和 DTO 字段。
- [ ] 建立 scheduler 创建门户或 provisioning Protocol。
- [ ] Web create 和 schedule_tool create 共用创建链路。
- [ ] ExecutionBridge 使用绑定 thread session。
- [ ] 前端展示“定时任务”分组并支持任务行打开 thread。
- [ ] 补齐后端、前端和 smoke/e2e 验证。

### 中期（下 1-2 轮）

- [ ] SchedulerManager 继续收口 pause/resume/remove/run_now 的 thread 关联语义。
- [ ] 删除 task 时支持 thread 归档或保留策略配置。
- [ ] run_now dispatcher 与 lifespan ticker dispatcher 统一到同一装配 helper。

### 长期（方向性）

- 任务量增大后，把 scheduler store 从 JSON 文件演进到 SQLite。
- 为 scheduled_task thread 增加聚合视图，例如最近 run、失败原因、下一次触发时间。
- 把 scheduler thread 的来源索引纳入全局搜索和审计查询。
