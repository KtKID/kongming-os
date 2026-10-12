# task-team-config · 开发清单

> spec: docs/spec/kmh-team-v0.1/spec.md
> tech-design: docs/spec/kmh-team-v0.1/tech-design.md
> 创建: 2026-10-12
> spec 基线: da9d0e50c2428ff12e33bd9db8406342465cc0ce500a656a96984dda4c50c6ac
> tech-design 基线: 29166ae488ecbff34c4a0b4591d43c6b050ab24e23bb58913473504ff03dcbf0

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[x] 🟢` 验证通过 / `[!] 🔴` 验证失败

| # | 任务 | 场景回指 | 涉及文件 | 风险 | 状态 |
|---|---|---|---|---|---|
| T1 | 团队建群、模型选择与创建去重；unit + Session smoke（D03、D10） | feat02 场景1-9 | docs/kmh/plugin-index.md, package.json, packages/kmh-team/src/client/Detail.tsx, packages/kmh-team/src/client/TeamDialog.tsx, packages/kmh-team/src/client/locales.ts, packages/kmh-team/src/client/transport.ts, packages/kmh-team/src/index.ts, packages/kmh-team/src/projection/index.ts, packages/kmh-team/src/team/index.ts, packages/kmh-team/src/web.ts, packages/kmh-team/test/config.test.mjs, packages/kmh-team/test/web-smoke.mjs, pnpm-lock.yaml, profiles/kmh-web/cordis.patch.yml, profiles/kmh-web/package.json, third_party/dsh/packages/api/session-controller/README.i18n.yaml, third_party/dsh/packages/api/session-controller/README.md, third_party/dsh/packages/api/session-controller/README.zh.md, third_party/dsh/packages/api/session-controller/src/client/sessions/manager.ts, third_party/dsh/packages/api/session-controller/src/client/sessions/session.ts, third_party/dsh/packages/api/session-controller/src/commands.ts, third_party/dsh/packages/api/session-controller/src/types.ts, third_party/dsh/packages/api/session-controller/tests/session-models.host.spec.ts | 高:会话创建与持久化 | [x] 🟢 |
| T2 | 配置保存、固定上下文窗口与输入校验；unit + durable settings smoke（D03、D04） | feat05 场景1-8 | packages/kmh-team/src/client/Detail.tsx, packages/kmh-team/src/client/TeamDialog.tsx, packages/kmh-team/src/client/locales.ts, packages/kmh-team/src/client/transport.ts, packages/kmh-team/src/index.ts, packages/kmh-team/src/projection/index.ts, packages/kmh-team/src/team/index.ts, packages/kmh-team/src/web.ts, packages/kmh-team/test/config.test.mjs, packages/kmh-team/test/web-smoke.mjs | 高:配置持久化与快照一致性 | [x] 🟢 |

流程生成的任务分配、checklist 与 dev-report 为交付元数据；下树与本表的实现及检查文件逐项对应。

## 影响文件树

```text
kongming-agent/
├── docs/kmh/plugin-index.md  M
├── package.json  M
├── packages/kmh-team/src/client/Detail.tsx  U
├── packages/kmh-team/src/client/TeamDialog.tsx  U
├── packages/kmh-team/src/client/locales.ts  U
├── packages/kmh-team/src/client/transport.ts  U
├── packages/kmh-team/src/index.ts  U
├── packages/kmh-team/src/projection/index.ts  U
├── packages/kmh-team/src/team/index.ts  U
├── packages/kmh-team/src/web.ts  U
├── packages/kmh-team/test/config.test.mjs  U
├── packages/kmh-team/test/web-smoke.mjs  U
├── pnpm-lock.yaml  M
├── profiles/kmh-web/cordis.patch.yml  M
├── profiles/kmh-web/package.json  M
├── third_party/dsh/packages/api/session-controller/README.i18n.yaml  M
├── third_party/dsh/packages/api/session-controller/README.md  M
├── third_party/dsh/packages/api/session-controller/README.zh.md  M
├── third_party/dsh/packages/api/session-controller/src/client/sessions/manager.ts  M
├── third_party/dsh/packages/api/session-controller/src/client/sessions/session.ts  M
├── third_party/dsh/packages/api/session-controller/src/commands.ts  M
├── third_party/dsh/packages/api/session-controller/src/types.ts  M
├── third_party/dsh/packages/api/session-controller/tests/session-models.host.spec.ts  M
```
