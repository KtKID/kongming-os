# 03 文件级改造清单

按"删除 / 改造 / 注释断开 / 保留复用"四类列出。路径以 HEAD（bc791068）为准。

## 删除

| 文件 | 原职责 | 去向 |
|---|---|---|
| `src/safety/guards/trust.py` | TrustResolver：intrinsic zone + grant 证据消费 | 整体删除，无替代 |
| `src/safety/grants/store.py` + `src/safety/grants/` | GrantStore：capability 键控的授权账本 | permissions 本子取代 |
| `src/safety/boundaries/resolver.py` + `path_trie.py` + `src/safety/boundaries/` | BoundaryResolver：trusted/approval/blocked zone 归类 | 删除；trusted_workdirs 语义由用户显式写 allow 表达式承接 |
| `src/safety/auto_approval/default_rules.yaml` 中 24 条 builtin ask 规则 | 智能审批分级 | 废弃（"没写即问"，不需要显式 ask 规则）；danger 相关条目并入 DangerGuard |
| `rule_models.py` 中 `RuleSource` / `RememberScope` / `RuleScope` / `RuleBehavior.ASK` | 三源规则、多档记忆、规则内嵌作用域 | 本子由 `thread_id` 选择独立 snapshot，见 02 |
| `src/safety/approval/rule_persister.py` | comment-preserving `setting.yaml` 规则写回 | 整体删除；thread permissions 只由 `ThreadPermissionsStore` 写 JSON，`setting.yaml` 不存在 permissions 写回路径 |

## 改造

| 文件 | 改动 |
|---|---|
| `src/safety/approval/decision_engine.py` | 7 步链塌缩为 3 步（见 01 伪代码）；构造参数去掉 boundary / trust / rule_manager，换 danger_guard / mode / permissions_manager |
| `src/safety/guards/hard_block.py` | 更名语义为 DangerGuard：`evaluate() -> ApprovalDecision(rejected)` 改为 `match() -> DangerRule | None`，由 engine 转强制审批；新增 git-internal-write / agent-instruction-write 两条；self-escalation 同时覆盖全局 `approval_mode` 和 thread permissions 文件 |
| `src/safety/guards/destructive.py` | 规则集并入 DangerGuard，文件随后删除或仅留规则数据 |
| `src/safety/guards/consent.py` | 增加 `danger: bool` / `remember_allowed: bool` 入参；四动作（允许一次/允许并记住/拒绝一次/拒绝并记住）；去掉倒计时分支 |
| 新增 `src/safety/approval/permissions_manager.py` | `PermissionsManager` 唯一门户：`resolve(thread_id, request)`、snapshot、remember 表达式、按 revision 写入/删除、`delete_thread`；per-thread lock 与内存 cache 按 thread_id 分桶 |
| 新增 `src/safety/approval/_thread_permissions_store.py` | 私有 store：`sha256(thread_id)` 路径、严格 JSON schema、跨进程文件锁、revision 冲突、fsync + atomic replace；只由 `PermissionsManager` 调用 |
| `src/safety/approval/approval_rule_manager.py` | 旧全局规则门户随 Trust/Grant/Boundary 清理任务整体删除 |
| `src/safety/approval/chain.py` | 装配新三件套；`build_safety_chain` 签名同步 |
| `src/safety/approval/manager.py` + `rules.py` | ApprovalRules 去掉 `policy=AutoApprovalPolicy` 参数与倒计时分类；`rules.py` 若只剩空壳则删除 |
| `src/infrastructure/config/models.py` / `schema.py` / `loader.py` / `writer.py` | 只增 `approval_mode` + `auto_judge` 预留位；删 `SafetyApprovalRuleConfig` / `trusted_workdirs`；loader 对旧字段和草案 `safety.permissions` 报错并指向迁移脚本 |
| 新增 `scripts/migrate_permissions_v06.py` | 必填 `--thread-id`，支持 `--dry-run` / `--apply`、幂等去重与 diff 摘要；旧 allow/deny 只写入显式指定 thread，禁止向全部 thread 扇出 |
| `src/scheduler/safety_wrapper.py` | **后续阶段**：cron trust/fail_closed 映射到新链；当前阶段保持 scheduler 文件冻结，共享装配层维持 fail-closed 兼容合同 |
| `src/hosts/web/protocol/ws_frames.py` ↔ `web/src/protocol.ts` | 审批帧新增 `danger: bool`；`RememberRule` 去 scope 字段，remember 退化为 bool 并固定归属 pending.thread_id；**双侧 1:1 同步 + 协议漂移测试**（CLAUDE.md 约束 17） |
| `src/hosts/web/protocol/rest_models.py` ↔ `web/src/protocol.ts` | 新增 `ThreadPermissionsDTO` / update DTO，字段含 thread_id、revision、allow、deny；未知字段严格拒绝 |
| `src/hosts/web/routers/threads.py` | 新增 `GET/PUT /api/threads/{thread_id}/permissions`，通过 `PermissionsManager` 读写当前 thread；删除 thread 时编排本子清理与补偿 |
| `web/src/features/approval-inbox/ApprovalToastCard.tsx` | danger=true 强红样式；danger 卡禁用快捷键/回车确认，必须显式点击；隐藏"记住"选项 |
| 新增 `web/src/features/thread-permissions/ThreadPermissionsManager.ts` + `index.ts` | 前端模块唯一门户：封装当前 thread 的 GET/PUT、revision CAS、加载/保存/冲突状态；`index.ts` 只导出 Manager 与公开类型 |
| 新增 `web/src/features/thread-permissions/internal/ThreadPermissionsView.tsx` | 作为模块内部视图，通过 `ThreadPermissionsManager` 渲染当前 thread 的 allow/deny、revision 冲突和加载/空/失败态 |
| `web/src/modules/dashboard/config/components/SafetyRulesView.tsx` | 移除全局规则编辑入口，全局 Safety 页面只编辑 `approval_mode` 和 `auto_judge`；thread permissions 只在 `ThreadPermissionsManager` 模块中展示和编辑 |
| 子 agent / workflow approval request 装配点 | 显式传递顶层 `thread_id`，子 session_id 保留在审计元数据，不作为新本子键 |

## 注释断开（保留代码，将来 auto 模式复用）

| 装配点 | 现状 | 动作 |
|---|---|---|
| `src/hosts/cli/main.py` | CLI Manager 曾注入 cwd 倒计时 policy | 构造 `PermissionsManager + ApprovalManager`，不创建 policy；装配点保留 `# TODO(auto-mode)` |
| `src/hosts/web/run.py` | runtime factory 曾读取并注入 `app.state.auto_approval_policy` | 删除 state 读取与 policy 参数；相关装配位置保留 `# TODO(auto-mode)` |
| `src/hosts/web/app_support/approval_runtime_manager.py` | `auto_approval_policy` 构造参数 | 参数与 import 删除，Manager 只装配 Permissions/Approval 门户；保留 `# TODO(auto-mode)` |
| `src/safety/auto_approval/`（模块本体） | 倒计时 policy / config_store / manager | **保留不动**，作为 auto 模式的"请求 → 自动裁决"接口插槽 |
| `src/hosts/web/approvals/auto/` 的 ws_handlers / 前端开关 | cwd 倒计时 UI 通道 | WS handler 注册注释断开，前端入口隐藏（代码保留）；旧 toggle/query 帧统一返回 `ErrorFrame(error_code="feature_disabled", reason="auto_approval_disabled")`，Python/TS `ErrorCode` 双侧同步扩展 |

## 保留复用（e4cfdd9f 做对的部分）

- `src/safety/approval/rule_parser.py`：canonical DSL 7 种 matcher，原样复用
- generic_chat / Claude Code 审批收敛：`approval_runtime_manager` 统一装配、`claude_code/approval.py` 薄适配、全局 inbox broadcaster 的 resolve_target 路由
- Codex 保留 provider transport 边界：`codex/approval.py` 继续映射原生 CLI flags，本期只透传 root `thread_id`；逐工具共享审批需要后续 app-server transport 任务
- `ApprovalInboxResolveResultFrame` 回执链路与审批卡"保存规则"交互骨架（改为写 pending.thread_id 对应的 permissions）
- `.importlinter` 合同：删除 boundaries / grants 后同步收紧对应边
