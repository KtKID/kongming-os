# task-trajectory-frontend · 开发清单

> spec: docs/spec/track-timeline-v0.1/spec.md
> 创建: 2026-09-30

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[x] 🟢` 验证通过 / `[!] 🔴` 验证失败

背景：消费 task-trajectory-backend 的 `GET /api/threads/{thread_id}/trajectory`，在 WorkspaceDock 新增「轨迹」页签，前端独立模块 `web/src/modules/trajectory/`（门户 `TrajectoryManager.ts`，约束 19：不复用 ChatTimelineStore，轨迹是独立 Projection）。时间线本版只做「时长」视角，「序列」「实际时间」两视角为待做（见 spec feat03 待做清单），数据结构（起止时间戳齐备）已为其预留。UI 参考 dsh `packages/client/ui-trajectory`（三泳道 / 轮次分组 / Ledger+Inspector 布局）。

| # | 任务 | 场景回指 | 涉及文件 | 风险 | 状态 |
|---|---|---|---|---|---|
| T1 | WorkspaceDock 增加「轨迹」页签：`WorkspaceDockTab` union 增加 `trajectory`、按 thread 惰性挂载（沿用 mountedWorkspaceTabs 模式）、workspaceStore activeTabByThread 支持 | feat01 场景1 | web/src/components/WorkspaceDock.tsx, web/src/pages/Chat.tsx, web/src/stores/workspace.ts | None | [x] 🟢 |
| T2 | 模块骨架：`TrajectoryManager.ts` 门户（拉取端点、手动刷新、thread 切换换数据）+ `TrajectoryStore.ts`（zustand：轨迹数据 / 加载 / 错误 / 选中记录 / 分组展开态 / 搜索词） | feat01 场景1, 场景4 | web/src/modules/trajectory/TrajectoryManager.ts, web/src/modules/trajectory/TrajectoryStore.ts | None | [x] 🟢 |
| T3 | `TrajectoryPanel` 主视图：顶部统计区（状态/总时长/总轮次/调用数/token 总量）+ 按运行分段展示（运行头：序号/状态/起止/耗时/token）；加载态、空态（「暂无轨迹数据」+ 引导）、会话不存在错误态（提示 + 返回列表入口）、进行中标注 | feat01 场景1, 场景2, 场景4, 场景5, feat06 场景1, 场景2 | web/src/modules/trajectory/TrajectoryPanel.tsx | None | [x] 🟢 |
| T4 | 账本列表 `TrajectoryLedger`：记录行（#N、角色图标配色：用户/模型/工具/系统、单行摘要、耗时、模型行 token、错误红色+图标+错误摘要）、轮次分组头（轮次号+起止时间）、单轮展开收起 + 「轮次」一键展开/收起 + 「调用」一键展开/收起、损坏占位条目（保留序号与时间、内容不可展开） | feat01 场景3, feat02 场景1-4 | web/src/modules/trajectory/TrajectoryLedger.tsx | None | [x] 🟢 |
| T5 | 长列表滚动窗口渲染：仅渲染可视区 + 上下缓冲行，数百条记录滚动流畅 | feat02 场景5 | web/src/modules/trajectory/TrajectoryLedger.tsx | None | [x] 🟢 |
| T6 | 时间线 `TrajectoryTimeline`（时长视角）：横条长按耗时比例、三泳道（用户/系统上、模型中、工具下）、无耗时记录最小占位宽、点击横条 → 列表滚动定位 + 高亮 + 详情同步 | feat03 场景1-3 | web/src/modules/trajectory/TrajectoryTimeline.tsx | None | [x] 🟢 |
| T7 | 详情面板 `TrajectoryInspector`：工具记录（名称/完整入参/完整输出/错误信息/起止耗时/所属轮次）、模型记录（完整回复/思考内容/token 明细含缓存/首字耗时/轮次运行归属）、用户输入完整内容、超长内容默认截断 + 「展开全部」 | feat04 场景1-4, feat07 场景2 | web/src/modules/trajectory/TrajectoryInspector.tsx | None | [x] 🟢 |
| T8 | 搜索：关键词过滤（匹配摘要/工具名/入参/输出/错误信息）、命中词高亮、无命中提示（保留搜索词）、清空恢复完整轨迹（保留分组展开与选中态） | feat05 场景1-3 | web/src/modules/trajectory/TrajectoryPanel.tsx, web/src/modules/trajectory/TrajectoryStore.ts | None | [x] 🟢 |
| T9 | 前端测试：Manager/Store（加载成功/失败/空/损坏占位记录进入列表）、Panel 空态与不存在错误态、Ledger 分组展开收起与错误行、Timeline 点击联动选中、搜索无命中与清空恢复、Inspector 超长截断展开 | feat01 场景2, 场景3, 场景5, feat02 场景2-4, feat03 场景3, feat04 场景4, feat05 场景1-3 | web/src/modules/trajectory/__tests__/ | None | [x] 🟢 |
| T10 | 跨端 smoke（pytest 侧）：真实 TestClient 构造 thread + 落盘 trace.jsonl → GET trajectory → 断言 DTO 关键结构与前端消费字段名一致（与 T9 的 fixture 同源） | feat01 场景1, feat06 场景1 | tests/unit/test_web_trajectory_smoke.py | None | [x] 🟢 |
| T11 | 模块 README：登记 `TrajectoryManager` 门户、TrajectoryStore/TrajectoryPanel/TrajectoryLedger/TrajectoryTimeline/TrajectoryInspector 职责、wire 类型只从 `@/protocol` 引用、待做视角清单 | None | web/src/modules/trajectory/README.md | None | [x] 🟢 |

## 影响文件树

```text
kongming-agent/
├── web/src/components/WorkspaceDock.tsx                 M  # WorkspaceDockTab 增加 trajectory 页签
├── web/src/pages/Chat.tsx                               M  # 挂载轨迹页签（惰性 mount）
├── web/src/stores/workspace.ts                          M  # activeTabByThread 支持 trajectory
├── web/src/modules/trajectory/                          U  # 新增模块：TrajectoryManager.ts(门户) / TrajectoryStore.ts / TrajectoryPanel.tsx / TrajectoryLedger.tsx / TrajectoryTimeline.tsx / TrajectoryInspector.tsx / README.md / index.ts
├── web/src/modules/trajectory/__tests__/                U  # 新增：store/panel/ledger/timeline/inspector 测试
└── tests/unit/test_web_trajectory_smoke.py              U  # 新增：跨端 smoke（trace.jsonl → 端点 → 前端消费字段）
```
