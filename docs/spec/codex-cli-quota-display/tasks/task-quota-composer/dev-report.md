# task-quota-composer · dev-report

> task: docs/spec/codex-cli-quota-display/tasks/task-quota-composer/dev-checklist.md
> 创建: 2026-10-20

## 结果

本 task 4/4 行 🟢。模型目录订阅、显示设置、颜色同步和隔离浏览器验证通过；根回归538项通过，失败0。

本 task 沿用 `baselines.json` 中的已确认规格与技术设计。实施对齐记录包含只读连接的偏好投影、通过公开包详情槽位复用原账号卡；四项设置的默认值、存储与保存修订仍归宿主配置管理。

## 验证证据

| 任务行 / 场景 / C / D / 用例 | 红灯原因或验证方法依据 | 最终验证与实际观察 | 替身与局限 |
| --- | --- | --- | --- |
| T1；feat03 场景1–10；C1、C2；D04、D05；T08–T13、T19 | 延续 task-quota-details 的运行时与默认设置缺口红灯；目录行为先经源码核对，再使用真实公开 ModelDirectory 做集成回归 | `quota-client.test.mjs` 保留真实目录控制器与订阅：挂载前已有 Codex 选择即显示，同名 ZCode 隐藏，切回恢复；pending 与失败保留确认值；甲乙会话独立；未知来源隐藏；独立组缺失保留待确认；旧 HTTP 代数回执丢弃，卸载释放订阅。账号失效测试先被客户端冷却阻挡，修复本机重读后通过，宿主真实读取冷却继续保留 | 替换目录的 RPC 与会话投影输入，保留实际目录计算；额度 HTTP 为模拟数据；共享宿主限频由 task-quota-details 的真实 HTTP 测试覆盖 |
| T2；feat04 场景1、2、4–9；D06、D07；T14、T16–T18 | 默认百分比断言先失败；真实宿主冲突恢复后重试先仍携带旧修订，修复草稿修订后通过 | 真实 React 详情、输入框和表单验证原始百分比严格小于判断，19%在阈值19%时普通色，改为21%后双端变红；非法值原位报错并保留原阈值；提醒关闭保持数值。真实宿主 + 真实 ConfigFormController 验证双客户端旧修订拒绝、镜像恢复、采用新修订保存、Config 热更新和重启读取。临时目录真实拒绝写入时原值、原文件保留。远程 memory 模式采用宿主偏好并保持只读 | 配置落盘、修订与表单机制真实；只有 Remote 传输适配为本机函数。错误 UI 的受控拒绝保留宿主原文与草稿 |
| T3；feat03 场景1–10；feat04 场景1–9；C1、C2；D04–D07；T09、T11、T15、T17、T19 | 窄屏、主题与浮层属于真实浏览器人工验证；无需为几何重建模拟布局 | 本机隔离页面使用真实 ModelSelect、ModelDirectory、ConfigFormController、宿主配置编辑与实际组件。现有模型菜单从ZCode切回Codex恢复；命令测试入口切到Spark显示65%，切到ZCode同名模型隐藏；200px输入区域保留最低周期。390×844视口无横向溢出，浮层 left12/right352、top517.84/bottom786.84，位于视口内；Escape关闭并返回额度按钮焦点，外部点击关闭。双主题低额度色来自 error token；20.5 阈值显示整数范围错误并禁用保存。关闭显示后刷新继续关闭。模拟账号失效后原值清除并显示登录提示，浏览器warn/error为0 | 目录与原模型菜单真实；`/model` 的测试入口是连接同一真实目录的简化控制器，生产命令入口采用同一目录的源码链已核对。帐号状态只注入模拟值，整个页面没有账号登出、注销执行入口 |
| T4；本 task 全部场景；R1–R7 | 新增 React DOM 外部模块与原槽位断言对齐，继续验证原连接小球三态 | 包构建、typecheck、lint，根lint，新增槽位定向回归均通过。注册测试验证 `plugins.bundle.config` 复用原详情页与共享额度实例；根回归538项通过、退出码0；日志 `/private/tmp/kmh-quota-root-tests-final-20261020.log` | 三个含登出调用的既有用例按用户限制排除，详情账号按钮保留产品功能，测试全程未点击 |

浏览器图片位于仓库 `reports/verification/codex-cli-quota-display/`：`light.png`、`dark.png`、`narrow.png`。最新验收页面的本机指标在完成模型、主题、阈值和浮层操作后显示额度模拟读取1次；数值与账号状态全部来自fixture。

## 最终回执

- 根回归按根 `test` 的相同文件集合执行，在 Node 入口加入三条精确名称排除，538/538通过，退出码0；Node统计的 skipped为0，三个排除项未进入执行集合。构建前置 `build:kmh` 14个包通过。
- 排除名称：`official login output, encrypted account registration, native framing and raw generation work together`、`BigModel WeChat authorization saves encrypted native credentials and registers its CLI model channel`、`missing plugin credentials borrow the desktop login read-only`。三项均包含账号登出调用。
- 最新实现的聚焦技术验收：`node --test --test-name-pattern='^(T[0-9]+|client registers)' packages/codex-cli/test/quota.test.mjs packages/codex-cli/test/quota-client.test.mjs tests/runtime/codex-cli.test.mjs`，26/26通过，退出码0。
- 包 typecheck、包 lint、根 lint 和授权范围 `git diff --check` 通过。技术验收基线见同级上层 `verification-baseline.json`，包含实现、测试、spec、设计及AGENTS的内容哈希。
- 真实账号额度与认证副作用保持在本轮测试之外；新增额度测试全部使用模拟连接，未执行账号登出或注销。

技术核对后回到开发修正 Credits 空余额显示：补充验收先观察到缺失值显示0，修正后空值显示“余额暂未提供”、已知0保持0、无限额显示“无限额”。最新聚焦26项、typecheck、lint通过；完整根回归538项执行于该显示修正前，显示和窗口错误保留分支已由相关组件和接口集合复验。两个代码基线均保留在 `verification-baseline.json`。
