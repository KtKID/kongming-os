# task-minimal-init · 开发清单

> spec: docs/spec/kmh-zcode-cli-request-supervision/spec.md
> 创建: 2026-10-06

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[x] 🟢` 验证通过 / `[!] 🔴` 验证失败

| # | 任务 | 场景回指 | 涉及文件 | 风险 | 状态 |
|---|---|---|---|---|---|
| T1 | 逐项验证已安装 CLI 的最小启动参数（插件、外部工具服务、钩子、记忆写入、调度、工具执行入口的官方关闭方式，如 `--no-plugins` 与相关配置字段），能力清单入请求记录 | feat08 场景1 | packages/zcode-cli/src/minimal-init.ts, packages/zcode-cli/src/runtime.ts, packages/zcode-cli/src/config.ts | 高:官方关闭开关仅逆向发现未经真机验证 | [ ] ⏳ |
| T2 | 多余组件检测：初始化事件中插件数、外部工具服务数、钩子数非零时拒绝启动并显示"初始化包含多余组件" | feat08 场景2 | packages/zcode-cli/src/minimal-init.ts, packages/zcode-cli/src/supervisor.ts, tests/runtime/zcode-cli.test.mjs | None | [ ] ⏳ |
| T3 | 版本不支持：当前 CLI 版本无法关闭全部多余组件时显示最小运行模式不可用的原因，不静默降级 | feat08 场景3 | packages/zcode-cli/src/minimal-init.ts, packages/zcode-cli/src/status.ts | None | [ ] ⏳ |
| T4 | smoke：真实已安装 CLI 以最小参数启动，核对额外插件数、MCP 服务数、钩子数为零 | feat08 场景1 | tests/runtime/fixtures/zcode-cli/ | 高:真实产物行为与逆向结论可能有偏差 | [ ] ⏳ |
| T5 | README 同步：最小运行配置的参数、验证方法与降级行为说明 | None | packages/zcode-cli/README.md | None | [ ] ⏳ |

## 影响文件树

```text
kongming-agent/
├── packages/zcode-cli/src/
│   ├── minimal-init.ts            U  # 新增：最小启动参数解析、多余组件检测、版本能力结论
│   ├── runtime.ts                 M  # 启动路径接入最小配置与检测
│   ├── config.ts                  M  # 最小运行相关配置项
│   └── status.ts                  M  # 最小模式不可用状态
├── tests/runtime/
│   ├── zcode-cli.test.mjs         M  # 多余组件拒绝、版本不可用测试
│   └── fixtures/zcode-cli/cli.mjs M  # 模拟带插件/MCP 初始化与能力清单的 fixture 模式
└── packages/zcode-cli/README.md   M  # 最小运行配置说明
```
