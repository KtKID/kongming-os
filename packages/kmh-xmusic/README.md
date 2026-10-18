---
description: "x-music 服务插件：在 Kongming Web 侧栏加一个 x-music 入口，点击后主区内嵌打开 x-music 的 Web 端（默认 http://127.0.0.1:60070）；面板地址为唯一配置项。"
---

# @kmh/xmusic

## 概述

给 Kongming Web 的侧栏加一个 x-music 入口，点开在主区内嵌打开 x-music 的 Web 端（本机 60070 的管理面板，能搜歌、点播、看听歌数据并在浏览器里出声）。面板里的一切内容由 x-music 提供，本插件只负责"把它嵌进来"：没有工具栏、没有加载超时提示、没有系统浏览器兜底——面板打不开时看到的就是浏览器对该 iframe 的原生呈现。第一阶段没有插件详情配置表单，也没有助手工具接入（[规格](../../docs/spec/xmusic-plugin-v0.1/spec.md)第二阶段）；改面板地址需编辑 profile 配置后重启 Web。

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

要在 Kongming 里直接使用 x-music 的管理面板而不切到独立浏览器标签时启用。x-music 未运行时入口照常出现、面板照常切入，页面内容为浏览器的原生错误呈现，本插件不做判断与提示。要在助手会话里调用 x-music 的搜歌、点播工具，属规格第二阶段（feat03），本插件不提供。

### 配置

挂载行（kmh-web profile 已登记）：

```yaml
- id: kmh-xmusic
  name: '@kmh/xmusic'
```

| 配置键 | 默认值 | 含义 |
|---|---|---|
| `boardUrl` | `http://127.0.0.1:60070` | 内嵌打开的 x-music Web 端地址 |

改地址：第一阶段没有配置表单，在挂载条目下加 `config: { boardUrl: <地址> }` 后重启 Web。地址只能指向 x-music 的 Web 端；music-core（3000）与手机网关（60073）不是面板目标（规格 C1）。

-----

<a id="实现说明"></a>
## 实现说明

<details>
<summary>实现细节 — 点击展开</summary>

一个包两个半，与 [@kmh/mademe](../kmh-mademe/README.md)、[@kmh/aggregated-token-analysis](../aggregated-token-analysis/README.md) 同形态：

- `src/index.ts` — 宿主半入口：导出 `Config` 与插件名 `kmh-xmusic`；`apply` 为空（没有运行期逻辑，也不装配 MCP）。
- `src/config.ts` — `boardUrl` 的 Schema 声明（volatile string）。面板地址默认值的唯一出处。
- `src/client/index.ts` — 浏览器半 `apply(ctx)`：注册 zh/en 词典；经 `ctx.configForms.get("kmh-xmusic")` 把 `boardUrl` 投影成快照 store（配置变更热生效）；向 `main` 槽（key 为面板 id `xmusic`）注册 `XmusicPanel`；向 `sidebar.panellist` 槽（order 13，排在现有服务插件之后）注册 `XmusicIcon`。`inject` 恰为 `slots`、`locale`、`configForms` 三个服务——不做刷新恢复，不注入 layout。
- `src/client/XmusicPanel.tsx` — 配置未就绪时中心显示共享加载点（`StateDot`）；就绪后渲染单个 iframe，`sandbox`/`referrerPolicy` 照抄 DSH 浏览器 tab 策略，`key` 取地址（地址变更即重载）。组件不读取、解析或改写 iframe 页面内容。
- `src/client/XmusicIcon.tsx` — 侧栏图标，取 `IconPlayOutlineRegular`（图标库无音符字形，Play 与"搜歌、点播、出声"语义最近）。
- `src/client/locales.ts` — 词典只有一个键 `panel`（面板显示名 "x-music"）。
- `build.mjs` — 先 `tsc -b` 再 esbuild 打包浏览器半为 cjs 工厂（`__ModuleLoader__.load`，id `@kmh/xmusic`）。
- `test/xmusic-config.test.mjs`、`test/xmusic-smoke.test.mjs` — 配置 schema 单测；包声明、产物、剃刀门禁（默认地址只在 `src/config.ts`、产物无配置表单槽/刷新恢复标记）与 profile 登记核对（含"第一版无 x-music 的 mcp-client 实例"反向断言）。

</details>

-----

<a id="验证"></a>
## 验证

在 Kongming 根目录实际运行（2026-10-18，均通过）：

```sh
pnpm --filter @kmh/xmusic build && pnpm --filter @kmh/xmusic typecheck
pnpm --filter @kmh/xmusic lint && pnpm --filter @kmh/xmusic format:check
node --test packages/kmh-xmusic/test/*.test.mjs
pnpm lint
pnpm config:web | grep -n -A2 "id: kmh-xmusic"
./kmh.sh restart
```

成功观察：12 个单测全过；合成配置含 `kmh-xmusic` 实例；重启后侧栏出现 x-music 入口（排在 Token 分析之后），点击主区内嵌加载 `http://127.0.0.1:60070` 的 Dashboard；切回会话时 iframe 卸载，再点入口按当前地址重新加载。失败排查：入口不出现看 `$KMH_HOME/logs/web-supervisor/web-server.log` 与插件面板激活状态；面板空白先确认 x-music 四件套在跑（`curl -I http://127.0.0.1:60070`）。

-----

<a id="归属与相关文档"></a>
## 归属与相关文档

- [插件索引](../../docs/kmh/plugin-index.md) — 自有包总导航。
- [x-music 服务插件规格](../../docs/spec/xmusic-plugin-v0.1/spec.md) · [调查记录](../../docs/spec/xmusic-plugin-v0.1/findings.md) — 需求、约束与第二阶段（MCP 接入、配置表单、超时提示）排期。
- [Kongming Web 配置](../../profiles/kmh-web/README.md) — 挂载条目所在 profile。
- [kmh-plugin-guide](../../.agents/skills/kmh-plugin-guide/SKILL.md) — 服务插件制作流程。

<a id="开发备注"></a>
## 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

- 第二阶段候选与既定草案：feat02 场景3（超时提示与系统浏览器兜底）、feat03（profile 直接声明 `mcp-xmusic` streamable-http 实例，YAML 草案见调查记录第 1 节）、feat04（配置表单，参照 kmh-mademe 的 `ConfigForm`/`config-controller` 复制即可）、刷新后恢复面板选中态。
- 面板打不开不做特殊处理是 2026-10-18 用户拍板：面板内就是浏览器对该 iframe 的原生呈现，不要往 `XmusicPanel` 里加任何提示逻辑。
- 本仓观察（与本插件无关）：页面加载完成后数秒内点击服务插件入口可能不切换面板，MadeMe 同样复现；就绪后点击正常。自动化验证时等待数秒再操作。

</details>
