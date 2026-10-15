# task-plugin-shell · 开发清单

> spec: docs/spec/mademe-plugin-v0.1/spec.md
> 创建: 2026-10-12

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[x] 🟢` 验证通过 / `[!] 🔴` 验证失败

| # | 任务 | 场景回指 | 涉及文件 | 风险 | 状态 |
|---|---|---|---|---|---|
| T1 | 包骨架与构建：package.json（@kmh/mademe，exports `.`/`./client`，`dsh.client{inject,platform:'web'}`，`dsh.bundle.patch`，peerDependencies，scripts）、tsc 双 tsconfig（host/browser references）+ esbuild client 打包、空宿主 apply、浏览器 apply 骨架 | None | packages/kmh-mademe/package.json, packages/kmh-mademe/build.mjs, packages/kmh-mademe/tsconfig.json, packages/kmh-mademe/tsconfig.host.json, packages/kmh-mademe/tsconfig.browser.json, packages/kmh-mademe/src/index.ts, packages/kmh-mademe/src/client/index.ts | None | [x] 🟢 |
| T2 | 根脚本接入：build:kmh / typecheck:kmh / lint / format:check 的 filter 列表与 test 脚本追加本包 | None | package.json | None | [x] 🟢 |
| T3 | bundle 接入：bundle patch 声明插件条目；kmh-web profile 以 link 依赖 + dsh.profile.bundles 启用 | None | packages/kmh-mademe/cordis.patch.yml, profiles/kmh-web/package.json | None | [x] 🟢 |
| T4 | 侧栏图标行注册：`sidebar.panellist`（id=PANEL_ID、order、label）+ MadeMeIcon + zh/en 词典 | feat01 场景1, 场景2 | packages/kmh-mademe/src/client/index.ts, packages/kmh-mademe/src/client/MadeMeIcon.tsx, packages/kmh-mademe/src/client/locales.ts | None | [x] 🟢 |
| T5 | 中心面板注册：`main` keyed 槽（key=PANEL_ID）挂占位面板（正式面板归 task-embed-panel），点击图标切换选中 | feat01 场景1 | packages/kmh-mademe/src/client/index.ts, packages/kmh-mademe/src/client/MadeMePanel.tsx | None | [x] 🟢 |
| T6 | 停用即消失与归位：停用/卸载插件后入口消失、主区回会话（retainMainPanels 免费行为验证） | feat01 场景3 | 无（验证行，机制免费） | None | [x] 🟢 |
| T7 | 刷新恢复选中：panelInfo 订阅写 localStorage 标记，apply 启动时恢复 selectPanel；卸载清理残留标记 | feat01 场景4 | packages/kmh-mademe/src/client/index.ts | None | [x] 🟢 |
| T8 | 实浏览器验收：pnpm web（60002 端口沙箱）走查入口展示、悬停提示、停用消失、刷新恢复 | feat01 场景1, 场景2, 场景3, 场景4 | 无（验证行） | None | [x] 🟢 |

## 影响文件树

```text
kongming-agent-os/
├── package.json                                    M  # 四个 filter 列表与 test 脚本追加 @kmh/mademe
├── profiles/kmh-web/package.json                   M  # link 依赖 + dsh.profile.bundles 追加 @kmh/mademe
└── packages/kmh-mademe/
    ├── package.json                                U  # 新增：包声明、exports 双入口、dsh.client/dsh.bundle 元数据
    ├── tsconfig.json                               U  # 新增：tsc 双入口构建配置
    ├── cordis.patch.yml                            U  # 新增：bundle patch，insert kmh-mademe 条目
    ├── src/index.ts                                U  # 新增：宿主半空 apply（接线归 task-config-form）
    └── src/client/
        ├── index.ts                                U  # 新增：浏览器半 apply、面板/图标注册、刷新恢复
        ├── MadeMeIcon.tsx                          U  # 新增：侧栏图标组件
        └── locales.ts                              U  # 新增：zh/en 词典
```
