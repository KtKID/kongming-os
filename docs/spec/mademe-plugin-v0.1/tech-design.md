# MadeMe 服务插件 v0.1 技术设计

对应 [spec.md](spec.md)。所有通路结论均已在 DSH 源码（`third_party/dsh`，kmh/runtime-core）中逐条核实，标注出处。

## 1. 总体形态

新建独立插件包 `packages/kmh-mademe`（npm 名 `@kmh/mademe`），一个包两个半：

- **宿主半**（Node，exports `"."`）：配置 schema（settings 体系读写与持久化）。
- **浏览器半**（exports `"./client"` + package.json `dsh.client` 声明）：侧栏入口、中心 iframe 面板、插件详情配置表单。

MadeMe 工具的接入不在插件内：kmh-web profile 直接声明一个 `@deepseek-ai/dsh-mcp-client` 实例（`mcp-mademe`，stdio）拉起 MadeMe-web 自带的 MCP 服务，见 §4.2。

包自带 `dsh: { bundle: { patch: './cordis.patch.yml' } }`，即 DSH 的**组合包（bundle）**——这是"可导出式插件"的官方形态：既能以 `link:` 依赖进 kmh-web profile，也能以 git 地址 / 本地路径 / registry 包被任何 DSH Web 的插件页 `pnpm add` 安装、启停（`packages/boot/plugin-manager/README.zh.md` 安装机制）。**零 DSH 子模块改动，零侧栏/布局改动。**

## 2. 通路调研结论（已核实）

| 结论 | 出处 |
|---|---|
| 全局面板注册范式：`PANEL_ID = 'mademe' as MainPanelId`（字符串断言，第三方合法）；`ctx.slots.inject('main', ...)` 注册中心面板（keyed，key=PANEL_ID）；`ctx.slots.inject('sidebar.panellist', ...)` 注册侧栏图标行（展开态图标+label、收起轨自动显示图标） | `packages/client/ui-plugin-manager/src/client/index.ts:66,110-147`（完整范例） |
| 浏览器半发现机制：package.json `dsh.client` 声明 + `exports['./client']`，client runner 自动挂载 | `packages/extensions/cordis-client-runner/src/index.ts` 模块注释 |
| **`main` 是 keyed slot，entryKey 切换即旧面板 unmount，无保活**；DSH 自己的右栏浏览器 tab 重挂载也是 `reload()` | `packages/client/ui-renderer/src/client/scoped-slots.tsx:1178-1184`；`packages/client/ui-sidebar-browser/src/client/pages.ts:19-21` |
| `activePanelId` 是瞬态（刷新回会话）；`retainMainPanels` 在面板注销时把选中态归位会话（停用插件→主区自动回会话，免费） | `packages/client/ui-layout/src/client/stores.ts:12-21,97-101` |
| ui-sidebar-browser 的 iframe 实现、URL 校验全部**包内私有**（index.ts 只有空 `apply`）→ 复制复用 | `packages/client/ui-sidebar-browser/src/index.ts` |
| iframe 策略：`sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox"` + `referrerPolicy='no-referrer'`；URL 校验仅 http/https、无 scheme 补 https、拒带凭据 | `.../view/IframePresentation.ts:7`；`.../browser/url.ts` |
| MCP 接入：`dsh-mcp-client` 是 namespace 插件，可在 profile patch 中以 YAML 直接声明实例（`transport: stdio` + `command`/`args`），工具名 `mcp__<serverName>__<tool>`；`serverName` 在所有实例中唯一，重名则后加载的实例失败；连接失败默认不阻塞启动（`failOnStartupError:false`），自动重连默认开（0.5s 起倍增、上限 30s、连续 10 次失败放弃并注销工具） | `packages/mcp/mcp-client/src/index.ts`、`src/connection.ts`、`README.md`；同仓先例 `bundles/dsh-web/cordis.patch.yml` 的 `mcp-openviking` |
| 配置表单：插件向插件页声明的槽 `plugins.bundle.config`（key=包名）注册自己的表单组件；值经自有 Remote 持久化（voice-input 为完整范例） | `packages/experimental/client-ui-voice-input/src/client/mount.ts:45-47` |
| 配置改走 DSH settings 体系（volatile 字段 + settings remote + profile 持久化），废弃自建 JSON 存储与自写 Remote | `packages/settings/settings/README.zh.md`；`packages/llm/llm-deepseek-api-key/src/config.ts` |
| 组合包启停 = 修改 profile `package.json` 的 `dsh.profile.bundles` 有序列表，插件页可视操作 | `packages/boot/plugin-manager/README.zh.md` |

## 3. 包结构与模块

```
packages/kmh-mademe/
  package.json        # name/@kmh/mademe；exports "." 与 "./client"；
                      # dsh.client { inject:[…], platform:'web' }；dsh.bundle.patch './cordis.patch.yml'；
                      # peerDependencies: cordis、schemastery、client 侧 ui-slots/ui-layout/ui-sidebar/ui-locale 等
  cordis.patch.yml    # bundle patch：- insert: [{ id: kmh-mademe, name: '@kmh/mademe' }]
  src/
    index.ts          # 宿主半：导出 Config schema 与插件名；apply 为空（无运行期逻辑）
    config.ts         # Config schema：serviceUrl 一个 volatile 字段 + normalizeHttpUrl
    client/
      index.ts        # apply(ctx)：注册面板/侧栏入口/配置表单；启动恢复选中态
      MadeMePanel.tsx # 中心面板：工具栏（刷新、在系统浏览器打开、地址只读展示）+ iframe 容器 + 加载提示条
      iframe-host.ts  # iframe 元素池（保活）+ 创建/搬移 + URL 解析校验（复制适配 url.ts）
      MadeMeIcon.tsx  # 侧栏图标（16/18px 两档，参照 PluginsPanelIcon）
      ConfigForm.tsx  # 插件详情表单：服务地址 + 测试连接
      locales.ts      # zh/en 词典
  test/              # node --test 单测（*.test.mjs，import lib/ 产物）
```

## 4. 关键机制设计

### 4.1 配置：走 DSH settings 体系（实现期修正，废弃自建存储）

实现期发现 DSH 已有完整的插件配置体系（`dsh-settings` + `dsh-config-editor`，kmh-web profile 均已启用；客户端 `ctx.remote.settings` 已挂载），比原"自建 JSON + 自写 Remote"更正统且免掉 typert 生成器集成，设计修正如下：

- 配置 = 宿主半 Config schema 的一个 **volatile 字段**：`serviceUrl`（string，默认 `http://127.0.0.1:30000`）。volatile 字段经 settings 表单修改后由 loader 把新值**热提交进运行中的配置引用**（`config.serviceUrl.get()`），并发 `loader/volatile-update` 事件；持久化走当前 profile 的 Cordis patch（config-editor 负责）。
- 宿主半直接读自己 Config 引用，无自建存储、无自写 Remote。
- 浏览器侧 ConfigForm 经已挂载的 `ctx.remote.settings`：`describe()` 取 `ns='kmh-mademe'` 的 view（schema 投影 + 解析值 + revision），`update(ns, patch, expectedRevision)` 写回（revision 乐观锁，过期写被拒）。变更事件 `settings/document-updated`。
- URL 校验双防线：schema 的 transform/validate（宿主侧）+ 表单内联校验（客户端）。

| 结论 | 出处 |
|---|---|
| volatile 字段：`z.string().default(...).volatile()` → `Volatile<T>` 活引用 `.get()`；写入后 loader 热提交 + `loader/volatile-update` | `packages/llm/llm-deepseek-api-key/src/config.ts`；`vendor/loader/README.md` Entry.update 节 |
| settings remote（客户端已挂载）：`describe()` / `update(ns, patch, expectedRevision)` / `replace` / `mutate`，revision 乐观锁 | `packages/api/settings-controller/lib/typert.remote-client.d.ts` |
| SettingsNamespaceView：ns=profile 条目 id、schema 序列化投影、value 解析值、`applies:'live'` | `packages/settings/settings/src/types.ts` |

### 4.2 MCP 接入（feat03）

插件不装配 MCP。MadeMe-web 交付的 MCP 是本机 stdio 进程（`node <MadeMe-web>/mcp/dist/index.js`，不监听端口、无 URL），由 kmh-web profile 的 `mcp-mademe` 实例（`@deepseek-ai/dsh-mcp-client`，`transport: stdio`，`serverName: mademe`）在 Web 启动时拉起为子进程，与同仓 `mcp-openviking` 实例同一形态。要点：

- 服务按自身文件位置定位 MadeMe-web 项目根并以此为工作目录调用 `mademe-cli`，Vault 路径由 MadeMe-web 的 `.env.local` 提供，实例不需要 `cwd`/`env`。
- 入口或 CLI 缺失：子进程启动即退出，mcp-client 按重连策略重试，窗口内补齐即恢复，超过后重启 Web（对应 spec feat03 场景2）。
- 停用：从 profile 移除实例并重启 Web；停用 `@kmh/mademe` 插件不影响工具（spec feat03 场景3）。
- 实例配置、核对入口与排障归属 [Web 配置 · MadeMe 工具](../../../profiles/kmh-web/README.md#mademe-工具)；`packages/kmh-mademe/test/mademe-smoke.test.mjs` 以 DSH 的 patch 解析器核对该实例存在、为 stdio 且服务名唯一。

### 4.3 iframe 面板与保活（feat02 核心）

`iframe-host.ts` 三件事：

1. **URL 解析**（复制 `url.ts` 改编）：仅 http/https；无 scheme 补 `https://`；拒 URL 内嵌凭据；不做 application-origin 拒绝（自有服务可能同域反代部署——同源 + `allow-same-origin` 会与父页面共享 storage，属已知边界，文档说明）。
2. **iframe 创建**：属性照抄 DSH 策略（§2 表）；`title` 固定 "MadeMe"；监听 `load`/`error` 上报 revision。
3. **保活池**（本插件新增机制，DSH 无先例）：
   - 模块级隐藏池容器（`display:none`，惰性 append 到 `document.body`）。
   - 面板挂载 → 把池中 iframe **同步 `appendChild`** 进视口容器；面板卸载 → effect cleanup 里同步搬回池。
   - 原理：同一 document 内同步搬移 iframe 元素，现代浏览器保留其浏览上下文（内容、滚动位置、登录态不丢）；跨任务移除才会销毁——池保证元素永不离开 document。
   - 兜底：若实测某浏览器搬移后重载，降级为"恢复 URL 重载"，同时回改 spec feat02 场景 2 措辞。

面板工具栏常驻：刷新（iframe.src 重载）、在系统浏览器打开（`window.open`）、地址只读展示。**无法内嵌/无法访问的检测能力有限**（X-Frame-Options 拒绝时 Chrome 在 iframe 内渲染错误页且照常触发 `load`，跨源不可读）：以"加载中提示条 + N 秒超时后显示『打不开？在系统浏览器打开』提示"落地 spec feat02 场景 4，同时工具栏常驻外部打开按钮。

### 4.4 面板注册与刷新恢复（feat01）

`client/index.ts` 按 §2 范式注册：

- `sidebar.panellist`：`{ id: PANEL_ID, order: 10, label: () => 'MadeMe' }` + `MadeMeIcon`——展开态图标+名称、收起轨图标、悬停提示全部由现有 SidebarRoot/PanelRow 机制渲染，**不改 ui-sidebar**。
- `main`（keyed，key=PANEL_ID）：`MadeMePanel`；点击图标走 `ctx.layout.selectPanel(PANEL_ID)`（PanelRow 现成行为）。
- 停用即消失：插件卸载 → 槽注销 → `retainMainPanels` 把选中态归位会话（spec feat01 场景3 免费）。
- 刷新恢复（场景4，`activePanelId` 是瞬态）：apply 时订阅 `ctx.layout.panelInfo`，选中 PANEL_ID 时写 `localStorage['kmh-mademe:active']='1'`，切走删除；apply 启动时若标志存在则 `ctx.layout.selectPanel(PANEL_ID)`。

### 4.5 配置表单（feat04）

`ConfigForm` 注册进 `plugins.bundle.config`，`key: '@kmh/mademe'`——插件页该包详情页渲染我们的表单（voice-input 同款通路）。表单经 `ctx.remote.settings` 读写 `ns='kmh-mademe'` 的配置（见 §4.1）：describe 取值与 revision，update 提交 patch；格式错误表单内联提示，过期 revision 被拒时重新读取再试。配置变更即时生效（volatile 热提交；面板下次挂载取新地址）。

## 5. feat 落实映射

| feat | 实现 | 备注 |
|---|---|---|
| feat01 侧栏入口 | §4.4 槽注册 | 停用归位免费；刷新恢复自建 |
| feat02 内嵌打开 | §4.3 面板+保活池 | 场景4 检测以超时提示落地 |
| feat03 助手工具 | §4.2 profile `mcp-mademe` 实例（stdio） | 不在插件内装配，不随插件启停（见 §8） |
| feat04 详情配置 | §4.5 表单 + §4.1 settings 体系 | 保存即生效（volatile 热提交） |

## 6. 接入步骤（Kongming 侧）

1. 新建 `packages/kmh-mademe`（§3 结构），构建用 tsc 单 tsconfig 双入口（`lib/index.js` + `lib/client.js`，照 `packages/web-surface-zh` 的 tsc 惯例）。
2. 根 `package.json`：`build:kmh`、`typecheck:kmh`、`lint`、`format:check` 四个 filter 列表追加 `--filter @kmh/mademe`；`test` 脚本追加 `packages/kmh-mademe/test/*.test.mjs`。HMR 监听无需改动（`scripts/plugin-watch.mjs` 的 `discoverWatchPackages` 按目录自动发现，且已识别 `dsh.client.platform`）。
3. `profiles/kmh-web/package.json`：dependencies 加 `"@kmh/mademe": "link:../../packages/kmh-mademe"`；`dsh.profile.bundles` 追加 `"@kmh/mademe"`（走组合包列表而非手写 cordis.patch.yml 条目，与插件页启停机制同一路径，导出安装行为一致）。
4. `pnpm install` → `pnpm web` 验收。
5. 导出形态验收：从另一个 profile 用插件页安装本地路径 `file:../../packages/kmh-mademe` 验证可导出性。

## 7. 测试与验收

- 单测（`node --test`，仓库惯例：`packages/kmh-mademe/test/*.test.mjs`，import `lib/` 构建产物，根 `pretest` 已先构建）：config-store 读写与校验合并；URL 解析边界（无 scheme/坏格式/带凭据）；iframe-host 池的纯逻辑。
- 槽注册、保活池、面板 UI、表单：无 jsdom/vitest 基建，以实浏览器验收覆盖（AGENTS.md 本就要求 Web 用户流程用实际浏览器验证）。
- MCP 验收：重启 Web 后核对启动日志的 `[mademe-mcp] … ready via stdio` 行，以及设置 → Built-in plugins → Global plugins 中 `mcp-mademe` 的 Status 为 Running；步骤与失败处理见 [Web 配置 · MadeMe 工具](../../../profiles/kmh-web/README.md#mademe-工具)。
- 实浏览器验收：`pnpm web` 逐条过 spec 场景；报告分别说明源码检查与运行结果。

## 8. 风险与 spec 偏差（需回写 spec 或知悉）

1. **feat02 场景2（不重载）依赖 iframe 同步搬移保活**——现代浏览器成立但无 DSH 先例，实现第一步先做该实验；失败则降级为"恢复 URL 重载"并改 spec。
2. **feat03 接入方式变更（2026-10-17）**：原设计在插件内以 streamable-http 挂 `mcpUrl`，实现后核实 MadeMe-web 没有任何 HTTP MCP 端点，其 MCP 是 stdio 进程。改为 profile 直接声明 `mcp-mademe` 实例（§4.2），插件删除 `mcp.ts` 与 `mcpUrl`/`mcpEnabled` 字段。代价：工具不再随插件启停，没有页面开关，改路径或停用需编辑 profile 并重启 Web；spec feat03 已按此改写，原场景4（未配置接入地址）随字段删除。选 YAML 而非 kmh-infra 式编程装配的理由：MadeMe 的服务不需要任何运行期取值（无暗号、无 env、自定位目录），编程装配没有收益。
3. **无法内嵌的检测**：以超时提示 + 常驻外部打开按钮落地，不能精确区分"拒绝嵌入"与"网络失败"。
4. **同源部署边界**：`allow-same-origin` 下若 MadeMe 与 KMH 同源，iframe 与父页面共享 storage；文档说明，默认不限制。
5. `serviceUrl` 默认值待用户提供（实现时填入常量）。

## 9. 本期不做

不改 `ui-sidebar`/`ui-layout`/`ui-dockkit`（零 DSH 改动）；不做 hover 轨/钉住（二期 spec `../workbench-rail-sidebar-v0.1/spec.md`）；不做同服务多账号；不做手动添加网页快捷方式。
