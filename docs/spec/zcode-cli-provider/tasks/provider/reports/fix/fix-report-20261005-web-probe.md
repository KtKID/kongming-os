---
description: ZCode Web 最小探测超时的环境对照、登录与探测分步处理及真实页面验证。
---

# ZCode Web 连通探测修复

本轮在修复 low 档位后复现了 Web 的 `ZCODE_PROBE_TIMEOUT`。曾将探测时限临时延长到 60 秒，页面仍超时；该改动已撤回，默认探测时限保持 15 秒。

## 根因与参考

当前插件继续通过官方 CLI 发送最小请求，工具列表为空，输出上限 1，思考等级 low。

Web 的 DSH 子进程环境会注入 `NODE_USE_ENV_PROXY=1`。官方 CLI 0.16.9 内置自己的代理传输；该开关与真实超时形成可重复的环境对照。相同账号、工作目录和最小请求，仅设置该开关为 1 时在 15 秒内超时；保留 Web 的代理地址、绕过列表与临时目录，设置为 0 后在 2962 ms 完成。官方 CLI 内部重复代理的精确调用位置尚未跟踪；本轮确认的是子进程开关的兼容性影响。

## 修复与超时处理

插件为官方 CLI 子进程固定设置 `NODE_USE_ENV_PROXY=0`，HTTP、HTTPS 代理地址和绕过列表继续传递。宿主代理服务和代理软件配置保持原值。

登录使用 `loginTimeoutMs`，默认 20 分钟，授权超时返回 `ZCODE_LOGIN_TIMEOUT`。`check()` 先确认登录完成，登录进行中或尚未登录时返回 `ZCODE_LOGIN_REQUIRED`，随后才建立独立的 `probeTimeoutMs`，默认 15 秒。探测超时返回 `ZCODE_PROBE_TIMEOUT`，账号继续保持已登录。登录成功后连接状态为待验证，用户单独执行测试连接。

## 验证

- 模块构建、Host/Browser 类型检查、lint、format:check 通过。
- `node --test tests/runtime/zcode-cli.test.mjs`：34/34 通过，新增登录进行中拒绝探测、代理开关隔离和探测超时保留登录状态断言。
- 使用本机现有桌面端登录和官方 CLI 0.16.9 进行真实对照，凭据只在本机内存中使用。
- 重启 Web 后在真实 Chrome 插件页面点击测试连接，页面由待验证变为模型请求已验证。成功状态在点击后 10070 ms 的观察中已出现，运行配置的探测时限为 15000 ms。
- 浏览器证据：`/Users/kid/.codex/visualizations/2026/10/05/01a10a9c-6589-7e20-8203-cbe18ad653f6/zcode-probe-ready.png`。

本轮真实验证覆盖已有登录后的模型探测；人工扫码登录未重新执行。登录授权超时由已有模拟测试验证，普通会话默认 high 保持原值。
