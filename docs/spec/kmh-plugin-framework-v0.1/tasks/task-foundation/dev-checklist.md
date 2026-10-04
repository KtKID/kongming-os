# task-foundation · 开发清单

> spec: docs/spec/kmh-plugin-framework-v0.1/spec.md
> 创建: 2026-10-02

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[x] 🟢` 验证通过 / `[!] 🔴` 验证失败

| # | 任务 | 场景回指 | 涉及文件 | 风险 | 状态 |
|---|---|---|---|---|---|
| T1 | 工程底座 | None | packages/package.json, packages/pnpm-workspace.yaml, packages/pnpm-lock.yaml, packages/tsconfig.json, packages/eslint.config.mjs, packages/.prettierrc.json, packages/.prettierignore, packages/.gitignore, packages/vitest.config.ts, packages/tooling/build.mjs, packages/README.md, packages/*/package.json | None | [x] 🟢 |
| T2 | 命名与中文注释检查 | feat01 场景1, feat01 场景2, feat01 场景3 | packages/tooling/verify.mjs, packages/tooling/tests/verify.spec.ts, packages/runtime/src/identity.ts, packages/runtime/src/contracts.ts, packages/profile/src/schemas.ts, packages/runtime/src/index.ts, packages/cli/src/index.ts, packages/cli/src/main.ts, packages/cli/tests/identity.spec.ts, packages/base/bundle.yml | None | [x] 🟢 |

## 影响文件树

```text
kongming-agent/
├── packages/runtime/src/contracts.ts   U  # 新增：插件命名校验
├── packages/profile/src/schemas.ts   U  # 新增：配置命名真源
├── packages/*/package.json   U  # 新增：模块实现、文档或可复用验证
├── packages/.gitignore   U  # 新增：模块实现、文档或可复用验证
├── packages/.prettierignore   U  # 新增：模块实现、文档或可复用验证
├── packages/.prettierrc.json   U  # 新增：模块实现、文档或可复用验证
├── packages/README.md   U  # 新增：模块实现、文档或可复用验证
├── packages/base/bundle.yml   U  # 新增：模块实现、文档或可复用验证
├── packages/cli/src/index.ts   U  # 新增：模块实现、文档或可复用验证
├── packages/cli/src/main.ts   U  # 新增：模块实现、文档或可复用验证
├── packages/cli/tests/identity.spec.ts   U  # 新增：模块实现、文档或可复用验证
├── packages/eslint.config.mjs   U  # 新增：模块实现、文档或可复用验证
├── packages/package.json   U  # 新增：模块实现、文档或可复用验证
├── packages/pnpm-lock.yaml   U  # 新增：模块实现、文档或可复用验证
├── packages/pnpm-workspace.yaml   U  # 新增：模块实现、文档或可复用验证
├── packages/runtime/src/identity.ts   U  # 新增：模块实现、文档或可复用验证
├── packages/runtime/src/index.ts   U  # 新增：模块实现、文档或可复用验证
├── packages/tooling/build.mjs   U  # 新增：模块实现、文档或可复用验证
├── packages/tooling/tests/verify.spec.ts   U  # 新增：模块实现、文档或可复用验证
├── packages/tooling/verify.mjs   U  # 新增：模块实现、文档或可复用验证
├── packages/tsconfig.json   U  # 新增：模块实现、文档或可复用验证
├── packages/vitest.config.ts   U  # 新增：模块实现、文档或可复用验证
```
