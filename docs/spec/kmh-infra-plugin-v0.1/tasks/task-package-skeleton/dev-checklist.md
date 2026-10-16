# task-package-skeleton · 开发清单

> spec: docs/spec/kmh-infra-plugin-v0.1/spec.md
> tech-design: docs/spec/kmh-infra-plugin-v0.1/tech-design.md
> 创建: 2026-10-16

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[x] 🟢` 验证通过 / `[!] 🔴` 验证失败

| # | 任务 | 场景回指 | 涉及文件 | 风险 | 状态 |
|---|---|---|---|---|---|
| T1 | 建包骨架：package.json 双入口 exports、`dsh.client` 元数据与 `dsh.bundle.patch`、三份 tsconfig、esbuild 构建脚本、忽略构建产物；随后 `pnpm install` 建立本包与根工作区的依赖链接 | None | packages/kmh-infra/package.json, packages/kmh-infra/tsconfig.json, packages/kmh-infra/tsconfig.host.json, packages/kmh-infra/tsconfig.browser.json, packages/kmh-infra/build.mjs, packages/kmh-infra/.gitignore, pnpm-lock.yaml | None | [x] 🟢 |
| T2 | 配置契约与单测：先写单测并确认因模块缺失而失败，再实现八个配置项的 schema（原生 string/number/boolean，全部 volatile）与地址规范化纯函数（C1、C5、C6；D01；用例 T1，unit） | None | packages/kmh-infra/src/config.ts, packages/kmh-infra/test/infra-config.test.mjs | None | [x] 🟢 |
| T3 | 宿主半与浏览器半最小入口：宿主 apply 空装配、浏览器半声明四个注入服务并留空 apply，保证两端可构建 | None | packages/kmh-infra/src/index.ts, packages/kmh-infra/src/client/index.ts | None | [x] 🟢 |
| T4 | 组合包 patch 与全部登记：包内 patch、profile 依赖与实例挂载、根脚本 filter、HMR 测试的符号链接包名单（同时补上 HEAD 就漏掉的 kmh-mademe，该测试在本轮之前即为红色）（C4；D06；用例 T2） | None | packages/kmh-infra/cordis.patch.yml, profiles/kmh-web/package.json, profiles/kmh-web/cordis.patch.yml, package.json, tests/runtime/web-plugin-hmr.test.mjs | 高:profile 登记写错会让 Web 启动失败（链接悬空），并连带打断 web-plugin-hmr 回归；验证不能只有 unit | [x] 🟢 |
| T5 | 冒烟测试：双入口产物存在、`dsh.client` 平台与注入声明、patch 含正确模块名、宿主半可导入、浏览器半是模块加载器工厂（D06；用例 T2，smoke） | None | packages/kmh-infra/test/infra-smoke.test.mjs | None | [x] 🟢 |
| T6 | 仓库根检查（本 task 相关部分）：`build:kmh`、`typecheck:kmh`、`lint` 与本包测试全绿，并确认 web-plugin-hmr 未因新包进入包名单而失败（D06；用例 T2、T11 的构建部分） | None | tests/runtime/web-plugin-hmr.test.mjs | None | [x] 🟢 |

## 影响文件树

```text
kongming-os/
├── packages/kmh-infra/
│   ├── package.json            U  # 新增：双入口 exports、dsh.client 元数据、dsh.bundle.patch、构建脚本
│   ├── cordis.patch.yml        U  # 新增：组合包 patch，insert 本插件实例
│   ├── build.mjs               U  # 新增：esbuild 打包浏览器半为模块加载器工厂，tsc 编译宿主半
│   ├── tsconfig.json           U  # 新增：双 references 汇总
│   ├── tsconfig.host.json      U  # 新增：宿主半编译配置
│   ├── tsconfig.browser.json   U  # 新增：浏览器半编译配置
│   ├── .gitignore              U  # 新增：忽略 lib 构建产物
│   ├── src/config.ts           U  # 新增：八个配置项 schema 与地址规范化（两端共用的契约）
│   ├── src/index.ts            U  # 新增：宿主半最小装配
│   ├── src/client/index.ts     U  # 新增：浏览器半最小入口，声明注入服务
│   ├── test/infra-config.test.mjs U # 新增：配置 schema 默认值、类型与地址规范化单测
│   └── test/infra-smoke.test.mjs  U # 新增：产物与分发声明冒烟
├── profiles/kmh-web/package.json      M  # dependencies 登记 link:../../packages/kmh-infra
├── profiles/kmh-web/cordis.patch.yml  M  # 以实例 id kmh-infra 挂载本插件
├── package.json                M  # build:kmh / typecheck:kmh / lint / format:check / test 各加本包
├── pnpm-lock.yaml              M  # pnpm install --lockfile-only 登记新包（本机未执行完整 install）
└── tests/runtime/web-plugin-hmr.test.mjs M # 符号链接包名单加入 kmh-infra，否则 prepareProfiles 链接悬空报错
```
