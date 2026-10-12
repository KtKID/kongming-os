# task-team-execution · 开发清单

> spec: docs/spec/kmh-team-v0.1/spec.md
> tech-design: docs/spec/kmh-team-v0.1/tech-design.md
> 创建: 2026-10-12
> spec 基线: da9d0e50c2428ff12e33bd9db8406342465cc0ce500a656a96984dda4c50c6ac
> tech-design 基线: 29166ae488ecbff34c4a0b4591d43c6b050ab24e23bb58913473504ff03dcbf0

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[x] 🟢` 验证通过 / `[!] 🔴` 验证失败

| # | 任务 | 场景回指 | 涉及文件 | 风险 | 状态 |
|---|---|---|---|---|---|
| T1 | owner 串行执行与公开上下文接纳；unit + Agent smoke（D04、D05） | feat03 场景1-6 | packages/kmh-team/src/execution/index.ts, packages/kmh-team/src/team/index.ts, packages/kmh-team/src/web.ts, packages/kmh-team/test/execution.test.mjs, packages/kmh-team/test/fixtures-provider.mjs, packages/kmh-team/test/smoke.test.mjs, packages/kmh-team/test/team-transcript.expected.json | 高:输入路由与任务区间 | [x] 🟢 |
| T2 | 结构化点名、fresh 成员及独立完整结果；unit + subagent smoke（D04、D06） | feat04 场景1-8 | packages/kmh-team/src/execution/index.ts, packages/kmh-team/src/team/index.ts, packages/kmh-team/src/web.ts, packages/kmh-team/test/execution.test.mjs, packages/kmh-team/test/fixtures-provider.mjs, packages/kmh-team/test/smoke.test.mjs, packages/kmh-team/test/team-transcript.expected.json | 高:并发执行、去重与隔离 | [x] 🟢 |
| T3 | 模型、工具、skill 和权限继承；recorded Agent smoke（D06） | feat07 场景1-4 | packages/kmh-team/src/execution/index.ts, packages/kmh-team/src/team/index.ts, packages/kmh-team/src/web.ts, packages/kmh-team/test/execution.test.mjs, packages/kmh-team/test/fixtures-provider.mjs, packages/kmh-team/test/smoke.test.mjs, packages/kmh-team/test/team-transcript.expected.json, third_party/dsh/packages/subagent/subagent/src/continuation.ts, third_party/dsh/packages/subagent/subagent/src/index.ts | 高:执行权限与错误收敛 | [x] 🟢 |

流程生成的任务分配、checklist 与 dev-report 为交付元数据；下树与本表的实现及检查文件逐项对应。

## 影响文件树

```text
kongming-agent/
├── packages/kmh-team/src/execution/index.ts  U
├── packages/kmh-team/src/team/index.ts  U
├── packages/kmh-team/src/web.ts  U
├── packages/kmh-team/test/execution.test.mjs  U
├── packages/kmh-team/test/fixtures-provider.mjs  U
├── packages/kmh-team/test/smoke.test.mjs  U
├── packages/kmh-team/test/team-transcript.expected.json  U
├── third_party/dsh/packages/subagent/subagent/src/continuation.ts  M
├── third_party/dsh/packages/subagent/subagent/src/index.ts  M
```
