# Kongming bundle

`@kmh/bundle-kongming` 是应用自有 DSH bundle，位于 Kongming 仓库。`dsh.bundle.patch` 指向本目录的 `cordis.patch.yml`，当前定义 Kongming persona。headless 和 SDK profile 在 DSH 官方组合之后加载它；Web profile 的 persona 已展开在 `profiles/kmh-web/cordis.patch.yml` 中，Web 配置在那里管理。

新增应用能力可在 bundle dependencies 声明 Kongming 插件，再在 patch 插入对应插件条目。公共基础框架包由 DSH 子模块提供；配置变化通过 `pnpm run dsh --profile kmh-headless --dump-config` 与 `pnpm test` 验证。
