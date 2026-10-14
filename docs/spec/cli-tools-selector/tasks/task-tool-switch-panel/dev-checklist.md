# task-tool-switch-panel · 开发清单

> spec: docs/spec/cli-tools-selector/spec.md
> tech-design: docs/spec/cli-tools-selector/tech-design.md
> 创建: 2026-10-14

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[x] 🟢` 验证通过 / `[!] 🔴` 验证失败

| # | 任务 | 场景回指 | 涉及文件 | 风险 | 状态 |
|---|---|---|---|---|---|
| T1 | 开关契约：新增纯 zod 模块（ToolSwitchId、ToolSwitchSchema、ToolSwitchListSchema、ToolSwitchUpdateSchema，类型由 z.infer 推导），codex-cli package.json 增子路径导出 `./tool-switches`，浏览器 tsconfig 纳入该文件（D02） | None | packages/codex-cli/src/tool-switches.ts, packages/codex-cli/package.json, packages/codex-cli/tsconfig.browser.json | None | [x] 🟢 |
| T2 | codex-cli `toolSwitches(signal, refresh)`：由 `toolPolicy.catalog()`、`config.toolSelection`、`settings.selection` 拼清单，原生恰为四个能力并带 covers，原生诊断折算 nativeStatus，refresh 触发重发现；先在真实 profile harness 写测试并确认因方法缺失失败，再实现（C5；D02、D03；用例 T1、T2，集成） | feat01 场景1, 场景2; feat02 场景4 | packages/codex-cli/src/tool-switches-service.ts, packages/codex-cli/src/index.ts, packages/codex-cli/test/tool-policy.test.mjs | None | [x] 🟢 |
| T3 | codex-cli `setToolSwitch(update, signal)`：KMH 行 upsert、命令执行三行一起、file-change/view-image/web-search 单行（无则追加），经 `ctx.settings.update` 带修订号写 profile 配置；未知 id 与修订号冲突原样抛错；配套把 `web_search` 改为可调（catalog.ts）、首次导入播种与快照回落（tool-policy.ts，设计 v0.2）；先写 harness 测试（落盘三行一致、其他命名空间不变、普通新建会话请求只含选中工具）并确认失败，再实现（C3、C7；D04；用例 T5，集成） | feat02 场景1, 场景3 | packages/codex-cli/src/tool-switches-service.ts, packages/codex-cli/src/index.ts, packages/codex-cli/src/native-tools/catalog.ts, packages/codex-cli/src/tool-policy.ts, packages/codex-cli/test/tool-policy.test.mjs | 高:写入 profile 配置持久化并依赖修订号并发核对，验证须含真实 settings 落盘与新会话请求的集成断言 | [x] 🟢 |
| T4 | 新包脚手架 `@kmh/cli-tools-selector`：仿 codex-cli 的 package.json（`./client` 导出、`dsh.client.inject` locale 与 plugin-manager）、tsconfig 三份、build.mjs（host tsc + client esbuild，banner id 为本包名）、host 空插件与 client 空注册、README 骨架（D01、D05） | None | packages/cli-tools-selector/package.json, packages/cli-tools-selector/tsconfig.json, packages/cli-tools-selector/tsconfig.host.json, packages/cli-tools-selector/tsconfig.browser.json, packages/cli-tools-selector/build.mjs, packages/cli-tools-selector/src/index.ts, packages/cli-tools-selector/src/client/index.ts, packages/cli-tools-selector/README.md | None | [x] 🟢 |
| T5 | host 路由 GET/POST `/api/cli-tools-selector/codex-cli/switches`：经宿主连接通道注册；codexCli 缺失 503 `CODEX_CLI_UNAVAILABLE`、请求体校验 400、未知 id 400、修订号冲突 409、其余 500 带 reason，响应经 ToolSwitchListSchema 校验并 no-store；先用伪造 connection 注册表与伪造 codexCli 写路由测试并确认失败，再实现（C1、C6；D03、D04；用例 T4、T6 路由侧，unit） | feat01 场景4; feat02 场景2 | packages/cli-tools-selector/src/web.ts, packages/cli-tools-selector/src/index.ts, packages/cli-tools-selector/test/routes.test.mjs | None | [x] 🟢 |
| T6 | client 区块：向 `plugins.detail.section` 注册 id `cli-tools-selector`，subject 非 `{kind:'item', id:'codex-cli'}` 返回 null；挂载拉清单，两列渲染（KMH 按名排序、原生四项附 covers 说明、顶部"仅普通新建会话生效"）、nativeStatus 降级与"重新读取"、加载失败与"重试"、乐观切换与非 2xx 回滚提示、文案本地化（R1–R4）；先写主题判定与乐观更新/回滚纯函数测试并确认失败，再实现（C2、C5、C6；D01、D03、D04；用例 T3、T6 组件侧，unit） | feat01 场景1, 场景2, 场景3, 场景4; feat02 场景1, 场景2 | packages/cli-tools-selector/src/client/index.ts, packages/cli-tools-selector/src/client/SwitchPanel.tsx, packages/cli-tools-selector/src/client/state.ts, packages/cli-tools-selector/src/client/locales.ts, packages/cli-tools-selector/test/panel.test.mjs | None | [x] 🟢 |
| T7 | 登记：kmh-web profile 增 link 依赖与 `kmh-cli-tools-selector` 条目，根 package.json 四处 filter 登记新包并把本包测试加入根 test，插件索引增行，包 README 写用途、路由、启停影响；HMR 启动测试的临时副本登记新包（D05） | None | profiles/kmh-web/package.json, profiles/kmh-web/cordis.patch.yml, package.json, pnpm-lock.yaml, docs/kmh/plugin-index.md, packages/cli-tools-selector/README.md, tests/runtime/web-plugin-hmr.test.mjs | None | [x] 🟢 |
| T8 | 集成验证：`pnpm typecheck:kmh`、`pnpm lint`、根 `pnpm test`（含 codex-cli harness 与启动测试）全绿；`git -C third_party/dsh status` 为空（C4） | None | 无新增文件（根 pnpm 脚本） | None | [x] 🟢 |
| T9 | 浏览器验收：`pnpm web` 打开 Codex 详情页核对清单、降级与重读、失败重试、切换与回滚提示、新建会话工具变化与旧会话不变、禁用/重新启用选择器的区块消失与恢复，证据记入开发报告（C1、C2、C3、C5、C6；用例 T3 复核，e2e/人工） | feat01 场景1, 场景2, 场景3, 场景4; feat02 场景1, 场景2, 场景3; feat03 场景1, 场景2 | docs/spec/cli-tools-selector/tasks/task-tool-switch-panel/dev-report.md | None | [x] 🟢 |

## 影响文件树

```text
kongming-os/
├── package.json                                              M  # build:kmh/typecheck:kmh/lint/format:check 四处 filter 登记新包，test 加入本包测试
├── pnpm-lock.yaml                                            M  # 新包进入工作区后的锁文件更新
├── tests/runtime/web-plugin-hmr.test.mjs                     M  # 临时副本登记新包，避免 profile link 建链 ENOENT
├── docs/kmh/plugin-index.md                                  M  # 自有包表增 @kmh/cli-tools-selector 行
├── docs/spec/cli-tools-selector/tasks/task-tool-switch-panel/dev-report.md  U  # 新增：开发报告与浏览器验收证据
├── profiles/kmh-web/package.json                             M  # 增 @kmh/cli-tools-selector link 依赖
├── profiles/kmh-web/cordis.patch.yml                         M  # insert 增 kmh-cli-tools-selector 条目
├── packages/codex-cli/
│   ├── package.json                                          M  # exports 增 ./tool-switches 子路径
│   ├── tsconfig.browser.json                                 M  # include 纳入 src/tool-switches.ts
│   ├── src/tool-switches.ts                                  U  # 新增：开关契约（纯 zod 与类型）
│   ├── src/tool-switches-service.ts                          U  # 新增：清单拼装与切换行映射
│   ├── src/index.ts                                          M  # CodexCli 增 toolSwitches/setToolSwitch 服务方法
│   ├── src/native-tools/catalog.ts                           M  # web_search 改为可调（v0.2）
│   ├── src/tool-policy.ts                                    M  # 首次导入播种 web_search 行；快照 webSearch 取行、缺行回落旧设置（v0.2）
│   └── test/tool-policy.test.mjs                             M  # 增清单一致、降级重读、切换落盘与新会话断言
└── packages/cli-tools-selector/
    ├── package.json / tsconfig.json / tsconfig.host.json / tsconfig.browser.json / build.mjs  U  # 新增：包脚手架与构建
    ├── README.md                                             U  # 新增：用途、路由、启停影响
    ├── src/index.ts                                          U  # 新增：host 插件，注入 connection 并挂路由
    ├── src/web.ts                                            U  # 新增：GET/POST switches 路由与状态码映射
    ├── src/client/index.ts                                   U  # 新增：plugins.detail.section 注册与本地化
    ├── src/client/SwitchPanel.tsx                            U  # 新增：两列开关区块组件
    ├── src/client/state.ts                                   U  # 新增：主题判定、乐观更新/回滚纯函数
    ├── src/client/locales.ts                                 U  # 新增：中英文案
    ├── test/routes.test.mjs                                  U  # 新增：路由状态码与校验测试
    └── test/panel.test.mjs                                   U  # 新增：主题判定与回滚逻辑测试
```
