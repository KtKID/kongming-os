# task-session-binding · 开发清单

> spec: docs/spec/codex-cli-provider/spec.md
> 创建: 2026-10-07

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[x] 🟢` 验证通过 / `[!] 🔴` 验证失败

覆盖 feat03（持续对话与会话绑定）：KMH 会话与 Codex thread 的绑定持久化、双历史同步的基线重置（压缩/分叉/编辑重发）、回合资源回收与串行控制。依赖 task-bridge-tools。

| # | 任务 | 场景回指 | 涉及文件 | 风险 | 状态 |
|---|---|---|---|---|---|
| T1 | 绑定存储：KMH sessionId → Codex thread.id + 差分游标快照的持久化（数据目录，崩溃后可读），会话内回合串行、整回合共用一进程、工具执行期间保留连接 | feat03 场景1 | packages/codex-cli/src/session-store.ts | 高:绑定/游标损坏直接影响恢复正确性 | [x] 🟢
| T2 | 首次创建与恢复：首个回合创建 thread 并立即记录返回 id，后续回合恢复相同 id 续推 | feat03 场景1 | packages/codex-cli/src/session-store.ts, packages/codex-cli/src/adapter.ts | None | [x] 🟢
| T3 | 重启恢复：进程退出后同会话继续时恢复原 thread，既有内容不重复投递（token 用量线性） | feat03 场景2 | packages/codex-cli/src/adapter.ts | None | [ ] ⏳
| T4 | 标题生成独立临时会话：`purpose: 'session-title'` 分流到临时 thread，完成后销毁 | feat03 场景3 | packages/codex-cli/src/adapter.ts | None | [x] 🟢
| T5 | 压缩两边同步：Codex 原生压缩后内容全量回传，KMH 覆盖本地历史，游标重置为压缩后状态，压缩后可继续对话 | feat03 场景4 | packages/codex-cli/src/cursor.ts, packages/codex-cli/src/adapter.ts | 高:压缩后基线错位即历史错乱 | [ ] ⏳
| T6 | 分叉与编辑重发：两者都创建新绑定并携带分叉/编辑点前历史（优先 Codex 原生 fork，协议不支持则历史注入首条消息），原绑定保留 | feat03 场景5, 场景6 | packages/codex-cli/src/session-store.ts, packages/codex-cli/src/adapter.ts | 高:fork 语义错误导致历史泄漏到错误会话 | [!] 🔴
| T7 | 原生会话缺失：绑定指向的 thread 恢复失败时返回明确恢复错误（含出路说明），不猜测续投 | feat03 场景7 | packages/codex-cli/src/adapter.ts | None | [x] 🟢
| T8 | 回合结束自动回收：turn 完成/终止后关闭 stdin 并等待进程退出，超时交清理兜底（task-stop-recovery T4） | feat03 场景8 | packages/codex-cli/src/turn.ts, packages/codex-cli/src/connection.ts | None | [x] 🟢
| T9 | unit：绑定读写/损坏容错、压缩覆盖后游标重置、分叉新绑定带历史、缺失错误码 | feat03 场景1, 场景4-7 | tests/runtime/codex-cli.test.mjs | None | [x] 🟢
| T10 | smoke：多轮续聊（含进程重启）、压缩后续聊、fork 后续聊三个基线场景 | feat03 场景1, 场景2, 场景4, 场景5 | tests/runtime/codex-cli.test.mjs | None | [!] 🔴

## 影响文件树

```text
kongming-agent/
├── packages/codex-cli/src/
│   ├── session-store.ts  U  # 新增：绑定与游标持久化、串行控制
│   ├── adapter.ts        M  # 恢复/分流/压缩同步/fork/缺失错误接入
│   ├── cursor.ts         M  # 压缩覆盖后的基线重置
│   ├── turn.ts           M  # 回合结束进程回收
│   └── connection.ts     M  # stdin 关闭与退出等待
└── tests/runtime/codex-cli.test.mjs  M  # 追加：绑定/压缩/fork unit 与三基线 smoke
```
