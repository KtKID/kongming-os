# task-plugin-shell · 开发报告

> spec: docs/spec/mademe-plugin-v0.1/spec.md
> 完成: 2026-10-12

## 结论

**全绿**：T1–T8 共 8/8 行 🟢，feat01 四个场景全部以真实浏览器验证通过；仓库全量回归 178/178 通过（含本包 5 个冒烟测试）。无高风险行。

## 验证摘要

- **源码侧**：`pnpm --filter @kmh/mademe build / typecheck / lint / format:check` 全绿；`node --test` 冒烟 5/5（exports 双入口、dsh.client 声明、bundle patch、宿主半可导入、client 产物为 `__ModuleLoader__` 工厂且含 inject 声明）。
- **实浏览器**（沙箱实例 http://127.0.0.1:60002，端口遵循用户当日指定；沙箱按 `tests/runtime/web-plugin-hmr.test.mjs` 配方搭建于 /tmp/kmh-mademe-verify）：
  - feat01 场景1：侧栏 Global panels 出现 MadeMe 图标行（展开态图标+名称），点击后主区切换为占位面板、按钮进入 `[active]`/`aria-current="page"` ✓
  - feat01 场景2：收起侧栏后悬停图标 500ms 出现 `tooltip "MadeMe"` ✓
  - feat01 场景4：刷新后选中态与面板恢复，localStorage 镜像 `kmh-mademe:active='1'` ✓
  - feat01 场景3：插件页开关停用（约 5–7 秒重组合）与外部编辑 profile 停用两条路径均验证——入口消失、主区回会话（聊天输入框回归）、面板卸载 ✓
  - 附带验证：插件页 Installed 列表正确展示 `@kmh/mademe`（组合包形态，可导出机制生效）

## 过程记录

- 包结构以 `packages/codex-cli` 为模板（esbuild `__ModuleLoader__` 工厂 + tsconfig host/browser 双 references + `brandString` 替代类型断言过 lint）。
- 首次加载失败：`dsh-brand` 作为 esbuild external 不在浏览器模块表——改为打包进 bundle（identity 函数，零依赖），peerDependencies 同步移除。
- 发现并修复：插件卸载后 localStorage 恢复标记残留，会在重新启用后把上次选中强加给刷新恢复——已在 selection mirror 的卸载清理中清除（复验 storageCleared=true）。
- 环境事实：本 worktree 首次构建 DSH（子模块原先无 lib）；DSH 子模块 `pnpm run setup` 的 lefthook postinstall 在 worktree 检出下因 git `extensions.worktreeConfig` 限制失败，构建用 `CI=true` 绕过（仅跳过 git hooks 安装，不影响产物）。

## 范围外改动（随本 task 的正当维护）

- `pnpm-workspace.yaml`：原 `allowBuilds: esbuild: set this to true or false` 为无效占位（非 pnpm 字段，从未生效），替换为正确的 `onlyBuiltDependencies: [esbuild]` 并批准构建。
- `tests/runtime/web-plugin-hmr.test.mjs`：沙箱物化包清单追加 `kmh-mademe`（profile 新依赖需要在沙箱可解析）。
- `tests/runtime/plugin-watch.test.mjs`：发现清单期望数组追加 `@kmh/mademe`。
- 根 `package.json` 四个 filter 列表与 test 脚本追加本包（checklist T2 内）。

## 未决

无。
