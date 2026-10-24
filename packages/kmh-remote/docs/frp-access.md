---
description: KMH Remote 私有部署参数的环境变量命名、现有 frp 接入、鸿蒙 CA 证书安装与访问故障处理。
---

# frp 公网访问

## 概述

手机通过现有 frp 访问电脑上的 KMH Remote。真实地址、端口及部署参数集中保存在本包的本地 `.env`，该文件由 Git 忽略。公开文档只列环境变量名称及对应字段，空值模板见 [.env.example](../.env.example)。部署时将 `.env` 中的参数应用到 frp、HTTPS 入口和插件的既有配置入口。

## 目录

- [环境变量命名](#环境变量命名)
- [接入现有 frp](#接入现有-frp)
- [鸿蒙安装 CA 证书](#鸿蒙安装-ca-证书)
- [故障处理](#故障处理)
- [维护与验收](#维护与验收)

---

## 环境变量命名

`.env` 作为私有部署参数来源；实际生效值分别由本地 frp 配置、HTTPS 入口配置、宿主本机覆盖和插件设置承载。这些部署文件保留在版本控制之外。变量需要由部署流程读取并填写到对应字段；插件现有设置入口见[插件说明](../README.md)。

| 环境变量                                | 对应配置或用途                                                                |
| --------------------------------------- | ----------------------------------------------------------------------------- |
| `KMH_REMOTE_PUBLIC_HOST`                | HTTPS 公网主机、证书适用地址和入口 Host 规则                                  |
| `KMH_REMOTE_PUBLIC_PORT`                | HTTPS 公网监听、安全组与防火墙规则                                            |
| `KMH_REMOTE_PUBLIC_URL`                 | 插件「公网访问地址」                                                          |
| `KMH_REMOTE_WEB_HOST`                   | KMH Web 监听地址                                                              |
| `KMH_REMOTE_WEB_PORT`                   | KMH Web 监听端口，Remote 从宿主读取实际值                                     |
| `KMH_REMOTE_PROXY_BIND_HOST`            | Remote 代理的监听地址记录                                                     |
| `KMH_REMOTE_PROXY_PORT`                 | Remote 实例的 `config.port` 或本地 `proxyPort` 设置，以及 frpc 的 `localPort` |
| `KMH_REMOTE_FRP_SERVER_HOST`            | frpc 的 `serverAddr`                                                          |
| `KMH_REMOTE_FRP_SERVER_PORT`            | frpc 的 `serverPort`                                                          |
| `KMH_REMOTE_FRP_LOCAL_HOST`             | frpc 的 `localIP`                                                             |
| `KMH_REMOTE_FRP_BIND_HOST`              | frps 的 `proxyBindAddr` 及 HTTPS 入口的后端主机                               |
| `KMH_REMOTE_FRP_REMOTE_PORT`            | frpc 的 `remotePort`、frps 的 `allowPorts` 项及 HTTPS 后端端口                |
| `KMH_REMOTE_FRP_EXISTING_REMOTE_PORTS`  | 现有转发端口清单，逗号分隔，用于保留 `allowPorts` 中已有项                    |
| `KMH_REMOTE_FRP_MAX_PORTS_PER_CLIENT`   | frps 的 `maxPortsPerClient`                                                   |
| `KMH_REMOTE_FRP_AUTH_ADDITIONAL_SCOPES` | frp 两端的 `auth.additionalScopes`，逗号分隔，应用时转换为配置数组            |

请求经过手机公网入口、服务器 frps 回环转发、电脑 frpc、Remote 鉴权代理，最后到达 KMH Web。公网入口、frp 控制连接和业务转发各自使用对应变量；部署时核对整个链路。

## 接入现有 frp

沿用现有 frp 的连接、认证与 TLS 配置。新增 KMH 转发时，同步检查允许端口、代理数量上限和两端鉴权范围。

1. 在本地 `.env` 填写部署参数，权限限定为仅所有者可读写。认证凭据继续由既有私有配置管理。
2. 在电脑 `frpc.toml` 的 KMH 代理中，分别将 `KMH_REMOTE_FRP_LOCAL_HOST`、`KMH_REMOTE_PROXY_PORT`、`KMH_REMOTE_FRP_REMOTE_PORT` 应用到 `localIP`、`localPort`、`remotePort`。代理名称使用 `kmh-remote`。
3. 在服务器 `frps.toml` 中，将 `KMH_REMOTE_FRP_REMOTE_PORT` 加入 `allowPorts` 并保留 `KMH_REMOTE_FRP_EXISTING_REMOTE_PORTS` 对应的已有项。`KMH_REMOTE_FRP_MAX_PORTS_PER_CLIENT` 应覆盖实际代理总数，字段定义见 [frp 服务端配置](https://gofrp.org/zh-cn/docs/reference/server-configures/)。
4. 核对两端认证凭据与 `KMH_REMOTE_FRP_AUTH_ADDITIONAL_SCOPES`。服务端要求的心跳与工作连接鉴权范围，需要在客户端配置中同步启用。范围配置放在第一个代理表之前；签名与校验行为见 [frp 鉴权实现](https://github.com/fatedier/frp/blob/v0.71.0/pkg/auth/token.go)。
5. 在 HTTPS 入口应用 `KMH_REMOTE_PUBLIC_HOST`、`KMH_REMOTE_PUBLIC_PORT`，后端使用 `KMH_REMOTE_FRP_BIND_HOST` 与 `KMH_REMOTE_FRP_REMOTE_PORT`，保留请求 Host 并支持 WebSocket。服务端证书的 SAN 应覆盖公网主机；SAN 是证书声明适用地址的字段。IP 入口的路由与无 SNI 握手共用默认 TLS 选项，规则见 [Traefik TLS 选项](https://doc.traefik.io/traefik/v3.6/reference/routing-configuration/http/tls/tls-options/)。
6. 按 `KMH_REMOTE_PUBLIC_PORT` 配置公网安全组和防火墙。frps 业务转发监听使用 `KMH_REMOTE_FRP_BIND_HOST` 指定的回环地址，供 HTTPS 入口访问。
7. 备份配置并进行 frpc、frps 离线校验，再应用配置。frp 服务重启时，共用的现有转发会短暂中断并重连，KMH 可保持原进程运行。
8. 将 `KMH_REMOTE_PUBLIC_URL` 的值填写到插件「公网访问地址」。手机信任证书后，手动打开入口或扫描二维码，使用插件显示的公网密码进入。

## 鸿蒙安装 CA 证书

本节路径来自 HarmonyOS 7 的 HUAWEI Pura X Max 实机操作。部署使用自建 CA 时，将公开 CA 证书交给手机安装；服务端证书由 HTTPS 入口使用，私钥留在部署端。

1. 用手机自带的华为浏览器下载公开 CA 证书，实机流程使用 PEM 格式的 CRT 文件。下载入口也可以由电脑通过临时 USB 通道提供，其监听参数保留在私有配置中。
2. 打开浏览器的「更多 → 下载管理」，找到证书文件并选择「打开」。
3. 在文件预览页选择「更多 → 使用其他应用打开 → 证书管理 → 仅此一次」。
4. 核对证书颁发者、有效期和指纹，确认与部署端公开 CA 一致。
5. 由手机使用者点击「安装」，完成系统要求的验证与信任确认。
6. 回到华为浏览器打开 `KMH_REMOTE_PUBLIC_URL` 对应的入口。证书下载完成后，关闭临时下载服务并移除临时端口映射。

## 故障处理

根据页面提示检查对应组件，公开报告保留变量名称和错误类别。真实地址、端口、进程编号及原始日志保留在私有部署记录。

| 提示或现象                  | 检查与处理                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `Bad Gateway`，缺少转发监听 | 核对 `KMH_REMOTE_FRP_REMOTE_PORT`、`KMH_REMOTE_FRP_MAX_PORTS_PER_CLIENT` 及注册日志；`exceed the max_ports_per_client` 表示代理数量超过上限 |
| 注册成功，工作连接鉴权失败  | 核对凭据和 `KMH_REMOTE_FRP_AUTH_ADDITIONAL_SCOPES`，确认客户端包含服务端要求的鉴权范围                                                      |
| `Misdirected Request`       | 核对公网主机、入口路由与默认 TLS 选项                                                                                                       |
| 「证书已损坏无法安装」      | 比对 CA 指纹；文件一致时，从华为浏览器下载管理交给证书管理。调试目录的文件来源可能读取失败，对应日志为 `get cert data failed`               |
| 证书不受信任或地址不匹配    | 核对手机信任的 CA、证书有效期和 SAN 与 `KMH_REMOTE_PUBLIC_HOST` 的对应关系                                                                  |

## 维护与验收

离线校验检查配置格式，进程与已有日志检查代理注册，手机手动访问确认 HTTPS、证书信任和页面访问。局域网开关与插件数据归属见[插件说明](../README.md)。

本地 `.env`、运行配置、备份和原始日志按私有部署资料管理。公开模板只保留变量名称，地址、端口、认证信息及私钥保留在 Git 忽略的文件中。更新证书时核对手机信任的 CA、证书 SAN 与 HTTPS 入口的证书路径。
