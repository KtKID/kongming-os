---
name: kmh-plugin-guide
description: 在 kongming-os 新建或改造“服务插件”——侧栏入口 + 主区内嵌打开指定域名/IP:端口的 Web 服务页面 + 插件详情页按插件所需逐项展示可配置项（访问地址、超时、开关等）+ 可选把该服务的 MCP 工具接入助手，全程按 kmh Web 界面规范（ui-primitives 组件、--dsw token、settings 体系 volatile 字段）落地并完成 profile 登记与验证。凡用户提到“给 X 服务做个插件/面板/入口”“在 Kongming 里内嵌打开某个网页”“插件详情里要能配地址”“把某个 MCP 接进助手”“照着 mademe/infra 再做一个”等，即使没说“插件”二字也使用本技能。
---

# KMH 服务插件制作指南

本技能把 kongming-os 里已经走通两次的“服务插件”做法固定下来：`@kmh/mademe`（最小形态，1 个配置项）与 `@kmh/kmh-infra`（完整形态，8 个配置项 + 运行期取暗号 + 插件内挂 MCP）。新插件以 kmh-mademe 为模板起步，需要更多配置项或运行期逻辑时参照 kmh-infra。先遵循根 [AGENTS.md](../../../AGENTS.md)，文档写法遵循 [kmh-doc](../kmh-doc/SKILL.md)，文字遵循 [kmh-prose-standard](../kmh-prose-standard/SKILL.md)。

## 目录

- [一个服务插件由什么组成](#一个服务插件由什么组成)
- [先做两个判断](#先做两个判断)
- [工作流程](#工作流程)
- [已知坑](#已知坑)
- [参考与索引](#参考与索引)

## 一个服务插件由什么组成

一个包、两个半边，整体交付、整体启停：

| 半边 | 运行位置 | 负责 | 现行示例 |
|---|---|---|---|
| 宿主半 | Node（DSH 进程） | 声明 Config schema；需要运行期逻辑时在这里做（取凭据、挂 MCP、订阅配置热更新） | [kmh-mademe/src](../../../packages/kmh-mademe/src)（apply 为空）、[kmh-infra/src](../../../packages/kmh-infra/src)（有 token.ts、mcp.ts） |
| 浏览器半 | DSH Web 客户端 | 侧栏入口、主区 iframe 面板、插件详情配置表单、词典 | [kmh-mademe/src/client](../../../packages/kmh-mademe/src/client)、[kmh-infra/src/client](../../../packages/kmh-infra/src/client) |

用户在界面上看到的三件事：侧栏多一个图标，点开在主区内嵌该服务的网页；插件页 → View 该包，详情页直接内联一张配置表单，**插件需要的每个配置项都在表单上**，保存即生效，附带“测试连接”；助手可选多出一组 `mcp__<server>__<tool>` 工具。

## 先做两个判断

**判断一：MCP 工具要不要写进插件。** 先问“接入需不需要运行期取值”。不需要（本机 stdio 服务、无凭据、无 env、服务自己能定位目录）就不写代码，直接在 profile 的 `cordis.patch.yml` 声明一个 `@deepseek-ai/dsh-mcp-client` 实例，仓内先例是 `bundles/dsh-web` 的 `mcp-openviking` 与两个 profile 的 `mcp-mademe`；需要（kmh-infra 要在运行期起 shell 读暗号）才在宿主半编程装配。代价要对用户讲清：YAML 路线没有页面开关、不随插件启停、改路径需编辑 YAML 并重启。

**判断二：目标网页能不能内嵌。** 服务若发 `X-Frame-Options` 或 CSP `frame-ancestors` 拒绝嵌入，iframe 只会表现为“一直加载不出来”，浏览器不让读跨源错误，无法与网络不可达区分。先在普通浏览器里用 `<iframe src>` 试一次；不能嵌的服务只能保留“在系统浏览器打开”，面板价值大减，要在需求阶段告诉用户。

## 工作流程

### 1. 定需求与配置项清单

逐条写下配置项，每条有用户来源——第一版只做用户明确要的功能，旧实现里继承来的固定、联动、待核实项默认不进 v1。每个配置项定四样：名字（camelCase，一个概念一个名字，面板地址与查询目标是同一个服务就只设一个字段，不要 `serviceUrl`/`mcpUrl` 两套）、类型、默认值（真实值由用户提供，占位值在代码里标 TODO）、表单呈现（地址框 / 文本框 / 正整数 / 开关）。

参考 kmh-infra 的 8 项：面板地址、暗号环境变量名（只填变量名，不填暗号）、Python 位置、模块目录、面板加载超时、探测超时、单次查询超时、接入开关。规格与技术设计写在 `docs/spec/<plugin>-v0.1/`，模板见 [mademe-plugin-v0.1](../../../docs/spec/mademe-plugin-v0.1/)。

### 2. 以 kmh-mademe 为模板建包

```
packages/kmh-<name>/
  package.json         # name @kmh/<name>；exports "." 与 "./client"；
                       # dsh.client { inject: [...], platform: "web" }；dsh.bundle.patch
  cordis.patch.yml     # 组合包 patch：- insert: [{ id: kmh-<name>, name: "@kmh/<name>" }]
  build.mjs            # 先 rm lib 再构建：tsc 宿主半 + esbuild 浏览器半（cjs，__ModuleLoader__ 工厂）
  tsconfig.json / tsconfig.host.json / tsconfig.browser.json
  src/index.ts         # 宿主半：导出 Config、name、apply
  src/config.ts        # Config schema + normalizeHttpUrl
  src/client/index.ts  # 浏览器半：四处注册 + 刷新恢复选中态
  src/client/<Name>Panel.tsx    # iframe 面板
  src/client/<Name>Icon.tsx     # 侧栏图标（16/18px 两档）
  src/client/ConfigForm.tsx     # 详情页表单
  src/client/config-controller.ts  # SettingsFormModel 桥接
  src/client/locales.ts         # zh/en 同键词典
  src/client/styles.ts          # 少量附加排版，JS 注入一次
  test/*.test.mjs      # node --test，import lib/ 产物
  README.md            # 按 kmh-doc 包 README 模板
```

直接复制 `packages/kmh-mademe` 整个目录改名最省事；复制后全文替换 `mademe`/`MadeMe` 并核对 `package.json` 的 `peerDependencies`/`devDependencies` 只留实际导入的包（不用的依赖摘掉并 `pnpm install` 同步锁文件，否则 `--frozen-lockfile` 失败）。

### 3. 宿主半：Config schema

```ts
import type { Volatile } from "@deepseek-ai/cordis";
import Schema from "@deepseek-ai/schemastery";

const serviceUrl = Schema.string()
  .description("X 服务地址")
  .default("http://127.0.0.1:12345")
  .volatile();
const probeTimeoutMs = Schema.number()
  .description("连通性探测超时（毫秒）")
  .step(1).min(1).max(Number.MAX_SAFE_INTEGER)
  .default(5000)
  .volatile();

export interface Config {
  serviceUrl: Volatile<string>;
  probeTimeoutMs: Volatile<number>;
}
export const Config = Schema.object({ serviceUrl, probeTimeoutMs });
```

- 字段一律 `.volatile()`：插件详情表单保存后，loader 把新值热提交进运行中的配置引用（`config.serviceUrl.get()` 立刻是新值）并发 `loader/volatile-update`；持久化由 settings + config-editor 写回当前 profile 的 patch。
- **只用原生 `Schema.string()/number()/boolean()`，不要 transform 节点。** transform 的序列化产物会被 settings 的 client 链路丢弃，结果是整个命名空间在配置页不可见（kmh-mademe 实测）。地址格式校验与规范化放到表单的 parse 层（`normalizeHttpUrl`：无 scheme 补 https、只收 http/https、拒内嵌凭据与非法主机名）。
- `apply` 没有运行期逻辑就写成空函数 `export function apply(): void {}`；不要留 `_ctx`/`_config` 之类未用参数，根 ESLint 没配 `argsIgnorePattern`，会被 `no-unused-vars` 拦下。
- 需要运行期逻辑（挂 MCP、取凭据）时：`apply(ctx, config)` 里 `mount.sync()`，订阅 `ctx.on("loader/volatile-update", () => mount.sync())`，用 `ctx.effect` 登记卸载；装配键用 `JSON.stringify` 把参与挂载的配置值串起来，键没变就不动在跑的实例。完整写法见 [kmh-infra/src/mcp.ts](../../../packages/kmh-infra/src/mcp.ts)。

### 4. 浏览器半：四处注册

`src/client/index.ts` 的 `inject = ["slots", "locale", "layout", "configForms"]`，apply 里按顺序做：

1. `ctx.locale.register(NS, { zh, en })`，`const t = ctx.locale.bind(NS)`。
2. `ctx.slots.inject("main", …)`：keyed 面板，`key: PANEL_ID`（`brandString<MainPanelId>("<name>")`），注入 `serviceUrl` 快照——来自 `ctx.configForms.get("kmh-<name>")` 的订阅投影，不要自己再拉一次配置。
3. `ctx.slots.inject("sidebar.panellist", …)`：`{ id: PANEL_ID, order, label }` + 图标组件；点击由现成的 PanelRow 调 `ctx.layout.selectPanel`。
4. `ctx.slots.inject("plugins.bundle.config", …)` 与 `ctx.slots.inject("plugins.row.config", …)` 各注册一次同一个 `ConfigForm`，`key` 为包名 `@kmh/<name>`，两处共用一个 controller 实例。

刷新恢复：订阅 `ctx.layout.panelInfo`，选中本面板时写 `localStorage["kmh-<name>:active"]`，启动时若存在则 `selectPanel`；`activePanelId` 是瞬态，不做这步刷新后回到会话。

### 5. 配置表单：插件需要的每个字段都要展示

表单用 ui-primitives 的 `SettingsForm` 包住，controller 用 `SettingsFormModel(scope, fieldSpecs)` 桥接 `configForms` 的共享表单（staged 编辑、revision 乐观锁、覆盖标记、非法值拦截都由它承担）。每种配置项对应一种字段规格，照抄 kmh-infra 的 [config-controller.ts](../../../packages/kmh-infra/src/client/config-controller.ts)：

| 配置项类型 | 字段规格 | 控件 | 规则 |
|---|---|---|---|
| http(s) 地址 | `settingsHttpUrlField` | `SettingsValueField` | 空草稿 = 清除；非法地址阻塞保存并内联提示；合法值规范化后保存 |
| 普通文本（路径、变量名、命令） | `settingsTextField` | `SettingsValueField` | 原样保存；凭据类只收“变量名”，取值由宿主半运行期解析，不落配置文件 |
| 毫秒/正整数 | `settingsPositiveIntegerField` | `SettingsValueField` | 非正整数阻塞保存 |
| 开关 | `settingsBooleanField` | 开关行：标签左、`Switch` 右、下方三级色 hint | 文本 `"true"/"false"` 暂存 |

每个字段都给 `label` 与 `hint`，hint 里写一个真实示例值（`如 http://127.0.0.1:60010`）。“测试连接”只对 http(s) 地址做 no-cors 可达性探测（超时取配置或 5 秒），结果用 `StateDot` 状态点 + 12px 辅助文本；stdio 进程、文件路径这类没有 URL 的配置项不做探测列。表单组件收到 `view`，`view !== "page"` 时返回 `null`——不分支的话摘要行与详情页会各渲染一份卡片。

### 6. 内嵌面板

iframe 属性照抄 DSH 浏览器 tab 的策略：`sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox"`、`referrerPolicy="no-referrer"`、`title` 固定为服务名。工具栏常驻三件：刷新（重设 `src`）、在系统浏览器打开（`window.open(url, "_blank", "noopener")`）、地址只读展示。8 秒无 `load` 显示“可能无法内嵌打开”提示条并指向系统浏览器按钮。面板切走即卸载 iframe，切回按当前地址重载——不要依赖保活池，WebKit/Safari 同步搬移 iframe 必定重载（实验结论，Chrome 保留），登录态靠服务 cookie。

### 7. 界面规范

强制规则在 [插件 Web 界面规范](../../../docs/kmh/web-ui.md)：控件只用 [ui-primitives 组件目录](../../../third_party/dsh/packages/client/ui-primitives/README.zh.md#component-catalog)，颜色/圆角/间距/阴影只用 `--dsw-alias-*` token，禁止第三方组件库与 CSS 框架，样式只能来自组件包与内联 style。现行插件把少量附加排版（字段分隔线、开关行、hint 文字）放在 `styles.ts` 里以 JS 注入一次 `<style>`，class 加包名前缀，属性值全部取 `var(--dsw-alias-*)`，行/详情字号 13px、hint 12px、字重不超过 500——新增样式先看这两个文件里有没有现成的 class。设计判断（反馈界面选 Toast 还是原位提示、浮层与菜单安全、加载态、错误文案位置）按 [dsh-client-ui-ux](../dsh-client-ui-ux/SKILL.md)。每种颜色在明暗两套主题下都看一遍。

### 8. 接入 profile 与登记

按 [新增 Kongming 自有包](../../../docs/kmh/adding-a-plugin-package.md) 逐项登记。kmh-web 的惯例是 `profiles/kmh-web/package.json` 的 `dependencies` 加 `"@kmh/<name>": "link:../../packages/kmh-<name>"`，并在 `profiles/kmh-web/cordis.patch.yml` 的 `- insert:` 里挂实例（不是 `dsh.profile.bundles`；包内 `dsh.bundle.patch` 保留给插件页安装场景）：

```yaml
    - id: kmh-<name>
      name: '@kmh/<name>'
      # 配置项默认值见包内 src/config.ts；运行时经插件详情页表单修改并持久化回本 patch。
```

根 `package.json` 五处 filter 列表（`build:kmh`、`typecheck:kmh`、`lint`、`format:check`、`test`）登记本包；`pnpm install` 同步锁文件。文档三处：包 README（按 [kmh-doc 包 README 模板](../kmh-doc/templates/package-readme.md)，含配置项、已知限制、维护归属）、[插件索引](../../../docs/kmh/plugin-index.md) 加一行、实例级配置若落在 profile 则写进该 profile 的 README。

### 9. MCP 工具（可选）

走 YAML 路线时在 profile 的 `- insert:` 加：

```yaml
    - id: mcp-<server>
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: <server>          # 工具名 mcp__<server>__<tool>；全部实例中唯一
        transport: stdio
        command: /opt/homebrew/bin/node
        args: ['/absolute/path/to/server/dist/index.js']
```

- `serverName` 在所有 mcp-client 实例里必须唯一：重名时**后加载的实例失败**。若某插件此前已编程式占用同名，先删插件那条线再加 YAML。
- 连接失败不阻塞启动（`failOnStartupError` 默认 false），重连 0.5 秒起倍增、上限 30 秒、连续 10 次失败放弃并注销工具（约两分钟），超过后只能重启。
- Codex CLI 后端的会话在创建时固定工具目录，之后新增的工具对旧会话既不发送、调用也返回 `TOOL_DISABLED`；交付说明必须写“仅新建会话可见”。
- DSH 的 `mcp-resources` 会在有任何 MCP 服务接入时向模型多挂 3 个资源工具；服务不提供 resources 时，在精简工具的 profile 里 `- id: mcp-resources` / `disabled: true` 关掉，并同步该 profile 的工具快照测试。
- 实例级机器检查：在包测试里用 `loadOverlayPatches`（`third_party/dsh/packages/boot/app-boot/lib/index.js`）解析 profile patch，断言实例存在、transport、serverName 唯一，参考 [mademe-smoke.test.mjs](../../../packages/kmh-mademe/test/mademe-smoke.test.mjs)。

### 10. 验证

依次运行并记录实际输出：

```sh
pnpm --filter @kmh/<name> build && pnpm --filter @kmh/<name> typecheck
pnpm --filter @kmh/<name> lint && pnpm --filter @kmh/<name> format:check   # format:check 含 cordis.patch.yml
node --test packages/kmh-<name>/test/*.test.mjs
pnpm config:web | grep -n -A8 "id: kmh-<name>"                             # 合成配置里实例正确
./kmh.sh restart                                                           # schema 默认值不热推，必须重启
```

重启后用真实浏览器过一遍：侧栏出现图标；点开主区加载到服务页面；插件页 → View `@kmh/<name>`，详情页列出全部配置项、修改保存后面板按新值重载、“测试连接”给出可达或不可达；浏览器半产物有缓存，改了 client 代码要强刷。MCP 实例在设置 → Built-in plugins → Global plugins 搜 `mcp`，Status 为 Running；`$KMH_HOME/logs/web-supervisor/web-server.log` 看子进程 ready 行。配置变更按 AGENTS.md 跑完整 `pnpm test`。

## 已知坑

- 配置页看不到本插件命名空间：schema 用了 transform 节点，改回原生字段。
- 改了 `src/config.ts` 默认值但运行时还是旧值：volatile 配置持旧值，重启 Web；先确认 `$KMH_HOME/cordis.patch.yml` 与 profile patch 没有持久化过该字段。
- 浏览器半改了没生效：加载器交付构建产物、无 HMR，重新构建后重启 Web 并强刷。
- 面板显示的是另一个服务的页面：端口被别的进程占用，`lsof -nP -iTCP:<port> -sTCP:LISTEN` 核对。
- 同一服务无法同时登录两个账号：浏览器 Cookie 按域隔离，不是插件问题。
- 与宿主同源部署的服务：`allow-same-origin` 下 iframe 与父页面共享 storage，文档里说明即可，默认不限制。
- `pnpm test` 想清空 node_modules：锁文件与 package.json 不同步，先 `pnpm install` 再跑。

## 参考与索引

本地副本（技能自带，离线可读）：

- [DSH · 第一个插件](references/dsh-first-plugin.zh.md)——DSH 面向第三方开发者的插件入门：`apply(ctx)` 形态、`cordis.yml` 插入、自动清理与 `ctx.effect`、`inject` 声明依赖、函数/对象/类三种形态。副本来源与语境差异见文件头注释；子模块升级后以原文为准。

DSH 子模块（随子模块版本更新，按需打开）：

| 主题 | 文档 |
|---|---|
| 插件配置（Config 类型、Schema 校验、无硬编码参数、配合 HMR） | [插件配置](../../../third_party/dsh/docs/user/develop/basic/config.zh.md) |
| 打包与安装（组合包 manifest、profile manifest、加载顺序、从 GitHub 安装） | [打包与安装插件](../../../third_party/dsh/docs/user/develop/basic/publish.zh.md) |
| 开发一个工具（defineTool DSL） | [开发一个工具](../../../third_party/dsh/docs/user/develop/basic/tool.zh.md) |
| 插件与生命周期、服务与依赖、事件系统 | [框架](../../../third_party/dsh/docs/user/develop/framework/index.zh.md) |
| DSH 工作区内部新增包的逐文件清单（package.json 不变式、门禁） | [添加 workspace 包](../../../third_party/dsh/docs/cookbook/adding-a-package.zh.md) |
| 即时配置表单（volatile 字段 + 设置卡片） | [即时配置表单](../../../third_party/dsh/docs/cookbook/adding-a-settings-card.zh.md) |
| 各类插件形态的参考模式 | [扩展插件形态](../../../third_party/dsh/docs/cookbook/extension-cookbook.zh.md) |
| Cordis 机制与防御规则 | [Cordis 机制](../../../third_party/dsh/docs/cordis-primer.zh.md)、[防御规则](../../../third_party/dsh/docs/defensive-patterns.zh.md) |
| 插件页安装/启停/组合包选择 | [plugin-manager](../../../third_party/dsh/packages/boot/plugin-manager/README.zh.md) |
| MCP 客户端配置（stdio / streamable-http、重连、serverName 规则） | [mcp-client](../../../third_party/dsh/packages/mcp/mcp-client/README.zh.md) |
| 样式规则、组件目录、主题 token、圆角 | [Web 样式规则](../../../third_party/dsh/docs/web-styling.zh.md)、[ui-primitives](../../../third_party/dsh/packages/client/ui-primitives/README.zh.md#component-catalog)、[ui-theme](../../../third_party/dsh/packages/client/ui-theme/README.zh.md)、[圆角规范](../../../third_party/dsh/docs/ui-radius.zh.md) |
| 槽位协议（main、sidebar.panellist、plugins.*） | [slots](../../../third_party/dsh/docs/subsystems/slots.zh.md) |

Kongming 侧：

| 主题 | 文档 |
|---|---|
| 新增自有包的登记清单与验证入口 | [新增 Kongming 自有包](../../../docs/kmh/adding-a-plugin-package.md) |
| 插件 Web 界面强制规则 | [插件 Web 界面规范](../../../docs/kmh/web-ui.md) |
| 自有插件索引与 DSH 能力导航 | [插件索引](../../../docs/kmh/plugin-index.md) |
| Web profile 的实例与部署覆盖（含 MadeMe 工具实例） | [Kongming Web 配置](../../../profiles/kmh-web/README.md) |
| 最小形态示例 | [@kmh/mademe](../../../packages/kmh-mademe/README.md) |
| 完整形态示例（多配置项、运行期取暗号、插件内挂 MCP） | [@kmh/kmh-infra](../../../packages/kmh-infra/README.md) |
| 规格 → 技术设计 → 任务记录的模板 | [mademe-plugin-v0.1](../../../docs/spec/mademe-plugin-v0.1/)、[kmh-infra-plugin-v0.1](../../../docs/spec/kmh-infra-plugin-v0.1/) |
| 文档、文字、UI 设计判断 | [kmh-doc](../kmh-doc/SKILL.md)、[kmh-prose-standard](../kmh-prose-standard/SKILL.md)、[dsh-client-ui-ux](../dsh-client-ui-ux/SKILL.md) |
