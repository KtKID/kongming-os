# dev-report · task-trajectory-backend

> date: 2026-09-30 · x-dev

## 结论

✅ 全绿：行 8/8 🟢。场景覆盖：feat01 场景1-5（数据面）、feat04 场景1-3（数据面）、feat06 场景1-2（数据面）全部有测试证据。

- T1/T7：Trajectory DTO 双侧真源同步（`rest_models.py` 6 个模型 + `protocol.ts` 镜像 + 双侧漂移测试：Python round-trip `trajectory_response_dto` 1 例 + TS `protocol.trajectory.contract.test.ts` 4 例，fixture 结构逐字段对齐）。
- T2/T5：`TrajectoryProjector` 两阶段投影（可变草稿累积 → EOF 物化 frozen DTO；usage 可在 llm.response 之后回填）。投影单测 5 例（双 run 完整 / 损坏占位 / 空 / 进行中 / 取消）。TDD 红灯先行（模块不存在 → ImportError）。
- T3：`TrajectoryManager` 门户（路径解析 + to_thread 读文件 + 投影 + thread_id 回填）。**实现偏离**：未给 ThreadManager 加公共方法——路径逻辑 3 行与 `run.py` / 既有 locator 同构，加方法反而扩大耦合；threads 模块零改动。
- T4/T6：`GET /api/threads/{thread_id}/trajectory` 独立 router + app 装配（`app.state.trajectory_manager`）。契约测试 6 例走真实 `create_app` + 真实 Manager + 临时目录真实落盘，仅 stub `list_threads`（路由测试红灯先行：全部 404）。
- T8：模块 README（门户 / 内部文件 / 投影规则 / import 边界 / 测试地图）。

## 关键实现事实（供 frontend task 与后续 review）

- 真实落盘路径是 `<kongming_home>/sessions/<tid>/trace.jsonl`——`kongming_home` 本身就是 `.kongming` 根，`resolve_kongming_path` 剥前缀拼接（路由测试初版写错成 `<home>/.kongming/sessions/` 已修）。
- 用户输入记录从该 run **首个** `llm.request` 的消息序列派生（runner 无 user 输入事件；steer 追加输入 v0.1 不展示，README 已记）。
- `TrajectoryResponseDTO.summary` 为必填（mypy 对 BaseModel default_factory 报错，且 projector 恒传）。

## 回归

- trajectory 相关 17 例 + 协议 round-trip 全量 111 例 + threads 路由 + protocol rejection：**183 passed, 1 failed**。
- 唯一失败 `tests/unit/test_web_e2e_smoke.py::test_e2e_full_flow` 为**存量失败**：已用 `git stash` 验证无本 task 改动同样失败（测试自身的 Config 构造用了旧 schema 字段 `model.name/base_url`，被当前 Config `extra=forbid` 拒绝，0.6s 内在测试 setup 阶段炸，与轨迹无关）。
- mypy（trajectory + router + protocol + app）no issues；ruff check / format 通过；`lint-imports` 20 contracts kept, 0 broken。

## 高风险行

无（只读投影 + 新增端点；无鉴权 / 持久化写 / 并发 / 不可逆改动）。

## 未决

无。前端消费注意：`input_detail` 对 tool 记录是 arguments 的 JSON 字符串；`summary` 已截断 120 字符单行。

## v0.1.1 修复（2026-10-01 · 系统提示词与用户输入缺失）

**缺陷**：上线后发现轨迹里没有系统提示词记录，用户输入记录也从不出现。
根因：trace 事件的消息是**脱敏摘要**（`llm.request` 只带 `message_roles`，
`llm.response.message` 只带 `content_chars`）——正文根本不在 trace 里；
而投影测试的 fixture 伪造了带完整 messages 的 payload，测试全绿但生产
数据永远派生不出正文（「fixture 失真导致假阳性」工程陷阱的活案例）。

**修复（双源融合）**：
- `TrajectoryManager` 补读 session 真源：`system_prompt.json`（系统提示词
  全文）+ manifest.format 指向的 session jsonl（user / assistant 正文）。
- `TrajectoryProjector.project(lines, *, session_messages, system_prompt)`：
  system 记录（seq=-1，账本最前）；user_input 记录按序消费 run 插入该 run
  段头（seq 负数递减，保证 React key / 选中唯一）；assistant 正文与思考
  按序回填 llm 草稿；llm 摘要退回 `content_chars` 脱敏字段兜底。
- 协议双侧 `TrajectoryRecordKind` 加 `system`；前端 Ledger/Inspector/
  Timeline 支持系统记录（会话信息分组、emerald 色、全文详情）。
- **老 thread 兜底**：无 trace.jsonl 的老会话也产出 system + user_input
  正文记录（无时序观测）。
- 测试 fixture 全部改为真实脱敏形状；新增融合 / 仅 session / 摘要兜底
  用例（projector 7 例、路由 7 例含 session-only、smoke 双源断言、前端
  27 例含系统记录断言）。回归：protocol round-trip 118 例全绿。
