# task-session-suspend · 开发清单

> spec: docs/spec/kmh-zcode-cli-request-supervision/spec.md
> 创建: 2026-10-06

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[x] 🟢` 验证通过 / `[!] 🔴` 验证失败

本 task 全部改动位于 DSH 子模块（third_party/dsh，维护分支 kmh/runtime-core），遵循子模块 AGENTS.md 的持久类型确认、SDK 投影与快照要求。

| # | 任务 | 场景回指 | 涉及文件 | 风险 | 状态 |
|---|---|---|---|---|---|
| T1 | 取消语义反转：取消收敛后待发送队列不再自动按 FIFO 恢复，进入可查询的挂起态 | feat03 场景1 | third_party/dsh/packages/core/agent-loop/src/agent.ts, third_party/dsh/packages/core/agent-loop/src/inbox.ts | 高:反转既有取消收敛行为，影响全部会话停止路径 | [x] 🟢 |
| T2 | "继续"命令：显式恢复挂起的队列与续跑，按记录顺序执行；session-controller 命令、契约与持久事件同步（含 SDK 投影与快照） | feat03 场景2 | third_party/dsh/packages/api/session-controller/src/commands.ts, third_party/dsh/packages/api/session-controller/src/client/contract/session.ts | 高:持久会话事件契约变更须同步快照与 SDK | [x] 🟢 |
| T3 | "补充本轮"命令：新内容进入下一步处理，不恢复已挂起队列 | feat03 场景3 | third_party/dsh/packages/api/session-controller/src/commands.ts, third_party/dsh/packages/api/session-controller/src/client/contract/session.ts | None | [x] 🟢 |
| T4 | 挂起期间输入保存：待处理输入持久保存，重新打开会话仍可见、可继续/编辑/删除 | feat03 场景4 | third_party/dsh/packages/core/agent-loop/src/inbox.ts, third_party/dsh/packages/api/session-controller/src/commands.ts | None | [x] 🟢 |
| T5 | 暂停一致性：后台调度、目标续跑、子代理投递遵循同一会话暂停状态，挂起期间不产生新执行 | feat06 场景1, 场景2 | third_party/dsh/packages/core/agent-loop/src/agent.ts, third_party/dsh/packages/api/session-controller/src/control.ts | 高:跨组件暂停一致性（并发） | [x] 🟢 |
| T6 | DSH 既有回归：cancel/resume/inbox/shutdown-drain 既有测试更新并通过 | None | third_party/dsh/packages/core/agent-loop/tests/ | None | [x] 🟢 |
| T7 | Web 挂起展示：队列与续跑入口显示已挂起，"继续""补充本轮"操作入口 | feat03 场景1, 场景2, 场景3 | third_party/dsh/packages/client/ui-conversation/src/client/ | None | [x] 🟢 |

## 影响文件树

```text
kongming-agent/
└── third_party/dsh/
    ├── packages/core/agent-loop/src/
    │   ├── agent.ts                M  # 取消收敛后挂起而非自动恢复；暂停状态查询
    │   └── inbox.ts                M  # 挂起队列的保存、恢复顺序、待处理输入持久
    ├── packages/core/agent-loop/tests/
    │   └── cancel.spec.ts, resume.spec.ts, inbox.spec.ts, shutdown-drain.spec.ts  M  # 语义反转后的既有测试更新
    ├── packages/api/session-controller/src/
    │   ├── commands.ts             M  # 继续/补充本轮命令，取消改挂起语义
    │   ├── control.ts              M  # 调度与续跑的暂停联动
    │   └── client/contract/session.ts  M  # 客户端契约更新
    └── packages/client/ui-conversation/src/client/  M  # 挂起展示与继续/补充入口（落点以调查为准）
```
