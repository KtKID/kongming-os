# task-native-progress · 开发清单

> spec: docs/spec/codex-cli-provider/spec.md
> 创建: 2026-10-07

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[x] 🟢` 验证通过 / `[!] 🔴` 验证失败

覆盖 feat08（查看原生工具实时进度）：app-server 结构化通知透传为独立观察记录（不触发 KMH 工具执行）、持久化与对话卡片展示。可观察的原生事件依赖 task-native-tool-selection 开放对应工具后才产生，T1 扩展点调查可先行。D14：过程输出分批合并限体积，base64 媒体走附件，凭据与原始传输头留在专有层；若公开能力缺失先记录缺口与宿主版本要求。

| # | 任务 | 场景回指 | 涉及文件 | 风险 | 状态 |
|---|---|---|---|---|---|
| T1 | 公开扩展点调查：会话持久事件（旧宿主 ignorable 兼容语义）与对话视图注册（ui-conversation assembly/view-registry）的能力边界；缺口与宿主版本要求记入 decisions.md | None | docs/spec/codex-cli-provider/decisions.md | None | [x] 🟢 |
| T2 | 观察记录模型与持久化：按 session/thread/turn/item 关联的单次执行记录，重复事件归并到原记录、过程输出分批合并并限制体积、刷新/重启后可重读 | feat08 场景4, 场景5 | packages/codex-cli/src/native-items.ts, packages/codex-cli/src/index.ts | 高:新增持久事件的旧宿主读取兼容处理不当会破坏会话日志可读性 | [x] 🟢 |
| T3 | 通知接入：item 生命周期（started/completed）、`item/commandExecution/outputDelta`、`turn/diff/updated`、`item/mcpToolCall/progress` 及其余 item 的实际可用信息映射为观察记录 | feat08 场景1, 场景2 | packages/codex-cli/src/protocol.ts, packages/codex-cli/src/turn.ts | None | [x] 🟢 |
| T4 | 对话卡片展示：工具来源、操作摘要、执行中与已等待时间、命令输出增量、文件变更内容与结果；仅提供开始/结束信息时按已收到信息展示（图片生成等待态）；客户端组件形态随 T1 扩展点定位 | feat08 场景1, 场景2, 场景3 | packages/codex-cli/src/client/ | None | [x] 🟢 |
| T5 | 失败/停止/待确认：执行失败显示原因，停止与连接中断分别显示停止或待确认（缺结束确认），已有输出保留 | feat08 场景6 | packages/codex-cli/src/turn.ts, packages/codex-cli/src/native-items.ts | None | [x] 🟢 |
| T6 | unit：通知解析、归并去重、体积限制、记录恢复读取与待确认状态 | feat08 场景4, 场景5 | tests/runtime/codex-cli.test.mjs | None | [x] 🟢 |
| T7 | smoke：fixture 或真实 CLI 回合的通知序列落记录、同调用增量合并、重启后读取 | feat08 场景1, 场景4, 场景5 | tests/runtime/codex-cli.test.mjs | None | [x] 🟢 |

## 影响文件树

```text
kongming-agent/
├── packages/codex-cli/src/
│   ├── native-items.ts              U  # 新增：叙述投影（开头/收尾/待确认文案、体积与 diff 账目）
│   ├── protocol.ts                  M  # 命令输出增量、turn diff、MCP progress 通知 schema与方法名
│   └── turn.ts                      M  # 通知接入叙述块（开启/增量/收尾/未决补记），reopen 重置账目
├── tests/runtime/codex-cli.test.mjs M  # 追加：叙述 unit 与注入通知的真实 CLI smoke
├── tests/runtime/fixtures/codex-fixture-server.mjs  M  # delayedText 脚本：响应延迟给注入窗口
└── docs/spec/codex-cli-provider/decisions.md  M  # D19：v1 形态拍板与宿主缺口记录
```

## 实施记录（2026-10-07）

- T1 结论见 decisions D19：宿主无公开持久事件/扩展块通道（`Session.append` 写不了
  `ignorable`，自定义事件会破坏旧宿主会话重载），v1 采用叙述文本块形态，卡片形态的
  宿主版本要求已记录。
- T2/T4 按 v1 形态落地：观察记录=助手消息内独立文本块（随会话历史持久、刷新/重开可查、
  差分账目自动吞掉不重投）；同调用增量合并进同一块，单条 8000 字符上限截断标注；
  "已等待时间"以完成时的 durationMs 呈现（无实时 tick，v1 偏差）。
- T5：回合终局未收尾的调用补"待确认"并闭合（diff 摘要块除外，常规闭合）；已有输出保留。
- T7 smoke：delayedText fixture 在模型响应前开注入窗口，真实 CLI 处理注入的
  started→outputDelta×2→diff→completed 序列，断言叙述全链路（来源/命令/增量/diff 摘要/
  退出码）与 block-end 全文权威内容，且不干扰正文。
- 验证：typecheck/lint 通过；41/41 全绿（既有 smoke 无回归）。真实原生命令的叙述
  （模型自发执行）归 task-mixed-e2e 真机验收。
```
