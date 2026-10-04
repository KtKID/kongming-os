# task-runtime · 开发清单

> spec: docs/spec/kmh-plugin-framework-v0.1/spec.md
> 创建: 2026-10-02

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[x] 🟢` 验证通过 / `[!] 🔴` 验证失败

| # | 任务 | 场景回指 | 涉及文件 | 风险 | 状态 |
|---|---|---|---|---|---|
| T1 | 服务依赖与分组隔离 | feat05 场景1, feat05 场景2, feat05 场景3, feat05 场景4, feat05 场景5, feat07 场景1, feat07 场景2, feat07 场景3 | packages/runtime/src/index.ts, packages/runtime/src/contracts.ts, packages/runtime/src/RuntimeManager.ts, packages/runtime/tests/runtime.spec.ts, packages/runtime/README.md | 高:异步加载与依赖撤回需真实运行时验证 | [x] 🟢 |
| T2 | 服务和事件协作 | feat06 场景1, feat06 场景2, feat06 场景3, feat06 场景4, feat06 场景5 | packages/runtime/src/contracts.ts, packages/runtime/src/RuntimeManager.ts, packages/runtime/tests/events.spec.ts, packages/runtime/tests/types.ts, packages/runtime/README.md | 高:真实调用链与观察者错误验证 | [x] 🟢 |
| T3 | 生命周期与限时停止 | feat08 场景1, feat08 场景2, feat08 场景3, feat08 场景4, feat08 场景5, feat08 场景6, feat08 场景7 | packages/runtime/src/RuntimeManager.ts, packages/runtime/tests/lifecycle.spec.ts, packages/runtime/README.md | 高:并发管理与清理需真实资源验证 | [x] 🟢 |

## 影响文件树

```text
kongming-agent/
├── packages/runtime/README.md   U  # 新增：模块实现、文档或可复用验证
├── packages/runtime/src/RuntimeManager.ts   U  # 新增：模块实现、文档或可复用验证
├── packages/runtime/src/contracts.ts   U  # 新增：模块实现、文档或可复用验证
├── packages/runtime/src/index.ts   U  # 新增：模块实现、文档或可复用验证
├── packages/runtime/tests/events.spec.ts   U  # 新增：模块实现、文档或可复用验证
├── packages/runtime/tests/lifecycle.spec.ts   U  # 新增：模块实现、文档或可复用验证
├── packages/runtime/tests/runtime.spec.ts   U  # 新增：模块实现、文档或可复用验证
├── packages/runtime/tests/types.ts   U  # 新增：模块实现、文档或可复用验证
```
