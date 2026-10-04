# Task 映射

## 当前 x-req task

| Task | 优先级 | 说明 | 验收点 |
|------|--------|------|--------|
| `dev-pipeline/tasks/subagent-scoped-permissions-v0.1/` | P0 | 子 agent 创建时固化 grant，运行时只允许 working_dir 内文件操作 | working_dir 内 read / write / list 成功，越界 read / write / list 拒绝，审计完整，子 agent 汇报包含拒绝事实 |

## 组件到任务映射

| 组件 | 文件 | Task | 说明 |
|------|------|------|------|
| `SubAgentPermissionSpec` | `src/executors/agent_runtime/subagent_permissions.py` | `subagent-scoped-permissions-v0.1` | 主 agent 创建时的权限输入结构 |
| `SubAgentGrant` | `src/executors/agent_runtime/subagent_permissions.py` | `subagent-scoped-permissions-v0.1` | 子 agent 运行时授权单 |
| `SubAgentApprovalProvider` | `src/executors/agent_runtime/subagent_permissions.py` | `subagent-scoped-permissions-v0.1` | 文件工具 scoped 审批 wrapper |
| `SubAgentManager` grant registry | `src/executors/agent_runtime/subagent_manager.py` | `subagent-scoped-permissions-v0.1` | 创建和维护 grant |
| `AgentWorkflowManager` audit 写入 | `src/executors/agent_runtime/workflow/manager.py` | `subagent-scoped-permissions-v0.1` | 写 `subagent.json` 和审计事件 |
| `AgentWorkflowTool` schema | `src/tools/agent_workflow_tool.py` | `subagent-scoped-permissions-v0.1` | task spec 新增 `skill_names`、`permission` |
| 单元测试 | `tests/unit/test_agent_workflow_manager.py` 或新文件 | `subagent-scoped-permissions-v0.1` | 覆盖 approved / rejected / audit |

## 实施顺序

1. 新增 `subagent_permissions.py`，定义数据结构和路径判断。
2. 扩展 `AgentWorkflowTool` schema 和 parser。
3. 扩展 `SubAgentTask` metadata，承载 skill 和 permission。
4. `SubAgentManager` 创建 grant 并传 scoped approval provider。
5. `AgentWorkflowManager` 或 audit helper 写完整创建记录。
6. 增加 approved / rejected / audit 单测。
7. 增加 CLI e2e smoke 或现有 smoke 扩展。

## Backlog

| Task | 优先级 | 说明 | 验收点 |
|------|--------|------|--------|
| B1 `workspace_read_paths` | P1 | 支持主 agent 授权只读源码路径 | 指定源码路径可读，未授权路径拒绝 |
| B2 `user_approval` escalation | P1 | 越界请求转交现有审批 UI | 审批 metadata 含 subagent 信息 |
| B3 `grant_updated` | P2 | 支持运行中扩大授权 | `subagent_grant_updated` 可审计 |
| B4 Web permission timeline | P2 | 前端展示子 agent 权限和审批 | workflow 页面可查看每次审批 |
| B5 skill scoped policy | P2 | skill 调用按 `skill_names` 白名单限制；第一版只记录 `skill_names` | 未授权 skill 拒绝 |
| B6 shell scoped sandbox | P3 | 在工作目录内执行受限 shell | cwd、环境变量和命令前缀可控 |
