---
description: 当前 Kongming 插件、自有客户端模块、预设与 DSH 能力的导航；实际实例和配置以合成后的 profile 为准。
---

# Kongming 插件索引

Kongming 的 Web 基础插件树由 [profile patch](../../profiles/kmh-web/cordis.patch.yml)管理，附加 bundle 由 [profile 清单](../../profiles/kmh-web/package.json)选择。`pnpm config:web` 展示合成配置；实例是否激活还受依赖、平台条件和预设选择影响，可结合插件面板与[运行日志](runtime-records.md)核对。

当前自有团队能力由 [`@kmh/kmh-team`](../../packages/kmh-team/README.md) 提供，Web profile 声明依赖并挂载 Host/Client；成员执行复用 subagent 的 spawn 服务。

## Kongming 自有包

| 包 | 用途 | 维护入口 |
| --- | --- | --- |
| `@kmh/codex-cli` | 官方 Codex CLI 模型接入、账号配置与客户端展示 | [包说明](../../packages/codex-cli/README.md) |
| `@kmh/zcode-cli` | ZCode CLI 模型接入、登录与客户端展示 | [包说明](../../packages/zcode-cli/README.md) |
| `@kmh/kmh-team` | 固定角色与团队会话，成员执行复用 DSH subagent | [包说明](../../packages/kmh-team/README.md) |
| `@kmh/runtime-log` | 将 Cordis 插件诊断保存到 KMH 数据目录 | [包说明](../../packages/runtime-log/README.md) |
| `@kmh/kmh-echo` | 插件加载与回收的生命周期示例 | [包说明](../../packages/kmh-echo/README.md) |
| `@kmh/web-surface-zh` | Web 环境系统提示词的中文替换 | [包说明](../../packages/web-surface-zh/README.md) |
| `@kmh/dev-preset` | 开发模式预设 bundle | [清单](../../packages/kmh-dev-preset/package.json)、[配置](../../packages/kmh-dev-preset/cordis.patch.yml) |
| `@kmh/bundle-mobile-assistant` | 移动助手 preset、精选技能与精简工具 | [包说明](../../bundles/mobile-assistant/README.md) |
| `@kmh/mobile-assistant-runtime` | 助手 SDK、持久会话恢复与审批转发 | [包说明](../../packages/mobile-assistant-runtime/README.md) |

Codex、ZCode 和团队包各自包含客户端源码，并通过 `./client` 导出接入 DSH Web。Web 外壳、通用 UI 服务和组件由 DSH 子模块提供。新增自有包的依赖、构建、profile 和测试登记见[包接入指南](adding-a-plugin-package.md)。

## DSH 能力导航

下列参考来自本仓库实际使用的 `third_party/dsh` 子模块。公开类型、配置和生命周期以对应服务及包源码为准，能力名称用于定向查找。

| 能力 | 参考 |
| --- | --- |
| profile、bundle、启动与重载 | [启动子系统](../../third_party/dsh/docs/subsystems/boot.zh.md)、[Cordis 机制](../../third_party/dsh/docs/cordis-primer.zh.md) |
| Agent 执行与实时事件 | [Agent 核心](../../third_party/dsh/docs/subsystems/core.zh.md) |
| 模型、请求与流式协议 | [模型流](../../third_party/dsh/docs/subsystems/llm-streaming.zh.md) |
| 会话记录、恢复与非会话数据 | [Session](../../third_party/dsh/docs/subsystems/session.zh.md)、[存储](../../third_party/dsh/docs/subsystems/storage.zh.md) |
| 提示词、技能与上下文压缩 | [系统提示词](../../third_party/dsh/docs/subsystems/system-prompt.zh.md)、[技能](../../third_party/dsh/docs/subsystems/skills.zh.md)、[压缩](../../third_party/dsh/docs/subsystems/compaction.zh.md) |
| 工具注册与执行 | [工具](../../third_party/dsh/docs/subsystems/tools.zh.md)、[工具编写](../../third_party/dsh/docs/cookbook/adding-a-tool.zh.md) |
| 审批与进程隔离 | [审批](../../third_party/dsh/docs/subsystems/approval.zh.md)、[沙箱](../../third_party/dsh/docs/subsystems/sandbox.zh.md) |
| 文件、Shell 与终端 | [文件系统](../../third_party/dsh/docs/subsystems/filesystem.zh.md)、[Shell](../../third_party/dsh/docs/subsystems/shell.zh.md)、[终端](../../third_party/dsh/docs/subsystems/terminal.zh.md) |
| 子 Agent、后台任务与工作流 | [子 Agent](../../third_party/dsh/docs/subsystems/subagent.zh.md)、[后台任务](../../third_party/dsh/docs/subsystems/jobs.zh.md)、[工作流](../../third_party/dsh/docs/subsystems/workflow.zh.md) |
| 目标与调度 | [目标](../../third_party/dsh/docs/subsystems/goal.zh.md)、[调度](../../third_party/dsh/docs/subsystems/schedule.zh.md) |
| 网络搜索与 MCP | [Web 工具](../../third_party/dsh/docs/subsystems/web.zh.md)、[MCP](../../third_party/dsh/docs/subsystems/mcp.zh.md) |
| Web 客户端、模块与 UI 扩展 | [客户端架构](../../third_party/dsh/docs/subsystems/web-client.zh.md)、[客户端模块](../../third_party/dsh/docs/subsystems/client-modules.zh.md)、[slots](../../third_party/dsh/docs/subsystems/slots.zh.md) |
| HTTP 服务与 Web 承载 | [Web 服务](../../third_party/dsh/docs/subsystems/web-server.zh.md) |

## 配置与作用域

standard、ptc、minimal、cordis 的基础预设位于 Web profile patch；开发预设由 `@kmh/dev-preset` bundle 提供。修改 Agent 的 persona、工具或权限时，在对应预设的子插件树内定位实例；同一插件包可在宿主和多个预设中分别加载。

实际 bundle 选择和覆盖顺序见 [Web 配置](../../profiles/kmh-web/README.md)，精确字段见 [DSH 配置目录](../../third_party/dsh/docs/config-catalog.zh.md)及各包 `Config`。升级 DSH 时同时核对 profile 依赖、附加 bundle 和原版配置对照，流程见[底座升级](README.md#版本升级)。
