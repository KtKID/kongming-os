# task-sidebar-and-panel · 开发清单

> spec: docs/spec/kmh-infra-plugin-v0.1/spec.md
> tech-design: docs/spec/kmh-infra-plugin-v0.1/tech-design.md
> 创建: 2026-10-16

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[x] 🟢` 验证通过 / `[!] 🔴` 验证失败

| # | 任务 | 场景回指 | 涉及文件 | 风险 | 状态 |
|---|---|---|---|---|---|
| T1 | 侧栏入口与中心面板注册：面板 id 用品牌化字符串、`sidebar.panellist` 与 `main` 两个槽、图标与名字文案、中英词典（D03、D11；用例 T4，unit） | feat01 场景1, 场景2 | packages/kmh-infra/src/client/index.ts, packages/kmh-infra/src/client/InfraIcon.tsx, packages/kmh-infra/src/client/locales.ts, packages/kmh-infra/test/infra-client.test.mjs | None | [x] 🟢 |
| T2 | 选中态镜像与刷新恢复：选中时落标记、切走清除、卸载时清残留、刷新后微任务恢复选中且失败只告警（D03；用例 T4，unit） | feat01 场景3, 场景4 | packages/kmh-infra/src/client/index.ts, packages/kmh-infra/test/infra-client.test.mjs | None | [x] 🟢 |
| T3 | 面板组件：内嵌视口、工具栏（当前地址、刷新、在系统浏览器打开）、地址取自配置投影快照、切走卸载切回重载、面板内登录与会话互不影响（D04；用例 T5） | feat02 场景1, 场景2, 场景4, 场景5 | packages/kmh-infra/src/client/InfraPanel.tsx, packages/kmh-infra/src/client/styles.ts | None | [x] 🟢 |
| T4 | 加载超时与打不开提示：超时阈值取配置（不写死）、未加载出来时的提示文案与系统浏览器兜底按钮（C6；D04；用例 T5） | feat02 场景3 | packages/kmh-infra/src/client/InfraPanel.tsx, packages/kmh-infra/src/client/styles.ts | None | [x] 🟢 |
| T5 | 界面规范落实：复用 ui-primitives 组件与现有图标、颜色与间距取主题 token、功能样式字重不超过 500、深浅两色都可读、反馈位置正确（C7；D11；用例 T12） | feat01 场景1, 场景2, feat02 场景1 | packages/kmh-infra/src/client/InfraIcon.tsx, packages/kmh-infra/src/client/InfraPanel.tsx, packages/kmh-infra/src/client/styles.ts | None | [x] 🟢 |
| T6 | 冒烟扩展：浏览器半产物含面板 id 与四个注入服务（D06；用例 T2） | None | packages/kmh-infra/test/infra-smoke.test.mjs | None | [x] 🟢 |
| T7 | 浏览器验证：入口可见与悬停提示、点击切主区并高亮、刷新后恢复；面板按配置地址加载、切走再回来重新加载、改地址后按新地址加载、不可达时按配置的超时出提示且兜底按钮始终可点（用例 T4、T5、T12，e2e） | feat01 场景1, 场景2, 场景3, 场景4, feat02 场景1, 场景2, 场景3, 场景4, 场景5 | — | None | [x] 🟢 |

## 影响文件树

```text
kongming-os/
└── packages/kmh-infra/
    ├── src/client/index.ts           M  # 注册侧栏条目与中心面板，接配置投影，维护选中态与刷新恢复
    ├── src/client/InfraIcon.tsx      U  # 新增：按侧栏请求边长渲染图标
    ├── src/client/InfraPanel.tsx     U  # 新增：内嵌视口、工具栏、超时提示与兜底按钮
    ├── src/client/locales.ts         U  # 新增：面板名与界面文案的中英词典
    ├── src/client/styles.ts          U  # 新增：面板样式（类名前缀、主题 token）
    ├── test/infra-smoke.test.mjs     M  # 断言产物含面板 id、注入服务与配置驱动的地址
    └── test/infra-client.test.mjs    U  # 新增：假上下文下的注册、选中态镜像与刷新恢复行为测试
```
