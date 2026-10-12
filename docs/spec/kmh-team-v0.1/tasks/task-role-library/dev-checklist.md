# task-role-library · 开发清单

> spec: docs/spec/kmh-team-v0.1/spec.md
> tech-design: docs/spec/kmh-team-v0.1/tech-design.md
> 创建: 2026-10-12
> spec 基线: da9d0e50c2428ff12e33bd9db8406342465cc0ce500a656a96984dda4c50c6ac
> tech-design 基线: 29166ae488ecbff34c4a0b4591d43c6b050ab24e23bb58913473504ff03dcbf0

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[x] 🟢` 验证通过 / `[!] 🔴` 验证失败

| # | 任务 | 场景回指 | 涉及文件 | 风险 | 状态 |
|---|---|---|---|---|---|
| T1 | 公共包、协议与编译入口（D01–D03） | None | docs/spec/README.md, docs/spec/kmh-team-v0.1/tasks/evidence.md, docs/spec/kmh-team-v0.1/tasks/evidence/*, docs/spec/kmh-team-v0.1/tech-design.md, packages/kmh-team/README.md, packages/kmh-team/build.mjs, packages/kmh-team/package.json, packages/kmh-team/src/protocol/index.ts, packages/kmh-team/tsconfig.browser.json, packages/kmh-team/tsconfig.host.json, packages/kmh-team/tsconfig.json, third_party/dsh/docs/config-catalog.md, third_party/dsh/docs/config-catalog.zh.md, third_party/dsh/docs/event-producer-consumer.md, third_party/dsh/docs/event-producer-consumer.zh.md, third_party/dsh/docs/persistence-catalog.i18n.yaml, third_party/dsh/docs/persistence-catalog.md, third_party/dsh/docs/persistence-catalog.zh.md, third_party/dsh/docs/persistence-schema.json, third_party/dsh/docs/subsystems/core.md, third_party/dsh/docs/subsystems/core.zh.md, third_party/dsh/docs/subsystems/session.md, third_party/dsh/docs/subsystems/session.zh.md, third_party/dsh/docs/subsystems/subagent.md, third_party/dsh/docs/subsystems/subagent.zh.md, third_party/dsh/packages/core/session/README.i18n.yaml, third_party/dsh/packages/core/session/README.md, third_party/dsh/packages/core/session/README.zh.md, third_party/dsh/packages/core/session/src/index.ts, third_party/dsh/packages/core/session/tests/session.spec.ts, third_party/dsh/packages/extensions/cordis-client-runner/src/client/api-catalog.ts, third_party/dsh/packages/extensions/cordis-client-runner/src/client/slot-catalog.ts, third_party/dsh/packages/extensions/tool-cordis/src/api-catalog.ts, third_party/dsh/packages/session/session-projection/README.i18n.yaml, third_party/dsh/packages/session/session-projection/README.md, third_party/dsh/packages/session/session-projection/README.zh.md, third_party/dsh/packages/session/session-projection/package.json, third_party/dsh/packages/session/session-projection/src/presentation.ts, third_party/dsh/packages/session/session-projection/src/types.ts, third_party/dsh/pnpm-lock.yaml, third_party/dsh/scripts/gen-cordis-catalog.ts, third_party/dsh/tsconfig.base.json | None | [x] 🟢 |
| T2 | 角色保存、主 Agent 创建工具与错误处理；unit + durable storage smoke（D02） | feat01 场景1-6 | packages/kmh-team/src/roles/index.ts, packages/kmh-team/src/roles/tool.ts, packages/kmh-team/test/roles.test.mjs | 高:固定配置写入与调用者鉴权 | [x] 🟢 |

T1 的 None 表示公共协议、编译入口、通用投影/可忽略事件元数据及生成文档接入等纯技术支撑；功能场景由 T2 和其他 task 承接。检查结果为严格 Host/Browser 编译、scoped lint/format、DSH 类型检查/oxlint、42 项 doc-sync 与持久化类型历史检查通过。

流程生成的任务分配、checklist 与 dev-report 为交付元数据；下树与本表的实现及检查文件逐项对应。

## 影响文件树

```text
kongming-agent/
├── docs/spec/README.md  M
├── docs/spec/kmh-team-v0.1/tasks/evidence.md  U
├── docs/spec/kmh-team-v0.1/tasks/evidence/*  U
├── docs/spec/kmh-team-v0.1/tech-design.md  U
├── packages/kmh-team/README.md  U
├── packages/kmh-team/build.mjs  U
├── packages/kmh-team/package.json  U
├── packages/kmh-team/src/protocol/index.ts  U
├── packages/kmh-team/src/roles/index.ts  U
├── packages/kmh-team/src/roles/tool.ts  U
├── packages/kmh-team/test/roles.test.mjs  U
├── packages/kmh-team/tsconfig.browser.json  U
├── packages/kmh-team/tsconfig.host.json  U
├── packages/kmh-team/tsconfig.json  U
├── third_party/dsh/docs/config-catalog.md  M
├── third_party/dsh/docs/config-catalog.zh.md  M
├── third_party/dsh/docs/event-producer-consumer.md  M
├── third_party/dsh/docs/event-producer-consumer.zh.md  M
├── third_party/dsh/docs/persistence-catalog.i18n.yaml  M
├── third_party/dsh/docs/persistence-catalog.md  M
├── third_party/dsh/docs/persistence-catalog.zh.md  M
├── third_party/dsh/docs/persistence-schema.json  M
├── third_party/dsh/docs/subsystems/core.md  M
├── third_party/dsh/docs/subsystems/core.zh.md  M
├── third_party/dsh/docs/subsystems/session.md  M
├── third_party/dsh/docs/subsystems/session.zh.md  M
├── third_party/dsh/docs/subsystems/subagent.md  M
├── third_party/dsh/docs/subsystems/subagent.zh.md  M
├── third_party/dsh/packages/core/session/README.i18n.yaml  M
├── third_party/dsh/packages/core/session/README.md  M
├── third_party/dsh/packages/core/session/README.zh.md  M
├── third_party/dsh/packages/core/session/src/index.ts  M
├── third_party/dsh/packages/core/session/tests/session.spec.ts  M
├── third_party/dsh/packages/extensions/cordis-client-runner/src/client/api-catalog.ts  M
├── third_party/dsh/packages/extensions/cordis-client-runner/src/client/slot-catalog.ts  M
├── third_party/dsh/packages/extensions/tool-cordis/src/api-catalog.ts  M
├── third_party/dsh/packages/session/session-projection/README.i18n.yaml  M
├── third_party/dsh/packages/session/session-projection/README.md  M
├── third_party/dsh/packages/session/session-projection/README.zh.md  M
├── third_party/dsh/packages/session/session-projection/package.json  M
├── third_party/dsh/packages/session/session-projection/src/presentation.ts  U
├── third_party/dsh/packages/session/session-projection/src/types.ts  M
├── third_party/dsh/pnpm-lock.yaml  M
├── third_party/dsh/scripts/gen-cordis-catalog.ts  M
├── third_party/dsh/tsconfig.base.json  M
```
