# 90 任务拆分与测试矩阵

## 实施顺序（P0 → P2）

| # | 任务 | 范围 | 依赖 |
|---|---|---|---|
| T1 | 数据模型与 config：`ApprovalMode` / `Verdict` / `PermissionEntry` / `ThreadPermissionsSnapshot`；`setting.yaml` 只保留 mode/auto；loader 旧字段报错 | `rule_models.py`、`infrastructure/config/*` | — |
| T2 | thread permissions 持久化与 Manager：hash 路径、JSON schema、per-thread 锁/revision/原子写；resolve/remember/snapshot/delete 全部按 thread_id | 新 `permissions_manager.py`、私有 `_thread_permissions_store.py` | T1 |
| T3 | DangerGuard：hard_block 改强制审批语义 + destructive 并入 + 新增 git/CLAUDE.md 两条 + self-escalation 检测 mode 与 thread permissions | `guards/hard_block.py`、`guards/destructive.py` | T1 |
| T4 | decision_engine 三步链 + consent 四动作 + chain 装配 | `decision_engine.py`、`guards/consent.py`、`chain.py`、`manager.py` | T2, T3 |
| T5 | 删除 Trust / Grants / Boundaries + `.importlinter` 收紧 + 全仓引用清理 | `guards/trust.py`、`grants/`、`boundaries/` | T4 |
| T6 | auto_approval 三处装配点注释断开（CLI / web run / approval_runtime_manager）+ ws_handlers 断开 | `hosts/cli/main.py`、`hosts/web/run.py`、`app_support/*` | T4 |
| T7 | 协议与路由：WS danger + remember bool；`ThreadPermissionsDTO`；`GET/PUT /api/threads/{thread_id}/permissions`；删 thread 清理本子 | 后端 protocol/router + `web/src/protocol.ts` | T4 |
| T8 | 前端：ApprovalToastCard danger 强红 + 禁快捷确认；新 `ThreadPermissionsManager` 门户 + 内部 View；全局设置页只保留 mode/auto | `web/src/features/approval-inbox/`、新 `features/thread-permissions/`、`config/components/` | T7 |
| T9（后续） | cron 衔接：safety_wrapper 映射新链，trust 模式下 danger 挂 NEEDS_APPROVAL；当前阶段冻结 scheduler 文件 | `scheduler/safety_wrapper.py` | T4 |
| T10 | 迁移脚本 `scripts/migrate_permissions_v06.py`：必填 `--thread-id`、dry-run、幂等、diff 摘要、禁止全 thread 扇出 | scripts | T2 |
| T11 | 文档回写：CLAUDE.md 决策链描述 / 约束条目、`docs/modules/安全/`、setting.yaml 注释、thread permissions REST/落盘路径 | docs | T5-T8, T10, T12 |
| T12 | 顶层 thread 键透传：主 agent / 子 agent / workflow / generic / Claude 使用同一 root thread_id，CLI 回落 session_id；Codex 只透传 root thread 上下文，内部工具审批保持 provider 原生策略 | approval request 各装配点 | T2, T4 |

## 必需测试矩阵（对齐 CLAUDE.md「必需测试用例」五层）

| 层 | 用例（均为 `tests/` 下 pytest / vitest，禁止一次性脚本） |
|---|---|
| Manager / 状态机 | `tests/unit/safety/test_permissions_manager.py`：deny 优先于 allow；未命中返回 None；thread A 写回后磁盘/内存/下次 resolve 三态一致；thread B 保持空；revision 冲突；并发两 thread 互不阻塞、同 thread 串行 |
| Manager / 状态机 | `tests/unit/safety/test_thread_permissions_store.py`：hash 路径防穿越、文件内 thread_id 校验、缺文件返空 snapshot、严格 JSON schema、原子替换失败回滚 |
| Manager / 状态机 | `tests/unit/safety/test_danger_guard.py`：rm -rf、`.git` 写入、CLAUDE.md 写入、修改 `approval_mode`、扩大 thread permissions allow 命中 → 强制审批且 `remember_allowed=False`；full_trust 模式下仍命中 |
| Manager / 状态机 | `tests/unit/test_safety_chain.py` 改写：三模式 × {danger 命中, deny 命中, allow 命中, 未命中} 全矩阵 12 格断言 outcome / decision_source / danger 标记 |
| 后端路由契约 | `GET/PUT /api/threads/{thread_id}/permissions`：路径 thread_id 与 DTO 一致、revision 冲突返明确 409、thread A 无法写 thread B；审批 resolve `remember=true` 固定写 pending.thread_id |
| 后端路由契约 | 删除 thread 后删除本子；本子清理失败时 thread 删除仍成功，audit/event 可观测且重试/启动扫描完成补偿；归档/重命名保留本子 |
| 装配 / 后端契约 | auto_approval 在 CLI、Web run、`ApprovalRuntimeManager` 三处装配点断开 policy 注入；auto WS handler 注册断开后，旧倒计时 toggle/query 帧统一返回 `ErrorFrame(error_code="feature_disabled", reason="auto_approval_disabled")`；Python/TS `ErrorCode` 双侧 fixture 同步；前端旧入口隐藏 |
| 协议漂移 | `tests/unit/test_web_protocol_round_trip.py` 增补：danger、remember bool、`ThreadPermissionsDTO`、revision 的双侧 fixture；旧 `RememberRule.scope` 与局部重复 wire 类型出现即失败 |
| 前端真实交互 | ApprovalToastCard：danger 卡红色类名 + Enter 键不触发确认 + 无"记住"按钮；普通卡四动作发正确 resolve 帧；ThreadPermissionsManager/View 切换 A/B thread 后列表完全隔离，并覆盖空/加载/保存/冲突/失败态 |
| e2e smoke | `tests/e2e/`：thread A 未命中 → "允许并记住" → A 的 JSON 出现表达式 → A 第二次静默放行 → thread B 同请求仍挂 pending；full_trust 下普通调用放行且 `rm -rf` 挂 danger 审批 |
| 跨执行链 | 顶层 thread 启动子 agent，子 agent 使用与父 agent 相同本子；另一顶层 thread 中的同名子 agent 使用独立本子 |
| cron 回归（后续） | 改写 `test_cron_trust_mode_e2e.py` / `test_cron_hard_block_in_trust_e2e.py`：trust 下 danger 行为从 rejected 变 NEEDS_APPROVAL 的合同更新；当前阶段不修改 cron 测试 |
| 迁移 | `tests/unit/safety/test_migrate_permissions_v06.py`：必填 thread_id、allow/deny 定向转换、ask 丢弃、trusted_workdirs 只生成候选、dry-run、幂等、零全量扇出 |

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| danger 从硬拒改强制审批 → 一次误点即放行 `rm -rf` | danger 卡禁用快捷键/回车，必须显式点击；审计双写（event + audit）；后续可加二次确认 |
| 删除 trusted_workdirs 造成老用户静默扩问（原信任目录开始弹审批） | 迁移脚本显式提示转换项；发布说明标注行为变化 |
| auto 模式配置了但未实现 | loader 允许 `auto` 值但引擎回落 user_approval 并 emit 告警事件，不静默 |
| 协议改动破坏旧前端 | 双侧同 commit 修改 + 协议漂移测试强制（约束 17） |
| 按 thread 分文件带来并发写和孤儿文件 | hash 路径 + per-thread 锁 + revision CAS + atomic replace；删 thread 走 Manager 编排清理；启动时可观测孤儿扫描 |
| root thread_id 在子 agent 链路丢失导致本子分裂 | approval request 显式携带 root thread_id；契约测试分别断言 thread_id 与 session_id |
