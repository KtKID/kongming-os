# 技术符合性验收 · 聚合 Token 分析视图 v0.1

- 项目与范围：`/Volumes/machub_app/proj/kongming-os`；feat01–feat03 全量，D01–D07 全部条目；承接三个 task（`tasks/task-package-skeleton`、`tasks/task-sidebar-panel-config`、`tasks/task-distribution`，dev-report 各自记录过程证据）。
- 设计及确认：`docs/spec/aggregated-token-analysis-view-v0.1/tech-design.md`，sha256 `1297c7586e7a101ab51e5904e6f406cc42e22f9f365c4f90576c0328999299d0`，设计状态"已确认"（用户 2026-10-18 两轮拍板，确认记录第 1–5 条）；用例 T1–T8 主定义在该设计正文。
- 规范及 spec：spec `docs/spec/aggregated-token-analysis-view-v0.1/spec.md`，94 行，sha256 `e2b1919645010415caeea3f312610d3ee7915a4d9ac2b943fc1119627353d86b`（含 C1–C6 与确认记录、命名修订）；共用开发规范取 x-tech-design 的 R1–R7；项目规范 `AGENTS.md` 与 [dsh-client-ui-ux](../../../../.agents/skills/dsh-client-ui-ux/SKILL.md)（C6 权威来源）。
- 代码基线：HEAD `119f293` 加工作区未提交改动；包内 `src/ + test/` 树哈希 `94807cc01ddc949d6ffce341808d322db5d1c4eb4056a964e6429c0dd59916e6`，包元文件（package.json / cordis.patch.yml / build.mjs / tsconfig×3 / README）树哈希 `2cbd5cb55f46b0a8466fb6f58ba765eeb5ccfc00f0978510c037f7459612a758`。注意：工作区同时含另一会话的 `packages/kmh-xmusic` 与 codex-cli 等未提交改动，本报告只对本包与四个登记文件（根 `package.json`、`profiles/kmh-web/package.json`、`profiles/kmh-web/cordis.patch.yml`、`tests/runtime/web-plugin-hmr.test.mjs`）中本任务新增的部分负责。
- 验证环境与证据：macOS / Node 25.6.1 / pnpm 11.7.0，仓库根执行；包内测试与根命令日志摘录于本报告及各 dev-report；浏览器证据来自隔离实例（`KMH_HOME=/tmp/ata-verify-home`，home 级 patch 覆盖端口 60020，`--no-open`），ZCode 内置浏览器驱动，截图存于会话产物目录；验证实例已停止、profile patch 无残留覆盖块。
- 整体结论：**未验证**（无失败项；C4 的停用相关两个子场景缺直接证据，浅色主题与换页正向显示未观察）。适用项通过 16、失败 0、未验证 3、不适用 1（R3）。

## 适用项证据

| 设计/规范条目与来源 | 适用原因 | 代码位置 | 命令或审查方法 | 预期及依据 | 实际与证据来源 | 结果与局限 |
|---|---|---|---|---|---|---|
| D01 配置项与默认值唯一出处（C2、C5） | 全部功能读这两个配置 | `packages/aggregated-token-analysis/src/config.ts`、`src/normalize-url.ts` | `node --test packages/aggregated-token-analysis/test/token-analysis-config.test.mjs`（本轮 6/6）；源码级门禁见 D06 | 两个 volatile 字段、默认值与类型、schema 原样保留、默认地址往返（用例 T1） | 6/6 pass：默认 `http://localhost:60010/_svc/x-token/`、`8000` 为 number、只两字段、非法地址拒 | 通过 |
| D02 侧栏入口与面板注册（C4 机制半） | feat01 的实现机制 | `src/client/index.ts` | `node --test test/token-analysis-client.test.mjs`（5/5）；`grep -rn "ctx\.layout\|\"layout\"" src/client/index.ts` 无命中；冒烟断言 `inject` 恰为 `["slots","locale","configForms"]` | 面板 id `token-analysis`、两槽共用、`order: 12`、词典 zh/en、不访问 layout（设计 D02） | 5/5 pass；无 layout 访问；浏览器：入口在导航区、Infra 之后、点击 `panelActive`、收起态 `role=tooltip` "Token Analysis" | 通过 |
| D03 面板视口与超时提示（C1、C2、C3、C5） | feat02 的实现机制 | `src/client/TokenAnalysisPanel.tsx`、`src/client/index.ts`（投影） | 单测投影两例（未就绪→unavailable 的红灯修复）+ 隔离实例浏览器观察 | iframe 无工具栏、src 取配置、超时取配置、提示含地址、切回重载（用例 T4） | src 0.8s 内随保存切换；60099 不可达 + 超时 2000：0.8s 无提示、3.5s `role=alert` 提示含 `http://127.0.0.1:60099/`；切回再回来是新 iframe；面板内 0 个按钮 | 通过（x-token 401 的外部状态另列范围外） |
| D04 配置表单（C5、C6） | feat03 的实现机制 | `src/client/config-controller.ts`、`src/client/ConfigForm.tsx` | 隔离实例浏览器操作（详情页填写/保存/Reset） | 两字段、默认值显示、非法原位拦截、保存持久化（用例 T6） | 默认值正确；`not a url` → `aria-invalid` + 原位提示 + Save 禁用；保存后 patch 出现 `pageUrl/pageLoadTimeoutMs: 2000` 覆盖条目并热生效；Reset 后条目消失；并发修改时提示 "Save did not land (config changed concurrently); please retry." | 通过 |
| D05 包构成与登记 | 交付形态 | 包元文件 + 四个登记文件 | `pnpm build:kmh`、`pnpm typecheck:kmh`、`pnpm lint`（均 exit 0）；`pnpm test`（exit 0，377/377）；`node --test tests/runtime/web-plugin-hmr.test.mjs`（1/1）；隔离实例 Web 挂载观察 | 双入口产物、dsh 元数据、patch、根脚本、HMR 名单、Web 能加载（用例 T2） | 全部通过；隔离实例插件页列出本包、侧栏入口与详情页可用 | 通过（`pnpm format:check` exit 1 全部来自 `packages/codex-cli` 的既有未提交改动，非本任务） |
| D06 C5 机器门禁 | 用户明确要求"不写死魔法数" | `test/token-analysis-smoke.test.mjs` 三条门禁 | 本轮 `node --test`（含 19/19）；产物实测 `grep -c`：`schemastery`/`Schema.`/`8000`/`8e3`/`60010`/`_svc\/x-token`/`:active` 全 0，`sidebar.panellist`/`pageUrl`/`pageLoadTimeoutMs` 命中 | 浏览器半产物不含宿主 schema、默认值、默认地址；源码默认值只在 `config.ts`（用例 T2） | 产物 41 KB（infra 同类 91 KB）；三项门禁 pass | 通过（防同一默认值被复写；默认值变更需同步断言） |
| D07 界面规范落实（C6） | 用户明确"必须使用规定的 UI" | `src/client/*` | 运行时读取注入样式表 + 深色主题截图 ×2 + 组件清单审查 | 只用 `SettingsForm`/`SettingsValueField`/`StateDot`/`IconDataOutlineRegular`，`--dsw-*` 变量、无字面量颜色、无 font-weight（用例 T8） | 样式表 5 处 `var(--dsw-…)`、0 字面量颜色、0 font-weight 声明；截图见会话产物 | 通过（局限：浅色主题未切换截图） |
| C1 只展示不加工 | 用户原话 | 浏览器半全部源码 | 逐文件审查 + 地址切换观察 | 无读取 iframe 内容、解析 token 数据或按内容分支的代码（用例 T5） | 审查无命中；src 三次随配置切换（默认/60099/x-dash） | 通过（局限：换页"原样显示"的正向观察未补，见未验证） |
| C2 地址走配置 | 用户原话 | 投影与表单 | 同 D03/D04 证据 | 改地址即换页面、详情页可见可改 | 0.8s 内 src 跟随；Reset 回默认 | 通过 |
| C3 打不开不拖垮 Web | 用户确认 | 宿主半空 `apply` + 面板局部状态 | 隔离实例在目标 401 状态下从头启动，全程操作会话/插件页/其他入口；`grep -ciE "error\|exception" /tmp/ata-web.log` = 0 | Web 启动、会话、MadeMe/Infra 照常，仅本面板提示（用例 T7） | 观察成立，日志 0 条 error | 通过 |
| C5 数值与地址全部走配置 | 用户原话 | D01 + D06 证据 | 同上 | 详情页可见可改、不写死 | 见 D01/D06 行 | 通过 |
| C6 界面按规范 | 用户确认 | 同 D07 | 同 D07 | 同 D07 | 同 D07 | 通过（浅色截图局限） |
| R1 模块边界 | 共用规范 | `src/client/*`、`tsconfig.browser.json` | 审查导入 + D06 产物断言（schemastery=0 即宿主 schema 未进浏览器半） | 浏览器半只依赖三个 client 服务与 `normalize-url.ts` | 审查与机器断言均通过 | 通过 |
| R2 协议优先 | 共用规范 | `src/config.ts` 权威 schema；`normalize-url.ts` 两端共用 | 审查 + T1 单测 | 表单层不另写校验副本 | 唯一一份规范化函数被两半引用 | 通过 |
| R4 数据唯一来源 | 共用规范 | profile patch 权威存储 | 追读路径 | 运行期唯一读取路径 `configForms` 投影 | 投影单点（client/index.ts），无第二读取路径 | 通过 |
| R5 概念命名 | 共用规范 | 配置键 `pageUrl`/`pageLoadTimeoutMs`、快照 `PageTargetState` | 审查 | 避开本仓库"token=暗号"语义 | 键名与文案一致，无第二套概念 | 通过 |
| R6 具名配置 | 共用规范 | 同 D01 | 同 D01 | 具名、单位、默认值 | 见 D01 | 通过 |
| R7 数据流与状态 | 共用规范 | 配置→投影→面板链路 | 设计时序图对照 + 浏览器热生效观察 + 乐观锁冲突实测 | 保存→投影重算→重载；并发保存报错重试 | 三次地址/超时改动均热生效；并发冲突提示符合 | 通过 |

## 不适用项

| 条目与来源 | 不适用理由 |
|---|---|
| R3 跨语言协议 | 本插件纯 TypeScript，与 x-token 之间只有一个 URL 字符串，无跨语言数据协议 |

## 失败、未验证与待确认

- 失败：无。
- 未验证 1（C4 停用相关，feat01 场景3 与 feat03 场景3）：插件页 "Enable" 开关属插件管理器层，不卸载经 profile 加载的实例（实测开关从关切到开，入口与配置均不变；与 kmh-infra 验收记录一致）；直接停用需从 `profiles/kmh-web/cordis.patch.yml` 移除实例并重启，本轮因另一会话正在并发编辑该文件而未执行。最小补法见 task-sidebar-panel-config dev-report"未决"（注释实例行→重启核对→恢复→核对配置保留→Reset）。
- 未验证 2（用例 T5 的正向观察）：把地址换成一个允许被内嵌的本机页面后"原样显示"。x-dash 根页面 6s 未触发 load（疑似拒绝内嵌）；改用验证实例自身地址时保存被并发乐观锁挡住。代码审查与 src 跟随证据已在 C1 行。补法：重启隔离实例后换地址核对再 Reset。
- 未验证 3（用例 T8 的浅色主题）：仅截取深色主题；切换浅色并截图即可补。
- 待确认（范围外，x-token 侧）：`http://localhost:60010/_svc/x-token/` 对无凭据请求返回 401 空响应（curl 两种主机名均 401）。用户已确认页面不需要登录；在 x-token 侧放行该页面前，默认配置下面板只能是空白或超时提示。
- 新增验收测试：`packages/aggregated-token-analysis/test/token-analysis-{config,client,smoke}.test.mjs`（TDD 随实现编写，无隔离数据残留；浏览器验证用的临时 home `/tmp/ata-verify-home` 与 60020 实例已停止，仓库 profile patch 无覆盖残留）。
- 范围外提示：kmh-infra 的冒烟断言 `doesNotMatch(/8000/)` 是假通过（esbuild 把 8000 印作 `8e3`，且其宿主 schema 本就被打进浏览器半产物），用户未表态修复归属，维持原状；根 `pnpm format:check` 的 5 个失败文件在 `packages/codex-cli`，属会话开始前的既有工作区改动。

结论仅覆盖所列范围、基线和证据。测试通过不是全面正确证明；任一未验证项阻止整体通过，已知失败优先判失败。
