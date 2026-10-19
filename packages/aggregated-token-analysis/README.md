---
description: 聚合 Token 分析视图服务插件：在 KMH Web 侧栏加"Token 分析"入口，在主区内嵌打开 x-token 的聚合 Token 分析页；页面地址与加载超时在插件详情页填写。只展示，不加工页面内容。
---

# 聚合 Token 分析视图（@kmh/aggregated-token-analysis）

装上并启用后，KMH Web 的侧栏出现"Token 分析"入口（英文界面 Token Analysis），排在 MadeMe、Infra 之后；点开在主区内嵌打开 x-token 提供的聚合 Token 分析页——页面汇总多个渠道的 token 消耗与分布，x-token 侧后续会把它演化成成本分析与异常分析工具。两个配置项（页面地址、页面加载超时）都收在插件详情页，改完即刻生效、不用重启。

**维护边界（规格 C1）**：本插件是打开对应网页的壳。它不读取、不解析、不改写页面内容，也不把任何能力接入助手；页面里看到的一切由 x-token 提供，x-token 升级页面后本插件不需要改动。要给页面加功能，去改 x-token，不要改这里。

与 [MadeMe 服务插件](../kmh-mademe/README.md)、[kmh-infra](../kmh-infra/README.md) 是同一形态的第三个实例，但按剃刀法则只保留最小集合：没有工具栏、没有"在系统浏览器打开"、没有"测试连接"、不记住刷新前的选中状态。

## 适用场景

需要在 KMH 里随手看多渠道 token 用量，或 x-token 的分析页需要一个固定入口时使用。页面不需要登录；若 x-token 部署在别处，改详情页里的页面地址即可。

## 配置项

全部在插件详情页（插件页 → `@kmh/aggregated-token-analysis`）填写，默认值的唯一出处是 [`src/config.ts`](src/config.ts)。

| 配置项 | 默认值 | 说明 |
|---|---|---|
| 聚合 Token 分析页地址 `pageUrl` | `http://localhost:60010/_svc/x-token/` | 内嵌打开的页面地址。不写协议时按 https 处理；非法地址在字段旁原位提示且不保存 |
| 页面加载超时 `pageLoadTimeoutMs` | `8000`（毫秒） | 超过这个时间仍未加载完成，面板顶部提示"页面可能无法打开"并带上正在尝试的地址；须为不小于 1 的整数 |

保存后的值持久化到当前 profile 的 Cordis patch（`profiles/kmh-web/cordis.patch.yml` 的本插件配置覆盖条目）；字段旁的"Reset"恢复继承值。实例由 profile 清单中选择的本插件 bundle 插入，profile patch 通过顶层 `id: aggregated-token-analysis` 覆盖配置；最终组合中的该 ID 保持唯一。

保存失败时，表单直接显示宿主或传输层返回的原文错误，并保留草稿。根据错误核对配置覆盖或版本冲突；需要以宿主当前值重新编辑时，离开详情页再进入。配置写入、原文错误展示和共享镜像同步均由本插件调用公开 settings API 实现。

**装完要改什么**：只有页面地址——x-token 不在本机 60010 时改它；其余不用动。

## 失败处理

- x-token 没运行、地址填错或页面拒绝被内嵌：面板显示加载中，超过配置的超时后出现提示（含地址与可能原因）。KMH 的会话与其他插件不受影响（规格 C3）。
- 页面返回 401 等空响应：浏览器可能把它当作已加载而显示空白、也可能不触发加载完成而出提示——两种都意味着 x-token 侧没有放行该页面，去 x-token 侧处理。
- 地址或超时填成非法值：原位提示并阻塞保存，原值继续有效。

## 限制

- 切到会话再回来会重新加载页面，页面内状态不保留（WebKit 系浏览器搬移 iframe 必然重载，与 MadeMe、Infra 相同）。
- 浏览器 `localhost` 与 `127.0.0.1` 是两个站点，若页面将来需要登录态，地址写法要与登录时一致。

## 源码结构

| 文件 | 职责 |
|---|---|
| `src/index.ts` | 宿主半：导出 `Config` 与 `normalizeHttpUrl`，`apply` 为空（没有宿主侧运行逻辑） |
| `src/config.ts` | 两个 volatile 配置项的 schema，默认值唯一出处 |
| `src/normalize-url.ts` | 地址规范化纯函数，宿主半与浏览器半共用；浏览器半只引它、不引 `config.ts`，因此宿主 schema 与默认值不进浏览器半产物 |
| `src/client/index.ts` | 浏览器半：注册词典、侧栏入口（`order: 12`）、中心面板、两处配置表单槽；把配置投影成面板快照；注入 `slots`、`locale`、`configForms`、`remote` 与 `remote.settings` |
| `src/client/TokenAnalysisPanel.tsx` | 内嵌视口 + 居中加载态 + 超时提示；无工具栏 |
| `src/client/ConfigForm.tsx`、`config-controller.ts` | 两字段配置表单（`SettingsForm` + `SettingsValueField`），地址与正整数两种字段规格 |
| `src/client/config-write.ts` | 用公开 settings Remote 写入配置并转发 revision；成功后回填共享镜像，拒绝时读取宿主当前状态并保留写入错误原文；恢复读取失败单独记录 |
| `src/client/locales.ts`、`TokenAnalysisIcon.tsx`、`styles.ts` | 中英文案；`IconDataOutlineRegular` 图标；`token-analysis-` 前缀样式，颜色取 `--dsw-*` 主题变量 |

规格与设计见 [docs/spec/aggregated-token-analysis-view-v0.1](../../docs/spec/aggregated-token-analysis-view-v0.1/spec.md)。

## 验证入口

```sh
pnpm --filter @kmh/aggregated-token-analysis build
node --test packages/aggregated-token-analysis/test/*.test.mjs
```

测试覆盖 schema 默认值、地址规范化、注册与配置投影、构建产物和分发声明、实际配置组合的唯一挂载，以及真实表单模型下的原文错误、草稿保留、revision 转发与保存成功后的镜像更新。规格 C5 的门禁要求浏览器产物保持 schema 与默认配置分离。浏览器验收包括：详情页改地址与超时后热生效、保存失败显示宿主原文、刷新与重启后配置保留。

## 开发备注

- `normalizeHttpUrl` 是 kmh-mademe、kmh-infra 之后的第三份同型拷贝，三处要同改；出现第四个服务插件时再抽共享包（技术设计确认记录第 2 条）。
- kmh-infra 用"产物里搜不到 `8000`"证明超时未写死，但 esbuild 把 8000 印成 `8e3`，那条断言是假通过；本插件改为拆文件 + 双写法断言，见技术设计 D06。
- 维护归属：KMH 自有插件，随本仓维护。
