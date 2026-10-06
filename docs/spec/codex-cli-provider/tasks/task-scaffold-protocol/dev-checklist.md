# task-scaffold-protocol · 开发清单

> spec: docs/spec/codex-cli-provider/spec.md
> 创建: 2026-10-07

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[x] 🟢` 验证通过 / `[!] 🔴` 验证失败

本 task 建立公共契约：包骨架、app-server JSON-RPC 协议层与连接层，供其余全部 task 复用。对仗 `packages/zcode-cli` 的包形态（公开包名 peerDependencies、独立 build.mjs、host/browser 双 tsconfig）。

| # | 任务 | 场景回指 | 涉及文件 | 风险 | 状态 |
|---|---|---|---|---|---|
| T1 | 包骨架：package.json（name `@kmh/codex-cli`、exports `.`/`./client`、peerDependencies 仅公开包名）、build.mjs、tsconfig 三件套、README 骨架 | None | packages/codex-cli/package.json, packages/codex-cli/build.mjs, packages/codex-cli/tsconfig.json, packages/codex-cli/tsconfig.host.json, packages/codex-cli/tsconfig.browser.json | None | [ ] ⏳ |
| T2 | 协议类型：app-server v2 方法与通知的请求/响应类型（initialize、thread/turn、account、model/list），标准输入输出 JSON-RPC 帧编解码（含 Content-Length 头分帧） | None | packages/codex-cli/src/protocol.ts | None | [ ] ⏳ |
| T3 | 连接层：spawn 官方 CLI（`codex app-server --stdio`）、initialize 握手、请求-响应关联、通知分发、断线与进程退出分类；工作目录跟随会话（复用 zcode-cli 的 sessions 查询模式，查不到回落配置 cwd） | None | packages/codex-cli/src/connection.ts | None | [ ] ⏳ |
| T4 | 配置：可执行文件路径（默认 `codex`）、各时限（启动/推理/取消回执/清理）、数据目录 | None | packages/codex-cli/src/config.ts | None | [ ] ⏳ |
| T5 | 主仓注册：package.json 的 build:kmh/typecheck:kmh/lint/format:check filter 列表加入 `@kmh/codex-cli` | None | package.json | None | [ ] ⏳ |
| T6 | unit：帧编解码往返、半包/粘包切分、未知通知容忍、断线错误分类 | None | tests/runtime/codex-cli.test.mjs | None | [ ] ⏳ |

## 影响文件树

```text
kongming-agent/
├── package.json                        M  # 四个 kmh filter 脚本加入 @kmh/codex-cli
├── packages/codex-cli/                 U  # 新增：包骨架（package.json/build.mjs/tsconfig 三件套/README）
│   └── src/
│       ├── protocol.ts                 U  # 新增：JSON-RPC 帧编解码与 app-server 协议类型
│       ├── connection.ts               U  # 新增：CLI 进程连接层（握手/关联/通知/断线）
│       └── config.ts                   U  # 新增：插件配置（可执行路径/时限/数据目录）
└── tests/runtime/codex-cli.test.mjs    U  # 新增：协议层 unit（后续 task 同文件追加）
```
