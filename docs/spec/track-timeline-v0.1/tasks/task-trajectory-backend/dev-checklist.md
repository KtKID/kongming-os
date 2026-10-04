# task-trajectory-backend · 开发清单

> spec: docs/spec/track-timeline-v0.1/spec.md
> 创建: 2026-09-30

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[x] 🟢` 验证通过 / `[!] 🔴` 验证失败

背景：基于每个 thread 的 `trace.jsonl` 事件日志（`src/hosts/web/run.py:1202-1213` 落盘，append-only，delta 默认不落盘故行号稳定）做只读 Trajectory Projection，输出 `GET /api/threads/{thread_id}/trajectory`。不动 Runner、不新增事件 kind、不做实时推送（实时轨迹留待 v0.2）。技术方案详见同目录 `../Readme.md`。`seq` = trace.jsonl 行号（0 起）。seq 字段语义：v0.2 实时轨迹接入时的断点续传坐标。

| # | 任务 | 场景回指 | 涉及文件 | 风险 | 状态 |
|---|---|---|---|---|---|
| T1 | 协议双侧真源同步（约束 17）：`rest_models.py` 新增 Trajectory 响应 DTO——总览（状态/总时长/轮次/调用数/token 汇总）、runs[]（run 序号/状态/起止/耗时/token）、records[]（seq/kind/turn/run/摘要/起止时间戳/耗时/tokens/ok/error + 工具入参出参、模型回复与思考、首字耗时等详情字段）、损坏占位记录结构；`web/src/protocol.ts` 1:1 复刻 | feat04 场景1-3, feat06 场景1, 场景2 | src/hosts/web/protocol/rest_models.py, web/src/protocol.ts | None | [x] 🟢 |
| T2 | 内部投影模型（frozen dataclass）+ `TrajectoryProjector`：逐行读 trace.jsonl（行号=seq），配对投影 run 分段（run.start/end/cancelled）、turn 分组、LLM 记录（llm.request/response/chunk.first/stream.end/usage → 首字耗时、token 明细、时长、摘要截断）、tool 记录（start/end 按 call_id 配对 → 入参/输出/ok/错误/时长）、用户输入记录（从该 run 首个 llm.request 消息序列派生）；无法解析的行产出 kind=corrupted 占位记录（保留 seq 与可读时间） | feat01 场景1, 场景3, feat04 场景1-3, feat06 场景1, 场景2 | src/hosts/web/trajectory/models.py, src/hosts/web/trajectory/projector.py | None | [x] 🟢 |
| T3 | `TrajectoryManager` 门户：自行解析 trace 路径（`resolve_kongming_path(cfg.session.file_store_path)` / `<home>/sessions/<tid>/trace.jsonl`，与 run.py 落盘同源；**实现偏离**：原计划经 ThreadManager 新增公共方法，实际路径逻辑仅 3 行且与既有 locator 同构，未改 threads 模块）、读文件调 projector、判定进行中（最后一个 run.start 无对应 run.end）、组装 DTO；thread 存在但无 trace 文件 → 空轨迹（runs=[]） | feat01 场景1-5, feat06 场景2 | src/hosts/web/trajectory/manager.py | None | [x] 🟢 |
| T4 | REST 路由：`GET /api/threads/{thread_id}/trajectory`，挂独立 router 并 include 进 app；thread 不存在 → 404，存在无轨迹 → 200 空，响应经协议模型校验后输出 | feat01 场景1, 场景2, 场景5 | src/hosts/web/routers/thread_trajectory.py, src/hosts/web/app.py | None | [x] 🟢 |
| T5 | 投影 unit 测试：多 run 轨迹（含 LLM 流式事件、tool 成败、usage、run.cancelled）、损坏行占位、多 run 分段统计聚合、空文件 | feat01 场景1, 场景3, feat06 场景1, 场景2 | tests/unit/test_web_trajectory_projector.py | None | [x] 🟢 |
| T6 | 路由契约测试（真实 FastAPI TestClient + 真实临时目录落盘 trace.jsonl + 真实 ThreadManager）：200 完整 / 200 空 / 404 / 损坏文件 200+占位 / 进行中状态 | feat01 场景1-5 | tests/unit/test_web_routers_thread_trajectory.py | None | [x] 🟢 |
| T7 | 协议漂移测试增例：Trajectory DTO 的 Python `TypeAdapter` dump 输出与 TS 侧 fixture 双侧对齐（字段增删、默认值、未知字段容忍） | feat01 场景1 | tests/unit/test_web_protocol_round_trip.py, web/src/protocol.trajectory.contract.test.ts | None | [x] 🟢 |
| T8 | 模块 README：登记 `TrajectoryManager` 门户类、公开方法、内部文件（projector/models）、允许 import 边界 | None | src/hosts/web/trajectory/README.md | None | [x] 🟢 |

## 影响文件树

```text
kongming-agent/
├── src/hosts/web/protocol/rest_models.py                    M  # 新增 Trajectory 响应 DTO（runs/records/统计/损坏占位）
├── src/hosts/web/protocol/__init__.py                       M  # 导出 Trajectory DTO
├── web/src/protocol.ts                                      M  # TS 侧 1:1 复刻 Trajectory DTO（约束 17）
├── src/hosts/web/trajectory/                                U  # 新增模块：models.py(投影草稿) / projector.py(纯投影器) / manager.py(门户) / __init__.py / README.md
├── src/hosts/web/routers/thread_trajectory.py               U  # 新增：GET /api/threads/{thread_id}/trajectory
├── src/hosts/web/app.py                                     M  # include trajectory router + app.state.trajectory_manager
├── tests/unit/test_web_trajectory_projector.py              U  # 新增：投影单测（多 run/损坏/统计/空/进行中/取消）
├── tests/unit/test_web_routers_thread_trajectory.py         U  # 新增：路由契约测试（200/404/空/损坏/进行中/422）
├── tests/unit/test_web_protocol_round_trip.py               M  # trajectory_response_dto round-trip 增例
└── web/src/protocol.trajectory.contract.test.ts             U  # 新增：TS 侧契约 fixture（与 Python fixture 对齐）
```
