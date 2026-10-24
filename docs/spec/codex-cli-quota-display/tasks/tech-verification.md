# Codex 额度展示 · 技术符合性验收

- 范围：`packages/codex-cli` 两份 task，feat01–feat04，D01–D07、C1–C3；对应规格29个场景。
- 确认来源：本会话用户确认规格、技术设计，并授权 req、dev、verify；禁止高频调用和账号登出、注销测试。确认内容与实施对齐保存于 `baselines.json`。
- 设计：`docs/spec/codex-cli-quota-display/tech-design.md`。开发规范：`/Volumes/machub_app/proj/skill-hub/x-tech-design/references/development-rules.md` 的R1–R7，以及根AGENTS、KMH UI、文字、CI可靠性规范。
- 代码基线：HEAD `bcaf783f7cefac251a36d99c023d4546b67f51b1` 加本地工作区；`verification-baseline.json` 保存27个实现、测试、依赖与规范文件的SHA256，包含完整根回归和边界修正后两个基线。用户既有修改保留，锁文件同时包含用户既有条目。
- 整体结论：通过。下列适用机制均取得证据；实际账号和CLI内部HTTP行为的边界见末节。

## 证据

| 条目 | 实现与核查方法 | 结果 |
| --- | --- | --- |
| D01；R1、R3；官方协议与公开服务 | 阅读 `quota.ts → connection.ts / protocol.ts`；原始消费字段对照本机会话导出的官方0.162 v2协议，并参考 `dsh-codex-subscription` 指定版本。正式代码按公开包名接入；浏览器仅消费共享展示协议，类型导入随构建擦除。新增读取只发 `account/read` 与 `account/rateLimits/read`，finally复用既有连接回收 | 通过。官方字段投影、方法参数、私有字段剥除与连接回收入口由测试核对；真实官方CLI的既有退出链由根回归覆盖 |
| D02；C1；R4、R6、R7；共享读取与冷却 | 额度服务按开始时间保留300000ms冷却，并共享在途Promise；force、summary/full与多个客户端命中同一完整缓存。读取失败和账号失效保留冷却。真实本机HTTP测试20个并发请求，服务测试100个并发及失败后100次调用 | 通过。每个时间窗一次额度RPC；错误结果保留原数值和原时间。全部连接为模拟，时间由可控时钟推进 |
| D02、D04；C2；账号与连接代数 | 模拟账号失效、账号切换及延迟回执；客户端重连中止旧等待并核对代数。详情账号操作开始时清空客户端额度，宿主操作前后递增代数；这部分账号副作用未在测试执行 | 通过。晚回执不能恢复旧账号数值，重新读取采用新代数。额度代码未包含账号登出、注销或额度消费方法；既有产品账号按钮继续使用原实现 |
| D03；R2、R5；数据边界与单位 | `protocol.ts` 分区校验官方数据，`quota-protocol.ts` 供宿主和浏览器共同parse，类型由Zod推导；query非法值返回400，响应no-store。宿主一次秒转毫秒，窗口分类按实际时长；Credits/重置卡零值、null和局部错误保留各自语义与时间 | 通过。主对象损坏而多分组有效时保留窗口及旧Credits；标准-32601识别不支持。技术核对发现空余额误显0，已回到开发修正；补充验收验证缺失、0与无限额三种结果；全部窗口解析失败保留原周期与原成功时间 |
| D04、D05；R4、R7；会话模型来源 | `ComposerQuota`订阅公开`ModelDirectory.store`的`current`，使用挂载时快照并监听后续发布。当前来源和模型决定是否展示及分组，pending由原选择界面管理。真实目录配合可控RPC/投影，测试首次、跨来源同名、切回、失败、多会话、延迟结果、销毁和缺失独立组 | 通过。只有确认的codex-cli显示；Spark与精确组优先，Reserve缺失时保持待确认；原连接小球继续注册。浏览器真实ModelSelect菜单和同一目录上的命令测试入口均观察到相应变化 |
| D06；R2、R4、R6；显示设置归属 | Config中四项volatile字段定义默认值和范围。context提供真实实例namespace；host模式采用共享ConfigForm，按读取修订调用remote.settings.mutate，成功回填镜像；失败恢复最新值并保留草稿、原文错误。memory只读模式采用同一宿主Config的偏好投影 | 通过。真实宿主配置、实际ConfigFormController验证双客户端冲突、恢复新修订、热更新、重启读取；临时目录拒写时原文件和原值保留；readonly值可展示，保存禁用 |
| D07；R4、R6；颜色派生 | `windowLow`由实际剩余、周期、原成功时间、重置时间和已接受设置计算。严格小于阈值；数据超过五分钟、时间到期或提醒关闭时恢复普通色。详情和输入框引用同一函数 | 通过。19%在阈值20%时变红、等于19%时普通色；调整阈值后两处同步，非法草稿保持原阈值。无独立提醒持久化状态 |
| UI、CI规范；T15、T17–T19 | 复用Button/Input/Switch和公开锚定、外部关闭hook，浮层portal到body，主题error token，标题字重500；本机浏览器验证双主题、200px输入区域、390×844视口、Escape焦点返回、外部关闭、原位整数错误。测试使用mkdtemp、listen(0)、受控Promise与有界清理 | 通过。窄屏无横向溢出，浮层保留边距；warn/error为0。纯测试目录拒写操作在finally恢复权限，fixture清理宿主与临时文件 |
| 工程检查与维护归属 | `build:kmh`14包构建；根lint；包build/typecheck/lint；授权范围diff检查；子模块状态检查。新增公开依赖和React DOM浏览器外部模块一致，包详情槽位复用原CodexCard | 通过。DSH工作区无修改，未创建分支、提交或推送 |

## 执行记录

- 完整根回归采用根`test`同一文件集合，加入三条精确名称排除：538项执行、538通过、失败0、退出码0；日志 `/private/tmp/kmh-quota-root-tests-final-20261020.log`。三个含账号登出调用的用例未进入执行集合；排除名称在两份dev-report中列出。
- Credits空值及窗口解析修正后，按当前内容执行 `node --test --test-name-pattern='^(T[0-9]+|client registers)' packages/codex-cli/test/quota.test.mjs packages/codex-cli/test/quota-client.test.mjs tests/runtime/codex-cli.test.mjs`：26项执行、26通过、失败0、退出码0。
- 修正后的包build、typecheck、lint以及范围diff检查均通过。完整根回归和最后显示修正分别记录基线，修正影响已定向复验的Credits展示、窗口异常保留分支与补充测试。
- 浏览器图片：仓库 `reports/verification/codex-cli-quota-display/light.png`、`dark.png`、`narrow.png`，均来自隔离数据页面。

## 验证边界

本轮新增额度测试的官方连接、模型RPC和账号变化均使用受控输入；真实宿主配置编辑、文件持久化、配置表单、模型目录、React组件及模型选择菜单保持实际实现。命令测试入口简化为同一目录的选择调用；生产`/model`与模型菜单共用该目录的源码链已核对。

官方只读额度成功响应已在本会话前期验证，当前账号实际只提供周窗口；短周期、消费上限与不同卡片形态由fixture覆盖。真实账号副作用和真实服务限流施压均保留在本轮测试之外。参考插件直连HTTP的`Retry-After`属于其WHAM传输路径；本适配验证CLI RPC外层五分钟冷却，CLI内部HTTP等待行为由官方CLI负责，后续CLI字段升级按协议与样本补验证。

结论覆盖本轮已确认范围和记录的代码基线；额度数值以账号实际返回为准。
