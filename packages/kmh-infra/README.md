---
description: kmh-infra 服务插件：在 KMH Web 侧栏加 Infra 入口、在主区内嵌打开 x-dash 面板，并把 x-infra 的本机服务查询接成助手工具。
---

# @kmh/kmh-infra

## 概述

装上并启用后，KMH Web 的侧栏出现 Infra 入口，点开在主区内嵌打开 x-dash 面板；同时把本机服务查询接入助手，会话里可以直接问"本机有哪些服务在跑"或某个服务现在的状态。八个配置项都收在插件详情页，不需要改配置文件，改完即刻生效、不用重启。

主要代价与边界：**只能查询**，不提供任何启停、修改或删除服务的操作；暗号只以"环境变量名"的形式保存在配置里，暗号本身要在启动 KMH 之前设进环境，否则助手查询会得到身份校验错误。面板与助手查询共用同一个 x-dash 地址，只填一处。

## 目录

- [用途](#用途)
- [实现说明](#实现说明)
- [验证](#验证)
- [归属与相关文档](#归属与相关文档)
- [开发备注](#开发备注)

-----

<a id="用途"></a>
## 用途

### 何时选择

需要在本机随时看 x-dash 里登记的服务状态，或想让助手直接回答这类问题时使用。只想看面板、不需要助手能力时，把配置里的接入开关关掉即可，入口与面板不受影响；不需要侧栏入口而只想给助手工具时，用 DSH 的 `mcp-client` 直接挂 x-infra-mcp 更省事，代价是配置得写在 profile patch 里而不是插件详情页。本插件与 [MadeMe 服务插件](../kmh-mademe/README.md)是同一形态的两个实例。

### 配置

在 `profiles/<profile>/cordis.patch.yml` 中挂载：

```yaml
- id: kmh-infra
  name: '@kmh/kmh-infra'
```

八个配置项全部在插件详情页（插件页 → `@kmh/kmh-infra`）编辑，不在 patch 里手写：

| 配置键 | 默认值 | 含义 |
|---|---|---|
| `dashUrl` | `http://127.0.0.1:60010` | 内嵌打开的面板地址，同时是助手查询的目标；只填一处 |
| `tokenEnvVar` | `X_INFRA_MCP_TOKEN` | **暗号所在的环境变量名**，不是暗号本身 |
| `pythonCommand` | `python3` | 启动服务查询进程的可执行文件 |
| `mcpModuleDir` | `/Volumes/machub_app/proj/x-infra/x-infra-mcp` | 服务查询进程的工作目录，指向 x-infra-mcp 检出目录 |
| `panelLoadTimeoutMs` | `8000` | 面板加载多久仍未完成就提示可能无法打开 |
| `probeTimeoutMs` | `5000` | "测试连接"等待多久算不可达 |
| `toolCallTimeoutMs` | `60000` | 助手单次查询最多等待多久 |
| `mcpEnabled` | `true` | 是否把服务查询能力接入助手 |

装上后通常要改两处：`pythonCommand` 与 `mcpModuleDir`（本机路径，换机器必改）；`dashUrl` 与 `tokenEnvVar` 多数情况不用动。

**暗号怎么给**：暗号不进配置。启动 KMH 之前把它设进进程环境，变量名与 `tokenEnvVar` 一致：

```sh
export X_INFRA_MCP_TOKEN="<与 x-dash 进程相同的暗号>"
```

x-dash 侧不设这个暗号时查询端点整体关闭，助手会得到身份校验错误——这与暗号填错的表现一致，都由助手回答"身份校验错误"。配置项标签写明该字段填变量名而非暗号，暗号也不会出现在日志或错误消息里。

-----

<a id="实现说明"></a>
## 实现说明

<details>
<summary>实现细节 — 点击展开</summary>

本包是宿主半加浏览器半的 Cordis 插件：宿主半（`src/index.ts`）持有配置 schema，并按配置把服务查询能力挂到助手工具面；浏览器半（`src/client/`）向侧栏注册入口、向中心区注册内嵌面板、向插件页注册配置表单。两侧共用 `src/config.ts` 里的配置 schema 与地址规范化函数，浏览器半不直接读宿主内部。停用插件时两侧一起消失，已填配置保留。

**`src/index.ts`（宿主半入口）** 导出 `name` 与 `apply`。`apply(ctx, config)` 建一个 `McpMount` 并调用 `sync()`，再监听加载器的 `loader/volatile-update` 事件，在配置变化时重新同步；插件的 `effect` 回收时调用 `mount.dispose()`。它只做装配与生命周期，不含业务判断。

**`src/config.ts`（配置契约）** 定义八个配置项。全部用原生 `Schema.string()` / `number()` / `boolean()` 并标记 `.volatile()`：`.volatile()` 让字段成为运行期活引用（apply 收到的 config 即活引用），配置改动经 loader 热提交，不必重启。不用 transform 节点——其序列化产物会被 settings 的 client 链路丢弃，导致配置页看不到该命名空间。同文件导出 `normalizeHttpUrl()`：补 scheme、拒绝非 http(s)、拒绝内嵌凭据与非法主机名、限制长度，供配置表单的校验层调用。

**`src/mcp.ts`（服务查询装配）** 的 `McpMount` 管理"按配置挂载一组子插件"这件事：

- `sync()` 读取 `mcpEnabled`、`pythonCommand`、`mcpModuleDir`、`dashUrl`、`toolCallTimeoutMs` 与 `tokenEnvVar`；启用且关键参数非空时组成装配键，与上次相同就不动。变化时先卸载旧实例再挂新的，避免重复实例。
- 挂载用 DSH 现成的 `@deepseek-ai/dsh-mcp-client` 的 stdio 形态：`args` 固定为 `-m x_infra_mcp.mcp_server`，工作目录取 `mcpModuleDir`，工具名落在 `mcp__infra__<tool>`。
- **两个环境变量由插件显式传给子进程**：DSH 给子进程的是一份"洗过的"父进程环境，名字匹配 `KEY|PASSWORD|SECRET|TOKEN` 的一律不转发，所以 `X_INFRA_MCP_TOKEN` 不会被自动带进去；`X_DASH_BASE_URL` 取 `dashUrl`。暗号取值单独保存与比较，不进装配键，以免被诊断信息打印出来。
- 失败处理：`failOnStartupError: false`，初始连接失败只记一条告警，工具暂不可用，插件其余部分与 Web 都不受影响；`tokenEnvVar` 为空或该变量没有取值时仍然挂载并记一条告警，查询会返回身份校验错误。
- 同一个 `sync()` 还会挂载 `src/prompt.ts` 的措辞引导，两者一起挂、一起卸。

**`src/prompt.ts`（措辞引导）** 把一个子插件注册到系统提示词的 `MCP_SERVERS` 段位，正文是"结果码 → 该怎么回答"的对照（身份校验错误、面板不在运行、名字查不到、状态暂未知、存在重名等）。工具输出文本由上游服务生成、插件不能改写，所以措辞只能这样引导；正文里不含地址与凭据。

**`src/client/index.ts`（浏览器半入口）** 注册四件东西：词典命名空间 `infra`、`sidebar.panellist` 的入口行（图标 + 名字 Infra，`order: 11`）、中心 `main` 槽的面板、以及插件详情页与组件行详情两处配置表单（`plugins.bundle.config` 与 `plugins.row.config`，键分别是包名与 `包名#行id`）。它还把面板地址与加载超时从 `configForms` 投影成快照注入面板，并在面板被选中时往 `localStorage` 写标记、刷新后于微任务中恢复选中；插件卸载时清掉残留标记。

**`src/client/InfraPanel.tsx`（面板）** 渲染内嵌视口、工具栏（地址、刷新、在系统浏览器打开）与加载超时提示。超时阈值来自配置快照而不是常量：它是"加载完成事件的预算"，不是"最终是否可见"——把 `panelLoadTimeoutMs` 调得很小时，即使 iframe 随后正常渲染，提示条也可能已经出现；提示文案写的是"面板可能无法打开"，面板仍可正常使用，默认 8000 毫秒下不会出现这种情况。面板卸载即销毁 iframe，切回按当前地址重新加载（WebKit 系浏览器搬移 iframe 必然重载）。

**`src/client/ConfigForm.tsx` 与 `config-controller.ts`（配置表单）** 前者用 ui-primitives 的 `SettingsForm` 渲染八个字段与"测试连接"，后者把 settings 体系的共享表单桥接成页面暂存表单。字段规格复用了 ui-primitives 的文本与数值字段模型，地址与布尔两类自定义：地址在 parse 层做规范化并拦截非法值，数值要求不小于 1 的整数（与宿主 schema 的 `min(1)` 对齐，非法值进不了 profile patch）。"测试连接"用 `no-cors` 请求探测面板地址可达性，等待上限取当前草稿的 `probeTimeoutMs`；查询进程是本地子进程、浏览器侧无法探测，因此不提供它的连通性按钮。

**`src/client/locales.ts`、`InfraIcon.tsx`、`styles.ts`（文案、图标与样式）** 词典给中英两套同键文案；图标取自 ui-primitives 现有图标库（仪表盘语义最贴近 x-dash 这种状态台）；样式以 `infra-` 前缀的类名注入，颜色与间距取 `--dsw-*` 主题 token，不写字面量。

**`build.mjs`（构建脚本）** 先清 `lib/`，用 `tsc -b` 编译宿主半与浏览器半（`tsconfig.host.json` / `tsconfig.browser.json` 双 references），再用 esbuild 把浏览器半打成 `__ModuleLoader__.load({id:"@kmh/kmh-infra", …})` 工厂，产物为 `lib/client.js`。它导出的 `watchClient()` 供开发期热构建使用。

**`test/`（包内测试）** 四份，都用 `node --test` 运行：`infra-config.test.mjs` 断言配置默认值、数值类型与地址规范化边界；`infra-client.test.mjs` 把构建产物当模块加载器工厂加载并注入假上下文，断言四个槽位的注册、面板 id 唯一、配置表单的注入面与选中态镜像/刷新恢复；`infra-mount.test.mjs` 用可变 volatile 替身驱动 `McpMount`，断言 stdio 参数、暗号显式传递与不泄漏、重挂与卸载、引导段落的内容边界；`infra-smoke.test.mjs` 断言产物与分发声明（双入口、`dsh.client` 元数据、组合包 patch、两端产物形态）。

</details>

-----

<a id="验证"></a>
## 验证

在 Kongming 根目录运行（都已实际执行）：

```sh
pnpm build:kmh
pnpm typecheck:kmh
pnpm lint
node --test packages/kmh-infra/test/*.test.mjs
node --test tests/runtime/web-plugin-hmr.test.mjs
```

成功时：包内测试全绿（26 项），`build:kmh` 产出 `lib/src/index.js` 与 `lib/client.js`，热重载回归用真实 KMH Web 入口在临时目录起服务并通过。失败时先看 `pnpm --filter @kmh/kmh-infra build` 的报错；模块解析失败通常是 profile 的 `link:` 登记或本包 `node_modules` 未建立。

**环境前提（本机当前状态）**：`pnpm install` 在本机要求先移除 `node_modules`（`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`）。在跑着 KMH Web 的机器上不要直接放行；本包的锁文件登记用 `pnpm install --lockfile-only` 完成，依赖链接按 pnpm 隔离链接器的布局建立。受此影响，根脚本内的 `pnpm --filter` 会做依赖状态检查并连带触发同一个 install，因此本机运行根命令时需要用 `pnpm_config_verify_deps_before_run=false pnpm <script>`。安全时机下应执行一次正常 `pnpm install` 让 pnpm 自己重建链接。

浏览器侧的人工核对：侧栏出现 Infra 入口（收起态悬停提示 Infra）、点开主区显示面板与工具栏、切回会话再回来面板仍在、刷新后恢复、配置改动即刻生效；助手侧问"本机有哪些服务在跑"应得到服务清单而不是推测。

-----

<a id="归属与相关文档"></a>
## 归属与相关文档

- [插件索引](../../docs/kmh/plugin-index.md) — 自有包清单与各自维护入口。
- [功能规格与技术设计](../../docs/spec/kmh-infra-plugin-v0.1/spec.md) — 已确认的关键约束 C1–C12、设计条目与验证用例的正文归属。
- [MadeMe 服务插件](../kmh-mademe/README.md) — 同形态的前一个实例，本包沿用其注册与配置范式。
- [x-infra-mcp](https://github.com/KtKID/x-infra) — 被接入的只读查询服务，工具语义与状态码以其 README 为准。
- [新增自有包](../../docs/kmh/adding-a-plugin-package.md) — 包、构建、profile 与测试的登记清单。

<a id="开发备注"></a>
## 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

- 插件详情页里那一行 bundle 开关显示为未启用，而插件实际通过 profile 的 cordis patch 正常运行：前者指"把这个 bundle 加进 profile"，后者是"profile 里已挂载的实例"，两者互不影响。MadeMe 是同样形态。
- 把 `tokenEnvVar` 清空再保存不会写入空值，字段会回落到 schema 默认（settings 的 clear 语义是"恢复继承下层"），此时保存按钮因无改动而置灰。
- 清空或填错 `tokenEnvVar` 都不阻塞保存，插件与面板照常可用；只有助手查询会报身份校验错误，运行日志里对应一条 `warn`。

</details>
