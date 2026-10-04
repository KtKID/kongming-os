# task-composition · 开发清单

> spec: docs/spec/kmh-plugin-framework-v0.1/spec.md
> 创建: 2026-10-02

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[x] 🟢` 验证通过 / `[!] 🔴` 验证失败

| # | 任务 | 场景回指 | 涉及文件 | 风险 | 状态 |
|---|---|---|---|---|---|
| T1 | 独立 profile 持久化 | feat02 场景1, feat02 场景2, feat02 场景3, feat02 场景4, feat02 场景5 | packages/profile/src/index.ts, packages/profile/src/schemas.ts, packages/profile/src/ProfileManager.ts, packages/profile/tests/profile.spec.ts, packages/profile/README.md | 高:真实目录和重复写保护 | [x] 🟢 |
| T2 | 本地 bundle 安装管理 | feat03 场景1, feat03 场景2, feat03 场景3, feat03 场景4, feat03 场景5, feat03 场景6, feat03 场景7 | packages/profile/src/schemas.ts, packages/profile/src/ProfileManager.ts, packages/profile/tests/bundle.spec.ts, packages/profile/tests/fixtures/plugins.ts, packages/profile/README.md | 高:原子写及失败保留 | [x] 🟢 |
| T3 | 配置层完整替换 | feat04 场景1, feat04 场景2, feat04 场景3, feat04 场景4, feat04 场景5 | packages/profile/src/schemas.ts, packages/profile/src/ProfileManager.ts, packages/profile/tests/config.spec.ts, packages/profile/README.md | 高:真实冲突哨兵和临时覆盖验证 | [x] 🟢 |

## 影响文件树

```text
kongming-agent/
├── packages/profile/README.md   U  # 新增：模块实现、文档或可复用验证
├── packages/profile/src/ProfileManager.ts   U  # 新增：模块实现、文档或可复用验证
├── packages/profile/src/index.ts   U  # 新增：模块实现、文档或可复用验证
├── packages/profile/src/schemas.ts   U  # 新增：模块实现、文档或可复用验证
├── packages/profile/tests/fixtures/plugins.ts   U  # 新增：真实配置插件
├── packages/profile/tests/bundle.spec.ts   U  # 新增：模块实现、文档或可复用验证
├── packages/profile/tests/config.spec.ts   U  # 新增：模块实现、文档或可复用验证
├── packages/profile/tests/profile.spec.ts   U  # 新增：模块实现、文档或可复用验证
```
