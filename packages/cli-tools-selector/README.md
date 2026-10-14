# @kmh/cli-tools-selector

在 KMH Web 的 Codex CLI 插件详情页里展示并切换工具开关：KMH 工具逐个一行，Codex 原生能力四项（命令执行、文件修改、查看图片、联网搜索）各一行。切换立即保存到 profile 配置，只对之后普通新建的 Codex 会话生效；已有会话保持创建时的选择。规格与设计见 [spec](../../docs/spec/cli-tools-selector/spec.md) 与 [技术设计](../../docs/spec/cli-tools-selector/tech-design.md)。

## 职责边界

本包只负责"画出来、转发切换"。开关是什么、怎么读写由 `@kmh/codex-cli` 自己通过服务方法 `toolSwitches()` / `setToolSwitch()` 决定，两端共用它发布的 zod 契约 `@kmh/codex-cli/tool-switches`。本包不解释工具名、不参与工具执行、不触碰会话；关闭或卸载本包后 Codex 一切照旧，只是详情页少一个区块。第一版只适配 codex-cli：其他插件的详情页不出现该区块。

## 接入

在 Web profile 声明依赖并挂载实例（kmh-web 已内置）：

```yaml
- id: kmh-cli-tools-selector
  name: "@kmh/cli-tools-selector"
```

无配置项。宿主侧挂两条路由到宿主连接通道：

| 路由                                                         | 用途                                 | 失败行为                                                                |
| ------------------------------------------------------------ | ------------------------------------ | ----------------------------------------------------------------------- |
| `GET /api/cli-tools-selector/codex-cli/switches[?refresh=1]` | 读清单；`refresh=1` 重新发现原生目录 | codex-cli 未就绪 503 `CODEX_CLI_UNAVAILABLE`；其余 500 带 `reason`      |
| `POST` 同路径，体 `{ id, enabled, revision }`                | 切换一个开关，返回新清单             | 体不合法或未知 id 400；配置修订号已变 409 `SETTINGS_CONFLICT`；其余 500 |

客户端向插件页公开槽 `plugins.detail.section` 注册区块，仅当页面主题为 codex-cli 官方插件时渲染。切换采用乐观更新：保存失败时该行回到原状态并提示原因；原生目录读取失败时 KMH 列照常、原生列显示原因并提供"重新读取"。

## 开发

`pnpm build` 产出 `lib/src`（宿主）与 `lib/client.js`（客户端）；本包依赖 `@kmh/codex-cli` 先行构建以提供契约类型。`pnpm test` 运行路由状态码与区块纯逻辑测试；真实链路（落盘、新会话工具）由 codex-cli 的 profile harness 覆盖，浏览器验收见任务开发报告。
