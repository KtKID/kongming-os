# task-account · 开发清单

> spec: docs/spec/codex-cli-provider/spec.md
> 创建: 2026-10-07

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[x] 🟢` 验证通过 / `[!] 🔴` 验证失败

覆盖 feat04（官方账号登录与退出）。凭据由官方 CLI 保存与刷新，插件只读状态与转发操作；登录状态纯本地凭据判定，不发起请求验证。依赖 task-scaffold-protocol。

| # | 任务 | 场景回指 | 涉及文件 | 风险 | 状态 |
|---|---|---|---|---|---|
| T1 | 状态判定：读取 Codex 本地凭据存在性显示已登录/未登录，不发模型请求；凭据来源标注 | feat04 场景1, feat05 场景1 | packages/codex-cli/src/account.ts | 高:凭据读取涉及敏感数据，输出须经凭据过滤不得回显内容 | [x] 🟢
| T2 | 登录：account/login/start 转发授权链接并等待完成通知，本地凭据存在时跳过（免登录） | feat04 场景1, 场景2 | packages/codex-cli/src/account.ts | None | [ ] ⏳ |
| T3 | 登录取消：account/login/cancel 终止本次尝试，回到未登录可重试 | feat04 场景3 | packages/codex-cli/src/account.ts | None | [x] 🟢
| T4 | 登录失效：模型请求或测试连接失败暴露失效提示并引导重新登录；仅查看状态不触发 | feat04 场景4 | packages/codex-cli/src/account.ts, packages/codex-cli/src/adapter.ts | None | [x] 🟢
| T5 | 退出账号：account/logout 转发，作用范围限定当前 Codex CLI 账号；**验收只做实现检查，不执行真实退出** | feat04 场景5 | packages/codex-cli/src/account.ts | 高:不可逆操作，真实执行会登出本机共享账号 | [x] 🟢
| T6 | unit：状态判定（凭据存在/缺失/损坏）、失效错误码、退出与取消的协议调用形态（协议桩） | feat04 场景1-5 | tests/runtime/codex-cli.test.mjs | None | [ ] ⏳
| T7 | smoke：真实登录→状态已登录→发起对话成功→取消路径（登录中取消）；退出仅源码路径核对 | feat04 场景1-3 | tests/runtime/codex-cli.test.mjs | None | [ ] ⏳

## 影响文件树

```text
kongming-agent/
├── packages/codex-cli/src/
│   ├── account.ts   U  # 新增：本地凭据状态判定、登录/取消/退出转发
│   └── adapter.ts   M  # 请求路径上的登录失效错误分类
└── tests/runtime/codex-cli.test.mjs  M  # 追加：账号 unit 与登录 smoke（退出仅实现检查）
```
