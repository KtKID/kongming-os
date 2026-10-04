# task-acceptance · 开发清单

> spec: docs/spec/kmh-plugin-framework-v0.1/spec.md
> 创建: 2026-10-02

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[x] 🟢` 验证通过 / `[!] 🔴` 验证失败

| # | 任务 | 场景回指 | 涉及文件 | 风险 | 状态 |
|---|---|---|---|---|---|
| T1 | 状态与敏感值诊断 | feat09 场景1, feat09 场景2, feat09 场景3, feat09 场景4 | packages/runtime/src/RuntimeManager.ts, packages/runtime/src/contracts.ts, packages/profile/src/ProfileManager.ts, packages/cli/src/index.ts, packages/cli/src/main.ts, packages/cli/tests/diagnostics.spec.ts, packages/runtime/README.md, packages/profile/README.md | None | [x] 🟢 |
| T2 | 示例与真实命令验收 | feat10 场景1, feat10 场景2, feat10 场景3, feat10 场景4, feat10 场景5, feat10 场景6 | packages/example/src/index.ts, packages/example/src/ExampleManager.ts, packages/example/bundle.yml, packages/example/tests/example.spec.ts, packages/example/README.md, packages/cli/src/index.ts, packages/cli/src/main.ts, packages/cli/tests/smoke.spec.ts, packages/cli/README.md, packages/README.md, packages/tooling/verify.mjs, packages/tooling/tests/verify.spec.ts, packages/tooling/build.mjs, packages/tooling/evidence.json, packages/tooling/report.mjs, packages/tooling/acceptance.json, packages/package.json, packages/.gitignore, packages/base/README.md, packages/tooling/tests/evidence.spec.ts | 高:跨模块与构建后命令链路 | [x] 🟢 |

## 影响文件树

```text
kongming-agent/
├── packages/tooling/report.mjs   U  # 新增：可重复验收报告
├── packages/tooling/acceptance.json   U  # 新增：实际场景验收状态
├── packages/package.json   U  # 新增：验收命令
├── packages/.gitignore   U  # 新增：忽略测试原始产物
├── packages/base/README.md   U  # 新增：基础 bundle 说明
├── packages/README.md   U  # 新增：模块实现、文档或可复用验证
├── packages/cli/README.md   U  # 新增：模块实现、文档或可复用验证
├── packages/cli/src/index.ts   U  # 新增：模块实现、文档或可复用验证
├── packages/cli/src/main.ts   U  # 新增：模块实现、文档或可复用验证
├── packages/cli/tests/diagnostics.spec.ts   U  # 新增：模块实现、文档或可复用验证
├── packages/cli/tests/smoke.spec.ts   U  # 新增：模块实现、文档或可复用验证
├── packages/example/README.md   U  # 新增：模块实现、文档或可复用验证
├── packages/example/bundle.yml   U  # 新增：模块实现、文档或可复用验证
├── packages/example/src/ExampleManager.ts   U  # 新增：模块实现、文档或可复用验证
├── packages/example/src/index.ts   U  # 新增：模块实现、文档或可复用验证
├── packages/example/tests/example.spec.ts   U  # 新增：模块实现、文档或可复用验证
├── packages/profile/README.md   U  # 新增：模块实现、文档或可复用验证
├── packages/profile/src/ProfileManager.ts   U  # 新增：模块实现、文档或可复用验证
├── packages/runtime/README.md   U  # 新增：模块实现、文档或可复用验证
├── packages/runtime/src/contracts.ts   U  # 新增：敏感设置解析
├── packages/runtime/src/RuntimeManager.ts   U  # 新增：模块实现、文档或可复用验证
├── packages/tooling/build.mjs   U  # 新增：模块实现、文档或可复用验证
├── packages/tooling/evidence.json   U  # 新增：模块实现、文档或可复用验证
├── packages/tooling/tests/evidence.spec.ts   U  # 新增：模块实现、文档或可复用验证
├── packages/tooling/tests/verify.spec.ts   U  # 新增：模块实现、文档或可复用验证
├── packages/tooling/verify.mjs   U  # 新增：模块实现、文档或可复用验证
```
