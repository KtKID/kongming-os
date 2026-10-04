# safety-approval-manager-v0.5

> **维护说明（2026-07-14）**：`ApprovalManager` 的权威职责收敛为显式 consent 的 request / resolve / cancel / timeout / inbox 生命周期。完整规则顺序由 `SafetyDecisionEngine` 持有，每个 `SessionEngine` 的最终决策入口为唯一 `SafetyGatedApproval`。B0 实现权威为 `repo:openspec/changes/session-engine-safety-chain-single-entry/`，组合架构方案见 `repo:docs/spec/safety-approval-single-entry-v0.1/`。
>
> **Spec 目标**：把 kongming-agent 当前散落的人工审批 pending 状态、宿主桥接、Future、Grant 展示与超时生命周期收拢到 `ApprovalManager` 门户。
>
> **Spec 版本**：v0.5（首版 spec，对齐 5 阶段渐进重构）
>
> **创建时间**：2026-05-18
>
> **Spec status**：方案确认 — 可进入 x-req 拆 task

---

## 最小可用路径（MVP 链路）

阶段 1 完成后用户就能体验到核心价值：

```
用户在 web chat 跟 kongming agent 聊
  → agent 触发 LLM tool call
  → SafetyDecisionEngine.decide → explicit_consent
  → SafetyGatedApproval.prompt_fn（被换成 manager 入口）
  → ApprovalManager.request(channel='generic_chat', thread_id, ...)
  → 创建 pending future + 注册 InboxEventSink
  → broadcaster.emit_add → /ws/thread-status fan-out
  → 浏览器 ApprovalToastQueue 弹卡片（通道 badge='generic_chat'）
  → 用户点同意/拒绝
  → inbox.resolve C2S → broadcaster.resolve → manager.resolve
  → future.set_result → ApprovalAction 返回 → 工具继续执行
```

完成后即满足 v0.1 用户需求（web chat 用户能 inbox 决策 generic_chat 工具调用）。后续阶段把剩余 4 通道也收进 manager。

---

## 5 阶段路径

| Phase | Task 名 | 范围 | 估时 | 状态 | 阻塞关系 |
|---|---|---|---|---|---|
| 1 | `smart-approval-manager-stage1` | 骨架 + generic_chat web 接入 + helper | 1.5d | ⏳ 可进入 x-req | 无 |
| 2 | `smart-approval-manager-stage2-claude` | 迁 claude_code（ApprovalBridge 改 thin wrapper + allow_list → GrantStore） | 1d | ⏳ 等 stage 1 | stage 1 |
| 3 | `smart-approval-manager-stage3-auto` | 迁 cron / evolution 装配 + rules auto-allow 配置 | 0.5d | ⏳ 等 stage 1 | stage 1 |
| 4 | `smart-approval-manager-stage4-cli` | CLIEventSink + CLI adapter 改装 | 0.5d | ⏳ 等 stage 1 | stage 1 |
| 5 | `smart-approval-manager-stage5-finalize` | timeout 统一 + rules schema 重设计 + 协议帧 v0.5 + 文档收尾 | 0.5d | ⏳ 等 stage 2-4 | stage 2-4 |

总计 **4-5 天** 分 5 个 task 独立 PR。

详见：[90-task-map.md](90-task-map.md)

---

## 文档导航

| 文档 | 用途 | 阅读优先级 |
|---|---|---|
| [00-overview.md](00-overview.md) | 系统总图：现状散落 → 目标 manager 统一 | **★★★ 必读** |
| [10-architecture.md](10-architecture.md) | ApprovalManager 内部组件 + 公开接口 + EventSink Protocol | **★★★ 必读** |
| [20-data-model.md](20-data-model.md) | `_PendingApproval` / `ApprovalDecision` / `ApprovalRules` / `GrantStore` 统一 DTO | ★★★ |
| [30-rules-schema.md](30-rules-schema.md) | rules.yaml per-channel + per-thread + per-cwd 三层 scope 设计 | ★★ |
| [40-protocol-evolution.md](40-protocol-evolution.md) | 协议帧 v0.5 演进：通道通用字段 + channel-specific + 三态 resolve 扩展 | ★★ |
| [50-migration-plan.md](50-migration-plan.md) | 5 阶段迁移路径 + 改动矩阵 + 双轨期契约 + 回滚预案 | **★★★ 必读** |
| [60-risk-and-mitigation.md](60-risk-and-mitigation.md) | 风险登记（双轨期 / 数据迁移 / 测试回归 / SDK 兼容 / 中文 docstring 强制） | ★★ |
| [90-task-map.md](90-task-map.md) | 5 阶段 task 名映射 + 当前状态 + 依赖关系 | **★★★ 必读** |
| [architecture.html](architecture.html) | 苹果风 mermaid 总架构图（现状 + 目标双视图） | ★★ |

---

## 关键决策点（8 项已拍板）

| # | 决策 | 答案 |
|---|---|---|
| 1 | manager 在哪个层？ | **safety 层**（`src/safety/`，与 SafetyDecisionEngine 同层）|
| 2 | EventSink 抽到 core.contracts 吗？ | **阶段 1 不抽**（manager 内部 Protocol）；阶段 5 重审 |
| 3 | broadcaster 跨层依赖？ | **DI 注入**（装配时拿 broadcaster 实例）；safety 包 0 import web |
| 4 | ApprovalAction 三态 vs PermissionResult 二态？ | **`ApprovalDecision` 统一 DTO**；PermissionResult 是 view |
| 5 | allow_list vs GrantStore？ | **GrantStore 是基础**；allow_list = in-memory backend 退化 |
| 6 | rules schema 跨通道？ | **per-channel + per-thread + per-cwd 三层 scope**；阶段 5 完整重设计 |
| 7 | 协议帧 v0.5 演进？ | 通道通用字段（channel/severity/auto_*_at_ms）+ channel-specific 字段 + 三态 resolve 扩展 |
| 8 | **中文 docstring 强制**（用户硬约束）| 所有新建函数/类必须中文 docstring；改动函数加新行也补；spec 60-risk 提议 pre-commit hook 检查 |

---

## 背景与价值

### 为什么要做

当前 5 通道（claude_code / generic_chat / cron / evolution / CLI）各有一套审批 Provider + 策略 + Bridge + Future 持有者 + Grant 存储 + 超时实现，**12 处散落**导致：

- **改一个能力要动多处**：例如想统一加 "5 分钟内自动同意上次同样工具" 功能，要改 ApprovalBridge + InteractiveApproval + ScheduleApprovalProvider + AutoAllowApproval 4 处
- **bug 修复要找正确路径**：每条通道审批 bug 都要先 grep "哪条路径"才能定位
- **新通道接入门槛高**：未来加 codex 通道要再写一套类似 ApprovalBridge 的桥接
- **测试矩阵爆炸**：每条通道独立测试 + 双套 grant 存储 + 多套超时

### 做完后

- **改一个能力只动一处**（manager + rules）
- **新通道接入**只需写一个 EventSink + 一个 thin wrapper（~50 行）
- **测试矩阵收敛**：manager 主测；通道 adapter 薄薄一层 mock
- **超时 / grant / 审计 / fan-out** 全部走 manager 单例，行为可预测

详细背景见 [`docs/modules/安全/approval-flow-current-state.html`](../modules/安全/approval-flow-current-state.html)（5 通道现状流程图）。

---

## 模块归属

本 spec 服务的代码主要落在：

- **`src/safety/`**（核心 manager + rules + EventSink Protocol）
- **`src/web/approvals/global_inbox/`**（broadcaster 加轻 API）
- **`src/web/run.py`** / **`src/cli/main.py`** / **`src/scheduler/runtime_factory.py`** / **`src/evolution/evolution_manager.py`**（各装配点改造）
- **`src/web/integrations/claude_code/approval.py`**（ApprovalBridge → thin wrapper，stage 2）
- **`web/src/features/approval-inbox/ApprovalToastCard.tsx`**（按 channel 隐藏第三按钮，stage 1）

模块文档真源：[`docs/modules/安全/README.md`](../modules/安全/README.md)（spec 不重复，只 reference）。

---

## 不在本 spec 范围

- **写代码**（spec 只产文档；写代码留 x-req → x-dev → x-verify → x-qa-gate 主流程）
- **单元测试细节设计**（DoD 阶段细化即可）
- **UI 视觉重新设计**（v2-inbox 已上线，复用即可）
- **跨语言多端**（仍只支持 web + CLI 两端）
- **policy 规则增量**（24 条规则不动；仅改 schema 容器；规则细化留单独 task）
- **审计落盘格式变更**（AuditLogger 接口稳定）

---

## 下一步建议

1. 用户审本 spec（10 文件）→ 通过则 status 改"已确认"
2. 阶段 1 跑 `x-req smart-approval-manager-stage1` 产 task 包
3. `x-dev smart-approval-manager-stage1` → 走 Gate ① / ② → ✅
4. 阶段 2-5 依次按 [90-task-map.md](90-task-map.md) 推进
5. 5 阶段全 ✅ 后本 spec status 标"已实施"

---

## 相关 spec

- 历史：[`docs/safety-scope-v0.1.4/`](../safety-scope-v0.1.4/)（boundary scope 设计）
- 历史：[`docs/safety-shell-intent-v0.1.5/`](../safety-shell-intent-v0.1.5/)（shell intent parser）
- 平行：v2-inbox [`dev-pipeline/tasks/smart-approval-v2-inbox/`](../../dev-pipeline/tasks/smart-approval-v2-inbox/)（claude_code 通道 inbox UI；本 spec 阶段 2 在其基础上迁 manager）
