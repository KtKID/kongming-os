# 验证策略与演进

## 验证策略

### 单元测试

#### 后端

| 模块 | 框架 | 重点场景 |
|------|------|---------|
| `Store.list_recent_runs` | pytest | 1. 空 store；2. 单任务多 run；3. 多任务跨任务排序；4. cursor 分页边界（恰好 N、超 N、cursor 在中间） |
| `routers/cron.py` | pytest + httpx async client | 1. GET 路径 200/400/404；2. POST 操作的乐观锁与幂等（重复 pause）；3. auth 缺失 401；4. `run_now` 错路径 400 |
| WS frame schema 扩展 | pytest | 验证 `cron.run.completed` 加 `next_run_at` / `status` 字段后旧客户端不破坏（broker 是仅 broadcast，向前兼容自然） |

#### 前端

| 模块 | 框架 | 重点场景 |
|------|------|---------|
| `cron store` selector | vitest | 1. 分组规则（CRON 进 recurring、ONCE 在今天进 todayOnce、ONCE 历史不出现）；2. 暂停的留在所属分组 |
| `cron store` actions | vitest | 乐观更新 + 失败回滚（`pauseTask` 失败时恢复 `enabled=true`） |
| `cron store` WS dispatch | vitest | `cron.run.completed` 收到后正确 prepend run + 更新 task |
| `useCronWS` hook | vitest | mount 订阅 / unmount 断开 / 重连退避 |
| `CronTaskRow` 状态图标 | vitest | 6 → 4 类映射正确；置灰渲染 |
| 抽屉互斥 (`workspace.ts`) | vitest | 打开 cron 时 `drawerFile` 被清空；旧 API `openFileDrawer` 转发后 `rightDrawer = 'file'` |

> **隔离要求**：每个 zustand 测试用 `setupStore()` factory 创建独立 store 实例；禁止共用 module-level 单例（CLAUDE.md "测试隔离与共享状态污染"）

### 集成测试

| 链路 | 框架 | 触发 | 备注 |
|------|------|------|------|
| 后端 REST 全路径（list / pause / resume / delete / run_now） | pytest e2e + 真实 `Store` 文件后端 | `make test-e2e` | 覆盖 happy path；用 `tmp_path` 隔离 |
| 前端 → 后端 → WS 三方完整链路 | Playwright e2e | 手动 + CI（如有） | 1. 创建任务 (通过 AI agent)；2. 立即触发 `run_now`；3. 验证抽屉里出现新 run；4. 验证红点 |

### 手动验证（Playwright MCP）

按 CLAUDE.md "完成 Web 需求后问是否 Playwright 验证"——本系统完成后必须实际打开浏览器跑一遍：

- [ ] 顶栏按钮存在 + hover 提示文字
- [ ] 点击打开抽屉；FileDrawer 同时打开时被关掉（反向也试）
- [ ] 任务列表分组正确（事先创建 1 CRON + 1 ONCE 今天 + 1 暂停）
- [ ] 状态图标 4 类视觉正确
- [ ] 点击任务行展开摘要
- [ ] 操作菜单：暂停 → 任务置灰；恢复 → 复原；删除 → 消失
- [ ] 立即触发 → 抽屉里日志区出现新 run
- [ ] 滚动到底部加载更多
- [ ] 实时推送：另开一个 thread 创建 ONCE 任务 5s 后触发，观察当前抽屉是否实时刷新

> 必须沉淀为 `web/tests/e2e/cron-center.spec.ts`，否则不算 ✅（CLAUDE.md "e2e 不等于手动浏览器实点"）

---

## 测试覆盖要求

| 模块 | 最低覆盖率 | 重点文件 |
|------|-----------|---------|
| `src/scheduler/store.py::list_recent_runs` | 100% | `tests/unit/scheduler/test_store_recent_runs.py` |
| `src/web/routers/cron.py` | 90% | `tests/unit/web/test_cron_router.py` |
| `web/src/stores/cron.ts` | 80% | `web/src/stores/__tests__/cron.test.ts` |
| `web/src/hooks/useCronWS.ts` | 70% | `web/src/hooks/__tests__/useCronWS.test.ts` |
| `web/src/components/CronTaskRow.tsx` | 70% | `web/src/components/__tests__/CronTaskRow.test.tsx` |

---

## 风险点与 PoC 建议

### 风险 A：`list_recent_runs` 性能（中）

**问题**：当前 `Store` 是文件后端，`runs/<task_id>/<run_id>.json` 跨任务聚合 = 遍历所有 task 目录读所有 run 文件，O(N×M)。

**PoC 步骤**：

```python
# tests/perf/test_list_recent_runs_perf.py
def test_list_recent_runs_under_1000():
    store = Store(tmp_path)
    for i in range(100):                # 100 task
        task = make_task(f"task-{i}")
        store.create_task(task)
        for j in range(10):             # 每 task 10 run
            store.append_run(make_run(task.task_id, j))

    t0 = time.perf_counter()
    runs = store.list_recent_runs(limit=50)
    elapsed = time.perf_counter() - t0
    assert len(runs) == 50
    assert elapsed < 0.2  # 200ms 上限
```

**判定标准**：
- 100 task × 10 run 下 < 200ms → 直接上线
- 200-500ms → 加内存索引（task_id → started_at 列表，lazy build）
- > 500ms → 重新设计 store layout（独立 `runs-index.json` 维护时间序）

**先做 PoC，再决定 T1 是否需要附带索引**。

### 风险 B：抽屉互斥改造破坏 FileDrawer（中）

**问题**：`workspace.ts` 改造涉及现有 `FileDrawer` 调用点；漏改 = 文件预览功能挂掉。

**缓解**：
- T3 起步前先 grep 全部 `useWorkspaceStore` 调用，列清单
- 改造 PR 必须跑现有 `web/src/components/__tests__/ToolCardViewFile.test.tsx`
- 在 PR 描述里明列"已验证 FileDrawer 不破坏"

### 风险 C：实时推送时 `next_run_at` 不一致（低）

**问题**：后端 `cron.run.completed` 当前 frame 不含 `next_run_at`。前端拿到推送后要么 N+1 查询，要么显示陈旧值。

**缓解**：T1 task 在 broker frame schema 加 `next_run_at` + `status` 两个字段。向前兼容（broker 仅 broadcast，旧客户端忽略未知字段）。

---

## 演进路线

### 短期（本轮 task）

- [ ] T1 后端 router + list_recent_runs（含 PoC）
- [ ] T2 前端数据层（API client + store + WS hook）
- [ ] T3 前端壳子（入口按钮 + 抽屉容器 + 互斥协调）
- [ ] T4 任务列表 + 行展开 + 操作菜单
- [ ] T5 日志区 + 滚动加载
- [ ] T6 实时推送 + 红点

### 中期（下 1-2 轮）

- [ ] 与"投递结果回到原 thread"那条修复链联动：在 cron 中心抽屉里点任务行能跳到创建该任务的 thread
- [ ] 任务行加"创建者 thread"小标签（根据 `created_by` 字段反查）
- [ ] 全局过滤：按状态 / 任务名搜索
- [ ] 失败任务自动展开 `delivery_error` 详情

### 长期（方向性）

- 移动端适配：抽屉变全屏 modal
- 任务编辑（修改 schedule / preset 而无需删后建）
- 任务运行图表（成功率、平均耗时）
- 跨设备未读同步（如果 cron 中心成为高频功能）
