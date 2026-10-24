# task-quota-details · 开发清单

> spec: docs/spec/codex-cli-quota-display/spec.md
> tech-design: docs/spec/codex-cli-quota-display/tech-design.md
> 创建: 2026-10-20

| # | 任务 | 场景回指 | 涉及文件 | 风险 | 状态 |
| --- | --- | --- | --- | --- | --- |
| T1 | 先验证额度协议与规则缺口，再实现官方字段投影（D01、D03、D07；用例 T01、T05、T06；unit） | feat01 场景1, 场景2, feat02 场景1, 场景2, 场景3 | packages/codex-cli/src/protocol.ts, packages/codex-cli/src/quota-protocol.ts, packages/codex-cli/src/quota-rules.ts, packages/codex-cli/src/quota.ts, packages/codex-cli/src/index.ts, packages/codex-cli/test/quota.test.mjs | None | [x] 🟢 |
| T2 | 先验证五分钟共享读取、失效和失败恢复，再实现服务与 HTTP（C1–C3；D01、D02；用例 T02、T03、T04、T07、T19；集成） | feat01 场景3, 场景4, 场景5, 场景6, feat02 场景4 | packages/codex-cli/src/quota.ts, packages/codex-cli/src/web.ts, packages/codex-cli/src/index.ts, packages/codex-cli/test/quota.test.mjs | 高:并发读取、账号结果归属与进程回收 | [x] 🟢 |
| T3 | 先验证详情页真实渲染，再接入额度卡与配置来源（D03、D06；用例 T01–T07；组件集成） | feat01 场景1-6, feat02 场景1-4 | packages/codex-cli/src/config.ts, packages/codex-cli/src/client/DetailCard.tsx, packages/codex-cli/src/client/QuotaCard.tsx, packages/codex-cli/src/client/quota-store.ts, packages/codex-cli/src/client/quota-styles.ts, packages/codex-cli/src/client/locales.ts, packages/codex-cli/src/client/index.ts, packages/codex-cli/package.json, packages/codex-cli/build.mjs, packages/codex-cli/tsconfig.browser.json, pnpm-lock.yaml, packages/codex-cli/test/quota-client.test.mjs | None | [x] 🟢 |
| T4 | 集成回归并维护使用说明，记录来源、冷却及未知值（C1–C3；用例 T01–T07、T19） | feat01 场景1-6, feat02 场景1-4 | packages/codex-cli/README.md, packages/codex-cli/test/quota.test.mjs, packages/codex-cli/test/quota-client.test.mjs, tests/runtime/codex-cli.test.mjs | None | [x] 🟢 |

## 影响文件树

```text
kongming-os/
├── packages/codex-cli/src/protocol.ts M # 官方只读协议
├── packages/codex-cli/src/quota-protocol.ts U # 共享展示协议
├── packages/codex-cli/src/quota-rules.ts U # 纯规则与读取间隔
├── packages/codex-cli/src/quota.ts U # 额度读取与投影
├── packages/codex-cli/src/index.ts M # 服务归属与导出
├── packages/codex-cli/src/web.ts M # 鉴权通道内只读路由
├── packages/codex-cli/src/config.ts M # 四项显示偏好
├── packages/codex-cli/src/client/DetailCard.tsx M # 现有详情页接入
├── packages/codex-cli/src/client/QuotaCard.tsx U # 额度卡
├── packages/codex-cli/src/client/quota-store.ts U # 浏览器共享快照
├── packages/codex-cli/src/client/quota-styles.ts U # 主题样式
├── packages/codex-cli/src/client/locales.ts M # 中英文案
├── packages/codex-cli/src/client/index.ts M # 状态注入
├── packages/codex-cli/package.json M # 公开依赖
├── packages/codex-cli/build.mjs M # 浏览器打包
├── packages/codex-cli/tsconfig.browser.json M # 共享类型
├── pnpm-lock.yaml M # 本包公开依赖锁定
├── packages/codex-cli/README.md M # 使用说明
├── packages/codex-cli/test/quota.test.mjs U # 协议、服务集成
├── packages/codex-cli/test/quota-client.test.mjs U # 真实组件渲染
└── tests/runtime/codex-cli.test.mjs M # 槽位回归
```
