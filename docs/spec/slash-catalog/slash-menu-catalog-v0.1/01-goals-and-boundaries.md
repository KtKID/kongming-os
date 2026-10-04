# 目标与完成标准

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

Web slash 菜单成为统一能力入口：用户输入 `/` 先看到能力分组，再进入具体 workflow、command、skill 或历史 workflow run。后端用 `SlashCatalogManager` 统一注册 provider，provider 从真实注册源读取条目。前端消费 DTO 和 action hint，并把选择结果绑定成 `ConversationReferenceDTO`。模型上下文注入由后端 resolver 和 `InputAssembler` 负责，Composer 只负责可视化引用和提交结构化 payload。

## 完成目标（DoD）

- [ ] DoD#1：输入 `/` 后首层显示 `workflow`、`command`、`skill`，顺序稳定。
- [ ] DoD#2：workflow 子项来自 `AgentWorkflowManager.list_workflow_strategies()` 或等价注册表工厂，展示已注册 mode、title、summary、status、runnable。
- [ ] DoD#3：command 子项来自 `CommandRegistry.list_commands("web")`，旧 `/api/slash-candidates` 的 command 投影保持字段兼容。
- [ ] DoD#4：skill 子项来自 `load_skill_specs(home, workspace)`，名称冲突处理与旧 flat list 兼容规则一致。
- [ ] DoD#5：completed workflow run 只读当前 thread 产物，来源于 `WorkflowRunViewerManager` 的轻量列表投影，路径受 session root 约束。
- [ ] DoD#6：新增 workflow/command/skill 注册项后，菜单通过 provider 自动更新，前端无需增加静态条目。
- [ ] DoD#7：前后端 DTO 有合同测试锁定，未知字段、空列表、错误码、旧 flat API 均有覆盖。
- [ ] DoD#8：SlashMenu 键盘和鼠标交互有 Vitest 覆盖，加载态、空态、分组返回、item 选择均可验证。
- [ ] DoD#9：catalog item 能输出 reference activation 模板，至少覆盖 skill、command、workflow strategy、workflow run 四种 kind。
- [ ] DoD#10：选择 skill 后 Composer 显示不可编辑 chip，支持原子删除、复制 fallback 和来源 tooltip。
- [ ] DoD#11：`UserInputFrame.references`、`Message.metadata["conversation_references"]` 和 history projection 字段一致。
- [ ] DoD#12：`ConversationReferenceManager` 能按真实 skill loader 解析 skill reference，并生成 `<selected_skill>` 注入片段。
- [ ] DoD#13：`InputAssembler` 只解析最新 user message 的 references，避免旧 turn 的 skill 重复注入。
- [ ] DoD#14：command 和 workflow 引用复用同一 `ConversationReferenceDTO`，能表达 `execute_command`、`guide_payload`、`open_viewer` 三类 activation。

## 范围边界

**包含**：
- `src/hosts/web/slash_catalog/` 新模块方案。
- `SlashCatalogManager` 门户类和 provider 注册机制。
- `WorkflowCatalogProvider`、`CommandCatalogProvider`、`SkillCatalogProvider`。
- `CompletedWorkflowRunProvider` 或 `WorkflowCatalogProvider` 内的历史分区子能力。
- `SlashCatalogGroupDTO`、`SlashCatalogItemDTO`、`SlashCatalogContext`。
- 新 REST route 与旧 `/api/slash-candidates` 兼容投影。
- Web `SlashMenu` 两级菜单状态机和 `Composer` 传入 `threadId`。
- `ConversationReferenceDTO`、`ComposerNode`、reference activation 模板。
- `UserInputFrame.references`、`Message.metadata["conversation_references"]` 和 history projection。
- `ConversationReferenceManager` skill resolver 与 `InputAssembler` 注入片段。
- Composer reference chip 的渲染、删除、复制、tooltip 和提交序列化。

**不包含**：
- 新 command、skill、workflow strategy 的业务实现。
- workflow mode 的多步参数收集 UI。
- completed run 的完整详情页改造。
- CLI slash 菜单能力。
- 持久化 catalog 缓存表。
- 多人协同富文本编辑。
- 直接在 Composer 渲染完整 `SKILL.md` 正文。
- workflow payload 多步 wizard 的完整实现。

## 关键约束

- 真实注册源是单一事实来源：workflow 读 strategy registry，command 读 `CommandRegistry`，skill 读 skill loader，历史 run 读 workflow viewer。
- route 层保持薄：负责校验 query、调用 manager、返回 DTO；不承载静态候选条目。
- 前端保持展示层：消费 group/item/action hint，列表内容由后端 catalog 决定。
- completed workflow run 必须 thread-scoped，复用 `WorkflowRunViewerManager` 的 session root 约束和 workflow ID 校验。
- 旧 `/api/slash-candidates` 保持 command+skill flat list 行为，降低现有前端和测试迁移风险。
- 图源集中在 `diagrams.md`，其他文档只引用图集。
- Composer 内的 chip 是引用投影；服务端 `ref/source_ref` 解析结果才是注入真源。
- `SKILL.md` 正文只在后端 resolver 读取，前端不接收完整 skill body。
- references 只对最新 user message 生效，历史消息保留 metadata 供 UI 回放。
- command/workflow/skill 统一走 activation 合同，前端按 action hint 调起具体交互。

## DoD ↔ 模块追溯矩阵

| DoD 条目 | 需要哪些模块 | 需要哪些 task | 状态 |
|---------|------------|-------------|------|
| DoD#1 | SlashCatalogManager + Slash Catalog REST + SlashMenu Frontend | `slash-catalog-core`、`slash-menu-two-level-ui` | 待实现 |
| DoD#2 | SlashCatalogManager + Catalog Providers | `slash-catalog-core` | 待实现 |
| DoD#3 | SlashCatalogManager + Catalog Providers + Slash Catalog REST | `slash-catalog-core`、`legacy-slash-candidates-projection` | 待实现 |
| DoD#4 | SlashCatalogManager + Catalog Providers + Slash Catalog REST | `slash-catalog-core`、`legacy-slash-candidates-projection` | 待实现 |
| DoD#5 | Workflow History Projection + Catalog Providers + Slash Catalog REST | `workflow-history-catalog-projection` | 待实现 |
| DoD#6 | SlashCatalogManager + Catalog Providers | `slash-catalog-core` | 待实现 |
| DoD#7 | SlashCatalogManager + Slash Catalog REST + SlashMenu Frontend | `slash-catalog-contract-tests` | 待实现 |
| DoD#8 | SlashMenu Frontend | `slash-menu-two-level-ui` | 待实现 |
| DoD#9 | Catalog Providers + Conversation Reference Contract | `slash-conversation-reference-contract` | 待实现 |
| DoD#10 | Rich Composer Reference UI + SlashMenu Frontend | `slash-rich-composer-references` | 待实现 |
| DoD#11 | Conversation Reference Contract + WebSocket Protocol + Runner metadata | `slash-conversation-reference-contract` | 待实现 |
| DoD#12 | Conversation Reference Manager + SkillCatalogProvider | `slash-reference-context-injection` | 待实现 |
| DoD#13 | Conversation Reference Manager + InputAssembler | `slash-reference-context-injection` | 待实现 |
| DoD#14 | Catalog Providers + Conversation Reference Contract + Workflow History Projection | `slash-reference-action-hints` | 待实现 |

> 模块覆盖关系：8 个模块均有 DoD 支撑；14 条 DoD 均能追溯到至少一个模块和 task。
