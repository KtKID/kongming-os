# task-sidebar-and-panel · dev-report

> task: docs/spec/kmh-infra-plugin-v0.1/tasks/task-sidebar-and-panel/dev-checklist.md
> 创建: 2026-10-16

## 结果

- task 测试：7/7 🟢 全绿
- 既有回归：通过（web-plugin-hmr 1 test / 1 pass，10.2s；该测试用真实 KMH Web 入口在临时目录起服务并完成热重载）
- 高风险行：本 task 无高风险行

## 验证证据

| 任务行 / 场景 / C / D / 用例回指 | 红灯原因与证据（或未采用 TDD 的理由） | 最终验证方式与实际结果 / 证据位置 | 局限或待补项 |
|---|---|---|---|
| 行 T1；feat01 场景1、场景2；D03、D11；用例 T4（unit + e2e） | 行为测试先于实现不可行：本行新建产物，导入缺失不构成有效红灯（与 task-package-skeleton 行 T2 同因）。改为实现后补自动化 | ① `test/infra-client.test.mjs`：把构建产物当模块加载器工厂加载、注入假上下文，断言 `sidebar.panellist` 与 `main` 两个槽的注册、面板 id 唯一、词典命名空间与"Infra"标签 —— 4 tests / 4 pass。② 真实浏览器（Playwright + 本机 chromium headless shell，指向临时实例）：侧栏出现 `Infra` 行，`aria-label="Infra"`、`aria-current="page"`、类名含 `panelActive`，收起态悬停提示为 `Infra`；面板打开后页面上无任何 pageerror | 临时实例未设语言偏好，界面渲染为英文（`Reload` / `Open in system browser`），因此本次观察同时证明英文词典可用；中文词典只有构建产物断言，未在浏览器里看到中文界面 |
| 行 T2；feat01 场景3、场景4；D03；用例 T4（unit + e2e） | 同 T1（新建行为，无有效红灯）；镜像与恢复语义靠假上下文精确断言，比截图更可靠 | ① 单测：选中时落 `kmh-infra:active`、切走清除、卸载时清残留标记、无标记时不抢主区、有标记时微任务恢复选中 —— 全部通过。② 浏览器：点击 Infra 后面板显示；点 `New session` 切回会话成功，再点 Infra 面板回来；`page.reload()` 后主区自动恢复为 Infra 面板 | 停用后入口消失（feat01 场景3 的后半）需要插件页操作，归 task-distribution 的用例 T7 验证 |
| 行 T3；feat02 场景1、场景2、场景4、场景5；D04；用例 T5（e2e） | 同 T1 | 浏览器实测：点开后主区 DOM 为 `div.infra-panel > div.infra-toolbar > span.infra-address + button(Reload) + button(Open in system browser) > iframe.infra-frame`，`iframe[src=http://127.0.0.1:60010]`、`sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox"`；内嵌页真实加载出 x-dash 登录界面（见 `evidence/panel-with-x-dash.png`），KMH 会话区与登录页互不影响；把配置地址改为 `http://127.0.0.1:60099` 后重启临时实例，面板工具栏地址随之变为 60099 | 面板内登录后的行为未验证（需要 x-dash 账号）；切走再切回"按当前地址重新加载"的字节级重载未单独取证，只观察了面板重新出现 |
| 行 T4；feat02 场景3；C6；D04；用例 T5（e2e） | 同 T1 | 把临时实例配置改为 `dashUrl=http://127.0.0.1:60099`、`panelLoadTimeoutMs=1500`（默认值是 8000）后重启：点击 Infra 到提示出现的实测耗时为 **1580ms**，提示文本为 "The dashboard may not open here：the dashboard is not running, the URL is wrong, or it refuses embedding; the system browser also works"，同一时刻 `Open in system browser` 按钮仍可点（见 `evidence/configured-timeout-notice.png`）。1580ms 远小于默认 8000ms，直接证明超时取配置而非写死 | 只测了一个非默认值；毫秒级精度受轮询间隔 50ms 限制，因此只声称"随配置变化"，不声称精确等于配置值 |
| 行 T5；C7；D11；用例 T12 | 非 TDD 行，属实现约束的自查 | 代码审查：面板组件只用 ui-primitives 的 `Button`、`StateDot` 与现有图标 `IconGaugeOutlineRegular`；`src/client/styles.ts` 不含颜色/圆角/间距字面量，全部取 `--dsw-*` token（`--dsw-alias-border-l1/l3`、`--dsw-alias-label-secondary`、`--dsw-alias-bg-layer-2`、`--dsw-alias-bg-base`）；样式未设置 `font-weight`（≤500）；面板加载态在中心显示共享 loader（`StateDot state="ongoing"`）；失败提示用工具栏下方的原位提示条而非全局 Toast，不与相邻元素夺位 | 深浅两色只看了深色（临时实例默认深色）；浅色主题未截图核对。图标选择属设计判断，未经设计师评审 |
| 行 T6；D06；用例 T2（smoke） | 产物已存在，属补覆盖，无红灯 | `node --test test/infra-smoke.test.mjs`：7 tests / 7 pass，含新增的"产物注册侧栏入口与中心面板"、"产物取地址与超时自配置且不含写死的 8000" | 断言的是产物文本，不是运行时行为 |
| 行 T7；feat01 场景1–4、feat02 场景1–5；用例 T4、T5、T12（e2e） | 非 TDD 行 | 见上四行的浏览器实测；整条链路无 pageerror | 见上方各行的局限 |

## 验证环境说明

1. **没有重启 127.0.0.1:60000 上的 Web。** 本会话就跑在那个实例上，重启会掐断会话；因此按 web-plugin-hmr 已验证的隔离配方在 `/Users/kid/.kmh-os/tmp/kmh-infra-e2e` 建了一个临时工作区（`packages/*` 全部符号链接、`bundles/dsh-web` 复制、profile 清单与 patch 复制并把端口换成 60123、独立 `KMH_HOME`），在其中启动真实 `kmh.mjs web`。该实例与使用者的界面互不影响。
2. **浏览器用的是 Playwright + 本机缓存的 chromium headless shell。** CUA 的隔离启动被拒（无可用的 vendor-signed Chromium），自行启动系统 Chrome 被文件沙箱挡在 `~/Library/Application Support`；headless shell 不需要这些路径，且完全后台、不占用使用者的桌面窗口。
3. **服务端侧另有旁证**：临时实例的首页 boot payload 中登记了 `{"id":"@kmh/kmh-infra","url":"plugins/??@kmh/kmh-infra/client.js&rev=7ce173ea7c5a","inject":[四个 client 包]}`，说明宿主确实把这个客户端模块发给了浏览器。

## 未决

- 无 🔴 行。三项局限中，中文界面与浅色主题已在 [task-distribution 的跨 task 补齐](../task-distribution/dev-report.md#跨-task-补齐的核对浅色主题与中文界面)里核对通过；"面板内登录之后的行为"仍未核对（需要 x-dash 账号），不阻塞本 task 交付。
