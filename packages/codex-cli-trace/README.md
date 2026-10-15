---
description: 在 KMH 会话内查看 Codex CLI 本地执行记录、token 用量、工具与技能调用，并导出带原文和内容摘要的 JSON。说明使用入口、文件来源、配置和读取失败的处理方式。
---

# Codex CLI Trace

## 概述

在 KMH 会话的「Codex Trace」标签内，可以按回合查看 Codex CLI 已保存的执行记录，并导出 JSON 留存核对。记录包含已保存的消息、模型响应、token 用量、工具与技能调用、文件操作和计时信息。插件通过读取本机文件更新页面，可独立于 Codex CLI 执行插件装载。查看历史需要已有会话对应关系和 CLI 记录文件；展示范围取决于这些文件实际保存的内容。

## 目录

- [查看记录](#查看记录)
- [导出记录](#导出记录)
- [接入与配置](#接入与配置)
- [读取异常与恢复](#读取异常与恢复)
- [实现说明](#实现说明)
- [验证](#验证)
- [归属与相关文档](#归属与相关文档)
- [开发备注](#开发备注)

<!-- prettier-ignore -->
-----

## 查看记录

`kmh-web` 已挂载本插件。打开已有 Codex CLI 记录的 KMH 会话，即可查看该会话当前关联的 CLI 会话。

1. 点击与「对话」「轨迹」「上下文」同级的「Codex Trace」。
2. 选择回合，查看模型、推理等级、token 用量、回合耗时和首个输出计时。
3. 选择一条记录，展开调用参数、返回内容或原始记录。内容支持复制；窄窗可通过「返回记录列表」回到原阅读位置。

搜索会匹配完整内容。分类、「仅异常」与「加载更多」控制记录列表；回合统计保持所选回合的范围。详情中的原始记录提供行号和字节范围，页面底部提供来源文件、CLI 版本与最近读取时间。

### 理解统计与记录范围

数值使用 CLI 已保存的统计口径。缓存读取和缓存写入是输入明细，推理 token 是输出明细；它们各自归入对应总量。模型响应按原生会话、回合和响应标识去重。只有会话累计用量时，页面单独列出其来源与覆盖说明。

耗时使用 CLI 已保存的计时字段，思考摘要展示已保存的可读内容。明确的零值显示为 `0`，缺失值显示「未记录」或破折号。结束记录或工具返回缺失时，页面保留待确认状态。已识别的技能调用与技能文件读写分别归入「技能」和「文件操作」。

「记录范围」列出损坏行、未知类型、统计冲突和可确认的缺口，便于结合原文核对结论。

### 跟随文件更新

页面可见时串行检查文件更新，间隔由 `refreshIntervalMs` 决定。页面隐藏时暂停读取，关闭视图会取消当前请求并释放页面计时器。

追加内容保留当前回合、选中项与阅读位置。看到「有新记录」后，可点击「跳到最新」。完整行按源文件顺序展示，末尾尚未写完的一行等待下一次文件更新。

<!-- prettier-ignore -->
-----

## 导出记录

点击「导出记录」，保存当前关联 CLI 会话在导出截止位置之前的全部完整记录。导出范围覆盖该 CLI 会话的所有回合；页面搜索、分类和「仅异常」只影响列表展示。

导出的 JSON 包含格式版本、KMH 与 CLI 会话标识、来源信息、回合与用量汇总、记录范围说明、逐行原文及 SHA-256 内容摘要。原文保留行终止符；无法按 UTF-8 解码的完整行使用 base64 保存。文件同时记录末尾未完成行的字节数与读取截止范围。截止位置之后追加的内容由下一次导出收录。

浏览器完整接收并校验 JSON 后开始保存，随后显示「记录已交给浏览器保存」。保存位置由浏览器的下载设置或保存对话框决定，可选「文稿」目录。导出过程中发生读取失败、源文件变更或接收中断时，页面提示失败并允许重试。

导出文件保留源记录中的消息、参数与返回内容。CLI 源文件和已有会话对应关系始终采用只读访问。

<!-- prettier-ignore -->
-----

## 接入与配置

插件运行在 KMH Web 宿主中，需要宿主能够读取会话对应关系和 Codex CLI 数据目录。历史查看可使用已有文件独立运行；会话对应关系的生成由执行侧负责。

`profiles/kmh-web` 已声明包依赖，并在 [Web patch](../../profiles/kmh-web/cordis.patch.yml) 中挂载以下实例：

```yaml
- insert:
    - id: kmh-codex-cli-trace
      name: "@kmh/codex-cli-trace"
      config:
        bindingsFile: !!js dshHomePath('codex-cli', 'codex-bindings.json')
        refreshIntervalMs: 1000
```

其他 Web profile 的包依赖与 patch 接入方法见[包接入指南](../../docs/kmh/adding-a-plugin-package.md)。本包的配置如下：

| 配置键              | 默认值                                            | 含义                                                                                            |
| ------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `bindingsFile`      | 必填                                              | 宿主上的会话对应关系文件绝对路径。上述配置指向 KMH 数据目录的 `codex-cli/codex-bindings.json`。 |
| `codexHome`         | `CODEX_HOME`，为空时使用宿主用户目录下的 `.codex` | Codex CLI 数据根目录绝对路径。                                                                  |
| `refreshIntervalMs` | `1000`                                            | 页面更新检查间隔，单位为毫秒；取值为 `1` 至 `2147483647` 的整数。                               |

插件使用对应关系中的当前 `threadId`，在 CLI 数据根目录的 `sessions` 和 `archived_sessions` 中查找并核对同一原生会话的 JSONL 文件。查看与导出均使用当前关联的 CLI 会话。

<!-- prettier-ignore -->
-----

## 读取异常与恢复

读取失败时，页面保留最近成功展示的内容，并显示错误提示。结合提示检查宿主上的文件与配置，再重新读取。

| 页面状态或提示                                | 检查与处理                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------- |
| 当前会话暂无 Codex CLI 记录                   | 检查该 KMH 会话是否已有对应关系及当前 `threadId`。                        |
| CLI 记录正在等待保存                          | 等待 CLI 写入首条完整记录，并确认 `codexHome` 指向实际数据目录。          |
| 会话对应关系格式损坏或暂时无法读取            | 检查 `bindingsFile` 的内容、路径和宿主读取权限。                          |
| CLI 记录暂时无法读取                          | 检查 CLI 数据目录、记录文件及宿主读取权限后重试。                         |
| 源记录发生变化                                | 文件替换、截短或已读取内容变更后，点击「重新读取」建立新的读取范围。      |
| CLI 记录与当前会话不对应，或对应多份 CLI 文件 | 核对当前关联标识、文件头与候选文件；文件链接必须位于配置的 CLI 根目录内。 |

损坏的完整行和未知类型会保留原文，并在「记录范围」中列出。后续可读取的完整记录继续参与展示。

<!-- prettier-ignore -->
-----

## 实现说明

<details>
<summary>工作流程、脚本与关键函数 — 点击展开</summary>

宿主加载插件后创建读取器和查询入口；浏览器在当前会话注册标签。打开标签时，读取器从对应关系取得 CLI 会话标识，核对源文件并读取完整行，再整理为回合、调用和用量。页面分别查询概览、列表与原文详情，导出器固定完整行范围并重新读取校验后交给浏览器保存。

下面逐个列出脚本用途，链接指向[详细实现说明](docs/implementation.md)。每项说明包含触发方式、输入输出、执行机制、关键函数和失败清理；配置值与用户操作统一由本文前面的章节说明。

### 宿主与共享源码

这些文件依次承担装载、来源校验、记录整理和查询，状态集中在宿主内存中。

| 脚本                                                           | 用途与详细说明                                 |
| -------------------------------------------------------------- | ---------------------------------------------- |
| [src/index.ts](docs/implementation.md#host-entry)              | 创建读取器、登记路由和清理任务，管理插件卸载。 |
| [src/config.ts](docs/implementation.md#config)                 | 校验路径、刷新间隔并填入默认值。               |
| [src/paths.ts](docs/implementation.md#paths)                   | 提供查询路径、分页和读取资源参数。             |
| [src/bindings.ts](docs/implementation.md#bindings)             | 读取 KMH 会话当前关联的 CLI 会话标识。         |
| [src/rollout-schema.ts](docs/implementation.md#rollout-schema) | 识别关系文件与 CLI 各类源记录的结构。          |
| [src/source.ts](docs/implementation.md#source)                 | 定位文件、切分完整行、保存位置并核对原始字节。 |
| [src/projector.ts](docs/implementation.md#projector)           | 归并回合、响应、调用与用量，保留问题及来源。   |
| [src/protocol.ts](docs/implementation.md#protocol)             | 定义前后端查询、响应和导出内容的校验规则。     |
| [src/reader.ts](docs/implementation.md#reader)                 | 协调增量读取、缓存、筛选分页、详情与并发清理。 |
| [src/web.ts](docs/implementation.md#web)                       | 注册四类只读查询，将失败转换为页面可读响应。   |
| [src/export.ts](docs/implementation.md#export)                 | 固定导出范围，两遍读取校验并生成 JSON 流。     |

### 浏览器源码

这些文件把当前会话的查询结果变成阅读界面，并管理刷新、提示与下载。

| 脚本                                                          | 用途与详细说明                                     |
| ------------------------------------------------------------- | -------------------------------------------------- |
| [src/client/index.ts](docs/implementation.md#client-entry)    | 注册会话标签、翻译词条和全局提示。                 |
| [src/client/state.ts](docs/implementation.md#client-state)    | 处理回合选择、请求校验、串行轮询与导出接收。       |
| [src/client/TraceView.tsx](docs/implementation.md#trace-view) | 展示统计、列表和详情，处理重读、复制、下载与取消。 |
| [src/client/locales.ts](docs/implementation.md#locales)       | 提供中英文词条与词条键类型。                       |
| [src/client/styles.ts](docs/implementation.md#styles)         | 提供复用主题变量的布局、换行和滚动样式。           |

### 构建、验收与测试脚本

构建产物由源码生成，测试与验收使用隔离数据；命令声明和生成文件来源见[构建与依赖说明](docs/implementation.md#生成文件与外部依赖)。

| 脚本                                                               | 用途与详细说明                                       |
| ------------------------------------------------------------------ | ---------------------------------------------------- |
| [build.mjs](docs/implementation.md#build)                          | 先构建 TypeScript，再打包浏览器入口供宿主加载。      |
| [test/browser-harness.mjs](docs/implementation.md#browser-harness) | 提供真实组件与读取器的临时页面，支持追加和故障注入。 |
| [test/fixtures.mjs](docs/implementation.md#fixtures)               | 生成两回合合成记录，创建和清理临时关系与源文件。     |
| [test/bindings.test.mjs](docs/implementation.md#bindings-tests)    | 检查关联缺失、错误归属、重复候选与越根链接。         |
| [test/source.test.mjs](docs/implementation.md#source-tests)        | 检查独立读取、标识保留和坏行后的记录恢复。           |
| [test/protocol.test.mjs](docs/implementation.md#protocol-tests)    | 检查查询、配置和外部记录的校验规则。                 |
| [test/projector.test.mjs](docs/implementation.md#projector-tests)  | 检查回合、调用、技能、消息、摘要与计时的整理结果。   |
| [test/usage.test.mjs](docs/implementation.md#usage-tests)          | 检查用量明细、去重、缺失和累计值冲突。               |
| [test/query.test.mjs](docs/implementation.md#query-tests)          | 检查全文搜索、组合筛选、分页和原文定位。             |
| [test/reader.test.mjs](docs/implementation.md#reader-tests)        | 检查半行追加、文件变更、共享读取与进程清理。         |
| [test/web.test.mjs](docs/implementation.md#web-tests)              | 通过内存路由检查请求、响应与注册释放。               |
| [test/export.test.mjs](docs/implementation.md#export-tests)        | 恢复导出字节，核对摘要、截止范围、取消与卸载。       |
| [test/client.test.mjs](docs/implementation.md#client-tests)        | 用受控时钟和请求替换检查选择、提示、轮询与导出失败。 |

</details>

<!-- prettier-ignore -->
-----

## 验证

以下命令在 Kongming 仓库根目录运行。构建生成本包宿主与浏览器产物；测试使用独立临时文件，覆盖只读关联、记录解析、统计、文件变更、查询和导出。

```sh
pnpm --filter @kmh/codex-cli-trace build
node --test --test-concurrency=1 packages/codex-cli-trace/test/*.test.mjs
```

构建以成功退出为准；测试输出中的失败数应为 `0`。测试结束后释放读取器和临时数据。

<details>
<summary>浏览器验证入口 — 点击展开</summary>

[浏览器验收页](test/browser-harness.mjs)使用隔离的合成文件，装载真实 Trace 组件、共享主题与读取路由，提供会话切换、追加记录和故障注入。KMH Web 接入验证使用实际会话内的「Codex Trace」标签，检查查看、刷新和导出流程。功能场景与执行证据集中在[需求与验收记录](../../docs/spec/codex-cli-trace/spec.md)及其任务目录。

</details>

<!-- prettier-ignore -->
-----

## 归属与相关文档

本包维护记录读取、统计、展示与导出；执行侧维护 CLI 执行和会话对应关系。相关入口按接入到维护的顺序排列：

- [Web 配置](../../profiles/kmh-web/README.md)：查看 Web profile 的插件组合与部署覆盖。
- [数据目录与运行记录](../../docs/kmh/runtime-records.md)：确认宿主数据目录和日志位置。
- [Codex CLI 执行插件](../codex-cli/README.md)：了解执行入口与会话关联的生成方式。
- [插件 Web 界面规范](../../docs/kmh/web-ui.md)：了解共享槽位、组件与生命周期要求。
- [插件索引](../../docs/kmh/plugin-index.md)：查找相邻插件及其说明归属。

<!-- prettier-ignore -->
-----

## 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
