# Slash Catalog

> Web 输入框 `/` 菜单的统一目录模块，负责把 workflow、command、skill 和 workflow 历史投影为可分组浏览的候选能力，并把用户选择的能力绑定为可进入对话上下文的 conversation reference。

## Spec 导航

| Spec | 状态 | 说明 |
|------|------|------|
| [slash-menu-catalog-v0.1](./slash-menu-catalog-v0.1/) | 可进入 x-req | 统一 slash catalog、三类 provider、REST DTO、两级 SlashMenu 与 workflow 历史分区方案。 |

状态：探索中 / 方案确认 / 可进入 x-req / 开发中 / 已完成

## 当前 Spec 审核基准

1. Web 输入框输入 `/` 时出现功能列表。
2. 首层列表来自统一 catalog，首层至少包含 `workflow`、`command`、`skill` 三组。
3. 每组子项目从各自真实注册源动态生成，前端和 route 层只做投影与展示。
4. workflow 子项来自实际 workflow 策略注册表，例如 `AgentWorkflowManager.list_workflow_strategies()`，展示已注册 workflow mode。
5. command 子项来自 `CommandRegistry.list_commands("web")`。
6. skill 子项来自 `load_skill_specs(home, workspace)`。
7. 历史已完成 workflow run 属于 workflow 组的历史分区，来源于 `WorkflowRunViewerManager` 的轻量 completed projection。
8. 新增 workflow、command、skill 后菜单通过通用 provider 自动更新。
9. 用户选择 skill 后，Composer 用原子 chip 渲染引用，例如 `Skill Creator`，提交时发送结构化 `ConversationReferenceDTO`。
10. skill 正文由后端 resolver 读取并注入模型上下文，输入框只显示引用投影。
11. command、workflow strategy、workflow run 与 skill 共用同一套 reference activation 合同。
12. 对话历史回放优先通过 message metadata 还原引用 chip，缺 metadata 时按普通文本展示。
