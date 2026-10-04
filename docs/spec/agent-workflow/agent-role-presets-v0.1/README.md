# agent-role-presets-v0.1

> 状态：方案确认
> 目标：为 agent-workflow 增加可复用子 agent 角色库，让主 agent 在编排前先选择已有角色，缺少合适角色时创建并保存最小角色定义，再把角色加入当前编排名单。

## 系统目标

`AgentRolePreset` 是跨编排复用的子 agent 身份模板。主 agent 发起 roundtable、debate、parallel review 或后续 pipeline 时，先查看可用角色列表；已有角色能覆盖任务时直接选择；角色缺失时调用创建工具保存 `id/title/role` 三字段角色，并把它加入本次 workflow 的 participant roster。

## 最小可用路径

主 agent 收到圆桌讨论请求 -> system prompt 提示先调用 `list_agent_roles` -> 工具返回当前角色摘要列表 -> 没有合适角色时主 agent 调用 `create_agent_role(id,title,role)` -> 工具保存到 `.kongming/agent_roles/<id>.json` 并返回保存结果 + 当前已加入子 agent 列表 -> 主 agent 继续创建所需角色 -> 调用 `run_agent_workflow(mode="roundtable_review", payload.participants.select=[...])` -> strategy 解析 role preset 为子 agent prompt -> workflow 审计固化本次使用的角色快照。

## 设计原则

- 字段先小：LLM 可见和创建参数只用 `id`、`title`、`role`。
- 角色可复用：角色库服务所有 workflow strategy，不绑定 roundtable。
- 编排可回放：workflow 运行时复制角色快照到 workflow 目录。
- 创建有回执：每次创建返回保存路径、保存状态和当前 roster。
- 默认低摩擦：第一版创建角色不进入人工审批，工具自身只能写角色库目录。
- preset 与动态并存：`code_review` 角色从 roundtable 内部迁到 `presets/code_review.py`，用户创建角色存入 `.kongming/agent_roles/`。

## 范围

包含：
- `AgentRolePreset` 最小数据结构。
- `AgentRoleManager` 角色模块门户，统一负责创建、查找、回执、解析、快照和持久化。
- `list_agent_roles` / `create_agent_role` 两个 LLM 可见工具。
- roundtable `participants.select` 引用角色 ID。
- workflow 角色快照、审计事件和测试夹具。
- `default_reviewer_specs()` 迁移到 code review preset。

范围外：
- Web 角色管理 UI。
- 跨用户共享角色市场。
- 复杂字段如 persona、temperature、model preset、skill policy。
- 自动删除或覆盖历史角色。
- 创建角色后的人工审核流。

## 模块导航

| 模块 | 状态 | 文档 | 是否可进 task | 说明 |
|------|------|------|---------------|------|
| `AgentRolePreset` | 方案确认 | [04-data-and-state.md](./04-data-and-state.md) | 是 | 最小 id/title/role 角色定义 |
| `AgentRoleManager` | 方案确认 | [02-module-breakdown.md](./02-module-breakdown.md) | 是 | 文件型读写、去重、摘要列表、session roster、role id 解析、快照 |
| `AgentRoleTool` | 方案确认 | [03-core-workflows.md](./03-core-workflows.md) | 是 | list/create 两个 LLM 工具薄适配器 |
| `Roundtable participants` | 方案确认 | [02-module-breakdown.md](./02-module-breakdown.md) | 是 | roundtable 从 role id 解析子 agent |
| `CodeReviewPreset` | 方案确认 | [02-module-breakdown.md](./02-module-breakdown.md) | 是 | 固定代码评审角色迁出 contracts.py |
| `Workflow role snapshot` | 方案确认 | [04-data-and-state.md](./04-data-and-state.md) | 是 | 每次编排固化角色快照 |

## 文档导航

- [架构图](./architecture.html)
- [目标与边界](./01-goals-and-boundaries.md)
- [模块拆分](./02-module-breakdown.md)
- [核心流程](./03-core-workflows.md)
- [数据模型与状态](./04-data-and-state.md)
- [验证策略与演进](./05-validation-and-evolution.md)
- [Task 映射](./90-task-map.md)

## 当前建议

先做 `AgentRoleManager` 的最小闭环：工具能列出空角色库、创建角色、返回 manager 维护的当前 roster；roundtable 能通过 manager 解析 `participants.select` 并写入角色快照。等这个闭环稳定后，再把 role preset 复用到 map_reduce mapper、debate 和 future pipeline。
