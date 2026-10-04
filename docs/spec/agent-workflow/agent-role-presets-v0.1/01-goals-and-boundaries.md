# 目标与边界

## 系统目标

这个 spec 解决 roundtable 固定写死 reviewer 的问题。编排系统需要一个通用角色库，让主 agent 能根据话题挑选子 agent 身份，缺少合适角色时创建并保存，然后把这些角色交给 workflow strategy 动态创建子 agent。

## 完成目标

- [ ] 启动 prompt 明确提示：发起 roundtable 前先查看 agent role 列表。
- [ ] `list_agent_roles` 返回 `[{id,title,role}]` 精简列表。
- [ ] 角色库为空时，工具结果明确提示调用 `create_agent_role`。
- [ ] `create_agent_role` 接收 `id/title/role`，保存 JSON，不走人工审批。
- [ ] 每次创建后返回保存结果和当前 roundtable 已加入子 agent 列表。
- [ ] roundtable payload 只支持 `participants.select` 引用已保存角色。
- [ ] workflow 目录保存本次使用的角色快照。
- [ ] `default_reviewer_specs()` 从 `contracts.py` 迁到 `presets/code_review.py`。

## 包含

- 角色库文件读写。
- 角色创建工具和角色列表工具。
- CLI 装配默认启用角色工具。
- roundtable parser 使用单一新字段 `participants.select`。
- 单元测试覆盖空库、创建、重复创建、roundtable 引用角色。

## 不包含

- Web 角色管理页面。
- 角色删除、批量导入、版本迁移。
- 创建角色审批流。
- 自动把每次临时 role 都提升为长期最佳实践。
- 为每个角色配置独立模型、temperature 或工具权限矩阵。

## 关键约束

- 角色创建工具只允许写 `.kongming/agent_roles/`。
- LLM 可见的角色摘要只包含 `id/title/role`。
- workflow 运行时使用角色快照，不依赖后续角色库变化。
- `AgentWorkflowManager` 只依赖 `AgentRoleManager` 门户，不直接读写角色文件。
- `roundtable_review` 的代码评审角色是 preset，通用角色能力属于 agent-workflow 基础设施。
