# 验证策略与演进

> 维护说明（2026-07-13）：本文件中“未来接入 upstream ApprovalProvider”的演进项已升级为 P0 必需迁移。当前 DoD 和跨分支验证矩阵以 `repo:docs/spec/safety-approval-single-entry-v0.1/05-validation-and-evolution.md` 为准。

## 验证矩阵

| 场景 | 验证方式 | 预期 |
|------|----------|------|
| 子 agent 写 `working_dir/result.txt` | fake LLM 单元测试 | approved，文件写入成功 |
| 子 agent 写 `working_dir/../outside.txt` | 单元测试 | rejected，写入失败 |
| 子 agent 读 `working_dir/input.txt` | 单元测试 | approved，读取成功 |
| 子 agent 读项目源码 | 单元测试 | rejected |
| 子 agent 调未授权工具 | 单元测试 | rejected |
| 子 agent 创建记录 | 单元测试 | `subagent.json` 字段完整 |
| 审批事件 | 单元测试 | `audit.jsonl` 含完整 approval payload |
| 每次审批落审计 | 单元测试 | approved 和 rejected 都生成 `subagent_approval_decided` |
| 会话日志分层 | 单元测试 | `subagent.json` 记录 child session log path，权限审计仍在 workflow `audit.jsonl` |
| 真实模型路径 | CLI smoke | MiniMax 子 agent 写工作目录成功，越界拒绝可审计且无副作用，作为补充证据 |

## 单元测试建议

新增或扩展 `tests/unit/test_agent_workflow_manager.py`：

- `test_subagent_grant_written_with_complete_creation_record`
- `test_subagent_write_file_inside_workdir_is_allowed`
- `test_subagent_write_file_outside_workdir_is_rejected`
- `test_subagent_read_file_outside_workdir_is_rejected`
- `test_subagent_unknown_tool_is_audited_from_lifecycle_hook_and_not_registered_event`
- `test_subagent_approval_audit_contains_complete_payload`
- `test_subagent_approval_audit_written_for_allow_and_reject`
- `test_subagent_creation_record_contains_session_and_audit_log_paths`

## e2e 建议

CLI smoke 增加两个任务：

1. `write-ok`：调用 `write_file` 写 `result.txt` 到自己的工作目录，预期成功。
2. `write-denied`：尝试写 `../outside.txt`，预期生成 `subagent_approval_decided`，`decision=rejected`，`decision_source=scope_deny`，目标文件没有写入，子 agent 汇报里包含拒绝事实；workflow 状态按子 agent 最终回复决定。

真实模型 smoke 使用一次性环境变量：

```bash
KONGMING_APPROVAL_MODE=auto_allow rtk uv run python -m cli.main \
  --config config/setting.yaml \
  --model-preset minimax-m3 \
  --subagent-smoke \
  --session-id subagent-permission-e2e-001
```

`auto_allow` 只作为外层审批 fallback，scoped grant 的越界拒绝必须优先执行。核心验收以 fake LLM pytest 为准，MiniMax M3 smoke 写入 dev-report 作为补充证据。

## 审计真实性检查

机器校验建议：

```bash
rtk jq -e '.grant.working_dir and .permission.mode == "scoped_workdir"' \
  .kongming/sessions/<sid>/agent-workflows/<wf>/agents/001-task/subagent.json

rtk jq -s -e '([.[] | select(.action == "subagent_approval_decided")] | length >= 1)' \
  .kongming/sessions/<sid>/agent-workflows/<wf>/audit.jsonl
```

## 风险与处理

| 风险 | 影响 | 处理 |
|------|------|------|
| 路径 `../` 绕过 | 子 agent 写出工作目录 | resolve 后再 `relative_to` |
| symlink 指向外部 | 子 agent 通过软链越界 | resolve 真实路径后判断 |
| 工具参数字段不统一 | 无法提取目标路径 | 为每个文件工具定义 path extractor |
| 审计体积变大 | session 目录增长 | 第一版保留完整，后续加大小上限和 raw dump 开关 |
| 主 agent 误授权工具 | 子 agent 能看到多余工具 | 默认空工具，主 agent 显式选择 |
| existing approval 被绕过 | 审批 UI 看不到请求 | scoped provider 记录审计，未来升级请求转交 upstream |

## 演进路线

### P1 workspace read grant

增加只读路径白名单：
- `workspace_read_paths`
- 每个路径必须位于项目根内。
- 审计记录主 agent 授权来源。

### P1 user approval escalation

增加 `escalation="user_approval"`：
- 越界请求注入 subagent metadata。
- 转交 existing `ApprovalProvider`。
- 用户审批结果回写 `subagent_approval_decided`。

### P2 main agent approval

依赖 wait / followup / async workflow：
- 子 agent 越权请求进入 workflow mailbox。
- 主 agent 恢复后决定是否扩大 grant。
- grant 变更写 `subagent_grant_updated`。

### P2 Web 渲染

从 `subagent.json` 和 `audit.jsonl` 投影：
- 子 agent 创建卡片。
- 授权详情面板。
- 工具审批时间线。
- 拒绝原因和路径差异展示。

## 可进入 x-req 的任务

当前 spec 已进入 `x-req`：`dev-pipeline/tasks/subagent-scoped-permissions-v0.1/`。
