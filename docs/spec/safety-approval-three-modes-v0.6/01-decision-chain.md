# 01 决策链设计

## 新旧链对照

| 步骤 | e4cfdd9f 现状（7 步） | v0.6 目标（3 步） |
|---|---|---|
| 1 | HardBlock 硬拒 | **DangerGuard 强制审批**（含原 HardBlock + destructive + `.git` / `CLAUDE.md`） |
| 2 | RuleManager.resolve → deny / explicit ask | **模式开关**（full_trust 放行 / auto 预留 / user_approval 继续） |
| 3 | BoundaryResolver 归类 zone | **按 thread_id 查 permissions 本子**（deny → allow → 未命中问用户） |
| 4 | DestructiveForceAsk（bypass_immune） | —（并入步骤 1） |
| 5 | 规则 allow 直接放行 | —（并入步骤 3） |
| 6 | TrustResolver 消费 intrinsic / grant 证据 | —（删除） |
| 7 | default:ask → Consent（可倒计时自动处置） | —（并入步骤 3，无倒计时） |

## engine 伪代码

```python
async def decide(request, runtime) -> ApprovalDecision:
    # ① 危险写死层：任何模式、任何本子都盖不掉
    danger = self._danger_guard.match(request)
    if danger is not None:
        return await self._consent.evaluate(
            request,
            danger=True,                      # → WS 帧 danger 标记 → UI 强红
            matched_rule=f"danger:{danger.name}",
            remember_allowed=False,           # danger 命中不提供"记住"选项
        )

    # ② 模式开关
    mode = self._mode                          # cfg.safety.approval_mode
    if mode is ApprovalMode.FULL_TRUST:
        return _approved(source="full_trust")
    if mode is ApprovalMode.AUTO:
        self._emit_warning("auto mode not implemented, falling back to user_approval")
        # 预留：return await self._auto_judge.decide(request)

    # ③ 当前 thread 的 permissions 本子（deny 先于 allow）
    # Web 主链使用 request.metadata["thread_id"]；CLI 等宿主回落 request.session_id。
    thread_id = self._thread_key.resolve(request)
    verdict = await self._permissions.resolve(thread_id, request)  # None | ALLOW | DENY
    if verdict is Verdict.DENY:
        return _rejected(source="permissions", matched_rule=verdict.expression)
    if verdict is Verdict.ALLOW:
        return _approved(source="permissions", matched_rule=verdict.expression)

    # 未命中 → 问用户，四个动作
    return await self._consent.evaluate(
        request,
        danger=False,
        remember_allowed=True,   # ALLOW_ONCE / ALLOW_REMEMBER / DENY_ONCE / DENY_REMEMBER
        remember_thread_id=thread_id,
    )
```

`thread_id` 是本子的唯一归属键。顶层 thread 内的主 agent、子 agent 和同一 thread 的多个 run 都传递同一个顶层 `thread_id`；`request.session_id` 仅保留执行会话身份。两个顶层 thread 即使 cwd 和 tool 请求完全相同，也会读取两份独立本子。

缺少稳定 `thread_id` 的瞬时运行仍可使用一次性审批；记住动作需要稳定 thread 键。CLI 的显式 session id 就是该宿主的稳定 thread 键。

## 三模式语义

| 模式 | ① danger | ③ permissions | 未命中默认 | 备注 |
|---|---|---|---|---|
| `user_approval`（默认） | 强制问，强红 | 当前 thread 本子生效 | 问用户 | "记住"写回当前 thread，跨 run 持久 |
| `full_trust` | 强制问，强红 | **忽略** | 放行 | decision_source=full_trust，写审计 |
| `auto`（预留） | 强制问，强红（不进 LLM） | 由裁决 LLM 决定 | 裁决 LLM | 本期 fail-closed 回落 user_approval |

设计裁定：

- **danger 永远问人**：即使将来 auto 模式实现，danger 命中也不交给裁决 LLM。
- **danger 不提供"记住"**：不允许用户把 `rm -rf` 类操作写进 allow 本子；每次都问。
- **deny 先于 allow**：同一请求同时命中两边时拒绝优先，与 Claude Code permissions 语义一致。
- **模式互斥**：单一 `approval_mode` 字段，不做组合。
- **thread 隔离**：匹配、记住、列表和删除都必须携带同一个 `thread_id`，cwd 不参与本子归属。

## DangerGuard 清单（代码写死，v0.6 初始集）

沿用 `src/safety/approval/default_rules.py` 现有 HardBlock 基线（host-root-delete、fork-bomb、secrets 读取、config-self-escalation 等）+ `guards/destructive.py` 的 rm -r*/shred/srm 规则，**新增**两条：

1. `git-internal-write`：write_file / edit_file / run_shell 目标命中 `**/.git/**`
2. `agent-instruction-write`：write_file / edit_file 目标命中 `**/CLAUDE.md`、`<kongming_home>/prompts/**`

行为统一从"硬拒（rejected）"改为"强制用户审批（danger=true）"。config-self-escalation 扩展为 safety-policy-self-escalation，同时检测两类自提权：写 `setting.yaml` 修改 `safety.approval_mode`，以及写 `<kongming_home>/safety/thread_permissions/` 扩大 thread `allow` 范围。

## 与 cron v0.5 的衔接

cron 任务级 `approval_mode`（trust / fail_closed）语义保持，每个 scheduled task 已绑定专属 thread。cron `trust` 对该 run 临时启用 `full_trust`，danger 命中时进入 NEEDS_APPROVAL；cron `fail_closed` 使用任务 thread 的 permissions 本子，未命中且无人应答时拒绝。`ScheduleApprovalProvider` 消费新 engine 的 decision 并传递 task `thread_id`。
