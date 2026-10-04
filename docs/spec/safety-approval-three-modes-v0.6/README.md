# 审批三模式简化 (v0.6)

> 状态：开发中（非 cron 阶段已实现；cron / scheduler 衔接后续执行）
> 目标：把 e4cfdd9f（"统一审批规则与通道"）之后仍然残留的 Trust / Grant / Boundary / capability 多层决策，塌缩为"危险写死层 + 模式开关 + 当前 thread 的 permissions 本子"三步链；智能审批倒计时断开接线，预留 LLM 自动审批插槽。

## 背景与动机

e4cfdd9f 完成了两件正确的事：规则真源统一到 `ApprovalRuleManager`，generic_chat / Claude Code 审批收敛到共享决策链和全局 inbox。Codex Web 当前仍由 `codex exec --json` 的原生 `permissionMode` 控制，只透传 Kongming 顶层 `thread_id`；它缺少执行前逐工具 approval callback，接入共享本子需要后续迁移到 Codex app-server 请求/响应协议。旧共享链仍保留 TrustResolver、GrantStore、BoundaryResolver、capability 映射、session/persistent 双档记忆、`RuleBehavior.ASK` 显式规则、auto_approval 倒计时，导致一次工具调用要穿过 7 步决策，规则语义（allow 命中不经 Trust、deny 压过 trusted_workdirs）难以向用户解释。

本 spec 按最终确认的用户心智模型重构：

1. **用户审批模式（user_approval，默认）**：当前 thread 的 permissions 本子上写了 allow/deny 的直接执行；未命中的一律问用户，可"仅本次"或"记住"（写回当前 thread 本子，跨 run 持久）。
2. **完全信任模式（full_trust）**：跳过当前 thread 的 permissions 本子并放行；代码写死的危险行为仍强制问用户。
3. **自动审批模式（auto，仅预留接口）**：把审批请求组装成 prompt 交给独立 LLM 裁决返回 allow/deny。本期不实现，选中时 fail-closed 回落 user_approval 并告警。

**危险写死层在任何模式下不可绕过**：命中即强制提交用户审批，WS 帧带 `danger` 标记，前端强红色展示，禁用快捷键/回车确认，必须显式点击。

## 目标决策链

```
decide(request):
  ① DangerGuard（代码写死，不可配置，不可被本子覆盖）
     rm -rf / fork bomb / secrets / .git 仓库写入 / CLAUDE.md 写入 / config 自提权 ...
     → 强制用户审批（danger=true，UI 强红）           ← 任何模式都走这里
  ② 模式开关 cfg.safety.approval_mode
     full_trust → approved（decision_source=full_trust）
     auto       → 预留：本期回落 user_approval + 告警事件
     user_approval → ③
  ③ 当前 thread 的 permissions 本子（thread 内唯一持久真源，deny 先于 allow）
     deny  命中 → rejected
     allow 命中 → approved
     未命中 → 问用户：
        [允许一次] [允许并记住] [拒绝一次] [拒绝并记住]
        "记住" → 写当前 thread 的 permissions.allow / .deny
                    （持久跨 run，thread 之间隔离）
```

没有 Trust、没有 Boundary zone、没有 capability 翻译、没有 grant 与 rule 双账本、没有倒计时自动处置。

## 范围边界

**包含**：

- `SafetyDecisionEngine.decide()` 塌缩为三步链
- `HardBlockGuard` 改造为 `DangerGuard`：从"硬拒"改为"强制审批 + danger 元数据"，清单并入 `.git` / `CLAUDE.md` / destructive 规则
- `<kongming_home>/safety/thread_permissions/<sha256(thread_id)>.json` 中的 `{allow: [], deny: []}`（DSL 表达式数组）替代 `setting.yaml` 的全局 `approval_rules`
- `setting.yaml` 只保留全局 `approval_mode` 与 `auto_judge` 预留配置，不再持有 permissions
- 删除 TrustResolver / GrantStore / BoundaryResolver / trusted_workdirs / capability 映射 / `RememberScope` / `RuleSource` / `RuleBehavior.ASK` / 24 条 builtin ask 规则
- auto_approval 倒计时在 3 处装配点注释断开（CLI / web run / approval_runtime_manager），模块本体保留为 auto 模式插槽
- WS 帧 + `web/src/protocol.ts` 双侧同步：danger 标记、remember 固定写入当前 thread
- 前端：ApprovalToastCard danger 红色档 + 禁用快捷确认；thread 设置面板渲染当前 thread 的 permissions allow/deny 两列
- 迁移：现有全局 `approval_rules` 只能显式导入指定 thread；不自动复制到所有 thread

**不包含**：

- auto 模式的 LLM 裁决实现（仅留 `AutoJudgeProtocol` 接口与配置位）
- cron 任务级 approval_mode（v0.5 已定，`trust` / `fail_closed` 语义映射到新链见 03）
- Codex `exec --json` transport 迁移到 app-server approval request/response；本期只保证 Kongming root `thread_id` 透传，Codex 内部工具继续使用 provider 原生权限策略
- DSL 表达式语法本身的修改（复用 `rule_parser.py` 现有 7 种 matcher）

## 文档导航

| 文档 | 内容 |
|---|---|
| [01-decision-chain.md](./01-decision-chain.md) | 新旧链对照、engine 伪代码、三模式语义、danger 层清单 |
| [02-data-and-config.md](./02-data-and-config.md) | thread permissions 数据模型、config schema、持久化与迁移方案 |
| [03-change-map.md](./03-change-map.md) | 文件级改造清单（删除 / 改造 / 注释 / 保留）+ 前端与协议影响面 |
| [90-task-map.md](./90-task-map.md) | 实施任务拆分 + 必需测试矩阵 |
