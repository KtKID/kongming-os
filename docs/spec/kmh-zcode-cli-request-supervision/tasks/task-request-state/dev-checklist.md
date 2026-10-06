# task-request-state · 开发清单

> spec: docs/spec/kmh-zcode-cli-request-supervision/spec.md
> 创建: 2026-10-06

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[x] 🟢` 验证通过 / `[!] 🔴` 验证失败

| # | 任务 | 场景回指 | 涉及文件 | 风险 | 状态 |
|---|---|---|---|---|---|
| T1 | 请求监督器数据模型：每请求独立记录（请求身份、阶段、各时间字段、尝试次数、终止原因、清理结果），多请求并发跟踪；账号维度状态保留在现有全局 state | None | packages/zcode-cli/src/supervisor.ts, packages/zcode-cli/src/runtime.ts | 高:多会话并发请求的状态跟踪 | [x] 🟢 |
| T2 | 终止原因分类：信号源分开监听、保留首个生效原因；总超时、用户停止、启动超时、提供方错误、通道提前退出、宿主卸载、清理失败各自归类，清理错误作独立信息追加 | feat04 场景1, 场景2, 场景3 | packages/zcode-cli/src/runtime.ts, tests/runtime/zcode-cli.test.mjs | None | [x] 🟢 |
| T3 | 阶段与进度事件：启动模型通道、等待模型回复、第 N 次尝试、慢请求提示（默认 30 秒可配置）、未知阶段回落"等待模型回复" | feat01 场景1, 场景2, 场景3, 场景4 | packages/zcode-cli/src/supervisor.ts, packages/zcode-cli/src/runtime.ts, packages/zcode-cli/src/config.ts, tests/runtime/zcode-cli.test.mjs | None | [x] 🟢 |
| T4 | 状态对外通道：按请求的状态查询与事件推送挂到已认证 Web 路由 | feat01 场景1 | packages/zcode-cli/src/web.ts | None | [x] 🟢 |
| T5 | 会话视图状态展示：插件客户端组件渲染"启动模型通道""等待模型回复""第 2 次尝试"与慢请求提示；先定位 DSH 会话视图可挂载的状态位（ui-conversation 停止链路附近），无现成插槽则按 ui-slots 声明机制新增 | feat01 场景1, 场景3 | packages/zcode-cli/src/client/index.ts, packages/zcode-cli/src/client/locales.ts, third_party/dsh/packages/client/ui-conversation/src/client/stop-sequence.ts | None | [x] 🟢 |
| T6 | unit：两请求并发时阶段与原因互不覆盖（fixture 双请求） | feat01 场景1 | tests/runtime/zcode-cli.test.mjs | None | [x] 🟢 |

## 影响文件树

```text
kongming-agent/
├── packages/zcode-cli/src/
│   ├── supervisor.ts              U  # 新增：按请求的监督器（状态、阶段事件、时间字段）
│   ├── runtime.ts                 M  # 接入监督器；信号源分开监听并归类终止原因
│   ├── config.ts                  M  # 新增慢请求提示等可配置项
│   ├── web.ts                     M  # 挂按请求状态查询与事件推送路由
│   └── client/index.ts, locales.ts  M  # 会话视图状态组件与文案
├── tests/runtime/
│   ├── zcode-cli.test.mjs         M  # 阶段、原因分类、并发覆盖测试
│   └── fixtures/zcode-cli/cli.mjs M  # 支持双请求与阶段推进的 fixture 模式
└── third_party/dsh/packages/client/ui-conversation/src/client/stop-sequence.ts  M  # 定位会话内状态挂载点（无插槽则改走 ui-slots 声明，落点以调查为准）
```
