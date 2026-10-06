# task-detail-page · 开发清单

> spec: docs/spec/codex-cli-provider/spec.md
> 创建: 2026-10-07

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[x] 🟢` 验证通过 / `[!] 🔴` 验证失败

覆盖 feat05（插件详情页）：现有 Web 插件管理区的信息展示、原生工具与技能开关、测试连接与版本提示。依赖 task-account、task-bridge-tools。沿用 zcode-cli 的 `connection.fetch.register` 路由 + ui-plugin-manager 槽位模式（browser-auth 鉴权，不依赖宿主私有改动）。

| # | 任务 | 场景回指 | 涉及文件 | 风险 | 状态 |
|---|---|---|---|---|---|
| T1 | Host 路由：`/api/codex-cli/*`（status/login/cancel/logout/check/config）经 connection.fetch.register 挂载，动作 POST、查询 GET、响应禁缓存 | feat05 场景1 | packages/codex-cli/src/web.ts | 高:账号操作路由，必须复用宿主 browser-auth 鉴权链 | [ ] ⏳ |
| T2 | 详情页 UI：CLI 版本、账号状态、凭据来源、默认模型、推理等级、最近连接测试结果展示与登录/测试连接/退出账号入口 | feat05 场景1 | packages/codex-cli/src/client/index.ts, packages/codex-cli/src/client/DetailCard.tsx, packages/codex-cli/src/client/locales.ts | None | [ ] ⏳ |
| T3 | 原生工具与技能开关：默认关闭（用 KMH 的），切换立即保存显示、当前回合不受影响、下回合生效 | feat05 场景2, feat02 场景3, 场景4 | packages/codex-cli/src/web.ts, packages/codex-cli/src/client/DetailCard.tsx | None | [ ] ⏳ |
| T4 | 测试连接：独立临时会话内用当前模型发短文本请求，成功/失败结果展示并留存"最近结果"，完成后临时会话与进程回收 | feat05 场景3 | packages/codex-cli/src/probe.ts | None | [ ] ⏳ |
| T5 | 版本检查：低于声明最低版本或找不到 CLI 时明确提示与处理指引 | feat05 场景4 | packages/codex-cli/src/status.ts, packages/codex-cli/src/client/DetailCard.tsx | None | [ ] ⏳ |
| T6 | unit：路由方法/动作映射、开关状态读写与持久化、版本比较 | feat05 场景1, 场景2, 场景4 | tests/runtime/codex-cli.test.mjs | None | [ ] ⏳ |
| T7 | e2e：真实浏览器完成打开详情页→登录态展示→开关切换→测试连接→失败提示全流程 | feat05 场景1-4 | tests/runtime/codex-cli.test.mjs | None | [ ] ⏳ |

## 影响文件树

```text
kongming-agent/
├── packages/codex-cli/
│   ├── src/web.ts                      U  # 新增：账号/配置路由（browser-auth 鉴权链）
│   ├── src/probe.ts                    U  # 新增：独立临时会话的连接测试
│   ├── src/status.ts                   U  # 新增：CLI 版本检查与最低版本声明
│   └── src/client/
│       ├── index.ts                    U  # 新增：详情页槽位挂载
│       ├── DetailCard.tsx              U  # 新增：信息展示/开关/按钮
│       └── locales.ts                  U  # 新增：中英文案
└── tests/runtime/codex-cli.test.mjs    M  # 追加：路由/开关 unit 与浏览器 e2e
```
