# Slash Menu Catalog v0.1

> 状态：可进入 x-req
> 目标：把 Web slash 菜单从 command/skill 扁平候选升级为统一 catalog 驱动的两级菜单，并把选择结果升级为可注入对话上下文的 conversation reference。

## 需求要点

1. Web 输入框输入 `/` 时出现功能列表。
2. 首层列表来自统一 catalog，首层至少包含 `workflow`、`command`、`skill` 三组。
3. 每组子项目从各自真实注册源动态生成，前端和 route 层只做投影与展示。
4. workflow 子项来自实际 workflow 策略注册表，例如 `AgentWorkflowManager.list_workflow_strategies()`，展示已注册 workflow mode。
5. command 子项来自 `CommandRegistry.list_commands("web")`。
6. skill 子项来自 `load_skill_specs(home, workspace)`。
7. 历史已完成 workflow run 属于 workflow 组的历史分区，来源于 `WorkflowRunViewerManager` 的轻量 completed projection。
8. 新增 workflow、command、skill 后菜单通过通用 provider 自动更新。
9. 用户选择 skill 后，Composer 用原子 chip 渲染引用，提交时随 `user.input.references` 发送结构化引用。
10. skill 正文由后端 resolver 读取并注入模型上下文，Composer 只显示紧凑引用投影。
11. command、workflow strategy、workflow run 与 skill 共用 `ConversationReferenceDTO` 和 activation 合同。
12. 历史回放时能根据 `conversation_references` metadata 还原 chip。

## 系统目标

Slash Catalog 为 Web 输入框提供统一、可扩展、可测试的 slash 能力目录。它把 workflow 策略、slash command、skill spec 和当前 thread 的历史 workflow run 汇入同一个目录合同，前端消费 group/item DTO，并把用户选择的 item 绑定成可进入对话上下文的 reference。新增注册项时，注册源负责暴露能力，catalog provider 负责投影，SlashMenu 自动展示，Conversation Reference 层负责选择后的上下文注入或动作调起。

## 最小可用路径

用户在 Web `Composer` 输入 `/` → `SlashMenu` 请求 `/api/slash-catalog` → 首层展示 `workflow`、`command`、`skill` → 用户进入某组 → `/api/slash-catalog/groups/{group_id}` 返回真实注册源生成的子项 → 选择 skill 后 Composer 显示原子 chip → 用户提交消息时 `user.input.references` 携带 `ConversationReferenceDTO` → 后端 resolver 按真实注册源读取 `SKILL.md` → `InputAssembler` 在最新 user message 前注入 `<selected_skill>` 片段。

这条链路涉及 `SlashCatalogManager`、Catalog Providers、Slash Catalog REST、SlashMenu Frontend、Workflow History Projection、Conversation Reference Contract、Rich Composer Reference UI 和 Conversation Reference Manager，全部为 P0/P1 模块。

## 范围边界

**包含**：
- 新增 `src/hosts/web/slash_catalog/` 方案边界和 `SlashCatalogManager` 门户。
- 统一 provider 协议：`group_id`、`group_title`、`list_items(context)`。
- 统一 DTO：`SlashCatalogGroupDTO`、`SlashCatalogItemDTO`、`SlashCatalogContext`。
- `WorkflowCatalogProvider`、`CommandCatalogProvider`、`SkillCatalogProvider` 三个注册源 adapter。
- completed workflow run 作为 workflow 组历史分区的只读投影。
- 新 REST route：`GET /api/slash-catalog`、`GET /api/slash-catalog/groups/{group_id}`。
- 旧 `/api/slash-candidates` 由 `SlashCatalogManager` 投影 command+skill flat list，保持兼容。
- 前端 SlashMenu group → item 两级状态机、加载态、空态、键盘导航与鼠标选择。
- `ConversationReferenceDTO`、reference activation 模板和 `user.input.references` 协议。
- Web Composer 内的 reference chip 渲染、原子删除、复制 fallback、tooltip。
- 最新 user message 的 skill reference 解析与 `<selected_skill>` 上下文注入。
- command、workflow strategy、workflow run 复用同一 reference 合同的 action hint。

**不包含**：
- workflow mode 的完整 payload 构建器和执行 wizard。
- completed workflow run 选择后的最终打开 viewer 或插入命令语义。
- workflow、command、skill 注册源自身的重构。
- 跨 host slash 菜单协议。
- 多人协同编辑富文本输入框。
- 把完整 `SKILL.md` 正文直接渲染到 Composer 内。

## 模块导航

| 模块 | 状态 | 文档 | 是否可进 task | 说明 |
|------|------|------|---------------|------|
| SlashCatalogManager | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-1slashcatalogmanager) | 是 | Web slash catalog 门户，注册 provider、聚合 group/items、提供兼容 flat 投影。 |
| Catalog Providers | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-2catalog-providers) | 是 | 将 workflow、command、skill 真源投影为统一 item DTO。 |
| Slash Catalog REST | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-3slash-catalog-rest) | 是 | FastAPI route 暴露 catalog 和 group items，接收可选 `thread_id`。 |
| SlashMenu Frontend | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-4slashmenu-frontend) | 是 | 两级菜单状态、加载态、空态、键盘与鼠标交互。 |
| Workflow History Projection | 方案确认 | [模块拆分](./02-module-breakdown.md#模块-5workflow-history-projection) | 是 | 复用 `WorkflowRunViewerManager`，只读加载当前 thread completed workflow run。 |
| Conversation Reference Contract | 方案确认 | [模块拆分](./02-module-breakdown.md#模块-6conversation-reference-contract) | 是 | 定义 catalog item 选择后的引用合同、activation 与 WS payload。 |
| Rich Composer Reference UI | 方案确认 | [模块拆分](./02-module-breakdown.md#模块-7rich-composer-reference-ui) | 是 | 在 Composer 内渲染不可编辑 chip，并维护 text/reference node 序列。 |
| Conversation Reference Manager | 方案确认 | [模块拆分](./02-module-breakdown.md#模块-8conversation-reference-manager) | 是 | 后端解析 references，生成 prompt 注入片段或后续动作计划。 |

## 文档导航

- [图集：总览 + provider 聚合 + 前端交互 + item 状态](./diagrams.md)
- [目标与完成标准](./01-goals-and-boundaries.md)
- [模块设计 + 接口 + 数据结构](./02-module-breakdown.md)
- [数据模型与状态](./04-data-and-state.md)
- [验证策略与演进](./05-validation-and-evolution.md)
- [Task 映射](./90-task-map.md)

## 当前建议

1. 先拆 `slash-catalog-core` 与 `slash-conversation-reference-contract`，锁定 catalog DTO、reference DTO、WS payload 和旧 flat API 兼容投影。
2. 再做 `slash-rich-composer-references`，把 skill item 选择渲染为 Composer chip，并完成提交序列化。
3. 后端优先落 skill reference resolver 与 `InputAssembler` 注入，command/workflow action 先共享合同和 action hint。
