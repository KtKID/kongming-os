# 验证策略与演进

## 验证策略

### 单元测试

- **覆盖模块**：`SlashCatalogManager`、`WorkflowCatalogProvider`、`CommandCatalogProvider`、`SkillCatalogProvider`、Conversation Reference Contract、Conversation Reference Manager、legacy flat projection。
- **框架**：pytest。
- **重点场景**：
  - provider 注册顺序稳定，首层 groups 固定为 `workflow`、`command`、`skill`。
  - workflow item 来自 fake `AgentWorkflowManager.list_workflow_strategies()`，新增 fake strategy 后自动出现在 item 列表。
  - command item 来自 fake `CommandRegistry.list_commands("web")`。
  - skill item 来自 monkeypatched `load_skill_specs(home, workspace)`。
  - command/skill slash key 冲突时，legacy flat projection 沿用 command 优先。
  - completed workflow run 仅投影 `status == "completed"` 的 item。
  - catalog item 带 `reference_template` 时能生成合法 `ConversationReferenceDTO`。
  - skill reference resolver 通过 fake `load_skill_specs(home, workspace)` 读取 `SKILL.md`。
  - `InputAssembler` 只对最新 user message 注入 `<selected_skill>`，历史 references 不重复注入。

### 后端路由契约测试

- **覆盖入口**：`GET /api/slash-catalog`、`GET /api/slash-catalog/groups/{group_id}`、`GET /api/slash-candidates`、WebSocket `user.input`。
- **框架**：FastAPI `TestClient`。
- **重点场景**：
  - DTO 字段完整：group `id/title/description/order/item_count`，item `id/group_id/kind/title/description/action/source_ref/reference_template`。
  - `UserInputFrame.references` 支持空列表、skill reference、未知 kind 错误。
  - 可选 `thread_id` 命中 workflow completed runs。
  - `group_id` 错误返回明确错误码。
  - 旧 flat API 返回 `slash/title/description/source`，source 只包含 `command` 和 `skill`。

### Manager / 状态机测试

- **覆盖模块**：SlashMenu 前端状态机、Rich Composer Reference UI、`Composer` 与 `SlashMenu` 交互。
- **框架**：Vitest + React Testing Library。
- **重点场景**：
  - 输入 `/` 触发首层 group 加载。
  - Enter 进入 group，Escape 返回首层或关闭。
  - ArrowUp/ArrowDown 在 group 和 item 列表中循环。
  - skill 选择后插入不可编辑 reference chip。
  - chip 支持 Backspace 原子删除、复制为 `$skill-name` fallback、tooltip 显示来源。
  - 提交时输出 `text` 和 `references`，并保留附件、reasoning controls 原行为。
  - history 带 `conversation_references` metadata 时还原 chip。
  - command 选择后能按 `insert_text` 兼容路径或 `execute_command` reference 路径处理。
  - workflow mode item 选择后插入 `/workflow <mode> ` 或触发 payload 引导 action。
  - completed run item 选择后触发 viewer action 或插入 `/workflow-run <workflow_id> `。
  - 后端返回空列表、当前 item 失配、连接失败时 UI 状态可见。

### 跨前后端 smoke/e2e 测试

- **端到端链路**：Web UI 输入 `/` → 请求 `/api/slash-catalog` → 展示三组 → 进入 skill 组 → 选择 `Skill Creator` → Composer 出现 chip → 提交 `user.input.references` → 后端 metadata 持久化 → `InputAssembler` 注入 `<selected_skill>`。
- **环境要求**：使用 fake app state 和 fake provider；workflow 历史使用临时 session root 写入 `workflow.json/result.json/reports/index.json`。
- **触发方式**：pytest 路由测试 + Vitest 组件测试；完整浏览器 smoke 可放到后续 x-dev 的 Playwright 验证。

### 协议漂移测试

- **覆盖对象**：`SlashCatalogGroupDTO`、`SlashCatalogItemDTO`、`ConversationReferenceDTO`、`UserInputFrame.references`、legacy `SlashCandidate`。
- **测试方式**：
  - 后端 fixture JSON 固定字段名和默认值。
  - 前端 TypeScript fixture 与后端 fixture 同步校验。
  - 未知字段被前端忽略，缺失关键字段进入错误态。
  - `workflow_strategy`、`workflow_run`、`command`、`skill` 四种 kind 均有样例。
  - `inject_context`、`execute_command`、`guide_payload`、`open_viewer` 四种 activation 均有样例。

### 手动验证

- **必须人工过的场景**：
  - 菜单在 Composer 上方定位、最大高度、滚动、焦点保持。
  - 长标题、长 description、无 `threadId` 的 workflow 组显示。
  - chip 在中英文混排、行尾换行、移动光标、删除和复制时保持稳定。
  - tooltip 能展示 skill 来源路径，长路径不撑破输入框。
  - command/skill 旧 flat API 在现有调用方上行为一致。
- **验收人**：Web slash catalog task owner。

## 测试覆盖要求

| 模块 | 最低覆盖要求 | 重点文件 |
|------|-------------|---------|
| SlashCatalogManager | provider 顺序、group 聚合、legacy projection 全覆盖 | `tests/unit/web/test_slash_catalog_manager.py` |
| Catalog Providers | workflow/command/skill 三源各有成功、空、异常用例 | `tests/unit/web/test_slash_catalog_providers.py` |
| Workflow History Projection | completed 过滤、thread 缺失、路径约束用例 | `tests/unit/web/test_slash_catalog_workflow_history.py` |
| Slash Catalog REST | 三个 API 的 TestClient 契约用例 | `tests/unit/web/test_slash_catalog_routes.py` |
| SlashMenu Frontend | 输入 `/`、group/item 导航、选择、空态、错误态 | `web/src/components/SlashMenu.test.tsx` |
| Conversation Reference Contract | DTO fixture、WS references、metadata 透传 | `tests/unit/web/test_conversation_reference_contract.py` |
| Conversation Reference Manager | skill resolver、失败诊断、注入片段 | `tests/unit/prompting/test_conversation_reference_manager.py` |
| InputAssembler Reference Injection | 最新 user message 注入、历史 reference 去重 | `tests/unit/test_input_assembler.py` |
| Rich Composer Reference UI | chip 插入、删除、复制、tooltip、提交序列化 | `web/src/modules/conversation-references/ConversationReferenceManager.test.ts` |
| Composer Integration | `threadId` 传递、选择后生成 chip、Escape 行为 | `web/src/components/Composer.test.tsx` |

## 演进路线

### 短期（本轮 task）

- [ ] 建立 `src/hosts/web/slash_catalog/`、DTO、provider 协议和 `SlashCatalogManager`。
- [ ] 接入 workflow/command/skill 三个 provider。
- [ ] 新增 slash catalog REST route，并让旧 `/api/slash-candidates` 调用 manager 兼容投影。
- [ ] 改造 SlashMenu 为两级菜单，`Composer` 传入 `threadId`。
- [ ] 增加 `ConversationReferenceDTO`、`UserInputFrame.references` 和 message metadata 透传。
- [ ] 增加 Rich Composer reference chip，先覆盖 skill 选择。
- [ ] 增加 `ConversationReferenceManager` skill resolver 与 `InputAssembler` 注入。
- [ ] 补齐 pytest 与 Vitest 的合同和交互测试。

### 中期（下 1-2 轮）

- [ ] 为 workflow mode 增加 payload 引导组件，基于 `WorkflowStrategyDescription.inputs` 生成表单。
- [ ] completed workflow run 选择后直达 viewer panel，并支持从菜单返回输入框。
- [ ] command reference 接入 `CommandService`，支持 prompt/action/interactive 三类行为。
- [ ] workflow strategy reference 接入 workflow payload guide。
- [ ] 增加 provider 诊断 UI，显示某组加载失败原因。

### 长期（方向性）

- 引入搜索 ranking，将 group/item 统一纳入 fuzzy search。
- 为 host adapter 暴露同一 catalog 协议，支持桌面壳层复用。
- 将 command/skill/workflow 的 action hint 扩展成更明确的 typed action，降低前端条件分支。
- 将同一 `ConversationReferenceDTO` 暴露给 host adapter，支持 XSpace 等宿主复用 Web baseline 能力。

## 审核重点

- 首层 group 来自 `SlashCatalogManager`，前端只渲染 DTO。
- 子项来自真实注册源，route 里不写静态 workflow mode、command 或 skill 条目。
- completed workflow run 只读当前 thread，来源于 `WorkflowRunViewerManager`。
- Composer chip 只展示引用，`SKILL.md` 正文由后端 resolver 读取并注入。
- `InputAssembler` 只解析最新 user message 的 references。
- command/workflow/skill 都使用同一 `ConversationReferenceDTO`，前端不分散拼接私有 payload。
- 旧 flat API 的 command/skill 行为保持可用。
