# task-stop-chain · 开发清单

> spec: docs/spec/kmh-zcode-cli-request-supervision/spec.md
> 创建: 2026-10-06

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[x] 🟢` 验证通过 / `[!] 🔴` 验证失败

| # | 任务 | 场景回指 | 涉及文件 | 风险 | 状态 |
|---|---|---|---|---|---|
| T1 | fixture CLI 实现 `workspace/cancelGenerateText`（匹配在途请求返回 `cancelled:true` 并中止、未知编号返回 `cancelled:false`） | None | tests/runtime/fixtures/zcode-cli/cli.mjs | None | [x] 🟢 |
| T2 | 停止操作：接收即持久记录并立即返回"正在停止"，关闭该轮执行授权，经官方取消通道发送取消（独立短时限控制信号，默认 1 秒） | feat02 场景1 | packages/zcode-cli/src/supervisor.ts, packages/zcode-cli/src/runtime.ts, tests/runtime/zcode-cli.test.mjs | 高:停止与在途请求的竞态 | [x] 🟢 |
| T3 | 回执分类：`cancelled:true/false` 与 generateText 落定交叉复核——已落定记"取消时请求已完成"，未落定且进程存活记通道不一致并升级清理，未落定且进程退出记"模型通道提前退出" | feat02 场景2 | packages/zcode-cli/src/supervisor.ts, tests/runtime/zcode-cli.test.mjs | 高:回执与请求落定的竞态 | [ ] ⏳ |
| T4 | 回收确认：复用底座 TERM/宽限/KILL 后以受管范围清空确认发布"本机任务已停止"；确认时限（默认 5 秒）到达仍未清空则记"停止状态待确认"并保持会话挂起 | feat02 场景1, 场景3 | packages/zcode-cli/src/supervisor.ts, packages/zcode-cli/src/runtime.ts, tests/runtime/zcode-cli.test.mjs | 高:进程回收不可逆且有时限 | [ ] ⏳ |
| T5 | 晚到结果：停止生效后到达的模型文本或工具调用不执行任何操作，处置记录按请求保存 | feat02 场景4 | packages/zcode-cli/src/supervisor.ts, packages/zcode-cli/src/runtime.ts, tests/runtime/zcode-cli.test.mjs | None | [ ] ⏳ |
| T6 | unit：两会话并发请求，停止其一仅回收目标请求，另一请求正常完成 | feat02 场景5 | tests/runtime/zcode-cli.test.mjs | None | [ ] ⏳ |
| T7 | 停止按钮两段式状态：点击立即变"正在停止"，随确认链路落定为"本机任务已停止"或"停止状态待确认" | feat02 场景1, 场景3 | packages/zcode-cli/src/client/index.ts, packages/zcode-cli/src/client/locales.ts, third_party/dsh/packages/client/ui-conversation/src/client/stop-sequence.ts | None | [ ] ⏳ |
| T8 | smoke：真实已安装 CLI 的原生取消真实往返（接受取消、忽略取消两路），校准回执时限 | feat02 场景2 | tests/runtime/fixtures/zcode-cli/ | 高:官方产物取消行为仅逆向确认未实测 | [ ] ⏳ |

## 影响文件树

```text
kongming-agent/
├── packages/zcode-cli/src/
│   ├── supervisor.ts              M  # 停止链路：授权关闭、取消发送、回执分类、回收确认、晚到结果
│   ├── runtime.ts                 M  # generate 拆出可中途取消的结构，停止路径先走官方取消
│   └── client/index.ts, locales.ts  M  # 停止按钮两段式状态与文案
├── tests/runtime/
│   ├── zcode-cli.test.mjs         M  # 停止链路各分支与并发隔离测试
│   └── fixtures/zcode-cli/cli.mjs M  # cancelGenerateText 两路回执与可中止在途请求
└── third_party/dsh/packages/client/ui-conversation/src/client/stop-sequence.ts  M  # 停止按钮状态流转对接（落点以调查为准）
```
