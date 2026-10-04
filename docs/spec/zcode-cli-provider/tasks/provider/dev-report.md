# provider · dev-report

> task: docs/spec/zcode-cli-provider/tasks/provider/dev-checklist.md
> 更新: 2026-10-04

## 结果

- T1：provider 请求仅向 CLI 提供配置允许的 read 声明，调用者工具数组、KMH 系统文本保持原样。工具 ID、参数和结果关联在隔离 CLI fixture 中完成往返。可选提示模块供安装者显式挂载，正常 KMH Web 使用原有系统提示。
- T2 高风险真实链路：用户已完成 BigModel 微信授权，凭据采用官方加密格式。官方 CLI 0.16.9 的账号注册仅传 access、builtinModelIds；Coding Plan 地址通过官方个人配置传入。修复默认值未应用的问题后，真实 ping 请求成功，使用现有账号、高思考等级和 GLM-5.3-Flash。此前真实验证过取消、账号目录隔离和官方 logout；本轮保留用户登录。
- T3 高风险真实链路：正常 kmh-web 的现有 Plugins 配置区显示已登录；浏览器点击测试连接后显示「模型请求已验证」。隔离同一正常 Web profile 的 CLI fixture 验证错误码 ZCODE_MODEL_REGISTRATION_FAILED、CLI 码 -32603 及提示，凭据显示为 [redacted]。二维码与取消交互此前已在真实官方授权链路验收。本轮按用户要求保留现有登录，重新授权由用户操作。
- T4：移除新增的 kmh-zcode、kmh-zcode-web profile 和全局 read-only 模块。原有 standard 等四个预设定义保留，新会话在浏览器显示标准模式并可输入。独立包导出 provider、Client、可选 prompt、类型和许可证；解包后公开入口及 Client 工厂检查通过。
- T5 高风险真实链路：真人授权此前已由用户完成。本轮真实最小连通测试通过官方 CLI 发送 ping、空工具列表，并传递输出上限 1，15 秒内返回。正式浏览器验证同一路径成功。

## 未决

本轮修复与最小连通验收完成。真实模型执行完整文件读取任务属于后续功能验收；本次工具往返证据来自隔离 CLI fixture。输出预算传给官方 CLI，其模型适配行为随 CLI 版本演进。

## 检查记录

`pnpm test` 45/45 通过；`pnpm typecheck:kmh`、`pnpm lint`、`pnpm format:check` 通过。命令使用进程局部 pnpm_config_enable_global_virtual_store=false，在宿主执行以保持既有模块布局。pretest 构建当前包。`pnpm --dir packages/zcode-cli pack --out /tmp/kmh-zcode-cli-0.1.0.tgz` 导出成功，临时解包后 provider、prompt 和 Client 工厂可加载。

浏览器证据：`/tmp/kmh-standard-restored.png` 为恢复后的标准新会话；`/tmp/kmh-zcode-coding-verified.png` 为正式 Coding Plan 连通成功；`/tmp/kmh-zcode-error-details.png` 为虚构账号的隔离错误展示验证。正式服务使用 3080，测试服务使用临时运行目录和 3098，测试完成后关闭。

## 根因与范围修正

创建专用 profile 并禁用 standard 造成新会话失败。工具范围已移至 provider 请求参数，原有预设继续使用。账号注册接口拒绝 api 字段（RPC -32603 / Unrecognized key）；模型地址改由个人配置设置。schemastery 的外层 transform 缺少默认值导致 apiBaseUrl 为 undefined，CLI 混用了 Anthropic 地址与 OpenAI 路径，服务返回业务码 500、404 NOT_FOUND。外层默认值补齐后，官方 CLI 的最小请求和正式插件区测试均成功。

最小连通策略为：ping、max_tokens=1、15 秒超时。

## 质量检查

Gate① 的场景回指、T1-T5 状态和真实链路声明已对齐。Q2 独立检查覆盖需求、正确性和证据，P0 为 0、P1 为 0。三个 P2 已登记：已知不支持输入的错误码可细分；多页面同时退出与重新登录存在状态竞争；可增加真实 read 执行器的隔离 Agent 集成测试。记录见 [质量检查](reports/qa-gate/qa-gate-report-20261004-181849.md)。当前正式登录、最小模型连接和错误展示的验收已通过。
