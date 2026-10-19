# task-distribution · 开发清单

> spec: docs/spec/aggregated-token-analysis-view-v0.1/spec.md
> tech-design: docs/spec/aggregated-token-analysis-view-v0.1/tech-design.md
> 创建: 2026-10-18

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[x] 🟢` 验证通过 / `[!] 🔴` 验证失败

前置：task-sidebar-panel-config 全部通过。

| # | 任务 | 场景回指 | 涉及文件 | 风险 | 状态 |
|---|---|---|---|---|---|
| T1 | 包 README：装上后要改什么（只有页面地址，指向 x-token 部署在别处时改 `pageUrl`）、两个配置项的语义与默认值、页面打不开时的表现与处理、已知限制与维护归属；写明维护边界——本插件是打开网页的壳，不读取、解析或改写页面内容，x-token 升级页面不需要改本插件（C1；D05） | None | packages/aggregated-token-analysis/README.md | None | [x] 🟢 |
| T2 | 文档登记：插件索引自有包表加一行指向包 README；spec 索引更新本 spec 状态（D05） | None | docs/kmh/plugin-index.md, docs/spec/README.md | None | [x] 🟢 |
| T3 | 仓库根全套检查与 Web 挂载核对：`pnpm install`、`build:kmh`、`typecheck:kmh`、`lint`、`format:check`、`test` 全绿；`pnpm web` 启动后插件已挂载，侧栏出现"Token 分析"入口，插件详情页能看到两个配置项（D05；用例 T2、T6 的最终回归） | None | — | None | [x] 🟢 |

## 影响文件树

```text
kongming-os/
├── packages/aggregated-token-analysis/README.md  U  # 新增：装完要改什么、失败处理、C1 维护边界与维护归属
├── docs/kmh/plugin-index.md  M  # 自有包清单加一行指向本包 README
└── docs/spec/README.md       M  # spec 索引更新状态为任务拆解完成/开发完成
```
