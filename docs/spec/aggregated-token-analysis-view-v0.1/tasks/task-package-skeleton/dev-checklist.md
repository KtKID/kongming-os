# task-package-skeleton · 开发清单

> spec: docs/spec/aggregated-token-analysis-view-v0.1/spec.md
> tech-design: docs/spec/aggregated-token-analysis-view-v0.1/tech-design.md
> 创建: 2026-10-18

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[x] 🟢` 验证通过 / `[!] 🔴` 验证失败

| # | 任务 | 场景回指 | 涉及文件 | 风险 | 状态 |
|---|---|---|---|---|---|
| T1 | 建包骨架：package.json 双入口 exports、`dsh.client` 元数据（web 平台与四个注入客户端包）与 `dsh.bundle.patch`、三份 tsconfig、esbuild 构建脚本（banner 模块 id 换成本包）、忽略构建产物；随后 `pnpm install --lockfile-only` 登记新包 | None | packages/aggregated-token-analysis/package.json, packages/aggregated-token-analysis/tsconfig.json, packages/aggregated-token-analysis/tsconfig.host.json, packages/aggregated-token-analysis/tsconfig.browser.json, packages/aggregated-token-analysis/build.mjs, packages/aggregated-token-analysis/.gitignore, pnpm-lock.yaml | None | [x] 🟢 |
| T2 | 配置契约与单测：先写单测并确认因模块缺失而失败，再实现两个配置项的 schema（原生 string/number，全部 volatile，默认值只出现在这里）与独立的地址规范化纯函数文件（C2、C5；D01、D06；用例 T1，unit） | None | packages/aggregated-token-analysis/src/config.ts, packages/aggregated-token-analysis/src/normalize-url.ts, packages/aggregated-token-analysis/test/token-analysis-config.test.mjs | None | [x] 🟢 |
| T3 | 宿主半与浏览器半最小入口：宿主半导出 `Config`、`normalizeHttpUrl` 与插件名并留空 `apply`；浏览器半声明恰为 `["slots","locale","configForms"]` 三个注入服务并留空 `apply`（不用 `layout`，依据 runner 守卫），保证两端可构建（D02） | None | packages/aggregated-token-analysis/src/index.ts, packages/aggregated-token-analysis/src/client/index.ts | None | [x] 🟢 |
| T4 | 组合包 patch 与全部登记：包内 patch（id 与模块名 `aggregated-token-analysis` / `@kmh/aggregated-token-analysis`）、profile 依赖与实例挂载（排在 kmh-infra 之后）、根脚本五个入口的 filter 与 build.mjs 语法检查、HMR 测试的符号链接包名单（C4；D05；用例 T2 的声明部分） | None | packages/aggregated-token-analysis/cordis.patch.yml, profiles/kmh-web/package.json, profiles/kmh-web/cordis.patch.yml, package.json, tests/runtime/web-plugin-hmr.test.mjs | 高:profile 登记写错会让 Web 启动失败（链接悬空），并连带打断 web-plugin-hmr 回归；验证不能只有 unit | [ ] ⏳ |
| T5 | 冒烟测试（基础版）：双入口产物存在、`dsh.client` 平台与注入声明、patch 含正确模块名、宿主半可导入且暴露插件名、浏览器半是模块加载器工厂且声明三服务（D05、D06；用例 T2，smoke） | None | packages/aggregated-token-analysis/test/token-analysis-smoke.test.mjs | None | [x] 🟢 |
| T6 | 仓库根检查（本 task 相关部分）：`build:kmh`、`typecheck:kmh`、`lint` 与本包 `node --test` 全绿，并确认 web-plugin-hmr 未因新包进入包名单而失败（D05）。锁文件有未提交改动时按仓库惯例直接跑 `node --test` 命令，全套留到 task-distribution | None | tests/runtime/web-plugin-hmr.test.mjs | None | [x] 🟢 |

## 影响文件树

```text
kongming-os/
├── packages/aggregated-token-analysis/
│   ├── package.json            U  # 新增：双入口 exports、dsh.client 元数据、dsh.bundle.patch、构建脚本
│   ├── cordis.patch.yml        U  # 新增：组合包 patch，insert 本插件实例
│   ├── build.mjs               U  # 新增：esbuild 打包浏览器半为模块加载器工厂，tsc 编译宿主半
│   ├── tsconfig.json / tsconfig.host.json / tsconfig.browser.json  U  # 新增：双 references；browser 的 include 是 normalize-url.ts 而非 config.ts（D06）
│   ├── .gitignore              U  # 新增：忽略 lib 构建产物
│   ├── src/config.ts           U  # 新增：两个配置项 schema；默认值的唯一出处
│   ├── src/normalize-url.ts    U  # 新增：地址规范化纯函数（两端共用；浏览器半只引它，不引 config.ts）
│   ├── src/index.ts            U  # 新增：宿主半最小装配（与 kmh-mademe 宿主半同型）
│   ├── src/client/index.ts     U  # 新增：浏览器半最小入口，声明三服务注入
│   ├── test/token-analysis-config.test.mjs U  # 新增：schema 默认值、类型与地址规范化单测
│   └── test/token-analysis-smoke.test.mjs  U  # 新增：产物与分发声明冒烟
├── profiles/kmh-web/package.json      M  # dependencies 登记 link:../../packages/aggregated-token-analysis
├── profiles/kmh-web/cordis.patch.yml  M  # kmh-infra 实例之后以 id aggregated-token-analysis 挂载
├── package.json                M  # build:kmh / typecheck:kmh / lint / format:check / test 各加本包；lint 加 build.mjs 语法检查
├── pnpm-lock.yaml              M  # pnpm install --lockfile-only 登记新包
└── tests/runtime/web-plugin-hmr.test.mjs M # 符号链接包名单加入本包，否则 prepareProfiles 链接悬空报错
```
