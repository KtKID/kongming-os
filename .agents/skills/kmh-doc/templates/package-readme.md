# 模板：Kongming 插件包 README

适用于两类 Kongming 自有包：

- `packages/kmh-*` 的 TS Cordis 插件包：入口导出 `apply` 或默认服务，经 `cordis.patch.yml` 挂载行接入 profile。
- `bundles/` 下的 bundle 包：目录内 `package.json` 加有序 patch 文件清单，由 profile 声明选择。

先读包事实再套模板：`src/index.ts` 的入口形态决定插件还是库（纯模块 API 是库，不写挂载指引与配置表，写消费者入口）；bundle 包以 `bundles/` 目录与其 manifest 为准。包 README 的现行参考示例见 [packages/kmh-echo/README.md](../../../../packages/kmh-echo/README.md)。

## frontmatter

```yaml
---
description: "一两句具体描述读者能用本包选择、配置或调试什么，包含可检索的领域词。"
---
```

## 骨架

````markdown
# <包名>

## 概述

三到五句：读者能用本包做什么、何时选择、主要代价、最重要的边界。不描述其 Cordis 角色、注册项或内部组件，除非读者在配置或命令中直接使用。

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

一段：决定条件与回退选择（用哪个相邻包或机制替代）。

### 配置

最小可用的挂载或声明，加配置键表：

| 配置键 | 默认值 | 含义 |
|---|---|---|
| `<key>` | `<默认>` 或 `必填` | 一行含义 |

插件包给 `cordis.patch.yml` 挂载行示例；bundle 包在本节说明 profile 的声明方式、该层加入后的可见表面（工具、provider 或 UI 行），以及每行行为由哪个包承担；库写消费者入口（最小 import 加调用）与成败观察方式。

-----

<a id="实现说明"></a>
## 实现说明

<details>
<summary>实现细节 — 点击展开</summary>

设计概念、组件架构与粗粒度数据流——足以理解本包如何工作。加一张源码映射表链接文件；不罗列 API 目录、不复述注释文档。

</details>

-----

<a id="验证"></a>
## 验证

在 Kongming 根目录实际运行的命令（写出前逐条运行）：

```sh
pnpm build:kmh
pnpm typecheck:kmh
pnpm test
```

命令集因包而异，只写真实存在且已运行的；随后说明成功与失败的观察方式（输出、日志、行为）。

-----

<a id="归属与相关文档"></a>
## 归属与相关文档

- [所属文档](../../../../docs/kmh/plugin-index.md) — 一句说明它对本包读者补充什么。
- 相邻包或 profile 文档，最近前置在前，各配一句增量说明。

<a id="开发备注"></a>
## 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
````

## 规则

- **写前事实核查。** 把包挂载到测试 profile 或本地运行，复现本 README 声称的每条命令、配置字段、默认值与行为；未复现的内容删除，改为链接归属。此要求详见 [SKILL.md 的事实核查节](../SKILL.md#事实核查测试而非假设)。
- **按入口形态分类，不按目录名。** `apply` 导出或默认服务导出是插件；纯模块 API 是库——不写挂载指引、不写配置表；`bundles/` 目录是 bundle 包。
- **不复述上游。** DSH 底座包的配置与行为链接 [Web 插件索引](../../../../docs/kmh/plugin-index.md) 或上游包 README；不把上游字段清单复制进本包 README。
- **配置键表只列本包自有的键。** 从子模块继承行为的键链接其归属说明。
- 文风、折叠与分隔线遵循 [页面文风](../references/style.md) 与 [页面结构与层级](../references/structure-hierarchy.md)。