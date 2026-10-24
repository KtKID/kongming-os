---
description: 用日常语言列出访问记录的全部专项与原功能回归用例、测试过程、留档结果及逐文件覆盖率。
---

# 访问记录：测试过程与结果

本报告依据2026-10-23保存的执行材料整理。每项“通过”来自当时的执行日志；操作与预期由对应测试代码和已确认设计说明。本轮整理实际核对了用例名单、执行统计、覆盖率原始计数和相关代码指纹。

## 本次结果

- 访问记录专项：13项通过，0项失败，0项跳过，逐项过程见下表。
- 原功能回归：138项通过，0项失败，0项跳过，全部逐例过程按功能折叠列在后面。
- 构建、类型、代码规范与格式检查：留档记录均为成功。
- 全仓额外检查：352项通过、23项失败、11项跳过。报告将失败归于底层构建及依赖前提；全仓验证保留待完成状态。该附件保存了汇总与失败名单，全仓逐例过程明细待补。
- 版本范围：当前页面入口文件已有独立设置修复，指纹与留档不同；本报告的通过结果对应留档代码。该后续差异由原设置修复任务承接。

任务清单的15行包含环境准备、13个场景及最终汇总；本次功能专项测试共13个。下表保留原编号供AI定位，正文说明它在检查什么。

## 13个访问记录专项用例

这些用例采用自动测试，包含真实文件、测试代理和组件检查；浏览器的人工观察在后文单列。每个编号可能执行多组数据，具体分组一并写在过程里。各行的实际状态均由[专项日志](evidence/records-coverage.log)中的13项全部通过支持；逐项观察详见[原执行记录](#原执行记录)。

| 用例与测试目的                       | 怎样测试                                                                                                     | 应该看到什么                                                                                 | 留档结果与定位                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| SAVE-01 每次提交密码都留下结果       | 分别从局域网和公网类型入口提交正确、错误及受限的密码请求；补充中断、请求异常等情况。                         | 每次提交保存一条，时间、来源、成功失败和原始原因与登录处理结果一致。                         | 通过；[access-records.spec.ts](../../../../../packages/kmh-remote/test/access-records.spec.ts#L129)               |
| SAVE-02 连续及同时提交分别保存       | 固定同一个来源和同一毫秒，提交21次混合结果；让请求重叠，并对同一次尝试重复报告结束。                         | 21次独立提交逐条保留；同一次尝试只交付一次最终结果。                                         | 通过；[access-records.spec.ts](../../../../../packages/kmh-remote/test/access-records.spec.ts#L273)               |
| SAVE-03 日常页面活动保持数量         | 先登录得到1条；带登录状态刷新、加载资源和访问业务地址；最后再提交一次密码。                                  | 页面活动后始终1条；再次提交后变成2条。                                                       | 通过；[access-records.spec.ts](../../../../../packages/kmh-remote/test/access-records.spec.ts#L330)               |
| SAVE-04 特殊文字和时间完整保留       | 保存含中文、换行、引号和反斜杠的错误；检查三种毫秒值；用上海和纽约时区的独立进程写同一目录，再读文件及页面。 | 文字逐字相同，毫秒及时区保留原值；来源说明完整，敏感凭据被过滤。                             | 通过；[access-records.spec.ts](../../../../../packages/kmh-remote/test/access-records.spec.ts#L344)               |
| SAVE-05 重启、切目录与重置后保留历史 | 准备全新目录及两个独立数据目录；写入多文件历史，重新创建记录器、独立进程重启、切换目录并执行设置重置。       | 每个目录保留自己的历史；重启后可继续读写；重置前后历史文件字节一致。                         | 通过；[access-records.spec.ts](../../../../../packages/kmh-remote/test/access-records.spec.ts#L424)               |
| SAVE-06 文件达到10MB时换文件         | 用真实中文和换行数据凑到10MB前一字节、恰好10MB及多一字节；再测同日重启、跨日和同时保存。                     | 按实际字节数在写前选文件，名称递增；旧文件内容和历史记录保留。                               | 通过；[access-records.spec.ts](../../../../../packages/kmh-remote/test/access-records.spec.ts#L572)               |
| SAVE-07 一条记录超大时明确报错       | 分别在全新目录和已有历史的目录提交超过10MB一字节及明显超大的记录，然后再保存正常记录。                       | 超大内容得到明确错误，旧文件保持原样；后续正常记录保存成功。                                 | 通过；[access-records.spec.ts](../../../../../packages/kmh-remote/test/access-records.spec.ts#L644)               |
| SAVE-08 保存故障可见且能恢复         | 让创建、打开、写入、同步等文件操作分别失败，补充只写入部分内容的情况；解除故障后继续保存并检查登录响应。     | 保留原始失败原因和历史，登录按原规则响应；恢复后可保存新记录，界面仍可查看此前失败。         | 通过；[access-records.spec.ts](../../../../../packages/kmh-remote/test/access-records.spec.ts#L677)               |
| VIEW-01 详情展示完整且保留设置草稿   | 准备成功及失败记录，调整时间顺序；渲染详情，填写设置草稿，切到记录再返回；另有浏览器主题检查记录。           | 字段、顺序及错误文字完整，返回设置时草稿仍在；界面内容可辨认。                               | 通过；[access-records-panel.spec.tsx](../../../../../packages/kmh-remote/test/access-records-panel.spec.tsx#L95)  |
| VIEW-02 全新目录的空页面             | 分别使用全新数据目录和只有空文件的目录，查询并显示记录页。                                                   | 显示当前目录和记录起点说明，列表为空，翻页按钮处于边界状态。                                 | 通过；[access-records-panel.spec.tsx](../../../../../packages/kmh-remote/test/access-records-panel.spec.tsx#L148) |
| VIEW-03 分页、刷新与迟到结果         | 分别准备1、10、11、20、21条及跨日文件；遍历各页，翻页时追加记录，再刷新；安排旧请求迟到返回。                | 每页最多10条，记录各出现一次；追加期间旧页集合稳定，刷新显示新记录；迟到结果保持当前页正确。 | 通过；[access-records-panel.spec.tsx](../../../../../packages/kmh-remote/test/access-records-panel.spec.tsx#L159) |
| VIEW-04 读取故障展示原始原因         | 分别在首次打开和已有旧页面时制造读取错误、损坏记录及格式错误，再解除故障刷新。                               | 显示原始原因，已有页面保留并标明此前结果，文件字节保留；恢复后刷新成功。                     | 通过；[access-records-panel.spec.tsx](../../../../../packages/kmh-remote/test/access-records-panel.spec.tsx#L276) |
| VIEW-05 访问记录只供本机查看         | 通过本机、远程、未知来源及缺少来源上下文的入口查询；补充变形路径、伪造来源和长连接请求，统计记录查询调用。   | 本机按已有授权读取；受限请求得到拒绝，记录查询调用为零。                                     | 通过；[access-records.spec.ts](../../../../../packages/kmh-remote/test/access-records.spec.ts#L842)               |

## 浏览器人工检查

这些观察由[执行总账](evidence/execution.json)及原报告保存，截图位于本机忽略位置。整理时可读取步骤和结果摘要，截图明细待从对应本机位置取得。

| 检查什么         | 实际操作                                                         | 留档观察                                                   |
| ---------------- | ---------------------------------------------------------------- | ---------------------------------------------------------- |
| 详情中的历史记录 | 从实际插件列表进入记录页，查看旧成功、失败记录及原始错误         | 旧记录和错误文字可读；后一次浏览器检查核对了原有3条记录    |
| 设置草稿         | 在设置页输入草稿，切到记录，再切回设置并恢复草稿                 | 草稿保留                                                   |
| 密码提交的计次   | 先只填写密码，查看记录数，再实际提交密码                         | 填写时数量保持原值，提交后增加一条                         |
| 分页和滚动       | 查看每页条数、末页按钮与列表内部滚动，操作外侧的翻页和刷新按钮   | 每页最多十条，末页按钮和固定操作区符合预期                 |
| 保存和读取故障   | 制造真实文件权限故障，查看登录响应和详情，再恢复权限后刷新及保存 | 原登录流程继续响应，错误可见；恢复后历史可读、新记录可保存 |
| 浅色与深色主题   | 分别查看两种主题下的文本和操作                                   | 文本与操作可辨认                                           |
| 本机与远程查询   | 从本机及Remote入口请求记录，并尝试未登录请求                     | 本机按授权可读；未登录返回401，Remote查询返回403           |
| 迁移前后历史保留 | 比较部署前后三条旧记录的文件指纹，再检查浏览器                   | 文件字节相同，页面可读                                     |

## 每个文件的代码覆盖情况

以下是13个专项自动测试合计的覆盖率。行覆盖表示测试执行到的代码行；分支覆盖表示判断路径的执行情况。功能结论同时依赖前面各项结果检查。

“全文件”统计文件全部代码；“本次范围”统计五个新业务模块的全部代码及六个原文件的新增接线。范围与计数来自[范围清单](evidence/coverage-scope.json)、[全文件统计](evidence/coverage-summary.json)，基线说明见[覆盖率基线](baselines/README.md)。

| 文件                                 | 本次统计范围   | 全文件：行 / 分支                     | 本次范围：行 / 分支             |
| ------------------------------------ | -------------- | ------------------------------------- | ------------------------------- |
| `shared/access-records.ts`           | 全文件         | 100%（26/26） / 100%（8/8）           | 100%（26/26） / 100%（8/8）     |
| `host/access-records.ts`             | 全文件         | 100%（195/195） / 100%（87/87）       | 100%（195/195） / 100%（87/87） |
| `host/access-records-integration.ts` | 全文件         | 100%（74/74） / 100%（46/46）         | 100%（74/74） / 100%（46/46）   |
| `client/RemotePluginPanel.tsx`       | 全文件         | 100%（44/44） / 100%（52/52）         | 100%（44/44） / 100%（52/52）   |
| `client/access-records-locales.ts`   | 全文件         | 100%（2/2） / 100%（0/0）             | 100%（2/2） / 100%（0/0）       |
| `host/proxy.mjs`                     | 新增或替换接线 | 66.09%（347/525） / 58.65%（271/462） | 100%（22/22） / 100%（18/18）   |
| `host/index.js`                      | 新增或替换接线 | 47.22%（34/72） / 25.8%（16/62）      | 100%（2/2） / 100%（0/0）       |
| `host/service.mjs`                   | 新增或替换接线 | 25.92%（28/108） / 10.76%（14/130）   | 100%（0/0） / 100%（1/1）       |
| `host/web-rpc.js`                    | 新增或替换接线 | 37.38%（80/214） / 37.74%（77/204）   | 100%（6/6） / 100%（4/4）       |
| `client/index.jsx`                   | 新增或替换接线 | 16.66%（17/102） / 0%（0/52）         | 100%（1/1） / 100%（0/0）       |
| `client/pocket-locales.js`           | 新增或替换接线 | 100%（3/3） / 100%（0/0）             | 100%（0/0） / 100%（0/0）       |

本次范围合计：行372/372、分支216/216；纳入测量文件的全量合计：行850/1365（62.27%）、分支571/1103（51.76%）。全文件未覆盖位置见[覆盖率日志](evidence/records-coverage.log)，完整计数见[原始覆盖率归档](evidence/coverage-final.json.gz)。逐个用例分别覆盖哪些文件的矩阵待采集；现有数据支持本批合计。

## 138个原功能回归用例

本节完整对应[原功能回归日志](evidence/remote-regression.log)中的138个成功条目。过程与预期按对应测试代码解释；“通过”表示当时相应检查完成，日志保存结果与耗时。各用例的检查方式以过程列为准，包含函数检查、源码/构建文件检查及本地真实请求。

<details>
<summary>登录与来源身份：2项全部通过</summary>

| 用例                                                                                            | 怎样测试                                                       | 应该看到什么                     | 留档结果                                  |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------- | ----------------------------------------- |
| [R001 限速使用真实连接地址](../../../../../packages/kmh-remote/test/auth-hardening.test.mjs#L9) | 构造三种连接地址，并填入伪造的来源声明，调用身份识别函数。     | 限速身份与连接地址一致。         | [通过](evidence/remote-regression.log#L1) |
| [R002 两种登录凭据](../../../../../packages/kmh-remote/test/auth-hardening.test.mjs#L115)       | 启动测试代理，分别提交主密码和替代凭据，再带登录凭据访问页面。 | 两种凭据都能登录，并能继续访问。 | [通过](evidence/remote-regression.log#L2) |

</details>

<details>
<summary>密码选择与随机来源：4项全部通过</summary>

| 用例                                                                                         | 怎样测试                                                               | 应该看到什么                                 | 留档结果                                  |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------- |
| [R003 手动指定局域网地址](../../../../../packages/kmh-remote/test/auth-routing.test.mjs#L39) | 设置一个手动局域网地址，比较它与普通内外网地址的密码选择，再清空设置。 | 指定地址使用局域网密码，清空后恢复自动分类。 | [通过](evidence/remote-regression.log#L3) |
| [R004 特殊内网地址的分类](../../../../../packages/kmh-remote/test/auth-routing.test.mjs#L87) | 把特殊内网地址段内部及两侧边界地址交给密码选择函数。                   | 地址段内部使用局域网规则，两侧使用公网规则。 | [通过](evidence/remote-regression.log#L4) |
| [R005 密码的随机来源](../../../../../packages/kmh-remote/test/auth-routing.test.mjs#L110)    | 读取构建后的密码生成代码，检查随机数实现及对应调用。                   | 密码生成采用安全随机来源。                   | [通过](evidence/remote-regression.log#L5) |
| [R006 持久访问密码](../../../../../packages/kmh-remote/test/auth-routing.test.mjs#L138)      | 分别输入局域网和外网地址，检查选择的凭据类型。                         | 两类地址都使用持久访问密码。                 | [通过](evidence/remote-regression.log#L6) |

</details>

<details>
<summary>手机文件操作接入：5项全部通过</summary>

| 用例                                                                                           | 怎样测试                                                   | 应该看到什么                 | 留档结果                                   |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------- | ------------------------------------------ |
| [R007 手机文件链接的识别方式](../../../../../packages/kmh-remote/test/file-guard.test.mjs#L25) | 读取文件链接处理代码，检查按钮、链接和路径文字的识别规则。 | 识别使用稳定结构及路径文字。 | [通过](evidence/remote-regression.log#L7)  |
| [R008 手机文件处理的接入](../../../../../packages/kmh-remote/test/file-guard.test.mjs#L41)     | 读取移动端入口代码，检查窄屏启用条件与文件读取方法的传递。 | 入口接入当前文件处理逻辑。   | [通过](evidence/remote-regression.log#L8)  |
| [R009 手机文件操作提示](../../../../../packages/kmh-remote/test/file-guard.test.mjs#L74)       | 读取文件处理与移动端代码，检查提示文字及添加工作区的处理。 | 约定提示和入口处理均存在。   | [通过](evidence/remote-regression.log#L9)  |
| [R010 构建后的文件处理](../../../../../packages/kmh-remote/test/file-guard.test.mjs#L87)       | 读取打包文件，查找文件处理及复制按钮的标记。               | 打包结果含对应逻辑。         | [通过](evidence/remote-regression.log#L10) |
| [R011 手机文件按钮样式](../../../../../packages/kmh-remote/test/file-guard.test.mjs#L110)      | 读取窄屏样式，检查添加工作区入口与复制按钮的规则。         | 入口隐藏与按钮样式规则完整。 | [通过](evidence/remote-regression.log#L11) |

</details>

<details>
<summary>文件读取：7项全部通过</summary>

| 用例                                                                                      | 怎样测试                                               | 应该看到什么               | 留档结果                                   |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------- | ------------------------------------------ |
| [R012 文件读取方法的名称](../../../../../packages/kmh-remote/test/file-read.test.mjs#L30) | 读取公开方法常量，检查文件读取方法名。                 | 方法名符合现有约定。       | [通过](evidence/remote-regression.log#L12) |
| [R013 读取真实文本文件](../../../../../packages/kmh-remote/test/file-read.test.mjs#L34)   | 在临时目录写入一份文本，调用文件读取方法。             | 返回的正文与文件内容相同。 | [通过](evidence/remote-regression.log#L13) |
| [R014 默认相对路径](../../../../../packages/kmh-remote/test/file-read.test.mjs#L47)       | 使用相对路径调用文件读取方法，检查它采用的工作目录。   | 路径按当前工作目录解析。   | [通过](evidence/remote-regression.log#L14) |
| [R015 指定目录的相对路径](../../../../../packages/kmh-remote/test/file-read.test.mjs#L65) | 准备临时目录和文本，把目录及相对路径一起传给读取方法。 | 返回指定目录下的文本。     | [通过](evidence/remote-regression.log#L15) |
| [R016 用户目录简写](../../../../../packages/kmh-remote/test/file-read.test.mjs#L80)       | 在临时用户目录准备文件，以用户目录简写路径读取。       | 简写展开后读取到对应文本。 | [通过](evidence/remote-regression.log#L16) |
| [R017 错误的文件路径](../../../../../packages/kmh-remote/test/file-read.test.mjs#L103)    | 分别提交空路径、缺失文件路径与目录路径。               | 各自返回读取错误。         | [通过](evidence/remote-regression.log#L17) |
| [R018 读取二进制文件](../../../../../packages/kmh-remote/test/file-read.test.mjs#L116)    | 写入含二进制字节的临时文件，再调用文本读取方法。       | 返回适用的读取错误。       | [通过](evidence/remote-regression.log#L18) |

</details>

<details>
<summary>图标兼容：9项全部通过</summary>

| 用例                                                                                         | 怎样测试                                   | 应该看到什么                 | 留档结果                                   |
| -------------------------------------------------------------------------------------------- | ------------------------------------------ | ---------------------------- | ------------------------------------------ |
| [R019 旧版图标名称](../../../../../packages/kmh-remote/test/icon-compat.test.mjs#L43)        | 给图标解析器提供旧版图标集合。             | 各按钮取得旧版图标。         | [通过](evidence/remote-regression.log#L19) |
| [R020 新版图标名称](../../../../../packages/kmh-remote/test/icon-compat.test.mjs#L50)        | 给图标解析器提供新版图标集合。             | 各按钮取得新版图标。         | [通过](evidence/remote-regression.log#L20) |
| [R021 两代图标同时存在](../../../../../packages/kmh-remote/test/icon-compat.test.mjs#L60)    | 同时提供新旧两套图标，检查解析结果。       | 优先选用新版图标。           | [通过](evidence/remote-regression.log#L21) |
| [R022 图标完全缺失](../../../../../packages/kmh-remote/test/icon-compat.test.mjs#L71)        | 给解析器空图标集合，逐项检查返回值。       | 各缺失图标返回空值。         | [通过](evidence/remote-regression.log#L22) |
| [R023 错误的图标值](../../../../../packages/kmh-remote/test/icon-compat.test.mjs#L79)        | 依次传入数字、文字及空值等候选。           | 这些候选被识别为空图标。     | [通过](evidence/remote-regression.log#L23) |
| [R024 图标集合缺失](../../../../../packages/kmh-remote/test/icon-compat.test.mjs#L107)       | 传入缺失或类型错误的图标集合并执行解析。   | 解析安全结束，返回空图标。   | [通过](evidence/remote-regression.log#L24) |
| [R025 图标的文字备用显示](../../../../../packages/kmh-remote/test/icon-compat.test.mjs#L116) | 逐项读取按钮的备用字形。                   | 每个图标都有可用的文字字形。 | [通过](evidence/remote-regression.log#L25) |
| [R026 图标的兼容接入方式](../../../../../packages/kmh-remote/test/icon-compat.test.mjs#L123) | 读取移动端组件导入与解析代码。             | 组件使用兼容图标解析入口。   | [通过](evidence/remote-regression.log#L26) |
| [R027 图标兼容代码已打包](../../../../../packages/kmh-remote/test/icon-compat.test.mjs#L150) | 读取打包文件，检查新版名称和备用字形标记。 | 构建结果包含兼容逻辑。       | [通过](evidence/remote-regression.log#L27) |

</details>

<details>
<summary>插件加载与卸载：4项全部通过</summary>

| 用例                                                                                          | 怎样测试                                       | 应该看到什么                           | 留档结果                                   |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------- | ------------------------------------------ |
| [R028 设置页及插件详情入口](../../../../../packages/kmh-remote/test/kmh-package.test.mjs#L10) | 加载客户端工厂并记录注册的页面位置与条目标识。 | 设置页及两种详情页都正确注册。         | [通过](evidence/remote-regression.log#L28) |
| [R029 插件身份一致](../../../../../packages/kmh-remote/test/kmh-package.test.mjs#L61)         | 比较包声明、模块导出及工厂使用的名称。         | 各处指向同一个插件。                   | [通过](evidence/remote-regression.log#L29) |
| [R030 源码和构建入口](../../../../../packages/kmh-remote/test/kmh-package.test.mjs#L86)       | 读取迁入清单和包声明，检查源码清单及构建导出。 | 清单保留手写源码，导出指向构建结果。   | [通过](evidence/remote-regression.log#L30) |
| [R031 插件卸载释放服务](../../../../../packages/kmh-remote/test/kmh-package.test.mjs#L106)    | 以测试宿主挂载插件，触发更新相关入口与卸载。   | 更新行为由宿主管理，服务在卸载时释放。 | [通过](evidence/remote-regression.log#L31) |

</details>

<details>
<summary>桌面与手机布局：7项全部通过</summary>

| 用例                                                                                          | 怎样测试                                           | 应该看到什么               | 留档结果                                   |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------- | -------------------------- | ------------------------------------------ |
| [R032 地址指定桌面布局](../../../../../packages/kmh-remote/test/layout-mode.test.mjs#L11)     | 组合地址参数、保存设置与屏幕宽度，指定桌面布局。   | 地址参数决定桌面布局。     | [通过](evidence/remote-regression.log#L32) |
| [R033 地址指定手机布局](../../../../../packages/kmh-remote/test/layout-mode.test.mjs#L26)     | 在宽屏等条件下指定手机布局。                       | 地址参数决定手机布局。     | [通过](evidence/remote-regression.log#L33) |
| [R034 自动布局使用保存设置](../../../../../packages/kmh-remote/test/layout-mode.test.mjs#L38) | 地址使用自动模式或空参数，再提供已保存的布局偏好。 | 布局按保存偏好选择。       | [通过](evidence/remote-regression.log#L34) |
| [R035 按屏幕自动选布局](../../../../../packages/kmh-remote/test/layout-mode.test.mjs#L53)     | 提供空布局偏好，再分别模拟宽窄屏。                 | 布局按屏幕条件选择。       | [通过](evidence/remote-regression.log#L35) |
| [R036 清除旧布局偏好](../../../../../packages/kmh-remote/test/layout-mode.test.mjs#L68)       | 清除本地布局偏好后重新执行自动布局判断。           | 布局恢复按屏幕条件选择。   | [通过](evidence/remote-regression.log#L36) |
| [R037 保存地址中的布局偏好](../../../../../packages/kmh-remote/test/layout-mode.test.mjs#L79) | 分别保存桌面与手机参数，再读取本地设置。           | 本地设置与指定模式相同。   | [通过](evidence/remote-regression.log#L37) |
| [R038 布局判定已打包](../../../../../packages/kmh-remote/test/layout-mode.test.mjs#L95)       | 读取打包文件，检查布局模式判定的标记。             | 构建结果保留布局判断逻辑。 | [通过](evidence/remote-regression.log#L38) |

</details>

<details>
<summary>中英文文字：3项全部通过</summary>

| 用例                                                                                      | 怎样测试                                   | 应该看到什么               | 留档结果                                   |
| ----------------------------------------------------------------------------------------- | ------------------------------------------ | -------------------------- | ------------------------------------------ |
| [R039 中英文条目齐全](../../../../../packages/kmh-remote/test/locales.test.mjs#L11)       | 读取两种语言的文字条目并比较名称集合。     | 两种语言的条目一一对应。   | [通过](evidence/remote-regression.log#L39) |
| [R040 中英文可替换内容一致](../../../../../packages/kmh-remote/test/locales.test.mjs#L21) | 逐条提取两种语言文字中的可替换位置并比较。 | 同一条目的可替换位置一致。 | [通过](evidence/remote-regression.log#L40) |
| [R041 页面引用的文字存在](../../../../../packages/kmh-remote/test/locales.test.mjs#L31)   | 扫描页面引用的翻译名称，逐项查询词典。     | 所有引用都有对应文字。     | [通过](evidence/remote-regression.log#L41) |

</details>

<details>
<summary>手机导航与页面布局：13项全部通过</summary>

| 用例                                                                                        | 怎样测试                                           | 应该看到什么                               | 留档结果                                   |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------ | ------------------------------------------ |
| [R042 手机侧边栏导航范围](../../../../../packages/kmh-remote/test/mobile-nav.test.mjs#L33)  | 读取导航识别规则，检查新旧侧边栏、会话及工具入口。 | 约定的导航入口均被覆盖。                   | [通过](evidence/remote-regression.log#L42) |
| [R043 工作区折叠行为](../../../../../packages/kmh-remote/test/mobile-nav.test.mjs#L50)      | 用模拟元素调用导航判断，元素匹配工作区行。         | 结果按折叠操作处理。                       | [通过](evidence/remote-regression.log#L43) |
| [R044 会话行与行内菜单](../../../../../packages/kmh-remote/test/mobile-nav.test.mjs#L57)    | 分别用会话行、新会话及行内菜单模拟点击目标。       | 会话操作被识别为导航，行内菜单按菜单处理。 | [通过](evidence/remote-regression.log#L44) |
| [R045 空点击目标](../../../../../packages/kmh-remote/test/mobile-nav.test.mjs#L70)          | 向点击判断传入空值和普通对象。                     | 安全返回空结果。                           | [通过](evidence/remote-regression.log#L45) |
| [R046 浮层中的点击](../../../../../packages/kmh-remote/test/mobile-nav.test.mjs#L78)        | 构造菜单等浮层目标，调用浮层识别逻辑。             | 点击被识别为浮层操作。                     | [通过](evidence/remote-regression.log#L46) |
| [R047 抽屉识别规则接入](../../../../../packages/kmh-remote/test/mobile-nav.test.mjs#L89)    | 比较抽屉常量与组件中使用的规则。                   | 识别规则与组件用法一致。                   | [通过](evidence/remote-regression.log#L47) |
| [R048 抽屉的显示层级](../../../../../packages/kmh-remote/test/mobile-nav.test.mjs#L138)     | 读取手机样式，比较抽屉与遮罩的层级。               | 抽屉层级高于相关遮罩。                     | [通过](evidence/remote-regression.log#L48) |
| [R049 全屏遮罩的处理](../../../../../packages/kmh-remote/test/mobile-nav.test.mjs#L159)     | 读取手机页面样式，检查框架附加遮罩的覆盖规则。     | 覆盖规则解除全屏遮罩干扰。                 | [通过](evidence/remote-regression.log#L49) |
| [R050 抽屉样式已打包](../../../../../packages/kmh-remote/test/mobile-nav.test.mjs#L179)     | 读取打包文件，查找抽屉样式关键规则。               | 构建结果包含抽屉样式。                     | [通过](evidence/remote-regression.log#L50) |
| [R051 手机右栏入口](../../../../../packages/kmh-remote/test/mobile-nav.test.mjs#L198)       | 读取右栏默认设置、稳定入口标记与隐藏规则。         | 默认显示入口，关闭设置后按规则隐藏。       | [通过](evidence/remote-regression.log#L51) |
| [R052 窄屏输入区底栏](../../../../../packages/kmh-remote/test/mobile-nav.test.mjs#L227)     | 读取输入区域样式，检查稳定标记及窄屏换行规则。     | 底栏具有标记且允许窄屏换行。               | [通过](evidence/remote-regression.log#L52) |
| [R053 统计行标记的位置](../../../../../packages/kmh-remote/test/mobile-nav.test.mjs#L249)   | 读取移动端挂载代码，检查标记使用的插入位置。       | 统计行标记落在约定底栏位置。               | [通过](evidence/remote-regression.log#L53) |
| [R054 移动组件已进入构建](../../../../../packages/kmh-remote/test/mobile-nav.test.mjs#L266) | 读取打包代码，检查移动入口引用的组件定义与导入。   | 引用的组件均有对应实现。                   | [通过](evidence/remote-regression.log#L54) |

</details>

<details>
<summary>手机统计显示设置：5项全部通过</summary>

| 用例                                                                                                     | 怎样测试                                           | 应该看到什么                             | 留档结果                                   |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------- | ------------------------------------------ |
| [R055 关闭统计的样式规则](../../../../../packages/kmh-remote/test/pocket-stats-optout.test.mjs#L114)     | 解析样式，检查统计关闭规则的选择条件、声明和数量。 | 规则符合约定且只有一份。                 | [通过](evidence/remote-regression.log#L55) |
| [R056 统计关闭规则的屏幕范围](../../../../../packages/kmh-remote/test/pocket-stats-optout.test.mjs#L131) | 解析规则的外层屏幕条件，检查窄屏条件是否同时成立。 | 手机屏幕下规则可以生效。                 | [通过](evidence/remote-regression.log#L56) |
| [R057 默认统计显示](../../../../../packages/kmh-remote/test/pocket-stats-optout.test.mjs#L156)           | 读取默认设置路径和相关样式规则。                   | 默认设置保留统计显示。                   | [通过](evidence/remote-regression.log#L57) |
| [R058 统计行标记的写入](../../../../../packages/kmh-remote/test/pocket-stats-optout.test.mjs#L179)       | 读取标记代码及相关设置引用。                       | 统计行持续写入约定标记，供显示规则使用。 | [通过](evidence/remote-regression.log#L58) |
| [R059 统计关闭样式已打包](../../../../../packages/kmh-remote/test/pocket-stats-optout.test.mjs#L192)     | 读取构建样式并解析统计关闭规则。                   | 构建结果保留对应规则。                   | [通过](evidence/remote-regression.log#L59) |

</details>

<details>
<summary>浏览器兼容功能：4项全部通过</summary>

| 用例                                                                                          | 怎样测试                                             | 应该看到什么                               | 留档结果                                   |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------ | ------------------------------------------ |
| [R060 浏览器兼容脚本内容](../../../../../packages/kmh-remote/test/polyfill.test.mjs#L21)      | 读取兼容脚本，检查重复加载标记及两个兼容功能。       | 标记、取消信号组合和随机标识兼容逻辑齐全。 | [通过](evidence/remote-regression.log#L60) |
| [R061 浏览器已有取消功能](../../../../../packages/kmh-remote/test/polyfill.test.mjs#L65)      | 给测试环境安装原生取消信号组合函数，再运行兼容脚本。 | 原有函数保持相同。                         | [通过](evidence/remote-regression.log#L61) |
| [R062 浏览器缺少取消功能](../../../../../packages/kmh-remote/test/polyfill.test.mjs#L75)      | 移除该函数，运行兼容脚本，再触发不同取消信号。       | 组合函数被补齐，并正确传递取消状态。       | [通过](evidence/remote-regression.log#L62) |
| [R063 浏览器缺少随机标识功能](../../../../../packages/kmh-remote/test/polyfill.test.mjs#L110) | 提供缺少随机标识功能的环境，执行兼容脚本。           | 函数被补齐，返回符合格式的标识。           | [通过](evidence/remote-regression.log#L63) |

</details>

<details>
<summary>请求转发、登录与长连接：36项全部通过</summary>

| 用例                                                                                          | 怎样测试                                                                   | 应该看到什么                                         | 留档结果                                   |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------ |
| [R064 网页访问被上游拒绝](../../../../../packages/kmh-remote/test/proxy.test.mjs#L89)         | 启动测试上游返回访问拒绝，再经代理请求网页。                               | 保留403状态，并显示可操作提示。                      | [通过](evidence/remote-regression.log#L64) |
| [R065 接口访问被上游拒绝](../../../../../packages/kmh-remote/test/proxy.test.mjs#L120)        | 经代理发送接口请求，让上游返回访问拒绝。                                   | 保留接口的原始状态与正文。                           | [通过](evidence/remote-regression.log#L65) |
| [R066 其他访问拒绝正文](../../../../../packages/kmh-remote/test/proxy.test.mjs#L145)          | 让上游返回另一种403正文，再经代理读取。                                    | 正文按原样传递。                                     | [通过](evidence/remote-regression.log#L66) |
| [R067 普通请求转发](../../../../../packages/kmh-remote/test/proxy.test.mjs#L170)              | 启动真实测试上游，经代理请求并记录上游收到的信息。                         | 上游地址信息按约定调整，响应内容保持一致。           | [通过](evidence/remote-regression.log#L67) |
| [R068 长连接被上游重置](../../../../../packages/kmh-remote/test/proxy.test.mjs#L199)          | 建立长连接后让上游突然重置连接，再请求普通页面。                           | 连接错误被处理，代理继续提供页面。                   | [通过](evidence/remote-regression.log#L68) |
| [R069 长连接半关闭](../../../../../packages/kmh-remote/test/proxy.test.mjs#L261)              | 建立长连接，让客户端直接结束底层连接，观察两侧连接。                       | 相关连接最终释放。                                   | [通过](evidence/remote-regression.log#L69) |
| [R070 长连接数据转发](../../../../../packages/kmh-remote/test/proxy.test.mjs#L348)            | 建立经代理的长连接并发送测试消息。                                         | 收到上游回显内容。                                   | [通过](evidence/remote-regression.log#L70) |
| [R071 长连接心跳与失联](../../../../../packages/kmh-remote/test/proxy.test.mjs#L377)          | 分别建立正常回应及停止回应的连接，等待心跳周期。                           | 正常连接持续传输，失联连接被清理。                   | [通过](evidence/remote-regression.log#L71) |
| [R072 上游服务停止](../../../../../packages/kmh-remote/test/proxy.test.mjs#L431)              | 让代理连接一个已经关闭的上游入口。                                         | 返回502及上游连接提示。                              | [通过](evidence/remote-regression.log#L72) |
| [R073 长连接首条消息](../../../../../packages/kmh-remote/test/proxy.test.mjs#L446)            | 把首条消息紧接在连接握手后发出，检查上游接收。                             | 上游收到首条消息。                                   | [通过](evidence/remote-regression.log#L73) |
| [R074 网页兼容脚本的注入范围](../../../../../packages/kmh-remote/test/proxy.test.mjs#L490)    | 分别返回网页、脚本和样式文件，经代理读取。                                 | 网页得到兼容脚本，其他资源保持原内容。               | [通过](evidence/remote-regression.log#L74) |
| [R075 页面中的旧会话标记](../../../../../packages/kmh-remote/test/proxy.test.mjs#L524)        | 分别请求首页及登录页，检查生成内容。                                       | 页面使用当前会话内容与标记规则。                     | [通过](evidence/remote-regression.log#L75) |
| [R076 压缩网页的传递](../../../../../packages/kmh-remote/test/proxy.test.mjs#L557)            | 让上游返回压缩网页，经代理读取压缩头和内容。                               | 压缩数据保持完整且可以解压。                         | [通过](evidence/remote-regression.log#L76) |
| [R077 关闭带长连接的代理](../../../../../packages/kmh-remote/test/proxy.test.mjs#L615)        | 建立活动长连接后调用关闭方法，等待它结束。                                 | 代理在测试时限内关闭。                               | [通过](evidence/remote-regression.log#L77) |
| [R078 长连接握手被拒绝](../../../../../packages/kmh-remote/test/proxy.test.mjs#L641)          | 让上游以访问拒绝回应长连接握手，读取客户端响应。                           | 客户端收到拒绝状态并结束等待。                       | [通过](evidence/remote-regression.log#L78) |
| [R079 默认网页注入内容](../../../../../packages/kmh-remote/test/proxy.test.mjs#L682)          | 读取默认注入脚本并检查桌面环境标记。                                       | 内容符合当前远程网页的标记规则。                     | [通过](evidence/remote-regression.log#L79) |
| [R080 旧桌面兼容函数](../../../../../packages/kmh-remote/test/proxy.test.mjs#L701)            | 单独生成旧桌面兼容脚本并检查参数处理代码。                                 | 脚本包含其函数约定的参数处理。                       | [通过](evidence/remote-regression.log#L80) |
| [R081 大响应和流式响应压缩](../../../../../packages/kmh-remote/test/proxy.test.mjs#L719)      | 分别请求大文本数据、实时事件流与已经压缩的响应。                           | 大文本被压缩且解压内容一致，其他类型按既有规则传递。 | [通过](evidence/remote-regression.log#L81) |
| [R082 登录与访问权限](../../../../../packages/kmh-remote/test/proxy.test.mjs#L874)            | 经测试代理依次执行公网登录、携带登录凭据访问、局域网访问及长连接认证。     | 各入口按对应认证规则放行或拒绝。                     | [通过](evidence/remote-regression.log#L82) |
| [R083 登录保持与服务重启](../../../../../packages/kmh-remote/test/proxy.test.mjs#L1061)       | 登录后检查有效期及登录凭据，再使用另一服务实例检查旧凭据。                 | 有效期和实例绑定符合约定，重启后的访问要求重新登录。 | [通过](evidence/remote-regression.log#L83) |
| [R084 局域网密码开关](../../../../../packages/kmh-remote/test/proxy.test.mjs#L1190)           | 关闭局域网密码开关，分别请求局域网和公网地址。                             | 局域网按开关直接访问，公网继续要求密码。             | [通过](evidence/remote-regression.log#L84) |
| [R085 局域网访问总开关](../../../../../packages/kmh-remote/test/proxy.test.mjs#L1245)         | 分别开关局域网访问，再请求局域网、本机与公网入口。                         | 局域网按设置响应，本机与公网按各自规则响应。         | [通过](evidence/remote-regression.log#L85) |
| [R086 多次输错密码](../../../../../packages/kmh-remote/test/proxy.test.mjs#L1316)             | 连续输入错误密码，分别检查单个来源、另一来源、登录成功后的状态与全局限制。 | 达到阈值时限速，独立来源及成功清零符合规则。         | [通过](evidence/remote-regression.log#L86) |
| [R087 同时提交错误密码](../../../../../packages/kmh-remote/test/proxy.test.mjs#L1436)         | 准备同时读取请求内容的多个登录请求，使它们重叠提交。                       | 读取内容后再次检查限速阈值。                         | [通过](evidence/remote-regression.log#L87) |
| [R088 地址密码和长连接密码限速](../../../../../packages/kmh-remote/test/proxy.test.mjs#L1508) | 分别通过地址参数及长连接入口提交错误密码。                                 | 这些密码尝试计入限速。                               | [通过](evidence/remote-regression.log#L88) |
| [R089 伪造本机来源](../../../../../packages/kmh-remote/test/proxy.test.mjs#L1654)             | 组合真实连接来源与声明地址，执行来源分类和请求。                           | 最终权限受真实连接来源约束。                         | [通过](evidence/remote-regression.log#L89) |
| [R090 两种请求入口使用相同策略](../../../../../packages/kmh-remote/test/proxy.test.mjs#L1739) | 读取普通请求及长连接入口的处理代码，检查来源策略接入。                     | 两个入口都使用对应来源策略。                         | [通过](evidence/remote-regression.log#L90) |
| [R091 高级模式提示](../../../../../packages/kmh-remote/test/proxy.test.mjs#L1754)             | 生成高级模式提示脚本并检查提示标记和文案。                                 | 脚本包含高级模式提示。                               | [通过](evidence/remote-regression.log#L91) |
| [R092 地址分类边界](../../../../../packages/kmh-remote/test/proxy.test.mjs#L1765)             | 把本机地址、私网地址及陌生域名交给分类函数。                               | 分别归入本机、局域网及公网。                         | [通过](evidence/remote-regression.log#L92) |
| [R093 首次访问补登录凭据](../../../../../packages/kmh-remote/test/proxy.test.mjs#L1809)       | 组合根路径、其他路径及已有登录凭据等输入，调用路径处理函数。               | 首屏按约定补充凭据，其他情况保留对应路径。           | [通过](evidence/remote-regression.log#L93) |
| [R094 清理地址中的桌面参数](../../../../../packages/kmh-remote/test/proxy.test.mjs#L1866)     | 传入含桌面参数及普通参数的地址，执行清理。                                 | 桌面参数被移除，其他参数保留。                       | [通过](evidence/remote-regression.log#L94) |
| [R095 转发前清理桌面参数](../../../../../packages/kmh-remote/test/proxy.test.mjs#L1901)       | 启动测试上游，经过代理发送带桌面参数的请求并记录上游路径。                 | 上游收到清理后的路径。                               | [通过](evidence/remote-regression.log#L95) |
| [R096 首次页面登录握手](../../../../../packages/kmh-remote/test/proxy.test.mjs#L1935)         | 启动代理与测试上游，读取过渡页及登录凭据，再继续访问首页。                 | 首屏发出过渡页，后续正常显示首页。                   | [通过](evidence/remote-regression.log#L96) |
| [R097 握手次数上限](../../../../../packages/kmh-remote/test/proxy.test.mjs#L2015)             | 模拟客户端持续无法保存登录凭据，反复请求首页。                             | 达到上限后显示可操作提示。                           | [通过](evidence/remote-regression.log#L97) |
| [R098 握手计数窗口](../../../../../packages/kmh-remote/test/proxy.test.mjs#L2104)             | 在设定时间内连续计数，再清零并推进到窗口外。                               | 窗口内累计、清零及过期重新计数符合预期。             | [通过](evidence/remote-regression.log#L98) |
| [R099 地址密码登录](../../../../../packages/kmh-remote/test/proxy.test.mjs#L2127)             | 在地址中携带测试密码访问页面，检查响应设置及后续访问。                     | 返回登录凭据，并按约定限制脚本读取。                 | [通过](evidence/remote-regression.log#L99) |

</details>

<details>
<summary>服务状态与二维码：5项全部通过</summary>

| 用例                                                                                   | 怎样测试                                                       | 应该看到什么                             | 留档结果                                    |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------- |
| [R100 二维码随地址变化](../../../../../packages/kmh-remote/test/service.test.mjs#L13)  | 使用测试代理和二维码生成器，先后设置本机及公网地址并读取状态。 | 两类地址各有二维码，地址变化后刷新缓存。 | [通过](evidence/remote-regression.log#L100) |
| [R101 监听端口冲突](../../../../../packages/kmh-remote/test/service.test.mjs#L51)      | 让测试代理启动器返回端口冲突错误，调用启动。                   | 只尝试一次，并保留原始错误。             | [通过](evidence/remote-regression.log#L101) |
| [R102 同时启动与卸载](../../../../../packages/kmh-remote/test/service.test.mjs#L67)    | 同时调用启动，启动完成前触发卸载，再重复卸载。                 | 共享同一次启动，资源只释放一次。         | [通过](evidence/remote-regression.log#L102) |
| [R103 公网地址状态查询](../../../../../packages/kmh-remote/test/service.test.mjs#L102) | 用测试服务设置公网地址，调用状态与旧隧道入口。                 | 状态返回完整地址，旧隧道入口保持关闭。   | [通过](evidence/remote-regression.log#L103) |
| [R104 二维码与网卡选择](../../../../../packages/kmh-remote/test/service.test.mjs#L129) | 生成测试二维码，并给网卡选择函数多种网卡信息。                 | 二维码形状及所选局域网地址符合约定。     | [通过](evidence/remote-regression.log#L104) |

</details>

<details>
<summary>设置页保存：1项全部通过</summary>

| 用例                                                                                            | 怎样测试                                                     | 应该看到什么               | 留档结果                                    |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------- | ------------------------------------------- |
| [R105 设置页局域网开关](../../../../../packages/kmh-remote/test/settings-actions.test.mjs#L127) | 以模拟组件状态调用真实设置处理器，依次打开和关闭局域网访问。 | 保存目标值后取得完整状态。 | [通过](evidence/remote-regression.log#L105) |

</details>

<details>
<summary>设置校验与存储：1项全部通过</summary>

| 用例                                                                                 | 怎样测试                                                                   | 应该看到什么                               | 留档结果                                    |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------- |
| [R106 各类设置的保存](../../../../../packages/kmh-remote/test/settings.test.mjs#L15) | 在临时目录依次写入合法、非法及待标准化的公网地址，并保存局域网和密码设置。 | 地址按规则校验和保存，各设置保持各自结果。 | [通过](evidence/remote-regression.log#L106) |

</details>

<details>
<summary>服务链路与页面接入：7项全部通过</summary>

| 用例                                                                                     | 怎样测试                                             | 应该看到什么                                 | 留档结果                                    |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------- | ------------------------------------------- |
| [R107 真实压缩网页链路](../../../../../packages/kmh-remote/test/smoke.test.mjs#L84)      | 启动本地真实上游及代理，返回压缩网页并读取最终页面。 | 页面正文和对应兼容脚本符合该链路约定。       | [通过](evidence/remote-regression.log#L107) |
| [R108 真实代理与状态](../../../../../packages/kmh-remote/test/smoke.test.mjs#L131)       | 启动真实服务，经代理读取网页并查询运行状态。         | 网页可读取，兼容脚本和监听状态可核对。       | [通过](evidence/remote-regression.log#L108) |
| [R109 真实服务的状态方法](../../../../../packages/kmh-remote/test/smoke.test.mjs#L165)   | 启动真实服务，经状态方法读取运行信息。               | 返回实际代理运行状态。                       | [通过](evidence/remote-regression.log#L109) |
| [R110 客户端使用宿主组件库](../../../../../packages/kmh-remote/test/smoke.test.mjs#L195) | 给客户端工厂测试宿主的组件模块，加载插件工厂。       | 工厂完成加载并导出插件入口。                 | [通过](evidence/remote-regression.log#L110) |
| [R111 设置页首次加载](../../../../../packages/kmh-remote/test/smoke.test.mjs#L222)       | 让首次状态读取保持等待，渲染设置页面。               | 显示加载状态。                               | [通过](evidence/remote-regression.log#L111) |
| [R112 手机抽屉遮罩规则](../../../../../packages/kmh-remote/test/smoke.test.mjs#L272)     | 读取抽屉组件和样式，检查内部及外部点击处理。         | 内部点击正常处理，外部点击保留关闭行为。     | [通过](evidence/remote-regression.log#L112) |
| [R113 手机文件入口](../../../../../packages/kmh-remote/test/smoke.test.mjs#L309)         | 读取移动端文件入口的宿主能力判断与点击逻辑。         | 具备文件能力时提供入口，点击入口后关闭抽屉。 | [通过](evidence/remote-regression.log#L113) |

</details>

<details>
<summary>宿主通信兼容：8项全部通过</summary>

| 用例                                                                                            | 怎样测试                                             | 应该看到什么                   | 留档结果                                    |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------ | ------------------------------------------- |
| [R114 通信兼容脚本已接入](../../../../../packages/kmh-remote/test/transport-shim.test.mjs#L40)  | 读取兼容脚本及默认注入集合。                         | 集合包含带重复加载标记的脚本。 | [通过](evidence/remote-regression.log#L114) |
| [R115 稍后出现的通信对象](../../../../../packages/kmh-remote/test/transport-shim.test.mjs#L55)  | 先运行兼容脚本，再给宿主设置缺少接口工厂的通信对象。 | 补上兼容方法并保留已有属性。   | [通过](evidence/remote-regression.log#L115) |
| [R116 已有通信方法](../../../../../packages/kmh-remote/test/transport-shim.test.mjs#L75)        | 给宿主已有接口工厂，再执行兼容脚本。                 | 宿主原方法保持相同。           | [通过](evidence/remote-regression.log#L116) |
| [R117 已经存在的通信对象](../../../../../packages/kmh-remote/test/transport-shim.test.mjs#L84)  | 先设置通信对象，再执行兼容脚本。                     | 兼容方法同样被补齐。           | [通过](evidence/remote-regression.log#L117) |
| [R118 错误的通信对象](../../../../../packages/kmh-remote/test/transport-shim.test.mjs#L98)      | 依次设置空值及类型错误的通信对象，执行兼容脚本。     | 脚本安全结束。                 | [通过](evidence/remote-regression.log#L118) |
| [R119 远程网页的宿主标记](../../../../../packages/kmh-remote/test/transport-shim.test.mjs#L118) | 在空通信环境运行兼容脚本，再执行宿主识别判断。       | 网页获得约定宿主标记。         | [通过](evidence/remote-regression.log#L119) |
| [R120 保留原通信属性](../../../../../packages/kmh-remote/test/transport-shim.test.mjs#L145)     | 给通信对象预置属性后运行兼容脚本。                   | 补上宿主标记并保留原属性。     | [通过](evidence/remote-regression.log#L120) |
| [R121 已有宿主标记](../../../../../packages/kmh-remote/test/transport-shim.test.mjs#L161)       | 准备已经声明宿主身份的对象，再运行兼容脚本。         | 标记保持原值与属性设置。       | [通过](evidence/remote-regression.log#L121) |

</details>

<details>
<summary>接口接入与请求校验：17项全部通过</summary>

| 用例                                                                                               | 怎样测试                                                       | 应该看到什么                       | 留档结果                                    |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------- | ------------------------------------------- |
| [R122 直接注册网页接口](../../../../../packages/kmh-remote/test/webserver-mount.test.mjs#L161)     | 提供真实测试网页服务器及会抛错的旧入口，安装处理器后请求接口。 | 请求通过网页服务器处理并返回结果。 | [通过](evidence/remote-regression.log#L122) |
| [R123 登录检查返回401](../../../../../packages/kmh-remote/test/webserver-mount.test.mjs#L180)      | 让认证检查器返回401，再请求接口。                              | 响应保留401及对应文字。            | [通过](evidence/remote-regression.log#L123) |
| [R124 权限检查返回403](../../../../../packages/kmh-remote/test/webserver-mount.test.mjs#L195)      | 让认证检查器返回403，再请求接口。                              | 响应保留403及对应文字。            | [通过](evidence/remote-regression.log#L124) |
| [R125 认证方法保留所属对象](../../../../../packages/kmh-remote/test/webserver-mount.test.mjs#L210) | 给认证方法设置依赖对象的状态，再发起请求。                     | 方法以正确对象调用并成功处理。     | [通过](evidence/remote-regression.log#L125) |
| [R126 缺少认证器的外部请求](../../../../../packages/kmh-remote/test/webserver-mount.test.mjs#L259) | 提供缺少认证器的宿主，发送外部地址声明的请求。                 | 请求得到403。                      | [通过](evidence/remote-regression.log#L126) |
| [R127 跨站请求的限制](../../../../../packages/kmh-remote/test/webserver-mount.test.mjs#L275)       | 在缺少认证器的情况下发送跨站来源请求。                         | 请求得到403。                      | [通过](evidence/remote-regression.log#L127) |
| [R128 请求方式校验](../../../../../packages/kmh-remote/test/webserver-mount.test.mjs#L290)         | 分别用允许范围外的请求方式访问接口。                           | 返回404。                          | [通过](evidence/remote-regression.log#L128) |
| [R129 接口路径校验](../../../../../packages/kmh-remote/test/webserver-mount.test.mjs#L324)         | 请求包含上级目录标记的接口路径。                               | 返回404。                          | [通过](evidence/remote-regression.log#L129) |
| [R130 请求内容类型校验](../../../../../packages/kmh-remote/test/webserver-mount.test.mjs#L338)     | 使用其他内容类型向接口发送请求。                               | 返回415并说明所需内容类型。        | [通过](evidence/remote-regression.log#L130) |
| [R131 请求正文格式校验](../../../../../packages/kmh-remote/test/webserver-mount.test.mjs#L354)     | 提交格式错误的请求正文。                                       | 返回400及格式说明。                | [通过](evidence/remote-regression.log#L131) |
| [R132 缺少请求编号](../../../../../packages/kmh-remote/test/webserver-mount.test.mjs#L393)         | 提交缺少请求编号的数据，读取返回消息。                         | 返回约定格式的无效请求错误。       | [通过](evidence/remote-regression.log#L132) |
| [R133 方法名与入口匹配](../../../../../packages/kmh-remote/test/webserver-mount.test.mjs#L413)     | 让正文方法名和请求路径中的方法名不同，再调用接口。             | 返回对应请求的错误消息。           | [通过](evidence/remote-regression.log#L133) |
| [R134 业务处理发生异常](../../../../../packages/kmh-remote/test/webserver-mount.test.mjs#L432)     | 让测试处理器抛出异常，再调用接口。                             | 异常被转成约定错误结果。           | [通过](evidence/remote-regression.log#L134) |
| [R135 成功返回消息格式](../../../../../packages/kmh-remote/test/webserver-mount.test.mjs#L464)     | 通过网页入口请求成功结果，与原接口消息结构逐字段比较。         | 返回消息符合相同格式。             | [通过](evidence/remote-regression.log#L135) |
| [R136 卸载接口处理器](../../../../../packages/kmh-remote/test/webserver-mount.test.mjs#L485)       | 请求一次接口，再卸载处理器并重新请求。                         | 卸载前成功，卸载后返回404。        | [通过](evidence/remote-regression.log#L136) |
| [R137 旧宿主的接口接入](../../../../../packages/kmh-remote/test/webserver-mount.test.mjs#L508)     | 提供只有旧接口注册器的宿主，安装处理器并调用。                 | 使用旧入口完成注册与处理。         | [通过](evidence/remote-regression.log#L137) |
| [R138 宿主缺少全部接口入口](../../../../../packages/kmh-remote/test/webserver-mount.test.mjs#L539) | 提供两种接口入口都缺少的宿主，安装并执行释放操作。             | 返回安全的释放方法并记录警告。     | [通过](evidence/remote-regression.log#L138) |

</details>

## AI复查与留档说明

本轮实际读取执行总账、两份测试日志、全仓汇总、覆盖范围、全文件统计、压缩原始计数和文件指纹清单，并逐项定位13个专项与138个回归用例。四项本次范围计数与执行总账相同；11个文件的原始语句、函数、分支计数与全文件统计相同。五个业务模块、五个其他接线文件及两份专项测试的当前指纹与留档相同；页面入口的后续设置改动已在开头标明。

六份仅含空白的日志分别对应构建、类型与代码规范检查及其verify副本。对应成功状态保存在[执行总账](evidence/execution.json)的退出码0中；每份日志自身提供的信息很少。历史文件只保留了空白输出和执行摘要，标准输出/错误输出的分别采集情况待补。

四组verify日志与开发日志的字节完全相同，提供相同输出。独立复跑次数和各自运行时间待从原执行过程核对。完整测试列表与逐文件计数均按本报告上方给出的来源读取。

全仓23项失败、11项跳过和本机截图的复查范围保持单列。关于开发顺序、替身、浏览器环境、旧版失败与迁移的历史说明保留在下面，供AI继续核对。

<details>
<summary>原执行记录：技术说明、开发顺序与环境限制</summary>

<a id="原执行记录"></a>

### 原结果

15/15 任务行通过；13/13 场景用例通过，跳过 0。提交内容的 Remote 既有回归 138/138 通过，跳过 0。五个 TS/TSX 业务模块全量及六个原文件新增接线的行、语句、函数、分支均为 100%，由覆盖率命令实际校验门槛。

保存结果从原密码处理处交付，文件归属当前 Home，详情提供本机分页查看。原设置沿用既有组件。源码与测试清单见 [source-manifest.json](evidence/source-manifest.json)，范围及计数见 [coverage-scope.json](evidence/coverage-scope.json)。

## 验证证据

用例主定义见[技术设计](../../tech-design.md)，功能全集来自 req 索引。下表记录实际参数与观察，场景正文仍以 spec 为准。

| 行 / 场景 / 用例             | 执行与观察                                                                                                                                                                                                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1 / None                    | 本包 build、严格 typecheck、lint 通过；Vitest、V8、真实 React 渲染和共享 schema 可执行。构建、类型与 lint 输出见 evidence/                                                                                                                                  |
| T2 / feat01 场景1 / SAVE-01  | 真实 HTTP/WS 代理与临时文件；LAN/public，表单与显式 URL/握手密码，成功、拒绝、前后限速、超大请求体及原始请求错误均保存对应终态；响应沿原登录流程。转发 IP 标记待核实，来源缺失有说明                                                                        |
| T3 / feat01 场景2 / SAVE-02  | 同 IP、固定同毫秒的 21 条混合提交逐条保存，序号唯一；首轮查询与保存同时初始化仍保留结果。真实中断后第二个错误终态只交付一次                                                                                                                                 |
| T4 / feat01 场景3 / SAVE-03  | 有效 Cookie 的刷新、资源及业务路径访问保持计数，再提交密码增加一条。浏览器只填写密码时保持记录数，提交后增加一条                                                                                                                                            |
| T5 / feat01 场景4 / SAVE-04  | 文件与查询逐字保留中文、换行、引号及反斜杠；毫秒 000/001/999；未知来源与转发声明完整，白名单剔除凭据。两个独立进程在上海、纽约时区写入同一 Home，旧记录保持原时间与时区                                                                                     |
| T6 / feat01 场景5 / SAVE-05  | 新 Home、A/B 隔离、同 Home 重新创建及独立进程重启均核对历史；多日、多文件、空文件、未完成尾行保持已完成历史。真实 Host 挂载/卸载接入记录器；执行设置重置前后访问文件字节相同                                                                                |
| T7 / feat01 场景6 / SAVE-06  | 真实 UTF-8 文件覆盖合计 T−1/T/T+1、单条恰好 T（T=10,000,000），包含换行与中文；同日重启产生 `_1`，并发保存跨日产生创建日文件及同日序号，容量允许时跨日继续原文件，历史共五条保留                                                                            |
| T8 / feat01 场景7 / SAVE-07  | 新目录及已有文件两种状态，实际 T+1 和明显超限均返回 `REMOTE_RECORD_TOO_LARGE`；清单与旧字节保持原样，后续正常保存成功                                                                                                                                       |
| T9 / feat01 场景8 / SAVE-08  | 仅指定文件接口注入 mkdir/open/write/sync/close/read 等故障，真实写入链继续执行；覆盖短写、零写、部分失败与恢复。保存错误及恢复标记保留，回调失败仍得到原登录响应。浏览器真实权限故障得到 EACCES，登录返回 302；恢复后原历史可读，新记录成功，仍显示此前失败 |
| T10 / feat02 场景1 / VIEW-01 | 真实组件核对字段、顺序、完整错误、来源声明和草稿；两处插件插槽接入 wrapper。浏览器从实际插件列表进入详情，切换 Tab 后草稿仍为输入值；浅色和系统深色主题文本及操作可辨认                                                                                     |
| T11 / feat02 场景2 / VIEW-02 | 全新 Home 的浏览器空态、仅含空文件的真实查询与组件空态；显示 Home 和正式记录起点，翻页边界禁用                                                                                                                                                              |
| T12 / feat02 场景3 / VIEW-03 | 1/10/11/20/21 条，21 个跨日文件及回拨时间；遍历页集合保持完整和唯一，追加后旧集合稳定，刷新返回新首条；返回上一页、无效游标、取消和迟到响应均核对。浏览器检查十条与末页边界、内部滚动及区域外操作                                                           |
| T13 / feat02 场景4 / VIEW-04 | 真实文件及指定 open/read 故障、损坏 JSON/schema，覆盖首次加载和已有旧页；原始 code/desc、旧页标记及原文件字节保留，解除故障后刷新成功。保存与读取同时失败分别展示；浏览器实际权限故障与恢复也通过                                                           |
| T14 / feat02 场景5 / VIEW-05 | 本机原连接及既有授权可读；远程和未知来源、无上下文、编码路径、HTTP/WS、伪造来源和非法信封均拒绝，受限请求的文件查询调用为零。浏览器经 Remote 查询得到 `REMOTE_RECORD_LOCAL_ONLY` 原文，Host 回环查询正常                                                    |
| T15 / 全部场景               | 专项 13/13，Remote 回归 138/138；四项覆盖率门槛通过；build、typecheck、本包 lint 和全仓 lint 通过。浏览器使用隔离 Home、临时端口及同版本已构建 DSH，验收后关闭页面和进程                                                                                    |

开发阶段在仓库根执行 `pnpm --filter @kmh/remote test:records:coverage`、`pnpm --filter @kmh/remote test`、build、typecheck、lint，退出码均为 0。提交前从 Git 暂存区导出独立副本，用已有依赖直接执行相同脚本入口；最终命令及计数见 [execution.json](evidence/execution.json)。专项输出见 [records-coverage.log](evidence/records-coverage.log)，既有回归见 [remote-regression.log](evidence/remote-regression.log)。完整 V8 计数归档在 [coverage-final.json.gz](evidence/coverage-final.json.gz)，工作区绝对前缀统一替换为相对路径；覆盖范围与源文件散列独立保存，既有文件全量指标也保留于 summary。

浏览器为实际 DSH Web 与当前插件构建。步骤为进入插件详情、填写设置草稿、切换记录、真实提交密码、翻页/刷新、读取故障与恢复、从 Remote 入口尝试查询；两次进程重启使用同一隔离 Home。临时认证与实际机器部署参数留在临时目录，截图留在本机忽略位置。公网分类使用测试 Host，真实 frp 外网可达性由部署环境验收。

## 开发顺序与测试限制

先写 13 条场景测试。依赖初期阻塞执行；文件模块写成后首次有效运行得到 8 个失败、5 个通过，原始输出见 [red.log](evidence/red.log)。其中容量用例的负 padding 属测试输入错误，随后修正；其余有效红灯覆盖代理未接线、详情 Tab/分页/错误展示及权限缺失。文件模块的首次有效运行已通过，记录为已有实现满足；本报告据实际执行保留这一顺序。

集成使用真实文件、Node HTTP/WS、Host 路由和 React 组件；上游仅返回测试页面，时钟和指定故障使用替身。公开 UI primitives 在组件测试中以简单可点击控件隔离，真实控件、主题及实际插槽由浏览器验收。依赖使用相同 DSH 提交的已有构建产物，只调整忽略的 node_modules 链接；DSH 受版本管理文件及子模块指针保持原值。

## 范围外检查限制

全仓 `pnpm test` 实际执行 386 项：352 通过、23 失败、11 跳过，退出 1，详见 [root-test-summary.log](evidence/root-test-summary.log)。失败来自当前子模块缺少 lib 构建、子模块侧 React 依赖及要求 DSH 已构建的启动路径；Remote 的全部既有测试通过。已用相同提交的构建产物完成本功能和全仓 lint，直接引用当前子模块 lib 的测试仍缺运行前提。全仓通过状态保持未完成，补齐这些依赖后的全仓回归由后续环境工作承接。

## 独立提交内容复验

最终暂存副本通过专项 13/13、Remote 回归 138/138、build、严格类型、lint 和格式检查，跳过 0；本次新增范围的行、语句、函数、分支覆盖率均为 100%。独立设置修复及其测试留在工作区，按其原任务承接。

副本复用同版本现有依赖。副本中的 pnpm 因工作区链接尝试安装并中止，随后通过 Node 直接运行构建、Vitest、Node test、TypeScript、ESLint 和 Prettier 的既有入口，实际命令保存在 execution.json。覆盖率接线范围依据固定 Git 基线及客户端注册入口，详见[覆盖率基线](baselines/README.md)。

2026-10-23 固定 Git 基线完成独立副本验证。当前规格目录集中维护一份功能正文与一份技术设计，原始验证计数、源文件散列和执行入口跟随当前实现更新。

## 严格 TypeScript 收口

用户要求把本次新增业务逻辑迁入 TS，保持功能和记录格式，并在完整场景及回归通过后提交。`access-records-integration.ts` 承接 Host 记录器创建、来源采集、一次密码终态、提交中断与错误、代理查询拦截、本机上下文和查询处理；`RemotePluginPanel.tsx` 承接详情渲染工厂；`access-records-locales.ts` 承接记录面板文案与翻译键检查。JS 文件负责原鉴权流程和模块调用。

业务模块使用现有 strict 编译选项及 typed ESLint，包含禁止 any、unsafe 操作、类型断言与未处理 Promise 的规则。统一入口 `pnpm --filter @kmh/remote check` 实际执行类型、lint 和格式检查，退出 0，输出见 [aggregate-check.log](evidence/aggregate-check.log)。原设置修复继续留在工作区。记录文件模块与持久化 RecordSchema 定义和迁移前内容一致；SAVE-04 继续核对原始错误、特殊字符、毫秒及时区，SAVE-05/06 继续核对历史及分文件。

最终暂存副本通过专项 13/13、Remote 回归 138/138、build、typecheck、lint 和格式检查；跳过 0。原有 13 个用例编号保持一致，VIEW-05 参数组补充原始请求缺失路径的 HTTP/WS 边界。范围内覆盖率为行 372/372、语句 434/434、函数 68/68、分支 216/216，门槛保持 100%。本工作区额外保留的 3 条设置修复测试另行通过。

真实浏览器使用 Docker 试用实例的迁移构建，验证插件详情的记录 Tab、完整旧记录和原始失败原因、刷新、切回设置保留草稿，并恢复测试草稿。原有 3 条记录的文件散列在部署前后相同；未登录查询返回 401，Remote 查询返回 403。浏览器构建保留沙盒已有设置修复，提交副本按本任务范围独立验证。截图保留在本机忽略位置，实际部署参数及认证资料由该实例维护。

</details>
