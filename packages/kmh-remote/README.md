---
description: KMH Remote 的手机访问、frp 公网入口、本地代理与源码维护方式。
---

# KMH Remote

手机通过二维码访问电脑上的 Kongming Web，会话通过 HTTP/WebSocket 代理保持同步。公网访问沿用使用者现有的 frp。Web profile 安装本包，初始状态为停用；在插件页启用 Bundle 后挂载 `kmh-remote`，设置中的「手机访问」与插件详情页提供同一组配置。

## 使用与 frp 配置

部署参数统一保存在 Git 忽略的本地 `.env`，公开的 [.env.example](.env.example) 只保留变量名称。README 中的部署参数约定如下：

| 环境变量                     | 用途                            |
| ---------------------------- | ------------------------------- |
| `KMH_REMOTE_WEB_HOST`        | 宿主 Web 监听参数               |
| `KMH_REMOTE_WEB_PORT`        | 宿主 Web 监听参数               |
| `KMH_REMOTE_PROXY_BIND_HOST` | 手机鉴权代理监听参数            |
| `KMH_REMOTE_PROXY_PORT`      | 手机鉴权代理与 frp 本地目标参数 |
| `KMH_REMOTE_FRP_LOCAL_HOST`  | frp 本地目标参数                |
| `KMH_REMOTE_PUBLIC_URL`      | 插件公网入口参数                |

frp 负责 TLS、转发规则和服务启停；插件负责保存入口并生成二维码。完整环境变量命名、参数应用方式、鸿蒙证书安装与故障处理见 [frp 公网访问指南](docs/frp-access.md)。

局域网访问和访问密码默认开启；公网请求始终校验公网密码。设置页可调整局域网开关、密码开关、手动 IPv4、frp 公网地址、两类访问密码和手机右侧栏。密码留空保存会生成随机值，固定密码接受 8–64 位字母或数字。重置只清理本插件的设置与密码。访问入口赋予手机操作当前 Kongming 会话及其工具的能力，二维码和密码由使用者保管。

插件数据保存在 `$KMH_HOME/kmh-remote/`，启动器将该数据根转换为 `DSH_HOME`。设置位于 `settings.json`，公网和局域网密码分别位于 `token`、`token-lan`，密码与设置文件以 `0600` 权限创建。登录限速使用真实 socket 来源地址；frp 回连的请求共享回连地址对应的限速计数。

挂载声明见包内 [Bundle 配置](cordis.patch.yml)。本地部署按 `.env` 参数填写既有配置入口，具体参数值保留在私有文件中。

移动布局在首次加载时按页面宽度选择，改变窗口尺寸后刷新页面应用对应布局。手机端会话日志导出沿用宿主会话菜单。

## 访问记录

在本机打开插件详情，选择「访问记录」查看密码提交历史。每次后端处理显式密码提交时，成功、失败和尝试受限各保存一条；有效 Cookie 的刷新与后续会话活动保持原计数。每页十条，列表内部滚动，支持上一页、下一页和刷新；切换到「访问设置」保留尚未保存的草稿。

历史保存在当前 Home 的 `logs/.kmh-remote/`，每行一条 UTF-8 JSON。记录保留发生时的本地时间、毫秒、时区、实际连接来源、待核实的转发声明、入口类型、事件与结果，失败显示原始 code/desc。文件按实际字节数在写入前按 10MB 分文件；历史随 Home 长期保留，重置设置继续保留记录。完整格式与边界见[功能规格](../../docs/spec/kmh-remote-access-records/spec.md)。

记录查询使用宿主原有认证，并检查原始连接为本机回环地址；Remote 代理会拒绝此查询。宿主 Web 保持本机监听，frp 的目标使用 Remote 代理，部署参数沿用上文指南。保存或读取失败时，详情显示原始错误；保存失败后 Remote 继续处理原访问，恢复后的保存会保留此前失败提示。读取失败时保留此前页面，恢复后可刷新。

## 源码与维护

KMH Remote 由 KMH 维护手机访问、本地鉴权代理、移动端布局及宿主公开接口适配。公网转发由 frp 管理。插件许可证见 [LICENSE](LICENSE)，移动端组件许可见[移动端声明](client/mobile/LICENSE.dsh-web-mobile)。

设置页与插件详情页的局域网访问、局域网密码及手机右侧栏开关提交 `on` 布尔值。各项设置写入成功后读取 `pocket.status` 的完整状态，再刷新表单、密码和二维码；写入失败时显示服务端错误。

| 路径                                           | 职责                                                                               |
| ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| `host/index.js`                                | 访问密码、鉴权回调、插件加载与卸载                                                 |
| `host/proxy.mjs`                               | HTTP/WebSocket 代理、浏览器握手、登录和限速                                        |
| `host/service.mjs`、`host/ip.mjs`              | 地址选择、二维码缓存、固定端口与监听回收                                           |
| `host/settings.mjs`                            | 本插件设置的校验与持久化                                                           |
| `shared/access-records.ts`                     | 记录与查询的 Zod 约定、推导类型及具名常量                                          |
| `host/access-records.ts`                       | 顺序保存、容量分文件、历史索引重建与倒读分页；`save/list/close` 返回结果并收回句柄 |
| `host/access-records-integration.ts`           | 严格类型的密码终态采集、原始错误、代理拦截、本机权限和查询处理                     |
| `client/RemotePluginPanel.tsx`                 | 详情 Tab、保留设置挂载、分页及原始错误；旧请求取消后保持当前页                     |
| `client/access-records-locales.ts`             | 访问记录的中英文文案，编译检查两种语言的键集合                                     |
| `host/web-rpc.js`、`client/api.js`             | 宿主信任检查、设置通道与共享契约                                                   |
| `client/index.jsx`、`client/pocket-locales.js` | 复用宿主控件的设置页、插件详情与中英文文案                                         |
| `client/mobile/`                               | 移动端布局、导航、文件操作与主题样式                                               |
| `build.mjs`                                    | 复制手写 Host 模块到 `lib/`，将 JSX/TSX 打包成 `lib/client.js`                     |
| `check.mjs`、`eslint.config.mjs`               | JavaScript 语法检查与移动端严格类型规则                                            |
| `test/`                                        | 代理、鉴权、frp 地址、资源回收与移动端回归                                         |

`host/` 保存宿主模块，访问记录使用 TypeScript；`client/` 保存浏览器端 JSX、TSX 和样式源码。构建时复制宿主模块、将访问记录的 Host TS 业务模块和共享约定编译为 ESM JavaScript，并将浏览器端源码打包为 `lib/client.js`。构建产物遵循仓库忽略规则。更新和进程生命周期由 Kongming 管理。

## 验证

在 Kongming 根目录执行：

```sh
pnpm --filter @kmh/remote build
pnpm --filter @kmh/remote check
pnpm --filter @kmh/remote test
pnpm --filter @kmh/remote test:records:coverage
```

访问记录专项包含 13 条场景用例。`test:records:coverage` 先生成 V8 原始报告，再由 `test/access-records-coverage.mjs` 按固定 Git 基线核对五个 TS/TSX 业务模块与密码记录接线的行、语句、函数和分支，四项门槛均为 100%；范围与原始证据见[任务记录](../../docs/spec/kmh-remote-access-records/tasks/README.md)。

本机测试覆盖二维码、密码隔离、HTTP/WebSocket 透传、宿主握手和卸载清理。浏览器验证使用独立临时 profile；真实手机和现有 frp 公网链路的可达性由对应部署环境验收。包接入步骤见[包接入指南](../../docs/kmh/adding-a-plugin-package.md)，Web 实例归属见 [Web profile](../../profiles/kmh-web/README.md)，功能导航见[插件索引](../../docs/kmh/plugin-index.md)。
