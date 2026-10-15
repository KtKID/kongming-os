---
description: Codex CLI Trace 逐个源码与配套脚本的用途、执行流程和关键函数说明，供维护者定位读取、统计、界面、导出、构建与测试实现。
---

# Codex CLI Trace 实现说明

## 概述

本文从打开会话标签的过程出发，解释记录怎样从本地文件变成可查看、可导出的内容。每个源码文件和配套脚本都说明触发方式、主要处理、输入输出以及状态变化。关键函数链接到实际源码，便于沿调用关系继续阅读。用户操作、配置默认值与故障恢复统一见[插件 README](../README.md)。

## 目录

- [整体流程](#整体流程)
- [宿主与共享源码](#宿主与共享源码)
- [浏览器源码](#浏览器源码)
- [构建与验收脚本](#构建与验收脚本)
- [测试脚本](#测试脚本)
- [生成文件与外部依赖](#生成文件与外部依赖)
- [开发备注](#开发备注)

<!-- prettier-ignore -->
-----

## 整体流程

宿主加载插件后准备文件读取器和查询入口；浏览器加载插件后在会话内加入标签。打开标签会提交 KMH 会话标识，读取器通过已有对应关系找到 CLI 会话文件，检查归属并读取完整行。记录整理器把这些行归并为回合、消息、调用和用量，页面分别请求概览、列表与详情。导出复用同一读取范围，重新读取原始字节进行校验，再交给浏览器保存。

这里的“投影”指把多种源记录整理成统一展示结构；“读取范围标识”指一次已核实读取结果的 `readToken`。列表和详情携带这个标识，宿主据此核对它们所属的文件状态。文件缓存、展示状态和源文件各有归属：读取器管理宿主内存，视图管理浏览器内存，记录文件由 CLI 写入。

<!-- prettier-ignore -->
-----

## 宿主与共享源码

<details>
<summary>宿主处理与关键函数 — 点击展开</summary>

宿主文件负责定位、读取和整理记录，共享文件规定宿主与浏览器交换的数据。以下顺序沿装载、读取、查询和导出展开。

<a id="host-entry"></a>

### src/index.ts：装载与卸载

Cordis 插件宿主调用 [apply()](../src/index.ts)，传入上下文和已校验配置。它创建一个 `TraceReader`，登记定期清理空闲缓存的计时器，并在 `connection` 服务可用时调用 `mountRoutes()` 注册查询入口。

这些注册通过 `ctx.effect()` 归入插件生命周期，即插件卸载时由宿主执行对应清理。读取器的清理函数停止计时并等待 `TraceReader.dispose()` 完成；路由注册返回的清理函数释放查询入口。状态变更集中在计时器、路由与内存读取器，文件访问交给读取层。

<a id="config"></a>

### src/config.ts：配置校验

宿主装载插件时调用 [Config](../src/config.ts) 校验配置，得到规范化后的配置对象。文件路径使用局部 `absolute` 校验器检查绝对路径，更新间隔检查整数和上下限。`codexHome` 的默认值在模块加载时从进程环境或宿主用户目录计算；具体值见 README 配置表。

路径或数值校验失败会抛出异常，交由宿主的插件加载流程报告。本模块构造校验规则，读取关系文件与 CLI 文件的工作由 `readBinding()` 和 `TraceReader` 承担。

<a id="paths"></a>

### src/paths.ts：共用路径与资源参数

[本模块](../src/paths.ts)在导入时提供常量。`TRACE_BASE` 供路由和页面组成查询地址，分页常量供请求校验和页面加载使用，分块字节数供文件读取使用，空闲时间供宿主清理使用，刷新参数供配置和页面初始化使用。

文件以顶层常量声明为主，输出供其他模块导入的值。修改这些值会影响对应的资源使用或查询限制；状态读写由各消费方执行。

<a id="bindings"></a>

### src/bindings.ts：取得当前 CLI 会话标识

读取器调用 [readBinding()](../src/bindings.ts)，传入关系文件路径和 KMH 会话标识。函数读取 JSON，用 `BindingFileSchema` 检查外层结构，再用 `BindingSchema` 检查当前会话项，返回它的 `threadId`。

文件或当前关联缺失时返回 `null`，读取器据此显示空状态。文件读取失败抛出 `BINDING_UNREADABLE`，JSON 或结构损坏抛出 `BINDING_INVALID`，原始异常保存在错误原因中。函数只读取已有关系。

<a id="rollout-schema"></a>

### src/rollout-schema.ts：识别外部记录

[本模块](../src/rollout-schema.ts)在导入时建立 CLI 文件与关系文件的校验规则。规则使用 Zod，即用于运行时检查数据结构的库；外部记录采用允许额外字段的对象规则，兼容 CLI 新增字段。

`EnvelopeSchema` 检查每行的类型与载荷外壳，`MetaSchema` 检查文件头，`BindingFileSchema`、`BindingSchema` 检查关系文件。投影过程中，`ContextSchema`、`TaskSchema`、`CompletedSchema`、`ResponseSchema`、`UsageRecordSchema` 和 `TokenCountSchema` 分别识别上下文、任务、完成项、消息与用量。`IdentitySchema` 用于核对记录中的会话归属。

这些规则把外部输入交给读取与投影层判断。调用 `safeParse()` 会返回成功或校验问题，调用 `parse()` 会在失败时抛出异常；调用方决定把问题保留为覆盖说明还是使当前请求失败。

<a id="source"></a>

### src/source.ts：定位文件与保留原文位置

读取器和导出器调用本模块，把文件路径或字节范围转换为带来源的完整行。文件句柄以只读方式打开，并通过 `finally` 关闭；`TraceReadError` 携带稳定错误类别与 HTTP 状态，供上层转换成页面提示。

- [locate()](../src/source.ts)接收 CLI 根目录和原生会话标识，内部 `walk()` 遍历两类会话目录，按文件名匹配候选。`realpath()` 取得真实路径，`inRoot()` 检查归属；越根链接、重复候选分别抛出来源错误。没有候选时返回 `null`。
- [readLines()](../src/source.ts)从已完成行的字节位置开始分块读取，按换行符切出完整行，使用 `EnvelopeSchema` 尝试解析。它为每行保存行号、字节起止和 `digest()` 计算的 SHA-256 摘要；坏行保留位置与摘要，尚未写完的末行留待后续读取。返回结果包含完整行截止位置与文件身份；读取长度不足、文件截短或身份核对失败时抛出 `READ_CHANGED`。
- [sourceMeta()](../src/source.ts)接收已读行与目标会话标识，核对首行的 `session_meta`，返回保存的 CLI 版本。首行类型或会话标识错误会抛出 `SOURCE_MISMATCH`。
- [readRaw()](../src/source.ts)按某行保存的字节范围重新读取，并核对摘要，返回原始 `Buffer` 字节。文件截短、内容变化或取消会使读取失败，调用方据此停止详情或导出。

<a id="projector"></a>

### src/projector.ts：把源行整理为展示事实

读取器每次取得新的完整行后，调用 [project()](../src/projector.ts)，传入全部已读行和原生会话标识。函数按文件顺序遍历，在内存中返回回合数组、条目映射和问题数组。“条目映射”把同一调用的参数、完成通知和返回内容收在同一个展示条目中，并保留各自来源。

遍历时先检查记录归属，再处理回合上下文、用量、任务事件和消息。明确携带其他会话标识的记录进入问题说明；损坏行和未知类型保留原文入口。回合结束事件清除当前回合归属，后续缺少明确回合标识的记录保留未归属状态。

`project()` 内的 `getTurn()` 创建或取得回合；`make()` 创建条目并收集来源；`tool()` 按调用标识归并记录，并把 `kmh-skill` 与已识别文件工具分类；`issue()` 记录问题及来源。这些函数共同修改本次投影的内存结果。

用量以回合和响应标识归并唯一响应。保存的回合累计值用于概览，唯一响应的求和结果用于交叉核对；数值冲突进入问题说明。只有会话累计值时，函数将其单独列为来源明确的条目。可见摘要与消息完成通知按已识别内容合并，计时使用保存字段或已保存起止时间之差。

- [emptyUsage()](../src/projector.ts)生成字段缺失的用量对象；[nativeUsage()](../src/projector.ts)把 CLI 字段转换为展示字段，保留零值与缺失值。
- [sumUsage()](../src/projector.ts)逐字段求和；某字段存在缺失时，该汇总字段保持空值。导出器也复用它生成汇总。
- [display()](../src/projector.ts)把已识别的字符串、文本片段或 JSON 转成可搜索和展示的文字，保留空字符串。
- `initialTurn()` 初始化回合，`messageTitle()` 根据保存的角色生成消息标题。字段格式问题通常通过 `safeParse()` 进入问题数组，原始字节继续由读取层管理。

<a id="protocol"></a>

### src/protocol.ts：前后端共用的数据约定

[本模块](../src/protocol.ts)在导入时定义查询参数、页面结果与导出文件的校验规则及对应类型。查询先通过这些规则检查，读取器生成的结果再通过它们检查，浏览器收到响应后继续复用同一套规则。

`SessionRequestSchema`、`TimelineRequestSchema`、`EntryRequestSchema` 检查查询输入，限制会话标识、分页和筛选参数，并拒绝额外参数。`SnapshotSchema`、`TimelineSchema`、`DetailSchema` 检查概览、列表与详情；`TraceExportSchema` 检查导出版本、记录数组和内容摘要。`ErrorSchema` 统一失败响应结构。

本文件以顶层规则声明为主。规则本身保持数据校验职责；具体的错误展示、缓存更新和文件访问由调用方完成。

<a id="reader"></a>

### src/reader.ts：协调读取、查询与资源清理

宿主创建 [TraceReader](../src/reader.ts)，路由随后调用它的方法。实例按 KMH 会话保存文件身份、行索引、投影和读取范围标识；并发任务另行登记，以便卸载时等待结束。

- [snapshot()](../src/reader.ts)接收会话标识、重新读取选项与取消信号，将同一会话的重叠查询合并到一次 `read()`。`abortable()` 管理单个调用方的等待取消，共享读取继续服务其他调用方。
- `read()` 调用 `readBinding()`、`locate()`、`readLines()`、`sourceMeta()` 和 `project()`。关联缺失、文件等待保存时由 `blank()` 返回对应空状态；文件未变时复用缓存；追加时从完整行截止位置续读，再对全部已读行重做投影。文件替换、截短或检测到同长度改写时，将缓存标记失效并抛出 `READ_CHANGED`。`reload` 会清除该会话缓存并建立新的读取范围。
- `current()` 检查缓存、读取范围标识、当前关联和文件状态，成功后更新访问时间。过期标识或来源变化会拒绝查询。
- [timeline()](../src/reader.ts)通过 `current()` 后，在完整参数、返回和文本中搜索，叠加回合、分类和失败筛选，再按来源行号排序分页。未归属回合的条目也进入所选回合的查询范围，供读者核对来源。
- [entry()](../src/reader.ts)取得指定条目，逐个调用 `readRaw()`，返回参数、返回内容、文本及原文。缺失条目抛出 `ENTRY_MISSING`；原文摘要变化会使缓存失效。
- [capture()](../src/reader.ts)先取得概览，再用 `current()` 返回同一范围的宿主缓存，供导出读取。可导出来源缺失时抛出 `SOURCE_UNAVAILABLE`。
- `track()` 登记进行中的工作，`ownExport()` 把导出完成信号纳入登记；`evictIdle()` 删除超时且没有待完成概览查询的缓存。`dispose()` 发出取消信号、等待所有已登记任务结束并清空缓存。`diagnostics` 提供缓存和任务数量，供测试观察。

`mapped()` 统一读取异常类别并保留原始原因。上述方法的状态变化集中在内存；CLI 源文件和对应关系采用只读访问。

<a id="web"></a>

### src/web.ts：查询入口与错误响应

宿主入口在连接服务就绪后调用 [mountRoutes()](../src/web.ts)，传入上下文和读取器。它在现有认证通道注册概览、列表、详情和导出四类 GET 查询，解析 URL 参数，使用共享规则校验后调用对应读取方法或 `exportTrace()`。

[failure()](../src/web.ts)把校验失败映射为 400，把带状态的来源错误映射为其状态，其余异常映射为 503；响应正文提供稳定错误类别和可读原因。查询响应带 `no-store`，请求取消信号传给读取与导出。返回的清理函数等待所有路由注册释放。导出流开始后的读取错误通过流本身传播给浏览器。

<a id="export"></a>

### src/export.ts：固定范围并导出原始字节

导出路由调用 [exportTrace()](../src/export.ts)，传入读取器、KMH 会话标识与取消信号。它通过 `capture()` 取得已核实的完整行范围，用 `ownExport()` 登记生命周期，并合并请求、插件卸载和流取消三种取消信号。

局部 `check()` 核对文件身份和截止位置。第一遍调用 `readRaw()` 校验每行并计算整段摘要；局部异步生成器 `generate()` 在第二遍读取时输出 JSON 原文记录，同时重算摘要。两遍结果一致后才写出完整 JSON 的结尾。UTF-8 解码失败的行转成 base64，字节顺序标记与行终止符随原字节保留。新增字节位于捕获范围之外。

`ReadableStream` 的 `pull()` 按消费进度取得下一段数据，`cancel()` 取消读取并关闭生成器。取消监听和 `generate()` 的 `finally` 共同释放等待状态；流失败时，浏览器接收完整 JSON 的步骤会失败。[exportName()](../src/export.ts)接收会话标识和时间，生成仅含安全字符的下载文件名，完整标识保存在正文中。`beforeSecondRead` 是供测试协调两遍读取时机的可选钩子。

</details>

<!-- prettier-ignore -->
-----

## 浏览器源码

<details>
<summary>页面处理与关键函数 — 点击展开</summary>

浏览器入口注册会话标签，视图和辅助模块共同处理查询、选择、提示与下载。页面状态通过当前会话标识和请求取消信号保持对应。

<a id="client-entry"></a>

### src/client/index.ts：注册标签、翻译与提示

浏览器插件宿主在槽位和语言服务可用时调用 [apply()](../src/client/index.ts)。函数注册中英文词条，在 `conversation.view` 槽位放入 `TraceView`，在 `shell.overlay` 槽位放入 `TraceToast`；槽位即宿主允许插件加入界面的指定位置。

各项注册由生命周期 effect 管理，卸载时释放注册并调用 `notices.clear()` 清空提示。浏览器插件清单声明的前置能力见 [package.json](../package.json)；界面从会话槽位取得当前 KMH 会话标识。

<a id="client-state"></a>

### src/client/state.ts：选择、请求与串行刷新

视图调用本模块的辅助函数，把网络数据转换为已校验结果，并保持提示与刷新状态。

- [chooseTurn()](../src/client/state.ts)接收回合数组和先前选择，优先保留仍存在的选择，否则选择最后一个待结束回合，再回退到最后一回合；空数组返回 `null`。
- [fetchJson()](../src/client/state.ts)接收地址、校验规则与取消信号，携带同源凭据请求 JSON。HTTP 失败转换为 `RequestFailure`，成功响应通过传入规则校验后返回。
- [poll()](../src/client/state.ts)接收读取动作、可见性判断和时间源，内部 `tick()` 在上一次读取结束后安排下一次读取。隐藏页面只安排后续检查；`wake()` 触发一次检查，`stop()` 取消当前请求和后续计时。读取错误交给 `onError()`，测试可传入受控时钟。
- [receiveExport()](../src/client/state.ts)完整接收导出正文，检查 HTTP 状态、JSON 结构、会话标识与行数，再返回可下载的 `Blob` 和文件名。`Blob` 是浏览器中保存文件内容的对象；解析、校验、接收中断或取消会使函数失败。
- `notices.show()`、`notices.clear()` 修改模块内的提示状态并通知订阅者；`subscribe()` 返回取消订阅函数，`getSnapshot()` 提供当前提示。它由全局提示组件订阅，持续到提示完成或插件清理。

<a id="trace-view"></a>

### src/client/TraceView.tsx：查询与阅读界面

会话槽位渲染 [TraceView()](../src/client/TraceView.tsx)，传入当前会话标识与翻译函数。组件在浏览器内保存概览、所选回合、筛选、条目、详情和错误状态，并输出统计、记录列表、原文与操作按钮。

三个主要 `useEffect()` 执行段分别负责概览轮询、按读取范围查询列表、按条目标识查询详情。`useEffect()` 是组件在依赖变化时运行并清理工作的机制：会话或筛选变化时取消旧请求，响应返回后检查取消信号再更新状态。列表的局部 `run()` 按分页游标取到当前所需数量，保留仍存在的选中项；读取失败保留最近成功内容并更新对应错误提示。

追加记录通过完整行截止位置检测，先显示新记录提示。局部 `latest()` 清除筛选、选择最后一回合、加载其记录并滚到末尾；`retry()` 设置重新读取标记并重建概览轮询。窄窗通过媒体查询切换列表与详情的显示，返回列表时保留列表容器。

局部 `save()` 防止重复导出，调用 `receiveExport()`，成功后建立临时对象地址并触发浏览器下载，在 `finally` 释放地址；失败通过提示组件展示原因。会话变化或卸载会取消导出。`copy()` 写入剪贴板并报告成功或失败；`block()` 渲染可复制的文本块，区分缺失与空字符串；`number()`、`seconds()` 格式化数值与毫秒。

[TraceToast()](../src/client/TraceView.tsx)订阅 `notices` 并渲染共享 `Toast`，提示结束时清空状态。其他清理段负责撤销媒体查询监听、页面可见性监听、轮询和详情请求。源记录在 `<pre>` 中按文本渲染。

<a id="locales"></a>

### src/client/locales.ts：界面词条

[本模块](../src/client/locales.ts)通过顶层 `NS`、`zh`、`en` 和 `LocaleKey` 声明提供命名空间、词条与键类型。浏览器入口注册词条，视图通过翻译函数按键取得文字。

英文词条使用中文键类型约束，缺键由 TypeScript 检查。运行时文件读取和请求失败由视图处理；本模块为这些状态提供显示文字。

<a id="styles"></a>

### src/client/styles.ts：布局与主题变量

[本模块](../src/client/styles.ts)在导入时建立 `styles` 对象，由视图应用到布局、统计、列表和长文本区域。颜色与边框取自 DSH 主题变量，换行、最小尺寸和滚动规则帮助宽窄窗口展示原文。

文件以顶层样式声明为主，通过 `CSSProperties` 类型检查样式值。窗口宽度判断与显示状态由 `TraceView()` 管理，主题变量定义由共享主题维护。

</details>

<!-- prettier-ignore -->
-----

## 构建与验收脚本

<details>
<summary>构建与隔离验收过程 — 点击展开</summary>

构建脚本生成宿主与浏览器所需文件，验收脚本提供隔离的本地页面。包内命令的实际声明集中在 [package.json](../package.json)。

<a id="build"></a>

### build.mjs：生成宿主代码与浏览器包

包的 `build` 命令运行[此脚本](../build.mjs)。顶层先通过 `execFileSync()` 执行 TypeScript 项目构建，项目引用由 [tsconfig.json](../tsconfig.json) 指向宿主与浏览器配置，输出到 `lib/`。

类型构建成功后，`build(options)` 使用 esbuild，即把浏览器入口及其本地依赖合成一个可加载文件的工具，生成 `lib/client.js`。`options` 指定入口、目标浏览器语法、共享外部依赖，以及调用 `window.__ModuleLoader__.load()` 的包装，使 DSH 能加载本插件。脚本保留已有产物并写入更新，供宿主热更新检测；热更新指宿主根据产物变化重新加载插件。

脚本以顶层顺序执行为主。TypeScript 子进程失败会中断后续打包，esbuild 失败会拒绝并使脚本失败退出。它修改本包构建产物，依赖已安装的 TypeScript、esbuild 与共享包。

<a id="browser-harness"></a>

### test/browser-harness.mjs：提供隔离验收页面

维护者启动[此脚本](../test/browser-harness.mjs)时，顶层调用 `fixture()` 建立临时数据，再创建真实 `TraceReader` 并通过 `mountRoutes()` 收集路由。脚本用 esbuild 在内存中合成页面，加载真实 `TraceView`、`TraceToast`、共享 Button、Toast 和主题样式。

`setup()` 注册打包时的解析与加载回调，使验收页复用共享界面组件。页面中的 `App()` 由脚本内嵌代码定义，提供会话切换、主题切换和装卸视图。HTTP 请求回调分别返回页面资源、转发读取路由、输出 `/stats` 诊断，或通过 `/control/` 切换故障、追加、重置和截短临时记录。延迟开关可阻塞概览请求，再次切换后释放。

服务绑定 `127.0.0.1` 的随机端口，启动后输出端口和临时目录。修改操作作用于隔离目录，查询使用真实读取与导出流程。该验收页的路由收集器代替正式连接服务，认证接入由真实 KMH Web 验证。

`stop()` 响应 `SIGINT`、`SIGTERM`，依次释放路由、等待读取器清理、关闭服务、删除临时数据并退出。启动与打包错误向进程报告，请求回调中的异常关闭相应响应连接。

</details>

<!-- prettier-ignore -->
-----

## 测试脚本

<details>
<summary>逐项测试机制与辅助函数 — 点击展开</summary>

Node 测试运行器加载各个 `*.test.mjs` 文件，顶层 `test()` 注册并执行用例，断言失败会使对应测试失败。测试通过临时数据、受控时钟或明确的等待点制造输入变化，使用 `t.after()` 登记读取器与临时文件清理。构建产物是这些测试的导入入口，运行命令与成功标志见 [README 验证](../README.md#验证)。

<a id="fixtures"></a>

### test/fixtures.mjs：构造临时源记录

测试与浏览器验收页调用 [sampleRecords()](../test/fixtures.mjs)生成问候、翻译两回合的合成记录；内部 `add()` 为每条记录附加时间和序号。数据包括模型上下文、调用参数、完成通知、返回、响应及累计用量，便于同时检查归并和重复统计。

[encode()](../test/fixtures.mjs)把记录数组序列化成逐行 JSON；[fixture()](../test/fixtures.mjs)接收清理登记对象与可选记录，建立独立临时根、关系文件和 CLI 文件，返回路径、会话标识及追加函数 `append()`。清理回调递归删除该临时根。文件创建或写入失败会使调用失败。

<a id="bindings-tests"></a>

### test/bindings.test.mjs：核对会话归属

[顶层测试](../test/bindings.test.mjs)调用 `fixture()` 和 `TraceReader.snapshot()`，分别构造缺失关联、关系文件损坏、文件头标识冲突、重复候选和越根文件链接。断言检查空状态或稳定错误类别，并比较读取前后的关系文件，确认只读行为。测试中的文件写入、复制与链接操作均作用于临时根，清理由测试回调完成。

<a id="source-tests"></a>

### test/source.test.mjs：核对来源与坏行恢复

[顶层测试](../test/source.test.mjs)仅装载读取器来取得两回合记录，并验证 KMH 会话、CLI 会话和回合标识各自保留。损坏行用例直接改写临时文件，再调用 `snapshot()` 和 `entry()`，核对后续回合继续可读、问题位置准确及坏行原文可取回。读取器通过测试清理回调释放。

<a id="protocol-tests"></a>

### test/protocol.test.mjs：核对校验规则

[顶层测试](../test/protocol.test.mjs)直接调用请求规则、外部行规则和 `Config`。它检查空标识、额外路径参数、错误字段类型、相对路径和超大刷新间隔被拒绝，同时检查未知字段保留与默认刷新值。测试主要操作内存对象，校验成功或失败由断言判断。

<a id="projector-tests"></a>

### test/projector.test.mjs：核对展示事实

[open()](../test/projector.test.mjs)接收测试对象和记录数组，建立临时文件与读取器并返回概览；局部 `timeline()` 组装回合查询。各用例修改合成记录后复用这两个函数，检查模型、推理等级、调用归并、技能分类、原文、可见摘要和计时。

测试还覆盖结束或返回缺失、其他会话记录、上下文角色、回合标题和冲突计时。断言核对事实、问题说明与来源；读取器和文件状态由各测试的清理回调释放。

<a id="usage-tests"></a>

### test/usage.test.mjs：核对用量口径

[run()](../test/usage.test.mjs)接收记录数组，建立读取器并返回概览，登记卸载清理。顶层用例检查两回合的响应数与 token 明细；随后追加重复响应或移除字段，验证去重、缺失值、只有累计值和累计冲突的处理。状态变更集中在合成数组及临时文件，统计差异通过断言暴露。

<a id="query-tests"></a>

### test/query.test.mjs：核对搜索、分页与原文详情

[query()](../test/query.test.mjs)从概览和覆盖参数生成列表查询。顶层用例将超长文本写入临时返回记录，再调用 `timeline()` 搜索末尾文字、叠加分类与失败筛选，并遍历分页游标检查重复条目。

详情用例调用 `entry()`，将行号、序号和字节长度与原文对应，再改写临时源文件，检查旧位置触发 `READ_CHANGED`。测试清理负责关闭读取器并删除临时数据。

<a id="reader-tests"></a>

### test/reader.test.mjs：核对增量读取和并发清理

[extra()](../test/reader.test.mjs)生成一条含中文的追加消息，顶层用例把它拆成两段写入临时文件，检查半行等待、补齐后只出现一次及缓存稳定。其他用例替换、截短或同长度改写文件，验证读取范围失效与重新读取。

并发用例通过 `beforeRead` 等待点和可控时间协调查询，检查共享读取、单个等待取消、错误恢复与空闲清理。局部 `worker()` 启动两个独立子进程，每个进程读取同一临时文件并输出统计与资源数量；父进程收集结果、检查退出状态与源文件保留。用例还检查预先取消的请求与卸载后的资源状态，子进程异常会使测试失败。

<a id="web-tests"></a>

### test/web.test.mjs：核对路由调用与释放

[routeHarness()](../test/web.test.mjs)接收读取器，用内存中的 `routes` 收集 `mountRoutes()` 注册，返回 `request()` 和清理函数。`request()` 构造真实 `Request` 并直接调用对应处理器，省去监听端口。

顶层测试经过该入口查询概览、列表和详情，检查额外路径参数被拒绝、响应禁止缓存以及源文件保留。最后释放路由与读取器，核对注册和进行中任务归零。正式 Web 认证链路由宿主提供。

<a id="export-tests"></a>

### test/export.test.mjs：核对导出完整性

[reconstruct()](../test/export.test.mjs)按每行的编码恢复字节并拼接。顶层测试调用 `exportTrace()`，将恢复结果和 SHA-256 摘要与临时源文件比较，覆盖长文本、坏字节、字节顺序标记与未完成末行。

测试通过 `beforeSecondRead` 在两遍读取之间追加或改写文件，检查截止范围与变更失败。取消和卸载用例使用取消信号及等待点，验证流失败、卸载等待和资源清空。导出内容在测试内存中接收，临时文件与读取器通过清理回调释放。

<a id="client-tests"></a>

### test/client.test.mjs：核对页面辅助状态

[顶层测试](../test/client.test.mjs)直接调用构建后的 `chooseTurn()`、`notices`、`poll()` 与 `receiveExport()`。受控 `clock.set()`、`clock.clear()` 保存待执行回调，使测试能检查读取串行、隐藏暂停和停止取消。

导出用例通过测试框架临时替换 `fetch()`，制造 HTTP 失败和截断 JSON，检查生成下载对象之前即报告错误。提示订阅、清空与选择规则通过内存断言验证；替换的请求函数由测试框架恢复，轮询由用例停止。

</details>

<!-- prettier-ignore -->
-----

## 生成文件与外部依赖

<details>
<summary>产物来源与命令归属 — 点击展开</summary>

构建产物的来源是 `src/`、`build.mjs` 与 TypeScript 项目配置。宿主代码和声明位于 `lib/src/`，浏览器独立编译结果和声明位于 `lib/browser-types/`，浏览器加载文件位于 `lib/client.js`；增量构建信息也保存在 `lib/`。调整实现时修改对应源文件，再执行 [README 中的构建与验证](../README.md#验证)。

`package.json` 的 `build` 指向构建脚本，`pretest` 在包测试前调用构建，`test` 指向串行 Node 测试。`typecheck` 分别检查宿主与浏览器 TypeScript，`lint` 检查源码，`format:check` 检查其声明的源码、配置与 README 格式。这些命令的输入范围以包清单为准，检查失败由各工具的退出状态报告。

Cordis 提供插件生命周期，连接服务提供认证查询通道，界面槽位、语言和共享组件由 DSH 提供。相关依赖声明见 [package.json](../package.json)，接入规则见 [Web 界面规范](../../../docs/kmh/web-ui.md)；构建和验收页直接读取的主题与组件来源见对应脚本中的路径。

</details>

<!-- prettier-ignore -->
-----

## 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
