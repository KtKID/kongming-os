# Task Map

## 任务总览

| Task ID | 任务名 | 模块 | 前置依赖 | DoD 覆盖 | 风险 | 备注 |
|---------|--------|------|---------|---------|------|------|
| **T1** | `web-cron-router-v0.1` | M1 + M2 + WS frame 扩展 | 无 | DoD#4(部分) #7 #8 #10(部分) | 中（性能 PoC） | **先做 PoC**：`list_recent_runs` 性能；通过后再实现 |
| **T2** | `web-cron-frontend-data-v0.1` | M3 + M4 + M5 | T1 | DoD#10 #11 | 低 | 数据层先于 UI |
| **T3** | `web-cron-shell-v0.1` | M6 + M7 + M10 | T2 | DoD#1 #3 | 中（破坏性改造） | 与 FileDrawer 互斥协调，需小心 |
| **T4** | `web-cron-tasklist-v0.1` | M8 | T3 | DoD#4 #5 #6 #7 | 低 | 可与 T5 并行 |
| **T5** | `web-cron-runlog-v0.1` | M9 | T3 | DoD#8 #9 | 低 | 可与 T4 并行 |
| **T6** | `web-cron-realtime-v0.1` | 红点 + 推送整合 | T2 + T3 + T4 + T5 | DoD#2 #10 | 低 | 收口任务，跑 e2e |

## 依赖关系

```
       T1（后端基础设施 + PoC）
        │
        ▼
       T2（前端数据层）
        │
        ▼
       T3（壳 + 互斥）
       ╱   ╲
      ▼     ▼
     T4    T5（可并行）
       ╲   ╱
        ▼
       T6（收口 + e2e）
```

## 排序依据

1. **T1 必须最先**：前端任何数据层都要它解锁。先做 PoC（`list_recent_runs` 性能），不达标先优化 store；达标再实现 router。
2. **T2 必须先于 UI 任务**：数据流跑通前 UI 没法测。
3. **T3 在 T4/T5 之前**：抽屉壳子是 UI 的容器。互斥改造放这里因为它必须配合抽屉一起做。
4. **T4 / T5 可并行**：列表和日志区数据来源不同（tasks vs runs），互不依赖。
5. **T6 最后**：把红点 + 实时推送 + e2e 沉淀到 spec 一起跑。

## 单 task 估算

| Task | 估算（人天） | 备注 |
|------|-------------|------|
| T1 | 1.5 | PoC 0.5 + router 0.5 + WS schema 扩展 0.5 |
| T2 | 1.0 | 模板套现有 chat store/connection |
| T3 | 1.0 | 互斥改造占大头（grep 调用点 + 兼容旧 API + 测试） |
| T4 | 1.0 | 操作菜单 + 展开逻辑 |
| T5 | 0.5 | 滚动加载相对简单 |
| T6 | 0.5 | 红点 + Playwright e2e |
| **合计** | **5.5 天** | 单人开发；含测试和验证 |

## PoC 触发条件（T1 内置）

T1 起步第一件事 = 跑 PoC：

```bash
uv run pytest tests/perf/test_list_recent_runs_perf.py -v
```

通过（< 200ms）→ 走方案 A（朴素跨任务文件读）
未通过（200-500ms）→ 走方案 B（lazy 内存索引）
严重未通过（> 500ms）→ 暂停 T1，回方案层重新设计 store layout

## 各 task 进入 x-req 的判定

| Task | 是否可进 x-req | 原因 |
|------|---------------|------|
| T1 | ✅ 可以 | 边界清晰、风险有 PoC 兜底 |
| T2 | ✅ 可以 | 前端数据层是模板化套路 |
| T3 | ⚠️ **建议先列 grep 清单再进 x-req** | 改造 `workspace.ts` 涉及多调用点，先调研再 plan |
| T4 | ✅ 可以 | UI 渲染 + 操作菜单标准模式 |
| T5 | ✅ 可以 | 单页面无依赖 |
| T6 | ✅ 可以 | 收口和 e2e |

## 当前建议

- **马上可启动**：T1（先做 PoC，1.5 天内出结果）
- **暂不启动**：T3 之前先做 `useWorkspaceStore` 调用点 grep 清单（属于 T3 准备工作，半小时）
- **可暂缓**：与 cron 主模块投递修复（`run.py` 缺 target_sink、`append_cron_message` 兜底、前端识别 `cron.message.appended`）独立另立 task 包，不阻塞本系统
