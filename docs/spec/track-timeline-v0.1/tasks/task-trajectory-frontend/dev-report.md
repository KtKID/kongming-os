# dev-report · task-trajectory-frontend

> date: 2026-09-30 · x-dev

## 结论

✅ 全绿：行 11/11 🟢。spec 全部 7 个 feat 的 UI 面交付（feat01 场景1-5、feat02 场景1-5、feat03 场景1-3、feat04 场景1-4、feat05 场景1-3、feat06 场景1-2、feat07 场景2 的 UI 面）。

- T1：WorkspaceDock 增加「轨迹」页签（`WorkspaceDockTab` + `TABS` + `grid-cols-6` + `trajectoryContent`），workspace store `WORKSPACE_TABS` 增加 `trajectory`，Chat.tsx 惰性挂载（`showTrajectoryPanel`，generic_chat 线程限定）。
- T2：`TrajectoryManager`（门户：拉取 + 404/network 分类）+ `TrajectoryStore`（zustand per-thread：数据 / 加载 / 错误 / 选中 / 搜索 / 折叠；选中与折叠独立于搜索存在）。
- T3-T8：`TrajectoryPanel`（统计 + 损坏不完整提示 + 运行分段 + 刷新；加载 / 空态 / 404 / 网络错误态）、`TrajectoryLedger`（轮次分组头折叠 + 一键轮次/调用收起 + 错误标红 + 损坏占位 + 固定行高滚动窗口虚拟渲染）、`TrajectoryTimeline`（时长视角三泳道 + 轮次分界 + 点选联动）、`TrajectoryInspector`（工具/模型/用户详情 + 超长 2000 字符截断展开）、搜索（过滤高亮 / 无命中 / 清空恢复）。
- T9：3 个测试文件 22 例（derive 10 / store 4 / panel 12），mock `@/lib/api` 走真实 Manager → Store → Panel 链路。
- T10：`tests/unit/test_web_trajectory_smoke.py`——后端产出结构与前端 fixture 消费字段对齐。
- T11：模块 README（门户 / 文件职责 / zustand v5 selector 陷阱 / 待做视角）。

## 实现要点（review 关注）

- **zustand v5 selector 新引用陷阱**：`s.collapsedTurnsByThread[tid] ?? []` 每次返回新数组 → 无限重渲染；已用模块级 `EMPTY_COLLAPSED_KEYS` 常量解决（初版红灯：Maximum update depth exceeded）。
- Inspector 固定在虚拟列表外（底部面板），保证滚动窗口行高恒定——列表内展开会破坏固定行高虚拟化。
- 既有测试同步更新：`workspace.test.ts` 页签数组断言加 `trajectory`（WorkspaceDock 测试无页签数断言，无需改）。

## 回归

- 前端全量 vitest：**976 passed / 19 failed**；19 个失败（ClaudeProjectsTree 15 + CodexProjectsTree 4）经 `git stash` 三次对照验证**全部为存量失败**（无我的改动同样失败），本次改动零新增失败。新增 22 例模块测试 + 更新 2 例既有断言全绿。
- `tsc --noEmit` 0 错误；`vite build` 生产构建通过。
- 后端 smoke `test_web_trajectory_smoke.py` 1 passed。

## 高风险行

无（纯 UI + 只读端点消费；无鉴权 / 持久化 / 并发改动）。

## 未决

无。待做视角（序列 / 实际时间）已在 spec feat03「待做」与模块 README 双处记录。
