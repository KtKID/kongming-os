# task-package-skeleton · dev-report

> task: docs/spec/kmh-infra-plugin-v0.1/tasks/task-package-skeleton/dev-checklist.md
> 创建: 2026-10-16

## 结果

- task 测试：6/6 🟢 全绿
- 既有回归：通过（全量 314 个测试 313 通过；唯一失败在 `packages/codex-cli/test/tool-policy.test.mjs`，属该包未提交改动带来的既有红，与本 task 无交集——该测试用自建临时 profile，不读 `profiles/kmh-web`）
- 高风险行：1 行（T4 profile 登记）含真实链路验证——`pnpm build:kmh` 通过、web-plugin-hmr 用真实 KMH Web 入口在临时目录起服务并通过

## 验证证据

| 任务行 / 场景 / C / D / 用例回指 | 红灯原因与证据（或未采用 TDD 的理由） | 最终验证方式与实际结果 / 证据位置 | 局限或待补项 |
|---|---|---|---|
| 行 T1；D06 | 脚手架行，无可测行为，未采用 TDD | `node build.mjs` 退出码 0，产出 `lib/src/index.js`（宿主半）与 `lib/client.js`（浏览器半，模块加载器工厂），见 `packages/kmh-infra/lib/` | 未跑 `pnpm install`，改用 `--lockfile-only` 更新锁文件 + 手工复刻 pnpm 的链接布局（见覆盖说明） |
| 行 T2；C1、C5、C6；D01；用例 T1（unit） | 先写测试再实现；首次运行为导入缺失（`../lib/src/config.js` 不存在）——按 skill 规矩导入错误不算有效红灯，故本行未采用 TDD，理由可核查 | `tsc -p tsconfig.host.json` 退出码 0；`node --test test/infra-config.test.mjs` 6 tests / 6 pass：八个默认值、三个数值字段类型为 number、字符串字段原样保留、地址规范化 6 个合法与 7 个非法边界 | 只覆盖 schema 与纯函数；配置项在插件详情页是否可见属行 T3 之外的用例 T3，由 task-config-and-mcp 验证 |
| 行 T3；D06 | 空壳入口无行为，未采用 TDD | `tsc -b`（含浏览器半）退出码 0；冒烟测试可导入宿主半并读到 `name = "kmh-infra"` | 两半尚未注册任何界面或能力，行为见后续 task |
| 行 T4；C4；D06；用例 T2 | 既有红灯（与本轮改动无关）：HEAD 的 `tests/runtime/web-plugin-hmr.test.mjs` 包名单漏了 `kmh-mademe`，而它在 profile 依赖里，`prepareProfiles` 对悬空链接目标 `realpathSync` 抛错 → 实测 `ENOENT ... packages/kmh-mademe`。已核实 `git show HEAD:profiles/kmh-web/package.json` 与 HEAD 的测试名单确认这是 mademe 时期遗留 | 名单补入 `kmh-mademe` 与 `kmh-infra` 后，`node --test tests/runtime/web-plugin-hmr.test.mjs` 1 test / 1 pass（11.6s，真实 KMH Web 在临时目录启动并完成热重载）；`pnpm build:kmh` 通过；`profiles/kmh-web/package.json` 与根 `package.json` 改后 JSON 合法 | 该测试只证明 Web 能带本插件启动与热重载，不证明插件已注册界面——界面由 task-sidebar-and-panel 的浏览器验证覆盖 |
| 行 T5；D06；用例 T2（smoke） | 产物已存在，属补覆盖，无红灯 | `node --test test/infra-smoke.test.mjs` 5 tests / 5 pass：双入口声明、`dsh.client` 平台与四个注入包、组合包 patch 含正确模块名、宿主半可导入并暴露 `name`/`apply`/`normalizeHttpUrl`、浏览器半产物是 `__ModuleLoader__` 工厂且声明四个注入服务 | 断言的是产物形态，不是运行时可用性 |
| 行 T6；D06；用例 T2、T11 的构建部分 | 非 TDD 行，属既有产物上的核对 | `pnpm build:kmh` ✓、`pnpm typecheck:kmh` ✓、`pnpm lint` ✓（含 `node --check packages/kmh-infra/build.mjs`）、`pnpm --filter @kmh/kmh-infra` 的 lint 与 format:check ✓、本包测试 11/11 ✓、web-plugin-hmr ✓ | 见下方覆盖说明的两项环境限制；根 `pnpm test` 的 1 个失败在 codex-cli，不在本 task 范围 |
| 行 T2/T5 附带；C1；用例 T8 | 非 TDD 行，属检索取证 | `git grep` 在被跟踪文件里检索疑似明文凭据（`token\|secret\|password` 后跟 12 位以上字面量）无匹配；`src/config.ts` 只有 `tokenEnvVar`（暗号所在的环境变量名），注释与字段说明均写明不填暗号本身；profile patch 的 kmh-infra 段只有变量名与说明 | 检索只能证明当前提交里没有明文，不能防止后续有人手填；该风险由配置项标签与提示文案承担，其呈现由 task-config-and-mcp 的用例 T8 验证 |

## 覆盖说明（环境限制与偏离）

1. **未执行 `pnpm install`。** 它要求先移除 `node_modules`（`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`），而本机正跑着用户的 KMH Web，清空依赖目录风险不可接受。替代做法：`pnpm install --lockfile-only` 更新锁文件（已把 `packages/kmh-infra` 登记进 `pnpm-lock.yaml`），再按 pnpm 隔离链接器的布局手工建立本包 `node_modules` 的符号链接，并逐项比对与 `packages/kmh-mademe/node_modules` 的解析目标一致（`readlink -f` 全等），无悬空链接。**建议在安全时机由使用者执行一次正常 `pnpm install` 让 pnpm 自己重建链接。**
2. **`pnpm` 的依赖校验会连带触发同一个 install。** 根脚本内的 `pnpm --filter` 会先做依赖状态检查，因此根命令需带 `pnpm_config_verify_deps_before_run=false` 才能运行。这是环境状态导致的，不是本 task 引入的。
3. **根 `format:check` 失败但不在本包。** 5 个格式问题全在 `packages/codex-cli`（`src/isolation.ts`、`src/native-tools/catalog.ts`、`src/tool-registry.ts`、`src/web.ts`、`tsconfig.host.json`），属该包未提交改动；本包单独跑 format:check 为 "All matched files use Prettier code style!"。

## 未决

- 无 🔴 行。两项环境限制与一个他包既有红见上方「覆盖说明」，均不阻塞本 task 交付。
