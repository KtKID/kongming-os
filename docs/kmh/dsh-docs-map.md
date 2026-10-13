---
description: third_party/dsh 子模块文档的中文索引：按插件开发、架构、配置、工具、Web 界面、测试、用户指南与升级场景列出上游文档入口与查阅时机，Kongming 开发者查 DSH 底座规范从此页定位。
---

# DSH 文档地图

DSH 底座的说明文档全部位于 [third_party/dsh](../../third_party/dsh) 子模块内，Kongming 侧不复制其内容。本页按开发场景索引其中常用文档，标注各自内容与查阅时机；Kongming 自有的接入与维护说明见 [docs/kmh](README.md)。

链接约定：

- 优先链接中文版（`.zh.md`）；仅英文的单独注明。每页顶部有 `[English]` 切换。
- 标注「生成」的文档（catalog 与图集类）由子模块 `gen-*` 脚本从源码再生成；发现与源码不一致时按其文件顶部的注释在子模块内重新生成，禁止手工编辑。
- 子模块当前维护分支为 `kmh/runtime-core`；升级子模块后请按文末[维护](#维护)核对本页链接。

## 插件开发

### 上手教程

[docs/user/develop](../../third_party/dsh/docs/user/develop) 是面向 harness 插件作者的教程序列，从零开始按序完成：

| 文档 | 内容与查阅时机 |
| --- | --- |
| [第一个插件](../../third_party/dsh/docs/user/develop/basic/index.zh.md) | 创建最小 Harness 插件并加载进 Web UI；写第一个插件前必读 |
| [插件配置](../../third_party/dsh/docs/user/develop/basic/config.zh.md) | 让插件接受 `cordis.yml` 传入的配置 |
| [构建工具](../../third_party/dsh/docs/user/develop/basic/tool.zh.md) | 在 Web UI 中给插件添加面向模型的工具（`greet` 示例） |
| [打包发布](../../third_party/dsh/docs/user/develop/basic/publish.zh.md) | 打包成组合包（bundle）、`dsh plugin add` 安装进 profile、配置层叠顺序 |
| [插件与生命周期](../../third_party/dsh/docs/user/develop/framework/index.zh.md) | Cordis 插件模型与 Fiber 生命周期状态机 |
| [事件](../../third_party/dsh/docs/user/develop/framework/events.zh.md) | 事件机制——harness 扩展点的核心通信方式 |
| [服务](../../third_party/dsh/docs/user/develop/framework/service.zh.md) | 服务定义、`inject` 声明与插件间能力公开 |
| [能力的三种角色设计](../../third_party/dsh/docs/user/develop/practice/index.zh.md) | seam、提供方、消费者三角色的概念与高级教程入口 |
| [动态 Cordis](../../third_party/dsh/docs/user/develop/practice/dynamic-cordis.zh.md) | 创造模式下的 Plugin Manager 与运行时检查 |
| [LLM 适配器教程](../../third_party/dsh/docs/user/develop/practice/llm-adapter.zh.md) | 以教程形式接入新模型提供方 |

### 框架概念与 API

| 文档 | 内容与查阅时机 |
| --- | --- |
| [Cordis 入门](../../third_party/dsh/docs/cordis-primer.zh.md) | Cordis 核心概念精简参考；读子系统页面前先过一遍 |
| [Cordis 教程](../../third_party/dsh/docs/cordis-tutorial/index.zh.md) | 七章动手教程（通用 Cordis 运行时示例，非 harness 加载链） |
| [Cordis 核心 API：Context](../../third_party/dsh/docs/cordis-api/context.zh.md) | 生成参考：`ctx` 核心 API 与继承层（`inherited` 页仅英文） |
| [Cordis 核心 API：服务](../../third_party/dsh/docs/cordis-api/service.zh.md) | 生成参考：服务定义与注册 |
| [Cordis 核心 API：事件](../../third_party/dsh/docs/cordis-api/events.zh.md) | 生成参考：事件定义与派发 |
| [Cordis 核心 API：Fiber](../../third_party/dsh/docs/cordis-api/fiber.zh.md) | 生成参考：fiber 状态机与隔离单元 |
| [Cordis 核心 API：Registry](../../third_party/dsh/docs/cordis-api/registry.zh.md) | 生成参考：注册表机制 |
| [子系统索引](../../third_party/dsh/docs/subsystems/README.zh.md) | 每个子系统一页：类型定义、语义与生成的 Cordis API 接线；查某个服务的精确签名从这里进。kmh 侧常用：[session](../../third_party/dsh/docs/subsystems/session.zh.md)、[tools](../../third_party/dsh/docs/subsystems/tools.zh.md)、[system-prompt](../../third_party/dsh/docs/subsystems/system-prompt.zh.md)、[web-client](../../third_party/dsh/docs/subsystems/web-client.zh.md)、[settings](../../third_party/dsh/docs/subsystems/settings.zh.md)、[boot](../../third_party/dsh/docs/subsystems/boot.zh.md) |

### 实操手册（cookbook）

[docs/cookbook](../../third_party/dsh/docs/cookbook) 收录带验证步骤的配方，直接按场景查用：

| 文档 | 内容与查阅时机 |
| --- | --- |
| [添加 workspace 包](../../third_party/dsh/docs/cookbook/adding-a-package.zh.md) | 在 DSH 子模块内新建 `dsh-*` 包的逐文件清单 |
| [添加工具](../../third_party/dsh/docs/cookbook/adding-a-tool.zh.md) | 面向模型的工具必须满足的约定真源；`tool-bash` 为生产级示例 |
| [添加 LLM 适配器](../../third_party/dsh/docs/cookbook/adding-an-llm-adapter.zh.md) | 接入新模型提供方的配方（参考 `llm-deepseek`、`llm-pi-ai`） |
| [添加设置卡片](../../third_party/dsh/docs/cookbook/adding-a-settings-card.zh.md) | 在插件 Config schema 声明即时字段并提供设置卡片入口 |
| [添加 remote API](../../third_party/dsh/docs/cookbook/adding-a-remote-api.zh.md) | 新增或改动 `ctx.remote` 端点的五步清单 |
| [添加 Session 格式版本](../../third_party/dsh/docs/cookbook/adding-a-session-format-version.zh.md) | 为 Session 日志添加新的结构性版本且不改写已发布数据 |
| [vendor 上游包](../../third_party/dsh/docs/cookbook/adding-a-vendored-package.zh.md) | 把上游 Cordis 包以源码形式固定进 `vendor/` 的流程 |
| [扩展插件形态](../../third_party/dsh/docs/cookbook/extension-cookbook.zh.md) | 各类扩展（工具、钩子、权限门等）的参考模式与写法索引 |

在 Kongming 仓库侧把自有插件包接入 profile 与 bundle 的步骤见 [包接入指南](adding-a-plugin-package.md)；子模块内的包结构归上游 `adding-a-package`，两者分工以该指南开头说明为准。

## 架构与运行时

| 文档 | 内容与查阅时机 |
| --- | --- |
| [架构](../../third_party/dsh/docs/architecture.zh.md) | 总架构图：组合方式、核心包、循环与扩展点；改动 `packages/` 前必读 |
| [Agent 生命周期](../../third_party/dsh/docs/agent-lifecycle.zh.md) | 会话/轮次/步骤生命周期的时序图（生成），architecture 的配套图示 |
| [能力 seam 图](../../third_party/dsh/docs/capability-seams.zh.md) | 服务声明、实现与消费方的 seam 关系图（生成） |
| [事件生产者/消费者矩阵](../../third_party/dsh/docs/event-producer-consumer.zh.md) | 哪些包派发/监听哪些 harness 事件（生成） |
| [图集](../../third_party/dsh/docs/graph-atlas.zh.md) | 生成目录未覆盖的包关系、事件流、组合与生命周期路径图（生成） |
| [模块依赖图](../../third_party/dsh/docs/module-graph.zh.md) | 包级依赖图，mermaid 源（生成） |
| [词汇表](../../third_party/dsh/docs/glossary.zh.md) | 领域术语一个概念一个词；写文档拿不准用词时查 |

## 配置、会话与持久化

| 文档 | 内容与查阅时机 |
| --- | --- |
| [配置目录](../../third_party/dsh/docs/config-catalog.zh.md) | 每个包 `config:` 块的完整声明（生成），部署轴参考：查 `cordis.yml` 能写什么键 |
| [Session 格式状态](../../third_party/dsh/docs/session-format-status.zh.md) | 工作区写入器版本与已发布 Session 格式的真源 |
| [持久化目录](../../third_party/dsh/docs/persistence-catalog.zh.md) | 全部持久化 Session 事件及其类型（生成） |
| [持久化变更记录](../../third_party/dsh/docs/persistence-changes/README.zh.md) | 历次持久化类型变更与历史格式 schema |

## 模型工具与远程 API

| 文档 | 内容与查阅时机 |
| --- | --- |
| [工具目录](../../third_party/dsh/docs/tool-catalog.zh.md) | 全部面向模型的工具的名称、描述与 schema（生成） |
| [工具执行流水线](../../third_party/dsh/docs/tool-execution-pipeline.zh.md) | 策略、钩子、沙箱、守卫与结果重写的执行顺序图（生成） |
| [API Gateway](../../third_party/dsh/docs/api-gateway.zh.md) | `ctx.remote` 一元/流式方法的声明与生成管线 |
| [DeepSeek wire 扩展](../../third_party/dsh/docs/deepseek-llm-api-wire-extensions.zh.md) | `llm-deepseek` 发送的 harness 专用 HTTP 标头与附加字段 |

## Web 界面

Kongming 侧插件界面的强制规范（必须复用 DSH UI 组件与 token）见 [插件 Web 界面规范](web-ui.md)；本组是上游权威：

| 文档 | 内容与查阅时机 |
| --- | --- |
| [Web 样式规则](../../third_party/dsh/docs/web-styling.zh.md) | 浏览器客户端的样式职责归属与组件规则；写 Web UI 代码前查 |
| [ui-primitives 组件目录](../../third_party/dsh/packages/client/ui-primitives/README.zh.md) | 全部可复用控件及语义；写任何控件前先查这张表（插件间无法互导组件，此包是唯一共享通道） |
| [ui-theme](../../third_party/dsh/packages/client/ui-theme/README.zh.md) | `--dsw-*` 色阶与语义别名的 token 归属及明暗主题 |
| [圆角规范](../../third_party/dsh/docs/ui-radius.zh.md) | 按组件用途与尺寸选择统一圆角 |
| [dsh-client-ui-ux 技能](../../third_party/dsh/.agents/skills/dsh-client-ui-ux/SKILL.md) | 界面设计判断：反馈面选择、浮层与菜单安全、加载态（英文；接入说明见[技能接入](skills.md)） |

## 测试与贡献流程

| 文档 | 内容与查阅时机 |
| --- | --- |
| [测试](../../third_party/dsh/docs/testing.zh.md) | 子模块分层测试方式与保持绿色的规则 |
| [开发指南](../../third_party/dsh/docs/development.zh.md) | 贡献者搭建、日常工作流与 CI 组织；进子模块开发先读 |
| [防御性模式](../../third_party/dsh/docs/defensive-patterns.zh.md) | 生命周期、并发、子进程与清理代码的缺陷类别规则 |
| [维护 dsh-code-review](../../third_party/dsh/docs/cookbook/maintaining-dsh-code-review.zh.md) | dsh-code-review 技能的周期维护流程 |
| [回应堆叠 PR 评审](../../third_party/dsh/docs/cookbook/responding-to-pr-review-on-a-stack.zh.md) | 依赖堆叠上评审修复的归属与传播 |
| [评审持久化类型变更](../../third_party/dsh/docs/cookbook/reviewing-persistence-type-changes.zh.md) | 创建 PR 前本地生成并验证持久化类型变更 |

## 产品用户指南

[docs/user/guide](../../third_party/dsh/docs/user/guide) 面向运行 Web UI 的使用者，运维 KMH 实例时同样适用：

| 文档 | 内容与查阅时机 |
| --- | --- |
| [使用 Web UI](../../third_party/dsh/docs/user/guide/index.zh.md) | 启动后的第一步：配置模型、选择工作区 |
| [模型提供方](../../third_party/dsh/docs/user/guide/providers.zh.md) | 各提供方与自定义 OpenAI 兼容端点的配置 |
| [定时任务](../../third_party/dsh/docs/user/guide/schedule.zh.md) | 提醒与定时后续操作的使用 |
| [网络代理](../../third_party/dsh/docs/user/guide/network-proxy.zh.md) | 出网代理配置 |
| [MCP 记忆](../../third_party/dsh/docs/user/guide/mcp-memory.zh.md) | MCP 记忆功能的使用 |
| [公开部署](../../third_party/dsh/docs/user/guide/public-deployments.zh.md) | 面向多用户的部署形态 |
| [Python SDK](../../third_party/dsh/docs/user/guide/python-sdk.zh.md) | Python 侧 SDK 调用 |
| [GitHub 评审](../../third_party/dsh/docs/user/guide/github-review.zh.md) | 用 harness 执行 GitHub 评审 |

## 升级与历史

| 文档 | 内容与查阅时机 |
| --- | --- |
| [升级指南目录](../../third_party/dsh/docs/upgrade-guide) | 各版本破坏性变更迁移，按版本号分目录、每主题一份 `guide.zh.md`（现有 v0.1.7-rc.2、v0.2.0-rc.2、v0.2.1-alpha.1） |
| [事故复盘索引](../../third_party/dsh/docs/postmortem/README.zh.md) | 历史事故的时序与教训 |
| [包改名映射](../../third_party/dsh/docs/rescope.zh.md) | vendor 层以 `@deepseek-ai` 作用域发布的名字映射表 |
| [性能基准](../../third_party/dsh/BENCHMARK.md) | 基准测试结果（仅英文） |

Kongming 侧跟随 DSH 升级的操作见 [DSH 接入与升级](README.md)。

## 仓库地图与子模块规则

| 文档 | 内容与查阅时机 |
| --- | --- |
| [包分组地图](../../third_party/dsh/packages/README.zh.md) | `packages/` 按能力系列分组的两级地图：先定位组，再进组 README 查包 |
| [子模块 AGENTS.md](../../third_party/dsh/AGENTS.md) | 子模块内开发的行为规范（英文）；进入子模块改动前必读 |
| [packages 子树规则](../../third_party/dsh/packages/AGENTS.md) | `packages/` 目录专属规则（英文） |
| [文档分层标准](../../third_party/dsh/docs/AGENTS.md) | 子模块文档的分层归属、写作规则与字数预算（英文）；改子模块文档前读 |
| [Agent Notes 规则](../../third_party/dsh/.agents/notes/README.zh.md) | 决策记录（为什么、放弃了什么）的存放与书写规则 |
| [native 说明](../../third_party/dsh/native/README.zh.md) | native 目录的构成 |
| [Python 侧说明](../../third_party/dsh/python/README.zh.md) | Python SDK 与运行时目录 |
| [项目 README](../../third_party/dsh/README.zh.md) | DSH 项目总览与源码运行入口 |
| [贡献指南](../../third_party/dsh/CONTRIBUTING.zh.md) | 贡献流程总述 |
| [安全策略](../../third_party/dsh/SAFETY.zh.md) | 安全边界与策略 |
| [品牌规范](../../third_party/dsh/BRAND_GUIDELINES.zh.md) | DSH 品牌与命名规范；Kongming 品牌改造时对照 |

## 维护

本页归 Kongming 侧维护，只做索引不复制内容；被索引文档的内容与更新归 DSH 子模块。升级子模块或发现链接失效时，在仓库根目录运行下列命令核对（列出即为失效）：

```sh
grep -o '\](\.\./\.\./third_party/dsh[^#)]*)' docs/kmh/dsh-docs-map.md | sed 's/^](//;s/)$//' | sort -u | while IFS= read -r p; do [ -e "docs/kmh/$p" ] || echo "missing: $p"; done
```

子模块新增文档时按场景并入对应分组；没有中文版的条目注明「仅英文」。子模块文档自身的写作规范见其[文档分层标准](../../third_party/dsh/docs/AGENTS.md)，不由本仓库技能约束。
