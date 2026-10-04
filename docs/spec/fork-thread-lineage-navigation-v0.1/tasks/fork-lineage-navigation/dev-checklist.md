# fork-lineage-navigation · 开发清单

> spec: docs/spec/fork-thread-lineage-navigation-v0.1
> risk: Q2

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[ ] 🟡` 待测试 / `[x] 🟢` 测试通过 / `[x] ✅` 已完成 / `[!] 🔴` 测试失败

| # | 任务说明 | Scenario IDs | 风险 | 涉及文件 | 依赖 | 状态 | fix |
|---|---|---|---|---|---|---|---|
| T1 | 先写红灯测试，覆盖普通任务隐藏 lineage、fork 终点气泡与分隔线的相邻顺序、精确父任务 route | SC_01, SC_02 | J1/J3/J4/J6；展示条件、边界与跳转目标 | `web/src/components/__tests__/MessageList.test.tsx`、`web/src/pages/__tests__/Chat.test.tsx` | None | [x] ✅ | issue-2 closed; placement correction applied |
| T2 | 在 fork metadata 持久化复制终点，并在消息时间线对应气泡下方实现居中横线、分叉图标和“续接自任务”链接 | SC_01, SC_02 | 父 ID 和 `forked_from_history_index` 共同构成展示真源 | `src/hosts/web/threads/`、`src/hosts/web/protocol/`、`web/src/{protocol,stores,components,pages}/` | T1 | [x] ✅ | placement correction applied |
| T3 | 扩展真实 Web fork smoke，覆盖重载后的 lineage 入口与回到源任务的浏览器路由及历史恢复 | SC_03 | J2/J5；浏览器→FastAPI→metadata→前端 route 链路 | `web/tests/e2e/thread-fork.spec.ts` | T2 | [x] ✅ | issue-2 closed; issue-3 P2 registered |
| T4 | 记录 verify 证据、运行 task 机械校验和 Gate① | SC_01, SC_02, SC_03 | Q2 真实 smoke 链路 | `docs/spec/fork-thread-lineage-navigation-v0.1/tasks/fork-lineage-navigation/` | T3 | [x] ✅ | Gate① 3/3; Gate② round 1 passed; placement correction: validate 0 issue, browser smoke passed |
