# task-stop-recovery · 开发清单

> spec: docs/spec/codex-cli-provider/spec.md
> 创建: 2026-10-07

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[x] 🟢` 验证通过 / `[!] 🔴` 验证失败

覆盖 feat06（停止与故障恢复）：用户停止链路、错误分类、崩溃后恢复与清理兜底。依赖 task-bridge-tools、task-session-binding。注意：停止后的输入队列行为属宿主官方语义，插件不干预。

| # | 任务 | 场景回指 | 涉及文件 | 风险 | 状态 |
|---|---|---|---|---|---|
| T1 | 停止链路：signal abort → 发送 turn/interrupt → 等待 interrupted 终止通知（可配置时限）→ 回合收尾清理；工具执行随 signal 一并中止 | feat06 场景1 | packages/codex-cli/src/turn.ts, packages/codex-cli/src/adapter.ts | None | [ ] ⏳ |
| T2 | 错误分类：用户取消、超时、登录失效、协议错误、进程意外退出五类独立错误码与可读说明，登录状态与会话记录不被破坏 | feat06 场景2 | packages/codex-cli/src/connection.ts, packages/codex-cli/src/adapter.ts | None | [ ] ⏳ |
| T3 | 崩溃恢复：依据绑定游标与双方日志识别已完成消息与工具结果；结果不确定的调用记录恢复状态，续聊时不重复执行有副作用的工具 | feat06 场景3 | packages/codex-cli/src/session-store.ts, packages/codex-cli/src/adapter.ts | 高:误判将导致副作用工具重复执行 | [ ] ⏳ |
| T4 | 清理兜底：回收超时后经现有 subprocess 托管机制强制回收，回合以明确终态收束 | feat06 场景4 | packages/codex-cli/src/connection.ts | None | [ ] ⏳ |
| T5 | unit：五类错误码、interrupt 等待超时、恢复状态标记、清理超时路径 | feat06 场景1-4 | tests/runtime/codex-cli.test.mjs | None | [ ] ⏳ |
| T6 | smoke：生成中停止（收到 interrupted、进程退出）、杀进程模拟崩溃后续聊（不重复副作用调用） | feat06 场景1, 场景3 | tests/runtime/codex-cli.test.mjs | None | [ ] ⏳ |

## 影响文件树

```text
kongming-agent/
├── packages/codex-cli/src/
│   ├── turn.ts          M  # interrupt 链路与回合终态
│   ├── adapter.ts       M  # 错误分类与恢复接入
│   ├── connection.ts    M  # 断线分类与清理超时强杀
│   └── session-store.ts M  # 恢复状态记录
└── tests/runtime/codex-cli.test.mjs  M  # 追加：错误分类 unit 与停止/崩溃 smoke
```
