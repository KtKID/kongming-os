# task-quota-composer · 开发清单

> spec: docs/spec/codex-cli-quota-display/spec.md
> tech-design: docs/spec/codex-cli-quota-display/tech-design.md
> 创建: 2026-10-20

| # | 任务 | 场景回指 | 涉及文件 | 风险 | 状态 |
| --- | --- | --- | --- | --- | --- |
| T1 | 先验证会话来源、分组和较晚结果，再实现输入框订阅（D04、D05；用例 T08–T13；组件集成） | feat03 场景1-10 | packages/codex-cli/src/client/ComposerQuota.tsx, packages/codex-cli/src/client/index.ts, packages/codex-cli/src/client/quota-store.ts, packages/codex-cli/src/quota-rules.ts, packages/codex-cli/test/quota-client.test.mjs | 高:会话隔离与异步回执归属 | [x] 🟢 |
| T2 | 先验证偏好保存和双端颜色，再实现显示设置（D06、D07；用例 T14、T16、T17、T18；表单集成） | feat04 场景1, 场景2, 场景4-9 | packages/codex-cli/src/quota-protocol.ts, packages/codex-cli/src/web.ts, packages/codex-cli/src/client/QuotaDisplaySettings.tsx, packages/codex-cli/src/client/QuotaCard.tsx, packages/codex-cli/src/client/quota-store.ts, packages/codex-cli/src/client/ComposerQuota.tsx, packages/codex-cli/src/client/locales.ts, packages/codex-cli/src/client/quota-styles.ts, packages/codex-cli/test/quota-client.test.mjs | 高:配置持久化与修订冲突 | [x] 🟢 |
| T3 | 浏览器验证双主题、窄窗口、切换与浮层（C1、C2；用例 T09、T11、T15、T17、T19；Web） | feat03 场景1-10, feat04 场景1-9 | packages/codex-cli/test/quota-browser-harness.mjs, packages/codex-cli/src/client/ComposerQuota.tsx, packages/codex-cli/src/client/QuotaDisplaySettings.tsx, packages/codex-cli/src/client/quota-styles.ts | None | [x] 🟢 |
| T4 | 回归、规格与技术验收对账及说明更新 | feat03 场景1-10, feat04 场景1-9 | packages/codex-cli/README.md, packages/codex-cli/package.json, packages/codex-cli/build.mjs, packages/codex-cli/tsconfig.browser.json, packages/codex-cli/src/client/DetailCard.tsx, tests/runtime/codex-cli.test.mjs | None | [x] 🟢 |

## 影响文件树

```text
kongming-os/
├── packages/codex-cli/src/quota-protocol.ts M # 只读偏好投影
├── packages/codex-cli/src/web.ts M # 宿主偏好读取
├── packages/codex-cli/src/client/ComposerQuota.tsx U # 会话额度
├── packages/codex-cli/src/client/QuotaDisplaySettings.tsx U # 显示表单
├── packages/codex-cli/src/client/index.ts M # 会话槽位
├── packages/codex-cli/src/client/quota-store.ts M # 订阅与配置状态
├── packages/codex-cli/src/client/QuotaCard.tsx M # 颜色同步
├── packages/codex-cli/src/client/DetailCard.tsx M # 显示表单接入
├── packages/codex-cli/src/client/locales.ts M # 中英文案
├── packages/codex-cli/src/client/quota-styles.ts M # 紧凑布局与颜色
├── packages/codex-cli/src/quota-rules.ts M # 模型分组
├── packages/codex-cli/test/quota-client.test.mjs M # 组件集成
├── packages/codex-cli/test/quota-browser-harness.mjs U # Web 隔离验收
├── packages/codex-cli/README.md M # 操作说明
├── packages/codex-cli/package.json M # 依赖与验证入口
├── packages/codex-cli/build.mjs M # 浏览器公共依赖
├── packages/codex-cli/tsconfig.browser.json M # 浏览器类型
└── tests/runtime/codex-cli.test.mjs M # 槽位回归
```
