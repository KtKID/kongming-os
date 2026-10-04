# Task 映射

## 开发顺序

| Task | 组件 | 内容 | 依赖 | 风险 | 状态 |
|------|------|------|------|------|------|
| task-1 | AgentRoleManager | 新增角色数据结构、result types、文件存储、list/get/create、session roster、resolve、snapshot、错误语义 | 无 | 低 | 测试通过 |
| task-2 | AgentRoleTool | 新增 `list_agent_roles` / `create_agent_role` 薄适配，回执由 manager 生成 | task-1 | 中 | 测试通过 |
| task-3 | Prompt + CLI Assembly | TOOLS prompt 提示选角流程，CLI 创建同一个 manager 并注册角色工具 | task-2 | 中 | 测试通过 |
| task-4 | CodeReviewPreset | 迁移 `default_reviewer_specs()` 到 preset | task-1 | 低 | 测试通过 |
| task-5 | Roundtable participants | 支持 `participants.select`，通过 manager resolve 并写 workflow roles snapshot | task-1/task-4 | 中 | 测试通过 |
| task-6 | Safety rule | `list_agent_roles` silent allow，`create_agent_role` 固定角色库目录 silent allow | task-2 | 中 | 测试通过 |
| task-7 | Tests | 单测 + fake LLM 工具链路测试 + 旧字段拒绝矩阵 | task-2/task-5/task-6 | 中 | 测试通过 |

## MVP 切片

第一轮做 task-1、task-2、task-3、task-5、task-6、task-7 的最小闭环。task-4 可以同轮完成，因为它只是迁移已有默认角色。

## 验收标准

- 角色库为空时，LLM 能通过工具创建角色并收到 `AgentRoleManager` 返回的 roster。
- `run_agent_workflow(mode="roundtable_review")` 能通过 `AgentRoleManager` 使用已创建角色。
- workflow 目录能看到 `AgentRoleManager` 写入的本次角色快照。
- code review preset 角色能通过 `participants.select` 显式选择并执行。
- `create_agent_role` 不暴露任意写文件路径参数。

## 实现必须落地的 Manager 方法

| 方法 | 必须测试 |
|------|----------|
| `list_roles` | 读取内置 preset、用户 JSON，跳过损坏文件 |
| `list_role_summaries` | 返回 `roles/current_roundtable_agents/empty_message` |
| `create_role` | 保存 JSON、返回 `created/existing`、更新 session roster |
| `get_role` | 按 role id 查找，缺失返回 `None` |
| `resolve_participants` | 非空校验、去重保序、未知 id 失败 |
| `write_workflow_snapshot` | 写入 `<workflow_dir>/roles.json`，只含本次使用角色 |

## 已同步的文档点

- `roundtable-review-v0.1` 顶部已补迁移说明，指向本 spec。
- 旧 `reviewers` schema 已标记为被 `participants.select` 取代。
- `AgentWorkflowManager` / CLI 装配流程已写明同一个 `AgentRoleManager` 注入 tool 和 workflow strategy。
