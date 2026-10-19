# task-package-skeleton · dev-report

> task: docs/spec/aggregated-token-analysis-view-v0.1/tasks/task-package-skeleton/dev-checklist.md
> 创建: 2026-10-18

## 结果

- task 测试：11/11 🟢 全绿（config 6 + smoke 5，`node --test packages/aggregated-token-analysis/test/*.test.mjs`）
- 既有回归：通过（`node --test tests/runtime/web-plugin-hmr.test.mjs` 1/1，新包已进符号链接名单）；根 `build:kmh`、`typecheck:kmh`、`lint` exit 0；本包 `format:check` 经 prettier 修一处 tsconfig.browser.json 换行后通过
- 高风险行：1 行（T4 接线登记），已含真实链路验证——HMR 运行时回归实际用新名单复制 profile 并启动 Web 热重载，通过

## 验证证据

| 任务行 / 场景 / C / D / 用例回指 | 红灯原因与证据（或未采用 TDD 的理由） | 最终验证方式与实际结果 / 证据位置 | 局限或待补项 |
|---|---|---|---|
| T1；D05 | 纯脚手架，无行为可测，不适用 TDD | `node build.mjs` 产出 lib/src 与 lib/client.js；根 `pnpm install` exit 0（4.3s，全部本地链接） | 无 |
| T2；C2、C5；D01、D06；用例 T1（unit） | 先写 `test/token-analysis-config.test.mjs` 并运行：1 fail，原因是 `../lib/src/config.js` 模块缺失（目标行为不存在，infra 同款红灯） | 实现 `src/config.ts` 与 `src/normalize-url.ts` 并构建后复跑：6/6 pass——默认值（URL 原样、8000 为 number）、schema 只两字段、schema 原样保留、默认地址往返、非法地址拒绝 | 无 |
| T3；D02 | 最小入口无独立行为，由冒烟断言覆盖（未单独造红灯） | 冒烟第 4、5 条：宿主半可导入且 `name === "aggregated-token-analysis"`；浏览器半为 `__ModuleLoader__` 工厂且 `inject` 恰为 `["slots","locale","configForms"]` | 无 |
| T4（高）；C4；D05；用例 T2 声明部分 | 接线为声明类改动，验证靠真实链路（HMR 回归）而非单测 | `profiles/kmh-web/package.json`、`profiles/kmh-web/cordis.patch.yml`（kmh-infra 之后）、根 `package.json` 五脚本、`tests/runtime/web-plugin-hmr.test.mjs` 名单均已登记；HMR 运行时测试 1/1 pass（11.8s，实际启动 Web 并热重载） | Web 启动加载本插件的整体核对在 task-sidebar-panel-config 的浏览器验证行 |
| T5；D05、D06；用例 T2（smoke） | 冒烟读产物，产物存在后才有意义（先测会因缺文件报错，非有效红灯） | 5/5 pass：双入口 exports、dsh.client 四注入包、patch 模块名、宿主半导入、工厂与三服务 | C5 的产物级禁入断言（schemastery/8000/8e3/60010/_svc\/x-token）按清单分配在 task-sidebar-panel-config T5 扩展 |
| T6；D05 | 检查行，无红灯概念 | 根 `pnpm build:kmh` exit 0、`pnpm typecheck:kmh` exit 0、`pnpm lint` exit 0、`pnpm --filter @kmh/aggregated-token-analysis format:check` 通过（修 tsconfig.browser.json 换行）、包内 11/11、HMR 1/1 | 全套 `pnpm test` 与 `format:check` 全仓按清单留到 task-distribution T3 |

## 未决

无。
