---
description: Codex 额度界面统一样式、局部设计与真实浏览器验收记录。
---

# 统一 Codex 额度界面

> 归属模块：packages/codex-cli 的插件详情及会话额度
> 功能文档：[界面呈现](../spec.md#界面呈现)
> spec: docs/spec/codex-cli-quota-display/spec.md
> 范围：界面呈现；feat01 场景1–4、feat02 场景1–4、feat03 场景1–4、场景7、场景9、feat04 场景1–9的受影响呈现与回归；C1–C3
> tech-design: 本文②；共享读取和模型联动沿用 ../tech-design.md
> 创建：2026-10-20
> 状态：已完成

## ① 需求与变更

用户要求“使用统一ui规范，修改ui”，授权本轮界面调整。详情页、显示设置与输入框的视觉层统一到现有设计系统。额度接口、共享读取、账号操作及模型选择协议沿用既有实现，C1–C3 持续适用。修改前可读源码、规格与设计保存在 [ui-before.json](ui-before.json)；目标正文见 [界面呈现](../spec.md#界面呈现)，变更索引回链到本任务。

## ② 精简技术设计

- D1（feat01/02）：使用统一 R20 设置卡片及设置填充/描边 token；13px/20px 行层级、500 字重；周期行、次要重置时间、Credits 与卡数建立稳定对齐。
- D2（feat04）：沿用受控草稿和保存逻辑，模式选择使用公共 Menu + Button，阈值输入使用公共 Input，提醒使用公共 Switch；分隔线使用0.5px语义描边。表单错误与草稿继续保留。
- D3（feat03/04）：常驻额度改用公共紧凑 Button；详情作为含按钮的点击固定对话浮层，沿用公共定位及外部关闭 hooks，采用主题 elevation 与 R28 圆角；关闭操作使用公共图标与 Tooltip。HoverCard 的锚点点击即关闭语义与既有点击固定要求不同，当前保留对话浮层状态管理。
- D4：局部 CSS Modules 取代全局样式字符串；构建将 CSS 作为同一客户端工厂的资源注入并随插件释放，维持单文件插件加载。单一类名绑定直接引用 CSS module，组合布局通过 CSS composes 实现。
- 计划文件：QuotaCard、QuotaDisplaySettings、ComposerQuota、DetailCard、client/index、局部 CSS 与声明、build.mjs、客户端测试适配和隔离浏览器夹具。文档按 kmh-doc/kmh-prose-standard 维护。
- 适用规范：dsh-client-ui-ux、web-styling、ui-radius、ui-primitives 公开目录、dev-ts；ui-check 做只读验收。R1 只用公开组件；R2/R4/R5 沿用 quota-protocol/store 单一来源；R3 纯 TS 不涉及跨语言；R6 读取间隔及阈值规则沿用；R7 保留保存确认、失败草稿和 provider 联动。构建和释放以包检查与槽位测试验证。

## ③ 测试用例与变化

| 用例 | 类型 | 依据 | 取证方式与预期 |
| --- | --- | --- | --- |
| U1 | 新增人工 | D1/D2，界面呈现 | 浏览器浅色/深色查看卡片、行、菜单、输入与颜色，统一 token、字号及对齐 |
| U2 | 新增人工 | D3，feat04 场景3 | 窄窗口展开额度，全部位于视口内；Escape/点击外部关闭；保留最低额度优先 |
| U3 | 沿用回归 | feat01–04、C1–C3 | 聚焦额度测试与真实公共组件验证；保留阈值边界、保存失败、Credits 0、模型来源联动和低频共享读取 |

自动用例预期沿用；改换 CSS module 后使用语义和数据标记定位测试节点。新增人工2项、沿用回归1组，业务场景与用例保持原定义。本次纯视觉变化以修改前截图和源码对照作为基线，采用浏览器人工取证。

## ④ 技术实现

- D1：QuotaCard 的周期使用响应式双列，Credits/重置卡并排并随宽度换行；原账号、版本和原生能力区域也采用同一设置卡片和信息行。
- D2：QuotaDisplaySettings 使用公共 Menu/按钮、Switch 与带百分号的 Input；保存确认、只读、失败草稿与原错误保持原路径。
- D3：ComposerQuota 使用公共 ghost Button、关闭图标和 Tooltip；原定位、外部关闭、Escape、模型确认订阅继续使用。
- D4：新增 quota.module.css 与 styles.d.ts，移除 quota-styles.ts；build.mjs 输出的客户端工厂嵌入生成 CSS，由 client/index 的 effect 挂载并释放。
- 测试：客户端节点改为数据标记定位，公共原语适配增加真实 Menu/Tooltip/图标；React 和 ReactDOM 固定同一解析来源。现有槽位集成用例补查样式挂载与卸载。隔离浏览器夹具加载完整基础主题，并使用公共按钮。
- 实际文件：src/client/{QuotaCard,QuotaDisplaySettings,ComposerQuota,DetailCard,index,quota.module.css,styles.d.ts}、build.mjs、包内 .gitignore、test/{quota-client.test.mjs,quota-browser-harness.mjs}、tests/runtime/codex-cli.test.mjs；规格、技术设计、包 README、本任务及任务索引。相对计划增加样式资源生命周期断言，业务接口文件保持原内容。包内忽略例外保留手写 styles.d.ts，使全新检出具备同一类型声明。

## ⑤ 验证结果

使用基线：修改前源码与规格见 ui-before.json；最终源码/设计/功能基线见 ui-after.json。执行目录 /Volumes/machub_app/proj/kongming-os，Node v25.6.1，执行时 HEAD 2b834b451e055fcfce22b00296eec65e92ced398，保留现有无关工作区改动。

### 开发验证与回归

| 项目 / 映射 | 命令或实际操作 | 真实结果与证据 |
| --- | --- | --- |
| U1；D1/D2；界面呈现 | 隔离浏览器打开真实 CodexCard；浅色与 body[data-ds-dark-theme] 深色逐项查看 | R20 设置卡片、500 字重、统一表单和两周期排版通过；深色底色 rgb(35,35,36)、浮层 rgb(44,44,46)，低额度颜色 rgb(242,90,90)；[浅色](../../../../reports/verification/codex-cli-quota-display/ui-unified-light.png)、[深色](../../../../reports/verification/codex-cli-quota-display/ui-unified-dark.png) |
| U1；D2；feat04 场景2/8 | 公共菜单用 Enter 选进度条并保存；刷新页面 | 菜单关闭、设置回显进度条，输入框显示对应条形；百分比模式可恢复；错误/草稿/只读通过自动回归 |
| U2；D3；feat04 场景3 | 390×844 视口，200px 输入框，点击常驻额度 | 无横向溢出；仅显示短周期19%，浮层显示两周期，边界 left12/right352/top23/bottom317；[窄窗口](../../../../reports/verification/codex-cli-quota-display/ui-unified-narrow.png) |
| U2；D3 | 浮层按 Escape；点击关闭按钮；点击浮层外的账号额度标题 | 均关闭；Escape 后焦点回到常驻额度按钮。关闭图标采用公共图标与 Tooltip |
| U3；feat03 场景1–4、场景7、场景9；feat04 场景4/5/9 | 切换会话 B 的同名 ZCode 模型，再回 A；短周期阈值改19/20并保存 | B 的 Codex 常驻按钮0、账号额度标题1；A 恢复常驻；等于19阈值恢复普通色，20阈值对应19剩余显示红色；自动回归补齐 pending/失败和过期 |
| U3；feat01 场景1–4、feat02 场景1–4、feat04 场景1–9；C1–C3 | 下方聚焦命令 | 退出0，26执行/26通过/0失败/0跳过；[日志](../../../../reports/verification/codex-cli-quota-display/ui-regression.log)。映射沿用 tech-design 附录 T01–T19；槽位用例增查同文件 CSS 挂载和释放 |
| D1–D4；UI 规范 | 包 build、typecheck、lint；根 lint；CSS 规则检查；git diff --check | 全部退出0；[根 lint](../../../../reports/verification/codex-cli-quota-display/ui-root-lint.log)；CSS 无字面颜色、主题分支、超过500字重，CSS 映射与声明一致 |

聚焦命令（根目录）：

```sh
node --test --test-name-pattern='^(T[0-9]+|client registers)' packages/codex-cli/test/quota.test.mjs packages/codex-cli/test/quota-client.test.mjs tests/runtime/codex-cli.test.mjs
```

测试采用人工视觉取证并沿用自动行为测试。首次尝试因测试 ReactDOM 解析到另一 React 副本、沙箱监听限制，以及新增释放断言所需 VM 计时器/DOM 事件环境而失败；这些均为测试环境问题，修正解析与夹具后取得上表最终结果。

测试期间的真实 Codex 接口调用0，账号登出和注销调用0。最终浏览器 /metrics 显示本次会话所有操作共1次模拟额度读取，设置为 percent/开启提醒/20/20；控制台警告与错误0。验证使用真实公开原语、模型目录、配置表单、宿主临时文件与额度服务；官方账号连接被模拟，页面外壳为隔离夹具，原有账号操作只展示。完整 KMH 生产会话和真实账号接口本轮覆盖范围以既有原任务记录为准。

### 功能文档与索引

界面主定义位于 spec 的“界面呈现”；changelog 回链本任务。原29场景和 C1–C3 的预期保持，新增人工2项、沿用回归1组，自动业务用例数保持。既有槽位用例修改1项以覆盖构建资源生命周期；实现新增/删除的样式文件及受影响文档已在④列出。

### 公共验收回执

- x-verify-spec：对账通过。九项逐一核对：五段及回指可定位；ui-before 的29场景与 C1–C3 和当前正文逐字一致；界面呈现承接用户本轮要求；U1/U2/U3 与执行记录及原 T01–T19 可定位；D1–D4 均有实现和证据；文档变更与实际文件对应；26执行/26通过与日志一致。本轮对账保持只读，结论仅证明记录闭合。
- x-verify-tech：通过，6项适用组通过、0失败、0未验证；R3不适用1项。依据为本任务②、规范与 ui-after 基线。

| 技术条目 | 本轮技术验收证据 | 结论 |
| --- | --- | --- |
| D1；UI 配色/字号/圆角规范 | CSS 规则复核、两主题实际渲染与390px布局；设置卡片语义 token，字重最高500，原生进度条采用主题颜色 | 通过 |
| D2；R7 草稿和持久化 | 公共 Menu/按钮实际选择与刷新；26项中设置保存、冲突、拒写、只读与草稿恢复；保存处理与原基线相同 | 通过 |
| D3；R4 模型与派生颜色 | 公共 ModelDirectory 订阅保持，实际其他来源收起/A恢复，阈值边界、窄屏、Escape及外部关闭；窗口新鲜性与颜色仍由 quota-rules 提供 | 通过 |
| D4；R1 资源和公开边界 | 最终客户端工厂嵌入 CSS；加载器集成实测挂载1份、effect释放后0份；4个视图只引用公开组件入口；局部 CSS Modules 与声明映射一致 | 通过 |
| R2/R5；协议与概念 | 代码审查：组件继续消费原 quota-protocol 与 store，保存和解析逻辑沿用；29场景和 C1–C3 逐字对照通过 | 通过 |
| R6；C1–C3 低频及测试边界 | 原具名读取间隔/阈值规则保持，26项中的密集/失败/并发冷却通过；浏览器1次模拟读取；真实账号接口、登出和注销调用0 | 通过 |

R3：本轮使用 TypeScript/JavaScript/CSS，涉及同一客户端构建与既有 TS 协议，跨语言协议同步不适用。技术检查在读取②与规范后执行，除上述测试外，最终包 typecheck/lint、10个改动文件格式检查和 diff 空白检查均退出0；根 lint 与包 build 成功。UI 浏览器外壳与官方连接的模拟边界见上文。技术验收保持业务代码和设计原样，未新增独立验收测试。

ui-check：本轮受影响详情、表单与浮层的公共控件、语义 token、500字重、圆角/阴影、键盘/关闭和双主题/窄屏检查通过。月饼工坊专用检查器与本项目不适配，采用本项目规则及上述真实渲染检查；旧截图只作为修改前参考，本轮截图单独保存。

### 当前结论

功能文档和变更索引已同步；新增人工2项、沿用回归1组、修改既有槽位集成1项；26项自动回归通过。交付对账通过，技术验收通过。本轮隔离浏览器页及临时服务已关闭，临时配置目录随夹具清理。手写 CSS 类型的 Git 可见性已核对。当前承接范围内无未决项；真实账号及完整生产外壳的覆盖边界见上文。
