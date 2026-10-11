# Spec 索引

> 所有 x-spec 需求包的导航。只记录状态和入口，具体设计内容在各 spec 目录内。

## Spec 导航

| Spec | 状态 | 说明 |
|------|------|------|
| [kmh-team-v0.1](./kmh-team-v0.1/spec.md) | 待评审 | 创建团队会话，默认与 owner 对话，按点名传递最近对话并显示成员回复 |
| [kmh-mobile-butler-v0.1](./kmh-mobile-butler-v0.1/spec.md) | 待评审 | 移动端管家统一委派给 Codex 或 ZCode，遵循用户选择并接收执行报告 |
| [agent-tree-v0.1](./agent-tree-v0.1/) | 方案确认 | 多 agent/loop 重构：统一 agent 抽象 + mailbox 串行驱动 + 异步 spawn 派生 + 树级打断；落 5 步（Event 坐标字段→run 终态分类器→TaskRegistry→loop mailbox 化→多 agent spawn） |
| [agent-workflow/task-flow-v0.1](./agent-workflow/task-flow-v0.1/) | 方案确认 | 新增 task_flow 编排模式，面向基础任务计划、逐节点执行、Progress 弹窗可视化和严重异常暂停询问 |
| [agent-workflow/workflow-prompt-catalog-v0.1](./agent-workflow/workflow-prompt-catalog-v0.1/) | 方案确认 | 将 workflow strategy catalog 注入 system prompt，给 CLI/Web 共享稳定短 listing 和 describe/run 发现路径 |
| [harness-eval-environment-v0.1](./harness-eval-environment-v0.1/) | 方案确认 | 明确 runtime eval 环境搭建、profile 切片、approval 自动化、case 级审批和产物元数据 |
| [runner-lifecycle-hooks-v0.1](./runner-lifecycle-hooks-v0.1/) | 方案确认 | 统一 Runner lifecycle hook 机制，新增 after_run 机制点并支持 runtime 装配后注册 |
| [safety-approval-single-entry-v0.1](./safety-approval-single-entry-v0.1/) | 方案确认 | 将主 Agent、子 Agent、定时任务收敛到同一审批决策入口；分支仅追加单调收紧的范围约束与授权证据 |
| [web-chat/pending-input-queue-v0.1](./web-chat/pending-input-queue-v0.1/) | 方案确认 | 为 Web generic_chat 增加同 thread 普通输入队列，统一 user.input、choice.submit、Avatar 输入的 run 启动入口 |
| [web-chat/task-detail-overlay-v0.1](./web-chat/task-detail-overlay-v0.1/) | 方案确认 | 在 Chat 上叠加任务详情页，提供 thread 文件浏览和嵌入式 Workflow Viewer |
| [web-chat/user-choice-tool-v0.1](./web-chat/user-choice-tool-v0.1/) | 方案确认 | LLM 调用工具，在输入框上方展示多问题选项列表，用户确认后把选择结果回传给对话 |
| [web-wire-protocol-unification-v0.1](./web-wire-protocol-unification-v0.1/) | 方案确认 | 统一 Web wire 协议双侧真源、发送端校验、前端消费边界和漂移测试 |
| [xspace-mobile-login/public-qr-login-v0.1](./xspace-mobile-login/public-qr-login-v0.1/) | 方案确认 | XSpace APK 通过公网域名或局域网私网 IP 扫码登录 Kongming Runtime，二维码入口位于 `/login` |
| [llm-provider-v0.2/reasoning-adapter-v2](./llm-provider-v0.2/reasoning-adapter-v2/) | 可进入 x-req | reasoning 控制升级为正交双字段（开关 + 档位），覆盖 GLM-5.2 / DeepSeek / MiniMax M3，修复 V1 单字段 none 设计缺陷 |

状态：探索中 / 待评审 / 方案确认 / 可进入 x-req / 开发中 / 已完成
