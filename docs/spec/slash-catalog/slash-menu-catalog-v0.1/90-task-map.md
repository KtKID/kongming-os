# Task Map

| 模块 | 建议 task 名 | 前置依赖 | 对应 DoD | 风险 | 状态 | 备注 |
|------|--------------|---------|---------|------|------|------|
| SlashCatalogManager + Catalog Providers | `slash-catalog-core` | 无 | DoD#1、DoD#2、DoD#3、DoD#4、DoD#6、DoD#7 | 中，workflow manager 可见性需先定注入路径 | 可进入 x-req | 先交付 DTO、provider 协议、三源投影和 manager 聚合。 |
| Slash Catalog REST | `slash-catalog-rest` | `slash-catalog-core` | DoD#1、DoD#3、DoD#4、DoD#5、DoD#7 | 低 | 可进入 x-req | 新 route + 旧 `/api/slash-candidates` 兼容投影。 |
| Workflow History Projection | `workflow-history-catalog-projection` | `slash-catalog-core` | DoD#5、DoD#7 | 低 | 可进入 x-req | 复用 `WorkflowRunViewerManager.list_workflows(thread_id)`，只投影 completed。 |
| Conversation Reference Contract | `slash-conversation-reference-contract` | `slash-catalog-core` | DoD#9、DoD#11、DoD#14 | 中，REST/WS/metadata/TS 类型需同步 | 可进入 x-req | 增加 `ConversationReferenceDTO`、`reference_template`、`UserInputFrame.references`。 |
| SlashMenu Frontend + Rich Composer Reference UI | `slash-rich-composer-references` | `slash-catalog-rest` + `slash-conversation-reference-contract` | DoD#1、DoD#8、DoD#10、DoD#11 | 中，富输入框需保持键盘和附件体验 | 可进入 x-req | 改 `SlashMenu.tsx`、`Composer.tsx`，新增 reference chip 管理。 |
| Conversation Reference Manager | `slash-reference-context-injection` | `slash-conversation-reference-contract` | DoD#12、DoD#13、DoD#14 | 中，skill body 读取和 prompt 注入需守住服务端真源 | 可进入 x-req | 后端解析 skill reference，`InputAssembler` 注入 `<selected_skill>`。 |
| Reference Action Hints | `slash-reference-action-hints` | `slash-conversation-reference-contract` + `workflow-history-catalog-projection` | DoD#9、DoD#14 | 中，command/workflow 行为需分层落地 | 方案确认 | command/workflow 先共享 DTO，执行和 payload wizard 分后续 task。 |
| Contract + Smoke Tests | `slash-catalog-contract-tests` | 前七项 | DoD#7、DoD#8、DoD#9、DoD#10、DoD#11、DoD#12、DoD#13、DoD#14 | 中，前后端 fixture 需同步 | 可进入 x-req | pytest + Vitest，浏览器 smoke 覆盖 skill chip 主链路。 |

## 建议开发顺序

1. `slash-catalog-core`：先把后端 DTO、manager 和 provider 协议定住，完成 command/skill 兼容投影。
2. `slash-catalog-rest`：暴露新 API，旧 route 迁移到 manager。
3. `workflow-history-catalog-projection`：接入 `thread_id` 和 completed run 分区。
4. `slash-conversation-reference-contract`：把 item 选择后的 reference 模板、WS payload 和 metadata 合同定住。
5. `slash-rich-composer-references`：前端切到 group → item → chip 的选择体验。
6. `slash-reference-context-injection`：后端先打通 skill reference 的 prompt 注入。
7. `slash-reference-action-hints`：command/workflow 使用同一合同输出 action hint。
8. `slash-catalog-contract-tests`：前后端 fixture 与交互用例收口。

## x-req 拆分建议

| x-req 包 | 范围 | 退出条件 |
|----------|------|----------|
| `slash-catalog-backend-v0.1` | Manager、providers、DTO、route、legacy projection、pytest | `/api/slash-catalog` 和 `/api/slash-candidates` 契约测试通过。 |
| `slash-menu-frontend-v0.1` | SlashMenu 两级 UI、Composer threadId、API client、Vitest | 输入 `/` 可展示三组并选择 command/skill/workflow item。 |
| `slash-catalog-workflow-history-v0.1` | completed run 分区、viewer action hint、路径约束测试 | 当前 thread completed run 出现在 workflow 组历史分区。 |
| `slash-conversation-reference-contract-v0.1` | `ConversationReferenceDTO`、reference template、WS references、metadata 透传 | skill item 选择能生成合法 reference payload。 |
| `slash-rich-composer-references-v0.1` | Composer chip、node 序列、删除/复制/tooltip/history 还原 | 选择 `$skill-creator` 后输入框显示 `Skill Creator` chip。 |
| `slash-reference-context-injection-v0.1` | 后端 reference resolver、skill body 读取、`InputAssembler` 注入 | 最新 user message 的 skill reference 被注入为 `<selected_skill>`。 |

## PoC 建议

- workflow manager 可见性先做 1 个窄 PoC：route 或 manager 能读取某个 thread 绑定的 `AgentWorkflowManager.list_workflow_strategies()`，并在未绑定时使用等价策略注册表工厂输出相同 mode 集合。
- 前端状态机先做 fixture 驱动 PoC：固定三组和四种 item kind，验证 keyboard path 后再接真实 API。
- Rich Composer 先做 skill-only PoC：固定一个 `skill:skill-creator` reference，验证 chip 渲染、删除、复制、提交 payload 和 history 还原。
- 后端注入先做 skill-only PoC：fake skill loader 指向临时 `SKILL.md`，断言 `InputAssembler` 输出里只有最新 user message 前出现一次 `<selected_skill>`。
