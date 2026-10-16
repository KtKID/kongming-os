# task-distribution · 开发清单

> spec: docs/spec/kmh-infra-plugin-v0.1/spec.md
> tech-design: docs/spec/kmh-infra-plugin-v0.1/tech-design.md
> 创建: 2026-10-16

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[x] 🟢` 验证通过 / `[!] 🔴` 验证失败

| # | 任务 | 场景回指 | 涉及文件 | 风险 | 状态 |
|---|---|---|---|---|---|
| T1 | 包 README：说清装上后必须改什么（Python 位置、x-infra-mcp 所在目录）、暗号怎么给（启动前设进环境，写的是变量名）、已知限制与维护归属（C1；D06） | feat05 场景1 | packages/kmh-infra/README.md | None | [x] 🟢 |
| T2 | 文档登记：插件索引加一行指向包 README，spec 索引加一行指向本次 spec（D06） | None | docs/kmh/plugin-index.md, docs/spec/README.md | None | [x] 🟢 |
| T3 | 分发与启停验证：按使用者视角填好本机情况后入口、面板与助手三处一起可用；停用后入口与助手能力一起消失、面板退出主区、已填配置保留；重新启用后三者恢复且配置仍是停用前的内容（C4、C11；D06；用例 T7，e2e） | feat05 场景1, 场景2, 场景3 | — | None | [x] 🟢 |
| T4 | 仓库根检查与热重载回归：`pnpm install`、`build:kmh`、`typecheck:kmh`、`lint`、`format:check`、`test` 全绿；Web 启动后插件已挂载，侧栏出现入口，插件详情页能看到全部配置项（D06；用例 T11） | feat05 场景1 | tests/runtime/web-plugin-hmr.test.mjs | None | [x] 🟢 |
| T5 | 进程治理验证：连续改地址或切换接入开关五次后，该查询服务进程数不累积；停用插件后归零（C12；D02；用例 T17，e2e） | feat05 场景2, 场景3 | — | 高:子进程残留属本机资源泄漏，验证必须用进程数序列而非单次观察 | [x] 🟢 |

## 影响文件树

```text
kongming-os/
├── packages/kmh-infra/README.md       U  # 新增：装完要改什么、暗号怎么给、限制与维护归属
├── docs/kmh/plugin-index.md           M  # 自有包清单加一行指向本包 README
├── docs/spec/README.md                M  # spec 索引加一行指向 kmh-infra-plugin-v0.1
└── tests/runtime/web-plugin-hmr.test.mjs M # 仅在热重载回归暴露问题时修正包名单或断言
```
