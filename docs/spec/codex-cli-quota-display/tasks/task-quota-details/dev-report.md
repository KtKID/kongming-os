# task-quota-details · dev-report

> task: docs/spec/codex-cli-quota-display/tasks/task-quota-details/dev-checklist.md
> 创建: 2026-10-20

## 结果

本 task 4/4 行 🟢。额度解析、共享读取、详情页组件与真实 HTTP 集成验证通过；根回归538项通过，失败0。

本轮新增额度测试的官方连接全部为替身，只允许 `account/read` 和 `account/rateLimits/read`。账号失效通过注入状态验证，测试未执行账号登出、注销。参考插件版本及 MIT 许可记录在本包 README。

## 验证证据

以下命令均在仓库根目录执行，构建使用 `pnpm --config.verifyDepsBeforeRun=false --filter @kmh/codex-cli build`。该参数沿用当前已安装依赖，避免触发整个工作区的依赖目录重装。

| 任务行 / 场景 / C / D / 用例 | 红灯原因与证据 | 最终验证与实际观察 | 替身与局限 |
| --- | --- | --- | --- |
| T1；feat01 场景1、2；feat02 场景1–3；C3；D01、D03；T01、T05、T06 | 最初 `quota.test.mjs` 的运行时服务断言失败：`runtime.quota.read` 缺失；导入与构造正常，属于功能缺口 | `quota.test.mjs` 验证官方秒转毫秒、短/周/部分周期、零余额、消费上限、重置卡数量与 null 详情；窗口与附加区域分别校验。`quota-client.test.mjs` 的真实 React 详情组件显示对应周期、0 余额、0 重置卡和详情未知状态 | 进程连接替身；官方消费字段对照本机会话已导出的 0.162 v2 类型与参考插件源码 |
| T2；feat01 场景3–6；feat02 场景4；C1–C3；D01、D02；T02–T04、T07、T19 | HTTP 注册断言先失败，因额度路由缺失。标准 `-32601` 用例先误判普通错误；主对象损坏用例先丢失旧 Credits，修复后定向通过 | `quota.test.mjs` 真实 HTTP 服务器使用随机本机端口，验证查询拒绝、no-store、20 个 HTTP 请求合并；100 个服务并发及重复刷新只触发一次额度读取，失败与账号失效保持五分钟冷却；旧账号晚回执失效；合法窗口保留，局部错误保留原区域时间；每次连接均调用回收入口 | 官方连接在进程边界替换。真实进程退出与隔离 CLI 回归由既有 `tests/runtime/codex-cli.test.mjs` 覆盖；账号变化使用纯模拟状态 |
| T3；feat01 场景1–6；feat02 场景1–4；D03、D06；T01–T07 | 默认显示设置断言先失败，原 Config 尚无四项偏好；随后补入唯一默认值定义 | React 组件测试验证 summary 零额度读取、详情与输入框共用缓存；浏览器观察两周期、更新时间、刷新、0 Credits、重置卡名称与未知到期日；模拟重置后保留19%并显示“正在确认重置后的额度”，红色解除；失败保留原时间和数值；模拟待登录后移除原账号区域 | 浏览器页面使用真实组件、真实宿主配置、模拟额度；真实账号的短周期、消费上限和卡片种类以官方实际返回为准 |
| T4；本 task 全部场景；C1–C3；T01–T07、T19 | 既有槽位测试初次因新增 React DOM 外部依赖失败，更新依赖与新增槽位断言后定向通过 | 构建、包 typecheck、包 lint 和根 lint 通过；原有 Codex 回归46项曾全绿，最新槽位定向测试通过；根回归538项通过、退出码0；日志 `/private/tmp/kmh-quota-root-tests-final-20261020.log` | 根回归显式排除3个包含账号登出调用的既有 ZCode 用例 |

浏览器证据：仓库 `reports/verification/codex-cli-quota-display/` 下的 `light.png`、`dark.png`、`narrow.png`。这些图片来自隔离验收页面。详情与输入框使用同一共享状态及颜色函数。

## 最终回执

- 根回归按根 `test` 的相同文件集合执行，在 Node 入口加入三条精确名称排除，538/538通过，退出码0；Node统计的 skipped为0，三个排除项未进入执行集合。构建前置 `build:kmh` 14个包通过。
- 排除名称：`official login output, encrypted account registration, native framing and raw generation work together`、`BigModel WeChat authorization saves encrypted native credentials and registers its CLI model channel`、`missing plugin credentials borrow the desktop login read-only`。三项均包含账号登出调用。
- 最新实现的聚焦技术验收：`node --test --test-name-pattern='^(T[0-9]+|client registers)' packages/codex-cli/test/quota.test.mjs packages/codex-cli/test/quota-client.test.mjs tests/runtime/codex-cli.test.mjs`，26/26通过，退出码0。
- 包 typecheck、包 lint、根 lint 和授权范围 `git diff --check` 通过。技术验收基线见同级上层 `verification-baseline.json`，包含实现、测试、spec、设计及AGENTS的内容哈希。
- 真实账号额度与认证副作用保持在本轮测试之外；新增额度测试全部使用模拟连接，未执行账号登出或注销。

技术核对后回到开发修正 Credits 空余额显示：补充验收先观察到缺失值显示0，修正后空值显示“余额暂未提供”、已知0保持0、无限额显示“无限额”。最新聚焦26项、typecheck、lint通过；完整根回归538项执行于该显示修正前，显示和窗口错误保留分支已由相关组件和接口集合复验。两个代码基线均保留在 `verification-baseline.json`。

补充窗口异常验收：先观察到全部窗口解析失败时清除原值并更新成功时间；修正为保留原周期和原成功时间，区域错误继续展示。用例 `T02/T07 窗口解析全部失败时保留上次周期与成功时间` 通过。
