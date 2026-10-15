# task-embed-panel · 开发清单

> spec: docs/spec/mademe-plugin-v0.1/spec.md
> 创建: 2026-10-12
> 修正: T2 实验结论为降级（WebKit 搬移 iframe 必重载），保活池取消，spec feat02 场景2 已回写

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[x] 🟢` 验证通过 / `[!] 🔴` 验证失败

| # | 任务 | 场景回指 | 涉及文件 | 风险 | 状态 |
|---|---|---|---|---|---|
| T1 | URL 校验复用：normalizeHttpUrl（含 hostname 显式校验）已由 task-config-form 落地 | feat02 场景1 | packages/kmh-mademe/src/config.ts | None | [x] 🟢 |
| T2 | 保活可行性实验：独立实验页（计时 iframe 入池/搬回三轮）——**结论：WebKit 系 webview 同步搬移 iframe 必定重载（计时归零），保活池不成立；按 tech-design §8-1 降级为"切回按当前地址重载"**，spec 已回写 | feat02 场景2 | 实验临时文件（/tmp，不入库） | None | [x] 🟢 |
| T3 | iframe 宿主：DSH sandbox 策略 + no-referrer + 超时提示（8 秒无 load 提示"可能无法内嵌打开"）；保活池取消（面板卸载即销毁） | feat02 场景1, 场景4 | packages/kmh-mademe/src/client/MadeMePanel.tsx | None | [x] 🟢 |
| T4 | 正式面板：工具栏（刷新、在系统浏览器打开、地址只读展示）+ iframe 视口 + waitingConfig 态 | feat02 场景1, 场景4 | packages/kmh-mademe/src/client/MadeMePanel.tsx, packages/kmh-mademe/src/client/locales.ts | None | [x] 🟢 |
| T5 | 地址来自配置：main 面板注入 serviceUrlStore（configForms scope 订阅投影），保存后热生效 | feat02 场景5 | packages/kmh-mademe/src/client/index.ts, packages/kmh-mademe/src/client/MadeMePanel.tsx | None | [x] 🟢 |
| T6 | 登录隔离与跨刷新实测：对真实 MadeMe 服务（127.0.0.1:30000）验证登录独立、刷新后仍登录 | feat02 场景3 | 无（验证行） | None | [x] 🟢 |
| T7 | 实浏览器验收：feat02 全场景走查（打开/切回重载/登录/打不开提示/改地址） | feat02 场景1, 场景2, 场景3, 场景4, 场景5 | 无（验证行） | None | [x] 🟢 |

## 影响文件树

```text
kongming-agent-os/
└── packages/kmh-mademe/
    ├── src/client/MadeMePanel.tsx        U  # 新增：正式内嵌面板（工具栏/iframe/超时提示/serviceUrl face）
    ├── src/client/index.ts               M  # main 面板注入 serviceUrlStore（configForms 订阅投影）
    └── src/client/locales.ts             M  # 面板文案（waitingConfig/刷新/外部打开/超时提示）
```
