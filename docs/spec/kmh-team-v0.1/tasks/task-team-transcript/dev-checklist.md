# task-team-transcript · 开发清单

> spec: docs/spec/kmh-team-v0.1/spec.md
> tech-design: docs/spec/kmh-team-v0.1/tech-design.md
> 创建: 2026-10-12
> spec 基线: da9d0e50c2428ff12e33bd9db8406342465cc0ce500a656a96984dda4c50c6ac
> tech-design 基线: 29166ae488ecbff34c4a0b4591d43c6b050ab24e23bb58913473504ff03dcbf0

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[x] 🟢` 验证通过 / `[!] 🔴` 验证失败

| # | 任务 | 场景回指 | 涉及文件 | 风险 | 状态 |
|---|---|---|---|---|---|
| T1 | 群聊、头像工作标记及客户端扩展；unit + Web smoke（D07、D08） | feat06 场景1-12 | packages/kmh-team/src/client/TeamView.tsx, packages/kmh-team/src/client/draft.ts, packages/kmh-team/src/client/index.ts, packages/kmh-team/src/client/locales.ts, packages/kmh-team/src/client/styles.ts, packages/kmh-team/src/client/transport.ts, packages/kmh-team/src/projection/index.ts, packages/kmh-team/src/team/index.ts, packages/kmh-team/test/client.test.mjs, packages/kmh-team/test/smoke.test.mjs, packages/kmh-team/test/state.test.mjs, third_party/dsh/packages/client/tsdown.client.ts, third_party/dsh/packages/client/ui-conversation/README.i18n.yaml, third_party/dsh/packages/client/ui-conversation/README.md, third_party/dsh/packages/client/ui-conversation/README.zh.md, third_party/dsh/packages/client/ui-conversation/package.json, third_party/dsh/packages/client/ui-conversation/src/client/apply.ts, third_party/dsh/packages/client/ui-conversation/src/client/contract/input.ts, third_party/dsh/packages/client/ui-conversation/src/client/contract/slots.ts, third_party/dsh/packages/client/ui-conversation/src/client/index.ts, third_party/dsh/packages/client/ui-conversation/src/client/input/facade.ts, third_party/dsh/packages/client/ui-conversation/src/client/input/hub.ts, third_party/dsh/packages/client/ui-conversation/src/client/skeleton/ConversationContent.tsx, third_party/dsh/packages/client/ui-conversation/src/client/skeleton/ConversationMainPanel.tsx, third_party/dsh/packages/client/ui-conversation/src/client/skeleton/InputBar.tsx, third_party/dsh/packages/client/ui-conversation/tests/input-bar.client.spec.tsx, third_party/dsh/packages/client/ui-conversation/tests/skeleton.client.spec.tsx, third_party/dsh/packages/client/ui-conversation/tests/team-extension.client.spec.tsx, third_party/dsh/packages/client/ui-conversation/tsconfig.client.json, third_party/dsh/packages/client/ui-workspace/README.i18n.yaml, third_party/dsh/packages/client/ui-workspace/README.md, third_party/dsh/packages/client/ui-workspace/README.zh.md, third_party/dsh/packages/client/ui-workspace/package.json, third_party/dsh/packages/client/ui-workspace/src/client/tree.ts, third_party/dsh/packages/client/ui-workspace/tests/tree.client.spec.ts, third_party/dsh/packages/client/ui-workspace/tsconfig.json | 高:多任务状态与迟到通知 | [x] 🟢 |
| T2 | 停止、恢复、保存失败和卸载；unit + restart smoke（D03、D09） | feat08 场景1-6 | packages/kmh-team/src/client/TeamView.tsx, packages/kmh-team/src/client/draft.ts, packages/kmh-team/src/client/index.ts, packages/kmh-team/src/client/locales.ts, packages/kmh-team/src/client/styles.ts, packages/kmh-team/src/client/transport.ts, packages/kmh-team/src/projection/index.ts, packages/kmh-team/src/team/index.ts, packages/kmh-team/test/client.test.mjs, packages/kmh-team/test/smoke.test.mjs, packages/kmh-team/test/state.test.mjs, tests/runtime/web-plugin-hmr.test.mjs | 高:取消、持久恢复与清理 | [x] 🟢 |

流程生成的任务分配、checklist 与 dev-report 为交付元数据；下树与本表的实现及检查文件逐项对应。

## 影响文件树

```text
kongming-agent/
├── packages/kmh-team/src/client/TeamView.tsx  U
├── packages/kmh-team/src/client/draft.ts  U
├── packages/kmh-team/src/client/index.ts  U
├── packages/kmh-team/src/client/locales.ts  U
├── packages/kmh-team/src/client/styles.ts  U
├── packages/kmh-team/src/client/transport.ts  U
├── packages/kmh-team/src/projection/index.ts  U
├── packages/kmh-team/src/team/index.ts  U
├── packages/kmh-team/test/client.test.mjs  U
├── packages/kmh-team/test/smoke.test.mjs  U
├── packages/kmh-team/test/state.test.mjs  U
├── tests/runtime/web-plugin-hmr.test.mjs  M
├── third_party/dsh/packages/client/tsdown.client.ts  M
├── third_party/dsh/packages/client/ui-conversation/README.i18n.yaml  M
├── third_party/dsh/packages/client/ui-conversation/README.md  M
├── third_party/dsh/packages/client/ui-conversation/README.zh.md  M
├── third_party/dsh/packages/client/ui-conversation/package.json  M
├── third_party/dsh/packages/client/ui-conversation/src/client/apply.ts  M
├── third_party/dsh/packages/client/ui-conversation/src/client/contract/input.ts  M
├── third_party/dsh/packages/client/ui-conversation/src/client/contract/slots.ts  M
├── third_party/dsh/packages/client/ui-conversation/src/client/index.ts  M
├── third_party/dsh/packages/client/ui-conversation/src/client/input/facade.ts  M
├── third_party/dsh/packages/client/ui-conversation/src/client/input/hub.ts  M
├── third_party/dsh/packages/client/ui-conversation/src/client/skeleton/ConversationContent.tsx  M
├── third_party/dsh/packages/client/ui-conversation/src/client/skeleton/ConversationMainPanel.tsx  M
├── third_party/dsh/packages/client/ui-conversation/src/client/skeleton/InputBar.tsx  M
├── third_party/dsh/packages/client/ui-conversation/tests/input-bar.client.spec.tsx  M
├── third_party/dsh/packages/client/ui-conversation/tests/skeleton.client.spec.tsx  M
├── third_party/dsh/packages/client/ui-conversation/tests/team-extension.client.spec.tsx  U
├── third_party/dsh/packages/client/ui-conversation/tsconfig.client.json  M
├── third_party/dsh/packages/client/ui-workspace/README.i18n.yaml  M
├── third_party/dsh/packages/client/ui-workspace/README.md  M
├── third_party/dsh/packages/client/ui-workspace/README.zh.md  M
├── third_party/dsh/packages/client/ui-workspace/package.json  M
├── third_party/dsh/packages/client/ui-workspace/src/client/tree.ts  M
├── third_party/dsh/packages/client/ui-workspace/tests/tree.client.spec.ts  M
├── third_party/dsh/packages/client/ui-workspace/tsconfig.json  M
```
