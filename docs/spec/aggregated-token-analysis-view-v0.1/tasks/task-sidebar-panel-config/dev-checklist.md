# task-sidebar-panel-config · 开发清单

> spec: docs/spec/aggregated-token-analysis-view-v0.1/spec.md
> tech-design: docs/spec/aggregated-token-analysis-view-v0.1/tech-design.md
> 创建: 2026-10-18

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[x] 🟢` 验证通过 / `[!] 🔴` 验证失败

前置：task-package-skeleton 全部通过（骨架、登记与最小入口已就位，Web 能加载本插件）。

| # | 任务 | 场景回指 | 涉及文件 | 风险 | 状态 |
|---|---|---|---|---|---|
| T1 | 侧栏入口与中心面板注册：面板 id 用品牌化字符串 `token-analysis`、`sidebar.panellist` 与 `main` 两个槽、`order: 12`、图标 `IconDataOutlineRegular`、中英词典（标签"Token 分析"/"Token Analysis"）；不做选中态镜像与刷新恢复。先写假上下文下的注册单测并确认失败再实现（D02；用例 T2 的槽名与注入断言在单测层先行，unit） | feat01 场景1, 场景2 | packages/aggregated-token-analysis/src/client/index.ts, packages/aggregated-token-analysis/src/client/TokenAnalysisIcon.tsx, packages/aggregated-token-analysis/src/client/locales.ts, packages/aggregated-token-analysis/test/token-analysis-client.test.mjs | None | [x] 🟢 |
| T2 | 面板组件与配置投影：注册侧把 `pageUrl` 与 `pageLoadTimeoutMs` 投影成 `PageTargetState` 快照（三条就绪条件）；面板只有内嵌视口，无工具栏；配置未就绪居中加载态；超时取快照值，超时后显示"页面可能无法打开"、可能原因与正在尝试的地址；`iframe` 的 `key` 只取地址，切回按当前地址重载；组件内不出现任何读取或解析页面内容的代码（C1、C2、C5；D03；用例 T4、T5 的组件侧） | feat02 场景1, 场景2, 场景3, 场景4, 场景5 | packages/aggregated-token-analysis/src/client/index.ts, packages/aggregated-token-analysis/src/client/TokenAnalysisPanel.tsx, packages/aggregated-token-analysis/src/client/styles.ts, packages/aggregated-token-analysis/test/token-analysis-client.test.mjs | None | [x] 🟢 |
| T3 | 配置表单：controller 两种字段规格（地址走 `normalizeHttpUrl` 规范化与拦截；数值要求不小于 1 的整数，与 schema 的 `min(1)` 对齐）；表单复用 `SettingsForm` + 两个 `SettingsValueField`，同时挂插件详情页与组件行详情两处槽；非法地址与非法数值在字段旁原位提示且不保存（C5、C6；D04；用例 T6 的表单侧） | feat03 场景1, 场景2 | packages/aggregated-token-analysis/src/client/config-controller.ts, packages/aggregated-token-analysis/src/client/ConfigForm.tsx, packages/aggregated-token-analysis/src/client/index.ts, packages/aggregated-token-analysis/src/client/locales.ts | 高:配置持久化写入 profile 的 Cordis patch，错值会影响 Web 下次启动，验证不能只有 unit | [x] 🟢 |
| T4 | 界面规范落实：只用 ui-primitives 现成件（`SettingsForm`、`SettingsValueField`、`StateDot`）与现有图标库，样式以 `token-analysis-` 前缀注入、颜色与间距取 `--dsw-*` 主题变量、字重不超过 500，浅深两色可读，字段校验留原位、面板加载态居中（C6；D07；用例 T8） | feat01 场景1, feat02 场景1, feat03 场景1 | packages/aggregated-token-analysis/src/client/TokenAnalysisIcon.tsx, packages/aggregated-token-analysis/src/client/TokenAnalysisPanel.tsx, packages/aggregated-token-analysis/src/client/ConfigForm.tsx, packages/aggregated-token-analysis/src/client/styles.ts | None | [x] 🟢 |
| T5 | 冒烟扩展与 C5 门禁：产物含 `sidebar.panellist`、`pageUrl`、`pageLoadTimeoutMs`；**不含** `schemastery`、`8000`、`8e3`、`60010`、`_svc/x-token`、`:active`；源码里 `8000`、`60010`、`_svc/x-token` 只出现在 `src/config.ts`（C5；D06；用例 T2，smoke） | None | packages/aggregated-token-analysis/test/token-analysis-smoke.test.mjs | None | [x] 🟢 |
| T6 | 浏览器验证——入口与面板：入口可见、排在 Infra 之后、收起态悬停提示、点击切主区并高亮；停用后入口消失且主区回到会话，重新启用后入口回来；页面按配置地址加载且没有工具栏、切回会话再回来重新加载、改地址保存后按新地址加载、不可达时按**当前配置的**超时出提示且提示带地址，改超时值后出提示的时间随之变化（C2、C4、C5；用例 T3、T4，e2e） | feat01 场景1, 场景2, 场景3, feat02 场景1, 场景2, 场景3, 场景4 | — | None | [ ] ▶️ |
| T7 | 浏览器验证——配置与隔离：详情页两个字段可见带默认值、改超时为 2500 保存刷新读回 2500 并在 profile patch 里看到覆盖条目、非法地址原位提示且不落盘、原地址继续有效；停用再启用后两个字段仍是停用前的值；停掉 x-token 后从头启动 Web，会话、MadeMe 与 Infra 照常，只有本面板出提示，日志无本插件加载错误（C3、C4、C5；用例 T6、T7，e2e） | feat02 场景3, feat03 场景1, 场景2, 场景3 | — | None | [ ] ▶️ |
| T8 | 内容无关核对：逐文件审查浏览器半，确认没有读取 `iframe` 内容、解析 token 数据或按页面内容分支的代码；把地址临时改成另一张本机网页（如 x-dash 的 `http://127.0.0.1:60010`）保存后点开，面板原样显示它、无需重建或重启；据此确认 x-token 升级页面内容后 KMH 不需改动（C1；D03；用例 T5，审查 + e2e） | feat02 场景1, 场景5 | — | None | [ ] ▶️ |

## 影响文件树

```text
kongming-os/
└── packages/aggregated-token-analysis/
    ├── src/client/index.ts                 M  # 注册侧栏条目、中心面板与两处配置表单槽；投影 PageTargetState；不接 layout
    ├── src/client/TokenAnalysisIcon.tsx    U  # 新增：按侧栏请求边长渲染 IconDataOutlineRegular
    ├── src/client/TokenAnalysisPanel.tsx   U  # 新增：内嵌视口、居中加载态、超时提示（含地址）；无工具栏
    ├── src/client/config-controller.ts     U  # 新增：地址与正整数两种字段规格，桥接共享表单
    ├── src/client/ConfigForm.tsx           U  # 新增：SettingsForm + 两个 SettingsValueField
    ├── src/client/locales.ts               U  # 新增：面板名、提示与配置文案的中英词典
    ├── src/client/styles.ts                U  # 新增：token-analysis- 前缀样式，取 --dsw-* 变量
    ├── test/token-analysis-client.test.mjs U  # 新增：假上下文下的注册、注入声明与配置投影行为单测
    └── test/token-analysis-smoke.test.mjs  M  # 扩展：槽名与配置键存在；schema、默认值与地址字面量不进产物；源码默认值只在 config.ts
```
