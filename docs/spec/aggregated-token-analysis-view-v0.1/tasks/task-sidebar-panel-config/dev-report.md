# task-sidebar-panel-config · dev-report

> task: docs/spec/aggregated-token-analysis-view-v0.1/tasks/task-sidebar-panel-config/dev-checklist.md
> 创建: 2026-10-18

## 结果

- task 测试：19/19 🟢 全绿（config 6 + smoke 8 + client 5，`node --test packages/aggregated-token-analysis/test/*.test.mjs`）；包内 `typecheck`、`lint`、`format:check` 全过
- 既有回归：task-package-skeleton 的 HMR 回归此前已过；本轮未改任何既有包
- 高风险行：1 行（T3 配置表单写 profile patch），已含真实链路验证——真实浏览器保存后在 `profiles/kmh-web/cordis.patch.yml` 读到覆盖条目、面板按新值热生效、Reset 后覆盖条目消失
- 行状态：T1–T5 🟢；T6、T7、T8 ▶️——各有一个子场景缺直接证据（见"未决"），其余子场景均已在真实浏览器验证

## 验证环境

为不打扰 60000 端口上正在运行 21 小时的 kmh-web 实例，用隔离的 `KMH_HOME=/tmp/ata-verify-home` 加 home 级 patch（`$KMH_HOME/cordis.patch.yml` 覆盖 `webserver.config.port: 60020`）另起一个实例（`node scripts/kmh.mjs web --no-open`），用 ZCode 内置浏览器驱动。注意：home 里的 `profiles/kmh-web` 是指向仓库 `profiles/kmh-web` 的软链（同一 inode），配置保存直接写进仓库的 profile patch；验证结束已 Reset 为默认、文件里无覆盖块。验证实例已停止，浏览器标签已关闭。

## 验证证据

| 任务行 / 场景 / C / D / 用例回指 | 红灯原因与证据（或未采用 TDD 的理由） | 最终验证方式与实际结果 / 证据位置 | 局限或待补项 |
|---|---|---|---|
| T1；feat01 场景1、2；D02；用例 T2 槽名断言 | 先写 `test/token-analysis-client.test.mjs`（假上下文、刻意不提供 layout）对骨架产物运行：5 fail，原因 `apply` 为空无任何注册（"必须注册 sidebar.panellist"、injected 为 []） | 实现 `src/client/index.ts` 后 5/5 pass：词典 zh/en、`sidebar.panellist` id `token-analysis`、`order 12`、label "Token 分析"、`main` 同 id、只注入四个槽、`configForms.get` 以行 id 为命名空间。浏览器：导航区按钮顺序 MadeMe → Automation tasks → Infra → **Token Analysis** → Context Insights；收起态悬停出现 `role=tooltip` 文本 "Token Analysis"；点击后入口带 `panelActive` 类 | 界面当前为英文词典，看到的是 "Token Analysis"；中文标签 "Token 分析" 由单测断言词典值覆盖 |
| T2；feat02 场景1–5；C1、C2、C5；D03；用例 T4、T5 组件侧 | 投影逻辑由同一单测覆盖：实现首版把 settings 的 "ready" 原样抄给无效值，单测"地址为空或超时非正数时面板不就绪"1 fail → 按设计"ready 当且仅当地址与超时都可用"修实现（不改断言）→ pass | 浏览器：点入口后 `.token-analysis-panel` 挂载、`iframe.token-analysis-frame` 的 `src` 恰为配置值、`sandbox`/`referrerPolicy` 按设计、面板内无任何按钮（无工具栏）、主区 composer 消失；切到会话再回来 `iframe` 是新元素（重新加载）；改地址保存后 0.8s 内 `src` 已是新地址；不可达地址 + 超时 2000 时，0.8s 无提示、3.5s 出现 `role=alert` 提示"页面可能无法打开：x-token 未运行或地址无效；正在尝试的地址：http://127.0.0.1:60099/"；默认地址（x-token 401）时也观察到 8s 后出提示的一次 | x-token 的 `/_svc/x-token/` 当前对无凭据请求返回 401 空响应（curl 与 127.0.0.1/localhost 均 401），浏览器有时把它当作已加载（空白面板、无提示）、有时不触发 load（按配置超时出提示）——两种表现都符合规格，根因在 x-token 侧，见未决 |
| T3（高）；feat03 场景1、2；C5、C6；D04；用例 T6 表单侧 | 表单渲染依赖真实 ui-primitives，Node 里加载不了（产物带 CSS 导入），采用浏览器验证而非单测红灯 | 浏览器：详情页恰两个字段，默认值 `http://localhost:60010/_svc/x-token/` 与 `8000`，Save 初始禁用；填 `not a url` → 字段 `aria-invalid=true`、原位提示 "a legal http(s) URL is required"、Save 禁用；填合法地址 + 2000 保存 → 字段显示新值、两处 "overridden" 标记、Save 回到禁用、仓库 patch 出现 `config: pageUrl / pageLoadTimeoutMs: 2000` 覆盖条目；两字段 Reset + Save → 覆盖条目从 patch 消失。另一会话同时改同一文件时，保存得到 "Save did not land (config changed concurrently); please retry."（乐观锁按设计生效） | 乐观锁冲突后该实例缓存的版本号对不上，后续保存持续失败直至重启实例；属 settings 体系行为，不在本插件范围 |
| T4；feat01 场景1、feat02 场景1、feat03 场景1；C6；D07；用例 T8 | 规范核对行，无红灯概念 | 代码审查：只用 `SettingsForm`/`SettingsValueField`/`StateDot`/`IconDataOutlineRegular`；运行时读注入的样式表：5 处 `var(--dsw-…)`、0 个字面量颜色、无 `font-weight` 声明；深色主题截图两张（图标轨中本插件图标高亮、面板与提示条）存于会话产物目录 | 浅色主题未切换截图；收起态提示的视觉未截图（DOM 已证 tooltip 存在） |
| T5；C5；D06；用例 T2 | 先 grep 产物现状再写断言（产物 41 KB，infra 的 91 KB；`schemastery`/`Schema.`/`8000`/`8e3`/`60010`/`_svc/x-token`/`:active` 全部 0 次） | 冒烟新增 3 条共 8/8 pass：产物含 `sidebar.panellist`、`pageUrl`、`pageLoadTimeoutMs`；产物级禁入 7 项；源码级 `8000`、`60010`、`_svc/x-token` 只在 `src/config.ts` | 断言防的是"同一默认值被复写"；默认值若改动需同步测试 |
| T6（▶️）；feat01 场景1、2、3，feat02 场景1、2、3、4；用例 T3、T4 | 浏览器验证行 | 已验：feat01 场景1、2；feat02 场景1、2、3、4（证据见 T1、T2 行）。**未验：feat01 场景3（停用即消失）**——插件页的 "Enable" 开关从关切到开后入口与配置均不变，它是插件管理器层的启用（与 Infra 验收记录第 47 行一致），不卸载经 profile 加载的实例；真正的停用要从 profile 拿掉实例并重启 | 停用核对需要编辑仓库的 profile patch，而另一会话正在同时编辑该文件（新增 kmh-xmusic 实例），为避免互相覆盖本轮未做；步骤见未决 |
| T7（▶️）；feat02 场景3，feat03 场景1、2、3；用例 T6、T7 | 浏览器验证行 | 已验：feat03 场景1、2（见 T3 行）；feat02 场景3 隔离部分——验证实例在 x-token 401 的状态下从头启动，会话视图、插件页、MadeMe 与 Infra 入口全部照常，只有本面板出提示，Web 日志 0 条 error（C3）。**未验：feat03 场景3（停用再启用后配置仍在）** | 同 T6；配置持久化本身已证（覆盖条目落盘、Reset 清除） |
| T8（▶️）；feat02 场景1、5；C1；D03；用例 T5 | 审查 + 浏览器 | 已验：逐文件审查浏览器半，无读取 `iframe` 内容、解析 token 数据或按内容分支的代码；地址从默认改到 60099、改到 x-dash 根页面，`iframe.src` 每次都原样跟随配置。**未验：换成另一张页面后"原样显示"的正向观察**——x-dash 根页面 6s 内未触发 load（多半拒绝内嵌）；改用验证实例自身地址时保存被乐观锁冲突挡住 | 需一个允许被内嵌的本机页面；步骤见未决 |

## 未决

- T6 · feat01 场景3 停用即消失 · 已尝试：插件页 Enable 开关（属另一层，不卸载 profile 实例）。待补步骤：等 `profiles/kmh-web/cordis.patch.yml` 无人并发编辑时，注释掉本插件实例 4 行 → 重启隔离实例 → 核对侧栏无 "Token Analysis" 且主区为会话 → 恢复 4 行 → 重启 → 入口回来。
- T7 · feat03 场景3 停用后配置保留 · 同上流程，在停用前先保存一个覆盖值（如超时 3000），恢复后核对详情页仍是 3000、patch 覆盖条目仍在，最后 Reset 清掉。
- T8 · 换页面正向显示 · 已尝试：x-dash 根页面（未触发 load）、验证实例自身地址（保存撞乐观锁）。待补步骤：重启隔离实例后把地址改成任一允许内嵌的本机页面，核对面板显示该页且超时后无提示，再 Reset。
- 范围外提示（x-token 侧）：`http://localhost:60010/_svc/x-token/` 当前对无凭据请求返回 401 空响应。用户已确认页面不需要登录，因此需 x-token 侧放行该页面，否则默认配置下面板只能是空白或超时提示。
