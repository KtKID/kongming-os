# Kongming Web 配置模块方案与逐项索引

本文件是阅读与规划资料，当前启动配置保持原样。依据固定 DSH 子模块 ede2c768 的配置和官方包 README 整理。

建议采用功能模块、适用入口和实例作用域三个维度。通用 Agent 服务与工具、GUI 共用功能、Web 启动承载、Agent 预设、Kongming 产品配置分别管理。初次整理保留覆盖顺序和预设内的隔离组；拆分配置时采用 DSH 原生 bundle 的有序 patch 文件列表。每个本地模块文件保存实际完整配置，pnpm config:web 提供展开总览。

建议的源配置目录如下，每个目录对应一个 Kongming 自有 bundle，其 manifest 显式列出本包内有序 patch 文件。此目录结构属于拟议方案。

```text
bundles/
  runtime-common/    # 装配、Agent、模型、数据、安全、工具、上下文、协作、联网
  gui/               # GUI 宿主支持、API 通信、界面、设置面板
  web/               # HTTP 服务、Web 启动、端口与浏览器打开方式
  agent-presets/     # standard、ptc、minimal、cordis 的完整子插件树
  kongming/          # Kongming 产品策略、品牌与应用配置
profiles/kmh-web/
  package.json       # 显式选择这些本地 bundle 及组合顺序
  cordis.patch.yml   # 本 profile 的个别覆盖
  upstream.cordis.yml # 固定版本的原版完整对照
  README.md          # 模块导航、常用修改位置与索引
```

模块文件内保存全部插件行与实际配置值；DSH 子模块提供插件实现。每条配置附中文用途、所属模块、作用域和适用入口，并链接单包 README 与 Config 源码。最终展开视图按 DSH 原生组合算法生成，编辑入口以模块源文件为准。

Web bundle 的原版实现已经通过五个有序 patch 文件组合主配置和四个预设，拟议方案沿用这一机制。通用能力的归属按功能判断，Web bundle 的来源标记单独记录；当前由 Web 装配的 workspace、schedule 等领域能力保留通用复用的分类。

首次迁移核对实例 id/name、全部 config 字段、disabled 条件、inject/isolate 和预设内组结构；保持覆盖顺序与必要的加载次序，重点验证 Web 的启动、配置写入和预设选择。跨 profile 复用通用配置时，各入口显式声明自身的工具装配与覆盖。Web 中部分顶层工具条目被禁用，所选预设在 Agent 作用域内加载对应工具；修改 Agent 的 persona 与工具时，定位所选预设内部配置。

配置字段目录对 ui-settings-general 列出源码链接，其宿主 Config 的 welcomeNoticeVersion 表示欢迎提示确认版本。该包的图形客户端功能同时包括设置面板外壳、通用设置分区、连接恢复展示和首次引导，功能说明与可配置字段分别阅读。

适用范围表示能力用途与复用方向；Web/GUI 源层与通用能力的分类分开判断。以下状态根据配置静态判读，实际激活受依赖、平台、所选预设和运行时条件影响。

配置中的 185 个顶层条目及预设、隔离组子项共 296 条实例记录；同一插件入口可能出现在多个作用域。功能摘要取自固定版本的官方单包说明，README 和源码负责精确配置与导出入口的细节。

## 01 运行装配与插件管理

| 实例位置 | 插件入口 | 功能说明 | 适用范围 | 配置状态 | 依据 |
| --- | --- | --- | --- | --- | --- |
| 宿主 / tool-plugin-manager | `@deepseek-ai/dsh-plugin-manager/tools` | 通过 Web 侧边栏或 agent 启停 profile 插件，并安装、删除或选择组合包。 | 通用能力；当前列入 Web 配置 | 显式禁用 | [官方包说明](../../third_party/dsh/packages/boot/plugin-manager/README.zh.md) |
| 宿主 / plugin-manager | `@deepseek-ai/dsh-plugin-manager` | 通过 Web 侧边栏或 agent 启停 profile 插件，并安装、删除或选择组合包。 | 通用能力；当前列入 Web 配置 | 按条件：!ctx.get('profileContext') | [官方包说明](../../third_party/dsh/packages/boot/plugin-manager/README.zh.md) |
| 宿主 / timer | `@deepseek-ai/cordis-plugin-timer` | Timer service for cordis | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/vendor/timer/README.md) |
| 宿主 / hmr | `@deepseek-ai/dsh-hmr` | 通过统一协调队列热重载插件代码和 profile 配置。 | 通用能力；当前列入 Web 配置 | 按条件：!ctx.get('profileContext') | [官方包说明](../../third_party/dsh/packages/boot/hmr/README.zh.md) |
| 宿主 / config-editor | `@deepseek-ai/dsh-config-editor` | 保存当前 profile 配置，并通过 Loader 应用。 | 通用能力；当前列入 Web 配置 | 按条件：!ctx.get('profileContext') | [官方包说明](../../third_party/dsh/packages/boot/config-editor/README.zh.md) |
| 预设 standard / planning | `cordis:group` | Cordis 子插件组及其服务隔离配置。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/vendor/README.md) |
| 预设 standard / compaction | `cordis:group` | Cordis 子插件组及其服务隔离配置。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/vendor/README.md) |
| 预设 standard / delegation | `cordis:group` | Cordis 子插件组及其服务隔离配置。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/vendor/README.md) |
| 预设 standard / tool-plugin-manager | `@deepseek-ai/dsh-plugin-manager/tools` | 通过 Web 侧边栏或 agent 启停 profile 插件，并安装、删除或选择组合包。 | 通用能力；当前列入 Web 配置 | 显式禁用 | [官方包说明](../../third_party/dsh/packages/boot/plugin-manager/README.zh.md) |
| 预设 ptc / planning | `cordis:group` | Cordis 子插件组及其服务隔离配置。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/vendor/README.md) |
| 预设 ptc / compaction | `cordis:group` | Cordis 子插件组及其服务隔离配置。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/vendor/README.md) |
| 预设 ptc / delegation | `cordis:group` | Cordis 子插件组及其服务隔离配置。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/vendor/README.md) |
| 预设 ptc / tool-plugin-manager | `@deepseek-ai/dsh-plugin-manager/tools` | 通过 Web 侧边栏或 agent 启停 profile 插件，并安装、删除或选择组合包。 | 通用能力；当前列入 Web 配置 | 显式禁用 | [官方包说明](../../third_party/dsh/packages/boot/plugin-manager/README.zh.md) |
| 预设 minimal / persistent-shell | `cordis:group` | Cordis 子插件组及其服务隔离配置。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/vendor/README.md) |
| 预设 cordis / planning | `cordis:group` | Cordis 子插件组及其服务隔离配置。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/vendor/README.md) |
| 预设 cordis / compaction | `cordis:group` | Cordis 子插件组及其服务隔离配置。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/vendor/README.md) |
| 预设 cordis / delegation | `cordis:group` | Cordis 子插件组及其服务隔离配置。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/vendor/README.md) |
| 预设 cordis / tool-plugin-manager | `@deepseek-ai/dsh-plugin-manager/tools` | 通过 Web 侧边栏或 agent 启停 profile 插件，并安装、删除或选择组合包。 | 通用能力；当前列入 Web 配置 | 按条件：!ctx.get('profileContext') | [官方包说明](../../third_party/dsh/packages/boot/plugin-manager/README.zh.md) |

## 02 Agent 核心

| 实例位置 | 插件入口 | 功能说明 | 适用范围 | 配置状态 | 依据 |
| --- | --- | --- | --- | --- | --- |
| 宿主 / session | `@deepseek-ai/dsh-session` | 面向用户与维护者的事件溯源会话日志与内存存储说明，用于构建、检查或扩展每个 agent（智能体）交互背后的持久记录。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/core/session/README.zh.md) |
| 宿主 / agent | `@deepseek-ai/dsh-agent` | 面向插件、UI 与编排器的 Agent 句柄、实时注册表、进程本地发起方作用域，以及 agent/* 事件词汇。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/core/agent/README.zh.md) |
| 宿主 / agent-default-model | `@deepseek-ai/dsh-agent-default-model` | 面向用户与维护者的部署默认模型选择说明，用于选择、配置或调试新创建的 agent（智能体）初始使用哪个模型。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/core/agent-default-model/README.zh.md) |
| 宿主 / tools | `@deepseek-ai/dsh-tools` | 面向工具作者与维护者的工具注册表与执行流水线说明，用于注册、限制、呈现或调试面向模型的工具。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/core/tools/README.zh.md) |
| 宿主 / system-prompt | `@deepseek-ai/dsh-system-prompt` | 面向用户与维护者的系统提示词组装说明，用于添加提示词段、变量、工具 schema 来源或配置面向模型的提示词。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/core/system-prompt/README.zh.md) |
| 宿主 / agent-loop | `@deepseek-ai/dsh-agent-loop` | 面向用户与维护者的默认 agent（智能体）驱动器说明，用于选择、配置或调试 agent 的创建方式以及轮次与步骤的运行方式。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/core/agent-loop/README.zh.md) |
| 预设 ptc / tool-presentation | `@deepseek-ai/dsh-agent-tool-presentation` | 面向用户与维护者的 agent（智能体）平面呈现选择器说明，用于选择、配置或调试 agent preset 的模型看到其工具的哪种形态。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/core/agent-tool-presentation/README.zh.md) |

## 03 模型、账号与凭据

| 实例位置 | 插件入口 | 功能说明 | 适用范围 | 配置状态 | 依据 |
| --- | --- | --- | --- | --- | --- |
| 宿主 / llm | `@deepseek-ai/dsh-llm` | 面向用户与维护者的提供方无关模型调用服务说明：流式发起请求、注册提供方适配器或解析模型元数据。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/llm/llm/README.zh.md) |
| 宿主 / deepseek-llm-api-extensions | `@deepseek-ai/dsh-deepseek-llm-api-extensions` | 面向提供方插件的官方 DeepSeek 请求扩展注册表，用于贡献具有生命周期归属的顶层 API 字段。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/llm/deepseek-llm-api-extensions/README.zh.md) |
| 宿主 / plugin-package-inventory-deepseek | `@deepseek-ai/dsh-plugin-package-inventory-deepseek` | 面向发送官方 DeepSeek 请求的部署，说明活跃 Loader 包清单元数据。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/llm/plugin-package-inventory-deepseek/README.zh.md) |
| 宿主 / llm-retry | `@deepseek-ai/dsh-llm-retry` | 面向用户与维护者的重试执行器说明：在持久 agent（智能体）步骤边界上配置按提供方路由的模型请求恢复。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/llm/llm-retry/README.zh.md) |
| 宿主 / authorization | `@deepseek-ai/dsh-authorization` | 面向用户与维护者的授权 flow 注册表：获取配置无法提供的凭据，因为拿到它需要与人对话。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/credentials/authorization/README.zh.md) |
| 宿主 / deepseek-account | `@deepseek-ai/dsh-deepseek-account-platform` | 通过系统浏览器登录，并将账号凭证保存在现有本地凭证存储中。本地取消会阻止迟到的回调和兑换响应使用户登录。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/credentials/deepseek-account-platform/README.zh.md) |
| 宿主 / credentials | `@deepseek-ai/dsh-credentials-local` | 面向用户与维护者的文件型凭据提供方：选择、配置或排查本地凭据存储及其环境分层。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/credentials/credentials-local/README.zh.md) |
| 宿主 / llm-pi-ai | `@deepseek-ai/dsh-llm-pi-ai` | 面向用户与维护者的 pi-ai 多提供方适配器说明：通过 pi-ai 目录与手工声明网关路由 harness LLM（大语言模型）服务。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/llm/llm-pi-ai/README.zh.md) |
| 宿主 / token-meter | `@deepseek-ai/dsh-token-meter` | 面向用户与维护者的具备回放感知的 token 与上下文压力计量说明：评估提示词规模或构建压缩（compaction）与占用显示。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/llm/token-meter/README.zh.md) |
| 宿主 / llm-deepseek | `@deepseek-ai/dsh-llm-deepseek-api-key` | DeepSeek API key authentication and model discovery. | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/llm/llm-deepseek-api-key/README.zh.md) |
| 宿主 / llm-deepseek-account | `@deepseek-ai/dsh-llm-deepseek-account` | DeepSeek 账号 authentication and model discovery. | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/llm/llm-deepseek-account/README.zh.md) |

## 04 会话与数据

| 实例位置 | 插件入口 | 功能说明 | 适用范围 | 配置状态 | 依据 |
| --- | --- | --- | --- | --- | --- |
| 宿主 / session-log-deepseek | `@deepseek-ai/dsh-session-log-deepseek` | 面向启用官方 DeepSeek 请求元数据的部署，增量上传规范会话日志。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/session/session-log-deepseek/README.zh.md) |
| 宿主 / session-title | `@deepseek-ai/dsh-session-title` | 面向用户与维护者的日志支持型会话标题说明，用于选择标题来源、配置服务或排查标题状态。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/session/session-title/README.zh.md) |
| 宿主 / session-title-llm | `@deepseek-ai/dsh-session-title-first-prompt-llm` | 面向用户与维护者的首消息 LLM（大语言模型）会话标题提供方说明，用于选择标题策略或排查自动标题生成。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/session/session-title-first-prompt-llm/README.zh.md) |
| 宿主 / session-persistence-jsonl | `@deepseek-ai/dsh-session-persistence-jsonl` | 面向部署方与维护者的随产品交付 JSONL 会话持久化后端说明，用于选择、配置或排查带可选 Zstandard 压缩的逐会话持久日志。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/session/session-persistence-jsonl/README.zh.md) |
| 宿主 / attachment-local | `@deepseek-ai/dsh-attachment-local` | DSH_HOME 下附加图片的本地存储，供用户与维护者选择或排查图片附件的存放位置。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/attachment/attachment-local/README.zh.md) |
| 宿主 / session-query-sqlite | `@deepseek-ai/dsh-session-query-sqlite` | 面向部署方与维护者的 SQLite FTS5 会话历史全文搜索后端，用于选择、配置或排查查询服务之上的全文搜索。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/session-query/session-query-sqlite/README.zh.md) |
| 宿主 / session-projection | `@deepseek-ai/dsh-session-projection` | 面向开发者与维护者的会话投影注册表说明，用于向客户端载体提供日志派生逐会话状态的完整当前值，或维护驱动约定。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/session/session-projection/README.zh.md) |
| 宿主 / storage | `@deepseek-ai/dsh-storage` | 存储枢纽（ctx.storage）：面向选择、挂载或排查具名存储后端与数据形式设施的组合方与维护者。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/storage/storage/README.zh.md) |
| 宿主 / storage-json | `@deepseek-ai/dsh-storage-json` | JSON 存储后端：面向在配置根目录下选择、配置或排查整单元文件与逐记录文件的宿主与维护者。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/storage/storage-json/README.zh.md) |
| 宿主 / storage-domain | `@deepseek-ai/dsh-storage-domain` | 领域数据形式（ctx.storageDomain）：面向在存储后端之上选择、挂载或排查经过 schema 校验、发出变更事件的 KV 领域的宿主与维护者。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/storage/storage-domain/README.zh.md) |
| 宿主 / session-projection-cache | `@deepseek-ai/dsh-session-projection-cache` | 面向部署方与维护者的持久会话投影缓存说明，用于选择、配置或排查持久检查点、零 I/O 列表读取与加速的冷投影折叠。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/session/session-projection-cache/README.zh.md) |
| 宿主 / session-telemetry-otel | `@deepseek-ai/dsh-session-telemetry-otel` | 面向部署方的 OpenTelemetry 会话遥测后端说明，用于选择模式、配置导出器或排查哪些数据离开本机。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/session/session-telemetry-otel/README.zh.md) |
| 宿主 / session-checkpoint-policy | `@deepseek-ai/dsh-session-checkpoint-policy` | 面向用户与维护者的语义会话持久性检查点说明，用于部署不会在崩溃时丢失模型请求或工具副作用的持久化 agent（智能体）。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/session/session-checkpoint-policy/README.zh.md) |
| 宿主 / session-log-download | `@deepseek-ai/dsh-session-log-export` | Web 会话日志 ZIP 导出：Host 流式传输、认证下载路由、Session Header 操作与 /export 命令。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/session-query/session-log-export/README.zh.md) |
| 宿主 / workspace | `@deepseek-ai/dsh-workspace` | 面向选择、挂载或排查持久 workspace 记录与会话头校验成员资格的宿主的 Workspace 实体注册表（ctx.workspaceRegistry）说明。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/workspace/workspace/README.zh.md) |
| 宿主 / session-stats | `@deepseek-ai/dsh-session-stats` | 面向客户端与维护者的全日志会话计数与墙钟时间说明，用于选择、组合或排查 sessionStats 投影单元。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/session/session-stats/README.zh.md) |
| 宿主 / session-turn-outline | `@deepseek-ai/dsh-session-turn-outline` | 面向组合或调试 turnOutline 投影单元的客户端与维护者的全量轮次大纲说明，支撑整会话轮次导航。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/session/session-turn-outline/README.zh.md) |

## 05 安全与审批

| 实例位置 | 插件入口 | 功能说明 | 适用范围 | 配置状态 | 依据 |
| --- | --- | --- | --- | --- | --- |
| 宿主 / user-questions | `@deepseek-ai/dsh-user-questions` | 基于 waterfall 的问答服务，用于工具、权限插件、本地 answerer 与 Agent-scoped Web 交互。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/interaction/user-questions/README.zh.md) |
| 宿主 / sandbox | `@deepseek-ai/dsh-sandbox-local` | 面向 Linux、macOS 或 Windows 上选择、配置或排查进程隔离的用户与维护者的本地各平台沙箱后端。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/sandbox/sandbox-local/README.zh.md) |
| 宿主 / sandbox-policy | `@deepseek-ai/dsh-sandbox-policy` | 面向需要在各项负责强制执行的能力之间组合、配置或排查文件操作策略的用户与维护者，提供共享的逐调用沙箱策略解析器与当前模型上下文。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/sandbox/sandbox-policy/README.zh.md) |
| 宿主 / approval | `@deepseek-ai/dsh-user-approval` | 与通道无关的一次性审批 seam；供组合应答者、设置策略或排查以拒绝方式关闭的权限决定的用户与维护者阅读。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/interaction/user-approval/README.zh.md) |
| 宿主 / permission | `@deepseek-ai/dsh-permission-presets` | 面向用户的权限预设：供选择、配置或排查把沙箱模式与审批策略捆绑在一起的 Permissions 选择器的用户与维护者阅读。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/interaction/permission-presets/README.zh.md) |
| 宿主 / commands | `@deepseek-ai/dsh-commands` | 交互式 UI 的面向用户斜杠命令注册表：插件拥有的命令直接针对 agent（智能体）执行，不产生模型消息；供组合或扩展命令面的用户与维护者阅读。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/interaction/commands/README.zh.md) |
| 预设 standard / tool-ask-user | `@deepseek-ai/dsh-tool-ask-user` | 基于 user-questions seam 的模型侧 ask_user_question 工具；供组合或排查交互式 agent（智能体）表面的用户与维护者阅读。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/interaction/tool-ask-user/README.zh.md) |
| 预设 ptc / tool-ask-user | `@deepseek-ai/dsh-tool-ask-user` | 基于 user-questions seam 的模型侧 ask_user_question 工具；供组合或排查交互式 agent（智能体）表面的用户与维护者阅读。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/interaction/tool-ask-user/README.zh.md) |
| 预设 cordis / tool-ask-user | `@deepseek-ai/dsh-tool-ask-user` | 基于 user-questions seam 的模型侧 ask_user_question 工具；供组合或排查交互式 agent（智能体）表面的用户与维护者阅读。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/interaction/tool-ask-user/README.zh.md) |

## 06 文件、命令与终端

| 实例位置 | 插件入口 | 功能说明 | 适用范围 | 配置状态 | 依据 |
| --- | --- | --- | --- | --- | --- |
| 宿主 / subprocess | `@deepseek-ai/dsh-subprocess-local` | 子进程服务的本地宿主提供方：在宿主机器上运行由 OS 所有的受管范围与真实终端会话，并明确披露较弱的 fallback。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/subprocess/subprocess-local/README.zh.md) |
| 宿主 / bash-sandbox | `@deepseek-ai/dsh-bash-sandbox` | 面向部署方与维护者的沙箱 Bash 执行器说明，用于选择、配置或排查受限命令执行及其拒绝与升权事实。 | 通用能力；当前列入 Web 配置 | 按条件：process.platform === 'win32' | [官方包说明](../../third_party/dsh/packages/shell/bash-sandbox/README.zh.md) |
| 宿主 / pwsh-sandbox | `@deepseek-ai/dsh-pwsh-sandbox` | 面向部署方与维护者的沙箱 PowerShell 执行器说明，用于选择、配置或排查受限 PowerShell 命令执行及其拒绝事实。 | 通用能力；当前列入 Web 配置 | 按条件：process.platform !== 'win32' | [官方包说明](../../third_party/dsh/packages/shell/pwsh-sandbox/README.zh.md) |
| 宿主 / shell-env | `@deepseek-ai/dsh-shell-env` | 受管 DSH_* shell 环境，供选择、配置或扩展每次模型 shell 调用所运行环境的使用者与维护者阅读。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/shell/shell-env/README.zh.md) |
| 宿主 / tool-bash | `@deepseek-ai/dsh-tool-bash` | 面向模型的 bash 工具，供选择、配置或排查一次性命令执行、后台任务与沙箱升权的使用者与维护者阅读。 | 通用能力；当前列入 Web 配置 | 显式禁用 | [官方包说明](../../third_party/dsh/packages/shell/tool-bash/README.zh.md) |
| 宿主 / tool-pwsh | `@deepseek-ai/dsh-tool-pwsh` | 面向模型的 pwsh 工具，供选择、配置或排查 Windows 上一次性 PowerShell 执行、后台任务与沙箱升权的使用者与维护者阅读。 | 通用能力；当前列入 Web 配置 | 显式禁用 | [官方包说明](../../third_party/dsh/packages/shell/tool-pwsh/README.zh.md) |
| 宿主 / fs-observation-policy | `@deepseek-ai/dsh-fs-observation-policy` | 编辑前读取的文件系统策略插件：面向选择或排查受防护写入/编辑行为的部署方与维护者。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/fs/fs-observation-policy/README.zh.md) |
| 宿主 / tool-fs | `@deepseek-ai/dsh-tool-fs` | 面向模型的 read、read_image、write 与 edit 工具：供组合或排查 agent 文件系统访问的用户与维护者使用。 | 通用能力；当前列入 Web 配置 | 显式禁用 | [官方包说明](../../third_party/dsh/packages/fs/tool-fs/README.zh.md) |
| 宿主 / tool-fs-search | `@deepseek-ai/dsh-tool-fs-search` | 面向模型的 glob 与 grep 发现工具：供组合或排查 agent（智能体）工作区搜索的用户与维护者使用。 | 通用能力；当前列入 Web 配置 | 显式禁用 | [官方包说明](../../third_party/dsh/packages/fs/tool-fs-search/README.zh.md) |
| 宿主 / fs-sandbox | `@deepseek-ai/dsh-fs-sandbox` | 强制沙箱的 `ctx.fs` 后端：面向把模型文件变更限制在会话工作区内的部署方与维护者。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/fs/fs-sandbox/README.zh.md) |
| 预设 standard / tool-bash | `@deepseek-ai/dsh-tool-bash` | 面向模型的 bash 工具，供选择、配置或排查一次性命令执行、后台任务与沙箱升权的使用者与维护者阅读。 | 通用能力；当前列入 Web 配置 | 按条件：process.platform === 'win32' | [官方包说明](../../third_party/dsh/packages/shell/tool-bash/README.zh.md) |
| 预设 standard / tool-pwsh | `@deepseek-ai/dsh-tool-pwsh` | 面向模型的 pwsh 工具，供选择、配置或排查 Windows 上一次性 PowerShell 执行、后台任务与沙箱升权的使用者与维护者阅读。 | 通用能力；当前列入 Web 配置 | 按条件：process.platform !== 'win32' | [官方包说明](../../third_party/dsh/packages/shell/tool-pwsh/README.zh.md) |
| 预设 standard / tool-fs | `@deepseek-ai/dsh-tool-fs` | 面向模型的 read、read_image、write 与 edit 工具：供组合或排查 agent 文件系统访问的用户与维护者使用。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/fs/tool-fs/README.zh.md) |
| 预设 standard / tool-fs-search | `@deepseek-ai/dsh-tool-fs-search` | 面向模型的 glob 与 grep 发现工具：供组合或排查 agent（智能体）工作区搜索的用户与维护者使用。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/fs/tool-fs-search/README.zh.md) |
| 预设 ptc / tool-bash | `@deepseek-ai/dsh-tool-bash` | 面向模型的 bash 工具，供选择、配置或排查一次性命令执行、后台任务与沙箱升权的使用者与维护者阅读。 | 通用能力；当前列入 Web 配置 | 按条件：process.platform === 'win32' | [官方包说明](../../third_party/dsh/packages/shell/tool-bash/README.zh.md) |
| 预设 ptc / tool-pwsh | `@deepseek-ai/dsh-tool-pwsh` | 面向模型的 pwsh 工具，供选择、配置或排查 Windows 上一次性 PowerShell 执行、后台任务与沙箱升权的使用者与维护者阅读。 | 通用能力；当前列入 Web 配置 | 按条件：process.platform !== 'win32' | [官方包说明](../../third_party/dsh/packages/shell/tool-pwsh/README.zh.md) |
| 预设 ptc / tool-fs | `@deepseek-ai/dsh-tool-fs` | 面向模型的 read、read_image、write 与 edit 工具：供组合或排查 agent 文件系统访问的用户与维护者使用。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/fs/tool-fs/README.zh.md) |
| 预设 ptc / tool-fs-search | `@deepseek-ai/dsh-tool-fs-search` | 面向模型的 glob 与 grep 发现工具：供组合或排查 agent（智能体）工作区搜索的用户与维护者使用。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/fs/tool-fs-search/README.zh.md) |
| 预设 minimal/persistent-shell / pty | `@deepseek-ai/dsh-terminal` | 面向部署方与消费方的持久终端会话说明，用于选择、组合或扩展限定所有者范围的 ctx.terminals 服务。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/terminal/terminal/README.zh.md) |
| 预设 minimal/persistent-shell / terminal-bash | `@deepseek-ai/dsh-terminal-bash` | 持久终端会话的随产品交付的 shell 后端：在共享沙箱策略下启动交互式 bash 或 pwsh，带就绪检测与有界逐行输出。 | 通用能力；当前列入 Web 配置 | 按条件：process.platform === 'win32' | [官方包说明](../../third_party/dsh/packages/terminal/terminal-bash/README.zh.md) |
| 预设 minimal/persistent-shell / persistent-bash | `@deepseek-ai/dsh-tool-bash-persistent` | 面向模型的持久 bash 工具，供选择、配置或排查跨调用保留的按所有者隔离 shell 状态的使用者与维护者阅读。 | 通用能力；当前列入 Web 配置 | 按条件：process.platform === 'win32' | [官方包说明](../../third_party/dsh/packages/shell/tool-bash-persistent/README.zh.md) |
| 预设 minimal/persistent-shell / terminal-pwsh | `@deepseek-ai/dsh-terminal-bash` | 持久终端会话的随产品交付的 shell 后端：在共享沙箱策略下启动交互式 bash 或 pwsh，带就绪检测与有界逐行输出。 | 通用能力；当前列入 Web 配置 | 按条件：process.platform !== 'win32' | [官方包说明](../../third_party/dsh/packages/terminal/terminal-bash/README.zh.md) |
| 预设 minimal/persistent-shell / persistent-pwsh | `@deepseek-ai/dsh-tool-pwsh-persistent` | 面向模型的持久 pwsh 工具，供选择、配置或排查跨调用保留的按所有者隔离 PowerShell 状态的使用者与维护者阅读。 | 通用能力；当前列入 Web 配置 | 按条件：process.platform !== 'win32' | [官方包说明](../../third_party/dsh/packages/shell/tool-pwsh-persistent/README.zh.md) |
| 预设 cordis / tool-bash | `@deepseek-ai/dsh-tool-bash` | 面向模型的 bash 工具，供选择、配置或排查一次性命令执行、后台任务与沙箱升权的使用者与维护者阅读。 | 通用能力；当前列入 Web 配置 | 按条件：process.platform === 'win32' | [官方包说明](../../third_party/dsh/packages/shell/tool-bash/README.zh.md) |
| 预设 cordis / tool-pwsh | `@deepseek-ai/dsh-tool-pwsh` | 面向模型的 pwsh 工具，供选择、配置或排查 Windows 上一次性 PowerShell 执行、后台任务与沙箱升权的使用者与维护者阅读。 | 通用能力；当前列入 Web 配置 | 按条件：process.platform !== 'win32' | [官方包说明](../../third_party/dsh/packages/shell/tool-pwsh/README.zh.md) |
| 预设 cordis / tool-fs | `@deepseek-ai/dsh-tool-fs` | 面向模型的 read、read_image、write 与 edit 工具：供组合或排查 agent 文件系统访问的用户与维护者使用。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/fs/tool-fs/README.zh.md) |
| 预设 cordis / tool-fs-search | `@deepseek-ai/dsh-tool-fs-search` | 面向模型的 glob 与 grep 发现工具：供组合或排查 agent（智能体）工作区搜索的用户与维护者使用。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/fs/tool-fs-search/README.zh.md) |

## 07 指令、技能与上下文

| 实例位置 | 插件入口 | 功能说明 | 适用范围 | 配置状态 | 依据 |
| --- | --- | --- | --- | --- | --- |
| 宿主 / agent-instructions | `@deepseek-ai/dsh-agent-instructions` | 面向用户与维护者的工作区指令上下文说明，用于启用、设置预算或排查 AGENTS.md/CLAUDE.md 的加载与刷新。 | 通用能力；当前列入 Web 配置 | 显式禁用 | [官方包说明](../../third_party/dsh/packages/context/agent-instructions/README.zh.md) |
| 宿主 / skill | `@deepseek-ai/dsh-skill` | skill（技能）提供方注册表，供选择、配置或排查来自任意来源的 skill 如何被合并、解析与加载的用户与维护者阅读。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/skill/skill/README.zh.md) |
| 宿主 / skill-filesystem | `@deepseek-ai/dsh-skill-filesystem` | 本地文件系统 skill 提供方，供编写本地 skill 或配置项目、自定义与用户 skill 根目录如何被发现与监视的用户与维护者阅读。 | 通用能力；当前列入 Web 配置 | 显式禁用 | [官方包说明](../../third_party/dsh/packages/skill/skill-filesystem/README.zh.md) |
| 宿主 / skill-badge | `@deepseek-ai/dsh-skill-badge` | 随包附带的「powered by dsh」徽章 skill（技能），供启用、使用或排查该可选徽章提供方的用户与维护者阅读。 | 通用能力；当前列入 Web 配置 | 显式禁用 | [官方包说明](../../third_party/dsh/packages/skill/skill-badge/README.zh.md) |
| 宿主 / tool-skill | `@deepseek-ai/dsh-tool-skill` | 面向模型的 skill（技能）目录与加载工具，供希望了解 agent（智能体）看到的内容或配置会话 skill 目录的用户与维护者阅读。 | 通用能力；当前列入 Web 配置 | 显式禁用 | [官方包说明](../../third_party/dsh/packages/skill/tool-skill/README.zh.md) |
| 宿主 / compaction-basic | `@deepseek-ai/dsh-compaction-basic` | 面向部署场景的自动会话压缩（compaction）：用于选择、调优或排查随 token 压力上升对较早历史进行摘要的方式。 | 通用能力；当前列入 Web 配置 | 显式禁用 | [官方包说明](../../third_party/dsh/packages/compaction/compaction-basic/README.zh.md) |
| 宿主 / command-compact | `@deepseek-ai/dsh-command-compact` | 面向交互式组合的按需 /compact 命令：它做什么、你会看到什么，以及如何挂载。 | 通用能力；当前列入 Web 配置 | 显式禁用 | [官方包说明](../../third_party/dsh/packages/compaction/command-compact/README.zh.md) |
| 宿主 / spill-local | `@deepseek-ai/dsh-spill-local` | 本地文件系统 spill 后端：spill 文本如何保存到私有会话级文件，并用 read 或 grep 取回。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/spill/spill-local/README.zh.md) |
| 宿主 / spill-policy | `@deepseek-ai/dsh-spill-policy` | 工具结果保留：文字和图片共享 token 预算，并通过完整结果文件恢复省略内容。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/spill/spill-policy/README.zh.md) |
| 宿主 / tool-result-pruner | `@deepseek-ai/dsh-compaction-tool-result-pruner` | 面向组合压缩（compaction）部署场景的工具输出修剪：选择大小限制或排查超大工具结果为何被缩短。 | 通用能力；当前列入 Web 配置 | 显式禁用 | [官方包说明](../../third_party/dsh/packages/compaction/compaction-tool-result-pruner/README.zh.md) |
| 宿主 / image-offload | `@deepseek-ai/dsh-compaction-image-offload` | 面向组合 compaction 的部署的图片省略执行器说明：支持图片的路由以请求超出图片预算拒绝时会发生什么。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/compaction/compaction-image-offload/README.zh.md) |
| 宿主 / session-reference | `@deepseek-ai/dsh-session-reference` | 跨会话快照引用与持久的不受信任模型上下文，供启用或排查 ctx.sessionReferenceResolver 的用户与维护者阅读。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/context/session-reference/README.zh.md) |
| 宿主 / file-reference-local | `@deepseek-ai/dsh-file-reference-local` | 面向用户与维护者的本地工作区 @file 补全提供方，用于启用、调整规模或排查 ctx.fileReferences 的发现能力。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/context/file-reference-local/README.zh.md) |
| 预设 standard / agent-instructions | `@deepseek-ai/dsh-agent-instructions` | 面向用户与维护者的工作区指令上下文说明，用于启用、设置预算或排查 AGENTS.md/CLAUDE.md 的加载与刷新。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/context/agent-instructions/README.zh.md) |
| 预设 standard / time-context | `@deepseek-ai/dsh-time-context` | 按步骤提供时钟上下文，包含当前时间、浏览器时区与经过时长，供调优本插件的用户与维护者阅读。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/context/time-context/README.zh.md) |
| 预设 standard / skill-filesystem | `@deepseek-ai/dsh-skill-filesystem` | 本地文件系统 skill 提供方，供编写本地 skill 或配置项目、自定义与用户 skill 根目录如何被发现与监视的用户与维护者阅读。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/skill/skill-filesystem/README.zh.md) |
| 预设 standard / tool-skill | `@deepseek-ai/dsh-tool-skill` | 面向模型的 skill（技能）目录与加载工具，供希望了解 agent（智能体）看到的内容或配置会话 skill 目录的用户与维护者阅读。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/skill/tool-skill/README.zh.md) |
| 预设 standard/compaction / compaction-basic | `@deepseek-ai/dsh-compaction-basic` | 面向部署场景的自动会话压缩（compaction）：用于选择、调优或排查随 token 压力上升对较早历史进行摘要的方式。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/compaction/compaction-basic/README.zh.md) |
| 预设 standard/compaction / command-compact | `@deepseek-ai/dsh-command-compact` | 面向交互式组合的按需 /compact 命令：它做什么、你会看到什么，以及如何挂载。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/compaction/command-compact/README.zh.md) |
| 预设 standard/compaction / tool-result-pruner | `@deepseek-ai/dsh-compaction-tool-result-pruner` | 面向组合压缩（compaction）部署场景的工具输出修剪：选择大小限制或排查超大工具结果为何被缩短。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/compaction/compaction-tool-result-pruner/README.zh.md) |
| 预设 ptc / agent-instructions | `@deepseek-ai/dsh-agent-instructions` | 面向用户与维护者的工作区指令上下文说明，用于启用、设置预算或排查 AGENTS.md/CLAUDE.md 的加载与刷新。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/context/agent-instructions/README.zh.md) |
| 预设 ptc / time-context | `@deepseek-ai/dsh-time-context` | 按步骤提供时钟上下文，包含当前时间、浏览器时区与经过时长，供调优本插件的用户与维护者阅读。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/context/time-context/README.zh.md) |
| 预设 ptc / skill-filesystem | `@deepseek-ai/dsh-skill-filesystem` | 本地文件系统 skill 提供方，供编写本地 skill 或配置项目、自定义与用户 skill 根目录如何被发现与监视的用户与维护者阅读。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/skill/skill-filesystem/README.zh.md) |
| 预设 ptc / tool-skill | `@deepseek-ai/dsh-tool-skill` | 面向模型的 skill（技能）目录与加载工具，供希望了解 agent（智能体）看到的内容或配置会话 skill 目录的用户与维护者阅读。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/skill/tool-skill/README.zh.md) |
| 预设 ptc/compaction / compaction-basic | `@deepseek-ai/dsh-compaction-basic` | 面向部署场景的自动会话压缩（compaction）：用于选择、调优或排查随 token 压力上升对较早历史进行摘要的方式。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/compaction/compaction-basic/README.zh.md) |
| 预设 ptc/compaction / command-compact | `@deepseek-ai/dsh-command-compact` | 面向交互式组合的按需 /compact 命令：它做什么、你会看到什么，以及如何挂载。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/compaction/command-compact/README.zh.md) |
| 预设 ptc/compaction / tool-result-pruner | `@deepseek-ai/dsh-compaction-tool-result-pruner` | 面向组合压缩（compaction）部署场景的工具输出修剪：选择大小限制或排查超大工具结果为何被缩短。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/compaction/compaction-tool-result-pruner/README.zh.md) |
| 预设 cordis / agent-instructions | `@deepseek-ai/dsh-agent-instructions` | 面向用户与维护者的工作区指令上下文说明，用于启用、设置预算或排查 AGENTS.md/CLAUDE.md 的加载与刷新。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/context/agent-instructions/README.zh.md) |
| 预设 cordis / time-context | `@deepseek-ai/dsh-time-context` | 按步骤提供时钟上下文，包含当前时间、浏览器时区与经过时长，供调优本插件的用户与维护者阅读。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/context/time-context/README.zh.md) |
| 预设 cordis/compaction / compaction-basic | `@deepseek-ai/dsh-compaction-basic` | 面向部署场景的自动会话压缩（compaction）：用于选择、调优或排查随 token 压力上升对较早历史进行摘要的方式。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/compaction/compaction-basic/README.zh.md) |
| 预设 cordis/compaction / command-compact | `@deepseek-ai/dsh-command-compact` | 面向交互式组合的按需 /compact 命令：它做什么、你会看到什么，以及如何挂载。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/compaction/command-compact/README.zh.md) |
| 预设 cordis/compaction / tool-result-pruner | `@deepseek-ai/dsh-compaction-tool-result-pruner` | 面向组合压缩（compaction）部署场景的工具输出修剪：选择大小限制或排查超大工具结果为何被缩短。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/compaction/compaction-tool-result-pruner/README.zh.md) |
| 预设 cordis / skill-filesystem | `@deepseek-ai/dsh-skill-filesystem` | 本地文件系统 skill 提供方，供编写本地 skill 或配置项目、自定义与用户 skill 根目录如何被发现与监视的用户与维护者阅读。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/skill/skill-filesystem/README.zh.md) |
| 预设 cordis / tool-skill | `@deepseek-ai/dsh-tool-skill` | 面向模型的 skill（技能）目录与加载工具，供希望了解 agent（智能体）看到的内容或配置会话 skill 目录的用户与维护者阅读。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/skill/tool-skill/README.zh.md) |

## 08 计划、目标与调度

| 实例位置 | 插件入口 | 功能说明 | 适用范围 | 配置状态 | 依据 |
| --- | --- | --- | --- | --- | --- |
| 宿主 / goal | `@deepseek-ai/dsh-goal` | 面向选择、配置或排查同会话持久 goal 服务的用户与维护者：每会话一个持久的完成目标。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/goal/goal/README.zh.md) |
| 宿主 / goal-round-driver | `@deepseek-ai/dsh-goal-round-driver` | 面向选择、组合或排查自动 Goal Round 的用户与维护者的同会话续行驱动器说明。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/goal/goal-round-driver/README.zh.md) |
| 宿主 / command-goal | `@deepseek-ai/dsh-command-goal` | 面向在 UI 命令平面中选择、组合或排查 goal 控制的用户与维护者的 /goal 斜杠命令说明。 | 通用能力；当前列入 Web 配置 | 显式禁用 | [官方包说明](../../third_party/dsh/packages/goal/command-goal/README.zh.md) |
| 宿主 / plan-mode | `@deepseek-ai/dsh-plan-mode` | 面向用户与维护者的计划模式说明：用于选择、配置或排查带部署引导、/plan 命令与经用户评审退出的逐 agent（智能体）规划功能。 | 通用能力；当前列入 Web 配置 | 显式禁用 | [官方包说明](../../third_party/dsh/packages/plan/plan-mode/README.zh.md) |
| 宿主 / tool-todo | `@deepseek-ai/dsh-tool-todo` | 面向 DeepSeek Harness 会话日志的模型侧 todo_write 工具：整表替换、单一会话归属与 todos 投影，供选择、配置或排查该工具的用户与维护者阅读。 | 通用能力；当前列入 Web 配置 | 显式禁用 | [官方包说明](../../third_party/dsh/packages/todo/tool-todo/README.zh.md) |
| 宿主 / tool-goal | `@deepseek-ai/dsh-tool-goal` | 面向选择、组合或排查 get_goal、create_goal 与 update_goal 的用户与维护者的模型侧 goal 工具说明。 | 通用能力；当前列入 Web 配置 | 显式禁用 | [官方包说明](../../third_party/dsh/packages/goal/tool-goal/README.zh.md) |
| 宿主 / schedule | `@deepseek-ai/dsh-schedule` | 宿主级持久提醒与按会话绑定的共享任务管理。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/schedule/schedule/README.zh.md) |
| 预设 standard / tool-schedule | `@deepseek-ai/dsh-tool-schedule` | 预设作用域的提醒管理工具（schedule_create、schedule_list、schedule_update、schedule_delete），基于宿主 ctx.schedule 服务，供选择哪些 agent 可以维护持久提醒的部署使用。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/schedule/tool-schedule/README.zh.md) |
| 预设 standard / command-goal | `@deepseek-ai/dsh-command-goal` | 面向在 UI 命令平面中选择、组合或排查 goal 控制的用户与维护者的 /goal 斜杠命令说明。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/goal/command-goal/README.zh.md) |
| 预设 standard / tool-goal | `@deepseek-ai/dsh-tool-goal` | 面向选择、组合或排查 get_goal、create_goal 与 update_goal 的用户与维护者的模型侧 goal 工具说明。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/goal/tool-goal/README.zh.md) |
| 预设 standard/planning / plan-mode | `@deepseek-ai/dsh-plan-mode` | 面向用户与维护者的计划模式说明：用于选择、配置或排查带部署引导、/plan 命令与经用户评审退出的逐 agent（智能体）规划功能。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/plan/plan-mode/README.zh.md) |
| 预设 standard / tool-todo | `@deepseek-ai/dsh-tool-todo` | 面向 DeepSeek Harness 会话日志的模型侧 todo_write 工具：整表替换、单一会话归属与 todos 投影，供选择、配置或排查该工具的用户与维护者阅读。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/todo/tool-todo/README.zh.md) |
| 预设 ptc / tool-schedule | `@deepseek-ai/dsh-tool-schedule` | 预设作用域的提醒管理工具（schedule_create、schedule_list、schedule_update、schedule_delete），基于宿主 ctx.schedule 服务，供选择哪些 agent 可以维护持久提醒的部署使用。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/schedule/tool-schedule/README.zh.md) |
| 预设 ptc / command-goal | `@deepseek-ai/dsh-command-goal` | 面向在 UI 命令平面中选择、组合或排查 goal 控制的用户与维护者的 /goal 斜杠命令说明。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/goal/command-goal/README.zh.md) |
| 预设 ptc / tool-goal | `@deepseek-ai/dsh-tool-goal` | 面向选择、组合或排查 get_goal、create_goal 与 update_goal 的用户与维护者的模型侧 goal 工具说明。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/goal/tool-goal/README.zh.md) |
| 预设 ptc/planning / plan-mode | `@deepseek-ai/dsh-plan-mode` | 面向用户与维护者的计划模式说明：用于选择、配置或排查带部署引导、/plan 命令与经用户评审退出的逐 agent（智能体）规划功能。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/plan/plan-mode/README.zh.md) |
| 预设 ptc / tool-todo | `@deepseek-ai/dsh-tool-todo` | 面向 DeepSeek Harness 会话日志的模型侧 todo_write 工具：整表替换、单一会话归属与 todos 投影，供选择、配置或排查该工具的用户与维护者阅读。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/todo/tool-todo/README.zh.md) |
| 预设 cordis / tool-schedule | `@deepseek-ai/dsh-tool-schedule` | 预设作用域的提醒管理工具（schedule_create、schedule_list、schedule_update、schedule_delete），基于宿主 ctx.schedule 服务，供选择哪些 agent 可以维护持久提醒的部署使用。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/schedule/tool-schedule/README.zh.md) |
| 预设 cordis / command-goal | `@deepseek-ai/dsh-command-goal` | 面向在 UI 命令平面中选择、组合或排查 goal 控制的用户与维护者的 /goal 斜杠命令说明。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/goal/command-goal/README.zh.md) |
| 预设 cordis / tool-goal | `@deepseek-ai/dsh-tool-goal` | 面向选择、组合或排查 get_goal、create_goal 与 update_goal 的用户与维护者的模型侧 goal 工具说明。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/goal/tool-goal/README.zh.md) |
| 预设 cordis/planning / plan-mode | `@deepseek-ai/dsh-plan-mode` | 面向用户与维护者的计划模式说明：用于选择、配置或排查带部署引导、/plan 命令与经用户评审退出的逐 agent（智能体）规划功能。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/plan/plan-mode/README.zh.md) |
| 预设 cordis / tool-todo | `@deepseek-ai/dsh-tool-todo` | 面向 DeepSeek Harness 会话日志的模型侧 todo_write 工具：整表替换、单一会话归属与 todos 投影，供选择、配置或排查该工具的用户与维护者阅读。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/todo/tool-todo/README.zh.md) |

## 09 子 Agent、任务与工作流

| 实例位置 | 插件入口 | 功能说明 | 适用范围 | 配置状态 | 依据 |
| --- | --- | --- | --- | --- | --- |
| 宿主 / jobs | `@deepseek-ai/dsh-jobs-local` | 进程本地后台任务注册表，供组合、容量评估或排查进程内任务的用户与维护者阅读：按所有者的准入、生命周期与销毁。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/jobs/jobs-local/README.zh.md) |
| 宿主 / tool-jobs | `@deepseek-ai/dsh-tool-jobs` | 面向模型的后台任务控制，供选择、配置或排查 job_output、job_list、job_kill 与完成通知的用户与维护者阅读。 | 通用能力；当前列入 Web 配置 | 显式禁用 | [官方包说明](../../third_party/dsh/packages/jobs/tool-jobs/README.zh.md) |
| 宿主 / subagent | `@deepseek-ai/dsh-subagent` | 面向用户与维护者的 subagent 委派 seam，用于选择提供方后端、组装委派工具或排查子 agent（智能体）运行问题。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/subagent/subagent/README.zh.md) |
| 宿主 / subagent-spawn-in-process | `@deepseek-ai/dsh-subagent-spawn-in-process` | 面向用户与维护者的进程内 spawn subagent 后端说明，用于选择、配置或排查全新子级委派。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/subagent/subagent-spawn-in-process/README.zh.md) |
| 宿主 / subagent-fork-in-process | `@deepseek-ai/dsh-subagent-fork-in-process` | 面向用户与维护者的进程内 fork subagent 后端说明，用于选择、配置或排查以父级已完成轮次作初始内容的子 agent（智能体）。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/subagent/subagent-fork-in-process/README.zh.md) |
| 宿主 / tool-subagent-control | `@deepseek-ai/dsh-tool-subagent-control` | 供用户与维护者在组合或调试可继续子级控制功能时使用的全局 send_message、interrupt_agent 与 list_agents 工具。 | 通用能力；当前列入 Web 配置 | 显式禁用 | [官方包说明](../../third_party/dsh/packages/subagent/tool-subagent-control/README.zh.md) |
| 宿主 / tool-subagent-list-agents | `@deepseek-ai/dsh-tool-subagent-control/list-agents` | 供用户与维护者在组合或调试可继续子级控制功能时使用的全局 send_message、interrupt_agent 与 list_agents 工具。 | 通用能力；当前列入 Web 配置 | 显式禁用 | [官方包说明](../../third_party/dsh/packages/subagent/tool-subagent-control/README.zh.md) |
| 宿主 / tool-subagent | `@deepseek-ai/dsh-tool-subagent` | 面向模型的 subagent 委派工具，供用户与维护者配置、组合或排查基于 subagent 提供方的委派。 | 通用能力；当前列入 Web 配置 | 显式禁用 | [官方包说明](../../third_party/dsh/packages/subagent/tool-subagent/README.zh.md) |
| 宿主 / tool-subagent-fork | `@deepseek-ai/dsh-tool-subagent` | 面向模型的 subagent 委派工具，供用户与维护者配置、组合或排查基于 subagent 提供方的委派。 | 通用能力；当前列入 Web 配置 | 显式禁用 | [官方包说明](../../third_party/dsh/packages/subagent/tool-subagent/README.zh.md) |
| 宿主 / ptc-runtime | `@deepseek-ai/dsh-ptc-runtime-node` | 在全新 Node 进程中运行 TypeScript 程序，使用会话文件系统沙箱、受管清理以及可配置的执行与输出限制。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/ptc-runtime/ptc-runtime-node/README.zh.md) |
| 宿主 / workflow-ptc | `@deepseek-ai/dsh-workflow-ptc` | 通过共享的沙箱化 PTC Node 进程运行时执行工作流编排，保留工作流钩子、subagent 路由和调用方拥有的取消能力。 | 通用能力；当前列入 Web 配置 | 显式禁用 | [官方包说明](../../third_party/dsh/packages/workflow/workflow-ptc/README.zh.md) |
| 宿主 / tool-workflow | `@deepseek-ai/dsh-tool-workflow` | 面向模型的工作流工具：运行扇出 subagent 的 JavaScript 编排脚本，供选择或配置模型驱动编排的用户与维护者阅读。 | 通用能力；当前列入 Web 配置 | 显式禁用 | [官方包说明](../../third_party/dsh/packages/workflow/tool-workflow/README.zh.md) |
| 宿主 / timeout-policy | `@deepseek-ai/dsh-tool-call-timeout-policy` | 为配合取消的工具调用设置协作式时间上限，并在超时流程完成后映射为清晰的模型错误，供选择或排查此插件的用户与维护者阅读。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/guard/timeout-policy/README.zh.md) |
| 宿主 / tool-ralph | `@deepseek-ai/dsh-tool-ralph` | 面向模型的 ralph 工具：固定前台 agent loop（智能体循环），让全新 agent 围绕一个不可变目标迭代，供选择或配置此类迭代的用户与维护者阅读。 | 通用能力；当前列入 Web 配置 | 显式禁用 | [官方包说明](../../third_party/dsh/packages/workflow/tool-ralph/README.zh.md) |
| 宿主 / repeat-tool-reminder | `@deepseek-ai/dsh-repeat-tool-reminder` | 建议性循环卫生 guard：当 agent（智能体）重复完全相同的工具调用时提醒模型，供选择、配置或排查此插件的用户与维护者阅读。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/guard/repeat-tool-reminder/README.zh.md) |
| 宿主 / subagent-model-selection-settings | `@deepseek-ai/dsh-tool-subagent/model-selection-settings` | 面向模型的 subagent 委派工具，供用户与维护者配置、组合或排查基于 subagent 提供方的委派。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/subagent/tool-subagent/README.zh.md) |
| 预设 standard / tool-jobs | `@deepseek-ai/dsh-tool-jobs` | 面向模型的后台任务控制，供选择、配置或排查 job_output、job_list、job_kill 与完成通知的用户与维护者阅读。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/jobs/tool-jobs/README.zh.md) |
| 预设 standard/delegation / tool-subagent-control | `@deepseek-ai/dsh-tool-subagent-control` | 供用户与维护者在组合或调试可继续子级控制功能时使用的全局 send_message、interrupt_agent 与 list_agents 工具。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/subagent/tool-subagent-control/README.zh.md) |
| 预设 standard/delegation / tool-subagent-list-agents | `@deepseek-ai/dsh-tool-subagent-control/list-agents` | 供用户与维护者在组合或调试可继续子级控制功能时使用的全局 send_message、interrupt_agent 与 list_agents 工具。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/subagent/tool-subagent-control/README.zh.md) |
| 预设 standard/delegation / tool-subagent | `@deepseek-ai/dsh-tool-subagent` | 面向模型的 subagent 委派工具，供用户与维护者配置、组合或排查基于 subagent 提供方的委派。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/subagent/tool-subagent/README.zh.md) |
| 预设 standard/delegation / tool-subagent-fork | `@deepseek-ai/dsh-tool-subagent` | 面向模型的 subagent 委派工具，供用户与维护者配置、组合或排查基于 subagent 提供方的委派。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/subagent/tool-subagent/README.zh.md) |
| 预设 standard/delegation / tool-subagent-codex | `@deepseek-ai/dsh-tool-subagent` | 面向模型的 subagent 委派工具，供用户与维护者配置、组合或排查基于 subagent 提供方的委派。 | 通用能力；当前列入 Web 配置 | 显式禁用 | [官方包说明](../../third_party/dsh/packages/subagent/tool-subagent/README.zh.md) |
| 预设 standard/delegation / tool-subagent-claude-code | `@deepseek-ai/dsh-tool-subagent` | 面向模型的 subagent 委派工具，供用户与维护者配置、组合或排查基于 subagent 提供方的委派。 | 通用能力；当前列入 Web 配置 | 显式禁用 | [官方包说明](../../third_party/dsh/packages/subagent/tool-subagent/README.zh.md) |
| 预设 standard/delegation / workflow-ptc | `@deepseek-ai/dsh-workflow-ptc` | 通过共享的沙箱化 PTC Node 进程运行时执行工作流编排，保留工作流钩子、subagent 路由和调用方拥有的取消能力。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/workflow/workflow-ptc/README.zh.md) |
| 预设 standard/delegation / tool-workflow | `@deepseek-ai/dsh-tool-workflow` | 面向模型的工作流工具：运行扇出 subagent 的 JavaScript 编排脚本，供选择或配置模型驱动编排的用户与维护者阅读。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/workflow/tool-workflow/README.zh.md) |
| 预设 standard/delegation / tool-ralph | `@deepseek-ai/dsh-tool-ralph` | 面向模型的 ralph 工具：固定前台 agent loop（智能体循环），让全新 agent 围绕一个不可变目标迭代，供选择或配置此类迭代的用户与维护者阅读。 | 通用能力；当前列入 Web 配置 | 显式禁用 | [官方包说明](../../third_party/dsh/packages/workflow/tool-ralph/README.zh.md) |
| 预设 ptc / tool-jobs | `@deepseek-ai/dsh-tool-jobs` | 面向模型的后台任务控制，供选择、配置或排查 job_output、job_list、job_kill 与完成通知的用户与维护者阅读。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/jobs/tool-jobs/README.zh.md) |
| 预设 ptc/delegation / tool-subagent-control | `@deepseek-ai/dsh-tool-subagent-control` | 供用户与维护者在组合或调试可继续子级控制功能时使用的全局 send_message、interrupt_agent 与 list_agents 工具。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/subagent/tool-subagent-control/README.zh.md) |
| 预设 ptc/delegation / tool-subagent-list-agents | `@deepseek-ai/dsh-tool-subagent-control/list-agents` | 供用户与维护者在组合或调试可继续子级控制功能时使用的全局 send_message、interrupt_agent 与 list_agents 工具。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/subagent/tool-subagent-control/README.zh.md) |
| 预设 ptc/delegation / tool-subagent | `@deepseek-ai/dsh-tool-subagent` | 面向模型的 subagent 委派工具，供用户与维护者配置、组合或排查基于 subagent 提供方的委派。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/subagent/tool-subagent/README.zh.md) |
| 预设 ptc/delegation / tool-subagent-fork | `@deepseek-ai/dsh-tool-subagent` | 面向模型的 subagent 委派工具，供用户与维护者配置、组合或排查基于 subagent 提供方的委派。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/subagent/tool-subagent/README.zh.md) |
| 预设 ptc/delegation / tool-subagent-codex | `@deepseek-ai/dsh-tool-subagent` | 面向模型的 subagent 委派工具，供用户与维护者配置、组合或排查基于 subagent 提供方的委派。 | 通用能力；当前列入 Web 配置 | 显式禁用 | [官方包说明](../../third_party/dsh/packages/subagent/tool-subagent/README.zh.md) |
| 预设 ptc/delegation / tool-subagent-claude-code | `@deepseek-ai/dsh-tool-subagent` | 面向模型的 subagent 委派工具，供用户与维护者配置、组合或排查基于 subagent 提供方的委派。 | 通用能力；当前列入 Web 配置 | 显式禁用 | [官方包说明](../../third_party/dsh/packages/subagent/tool-subagent/README.zh.md) |
| 预设 ptc/delegation / workflow-ptc | `@deepseek-ai/dsh-workflow-ptc` | 通过共享的沙箱化 PTC Node 进程运行时执行工作流编排，保留工作流钩子、subagent 路由和调用方拥有的取消能力。 | 通用能力；当前列入 Web 配置 | 显式禁用 | [官方包说明](../../third_party/dsh/packages/workflow/workflow-ptc/README.zh.md) |
| 预设 ptc/delegation / tool-workflow | `@deepseek-ai/dsh-tool-workflow` | 面向模型的工作流工具：运行扇出 subagent 的 JavaScript 编排脚本，供选择或配置模型驱动编排的用户与维护者阅读。 | 通用能力；当前列入 Web 配置 | 显式禁用 | [官方包说明](../../third_party/dsh/packages/workflow/tool-workflow/README.zh.md) |
| 预设 ptc/delegation / tool-ralph | `@deepseek-ai/dsh-tool-ralph` | 面向模型的 ralph 工具：固定前台 agent loop（智能体循环），让全新 agent 围绕一个不可变目标迭代，供选择或配置此类迭代的用户与维护者阅读。 | 通用能力；当前列入 Web 配置 | 显式禁用 | [官方包说明](../../third_party/dsh/packages/workflow/tool-ralph/README.zh.md) |
| 预设 cordis / tool-jobs | `@deepseek-ai/dsh-tool-jobs` | 面向模型的后台任务控制，供选择、配置或排查 job_output、job_list、job_kill 与完成通知的用户与维护者阅读。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/jobs/tool-jobs/README.zh.md) |
| 预设 cordis/delegation / tool-subagent-control | `@deepseek-ai/dsh-tool-subagent-control` | 供用户与维护者在组合或调试可继续子级控制功能时使用的全局 send_message、interrupt_agent 与 list_agents 工具。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/subagent/tool-subagent-control/README.zh.md) |
| 预设 cordis/delegation / tool-subagent-list-agents | `@deepseek-ai/dsh-tool-subagent-control/list-agents` | 供用户与维护者在组合或调试可继续子级控制功能时使用的全局 send_message、interrupt_agent 与 list_agents 工具。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/subagent/tool-subagent-control/README.zh.md) |
| 预设 cordis/delegation / tool-subagent | `@deepseek-ai/dsh-tool-subagent` | 面向模型的 subagent 委派工具，供用户与维护者配置、组合或排查基于 subagent 提供方的委派。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/subagent/tool-subagent/README.zh.md) |
| 预设 cordis/delegation / tool-subagent-fork | `@deepseek-ai/dsh-tool-subagent` | 面向模型的 subagent 委派工具，供用户与维护者配置、组合或排查基于 subagent 提供方的委派。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/subagent/tool-subagent/README.zh.md) |
| 预设 cordis/delegation / tool-subagent-codex | `@deepseek-ai/dsh-tool-subagent` | 面向模型的 subagent 委派工具，供用户与维护者配置、组合或排查基于 subagent 提供方的委派。 | 通用能力；当前列入 Web 配置 | 显式禁用 | [官方包说明](../../third_party/dsh/packages/subagent/tool-subagent/README.zh.md) |
| 预设 cordis/delegation / tool-subagent-claude-code | `@deepseek-ai/dsh-tool-subagent` | 面向模型的 subagent 委派工具，供用户与维护者配置、组合或排查基于 subagent 提供方的委派。 | 通用能力；当前列入 Web 配置 | 显式禁用 | [官方包说明](../../third_party/dsh/packages/subagent/tool-subagent/README.zh.md) |
| 预设 cordis/delegation / workflow-ptc | `@deepseek-ai/dsh-workflow-ptc` | 通过共享的沙箱化 PTC Node 进程运行时执行工作流编排，保留工作流钩子、subagent 路由和调用方拥有的取消能力。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/workflow/workflow-ptc/README.zh.md) |
| 预设 cordis/delegation / tool-workflow | `@deepseek-ai/dsh-tool-workflow` | 面向模型的工作流工具：运行扇出 subagent 的 JavaScript 编排脚本，供选择或配置模型驱动编排的用户与维护者阅读。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/workflow/tool-workflow/README.zh.md) |
| 预设 cordis/delegation / tool-ralph | `@deepseek-ai/dsh-tool-ralph` | 面向模型的 ralph 工具：固定前台 agent loop（智能体循环），让全新 agent 围绕一个不可变目标迭代，供选择或配置此类迭代的用户与维护者阅读。 | 通用能力；当前列入 Web 配置 | 显式禁用 | [官方包说明](../../third_party/dsh/packages/workflow/tool-ralph/README.zh.md) |

## 10 联网与外部工具

| 实例位置 | 插件入口 | 功能说明 | 适用范围 | 配置状态 | 依据 |
| --- | --- | --- | --- | --- | --- |
| 宿主 / web | `@deepseek-ai/dsh-web` | web 访问服务（ctx.web）：部署方与插件作者如何通过可互换的提供方搜索 web 与抓取 URL，以及统一的选择策略与错误词汇。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/web/web/README.zh.md) |
| 宿主 / web-search-deepseek | `@deepseek-ai/dsh-web-search-deepseek` | ctx.web 的 DeepSeek 搜索提供方：部署方如何通过 Anthropic 兼容 Messages API 挂载 DeepSeek 原生 web 搜索，并逐次解析凭据。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/web/web-search-deepseek/README.zh.md) |
| 宿主 / web-fetch-http | `@deepseek-ai/dsh-web-fetch-http` | ctx.web 的匿名公共 HTTP(S) 抓取后端：部署方如何挂载有界、安全的 URL 抓取，含同源重定向与仅文本解码。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/web/web-fetch-http/README.zh.md) |
| 宿主 / tool-web | `@deepseek-ai/dsh-tool-web` | 构建于 ctx.web 之上的面向模型 web 工具（web_search、web_fetch）：部署方如何启用、配置并观察模型看到的搜索与抓取工具。 | 通用能力；当前列入 Web 配置 | 显式禁用 | [官方包说明](../../third_party/dsh/packages/web/tool-web/README.zh.md) |
| 宿主 / mcp-resources | `@deepseek-ai/dsh-mcp-resources` | 通过共享工具、显式服务器选择和 agent 作用域访问，按需发现与读取 MCP 资源。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/mcp/mcp-resources/README.zh.md) |
| 预设 standard / tool-web | `@deepseek-ai/dsh-tool-web` | 构建于 ctx.web 之上的面向模型 web 工具（web_search、web_fetch）：部署方如何启用、配置并观察模型看到的搜索与抓取工具。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/web/tool-web/README.zh.md) |
| 预设 ptc / tool-web | `@deepseek-ai/dsh-tool-web` | 构建于 ctx.web 之上的面向模型 web 工具（web_search、web_fetch）：部署方如何启用、配置并观察模型看到的搜索与抓取工具。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/web/tool-web/README.zh.md) |
| 预设 cordis / tool-web | `@deepseek-ai/dsh-tool-web` | 构建于 ctx.web 之上的面向模型 web 工具（web_search、web_fetch）：部署方如何启用、配置并观察模型看到的搜索与抓取工具。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/web/tool-web/README.zh.md) |

## 11 插件开发与运行时查询

| 实例位置 | 插件入口 | 功能说明 | 适用范围 | 配置状态 | 依据 |
| --- | --- | --- | --- | --- | --- |
| 宿主 / cordis-host-runner | `@deepseek-ai/dsh-cordis-host-runner` | 动态 Cordis 包的 host 半说明，供选择、组合或排查注册表、沙箱与运行往返的 agent（智能体）与维护者阅读。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/extensions/cordis-host-runner/README.zh.md) |
| 宿主 / cordis-inspect-providers | `@deepseek-ai/dsh-tool-cordis/host` | 为开发和配置已安装 Harness 插件的 agent 提供只读运行时 API 查询。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/extensions/tool-cordis/README.zh.md) |
| 宿主 / cordis-client-runner | `@deepseek-ai/dsh-cordis-client-runner` | 动态 Cordis 包的浏览器半说明，供选择、组合或排查页面如何应答运行请求并装载浏览器半代码的用户与维护者阅读。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/extensions/cordis-client-runner/README.zh.md) |
| 宿主 / ui-cordis | `@deepseek-ai/dsh-client-ui-cordis` | 历史 Cordis 卡片及进程内 runner 定义的控件。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/extensions/ui-cordis/README.zh.md) |
| 预设 cordis / tool-cordis | `@deepseek-ai/dsh-tool-cordis` | 为开发和配置已安装 Harness 插件的 agent 提供只读运行时 API 查询。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/extensions/tool-cordis/README.zh.md) |

## 12 GUI/API 通信

| 实例位置 | 插件入口 | 功能说明 | 适用范围 | 配置状态 | 依据 |
| --- | --- | --- | --- | --- | --- |
| 宿主 / typert | `@deepseek-ai/dsh-typert-registry` | 运行时 Typert 注册表：保存生成的包反射、惰性 Zod schema factory 与 Remote 调用描述符，并按需为消费方解析。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/typert/registry/README.zh.md) |
| 宿主 / typert-loader | `@deepseek-ai/dsh-typert-loader` | 生成的 Typert 产物所用的 Loader 集成：已挂载的包如何自动把宿主侧反射与 schema 贡献给运行时注册表。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/typert/loader/README.zh.md) |
| 宿主 / typert-gateway | `@deepseek-ai/dsh-api-gateway` | 带类型的 Client 到 Host 调用与流：分派、校验、取消、重连与转发的 Host 事件。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/api/gateway/README.zh.md) |
| 宿主 / session-controller | `@deepseek-ai/dsh-api-session-controller` | Host 与 Client 会话控制：创建、恢复、提示、跟随历史并投影实时会话状态。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/api/session-controller/README.zh.md) |
| 宿主 / job-controller | `@deepseek-ai/dsh-api-job-controller` | Host 与 Client 的 job 控制：把一个会话看得到的名册与一个 job 的保留输出镜像到浏览器，不触碰模型的消耗型游标，并代人类停止一个 job。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/api/job-controller/README.zh.md) |
| 宿主 / terminal-controller | `@deepseek-ai/dsh-api-terminal-controller` | 用户交互式终端：执行环境默认 shell、有界屏幕恢复和类型化 Remote 控制。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/api/terminal-controller/README.zh.md) |
| 宿主 / workspace-files | `@deepseek-ai/dsh-api-workspace-files` | 面向 Web GUI 的工作区文件服务：有界文件读取、按目标监听文件系统变化，以及 Session 工作区根内的目录列举。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/api/workspace-files/README.zh.md) |
| 宿主 / account-controller | `@deepseek-ai/dsh-api-account-controller` | 账号页面使用经过认证的 Remote 操作和快照流。控制器提供登录状态，不返回 token 或 PKCE 私密数据。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/api/account-controller/README.zh.md) |
| 宿主 / settings-controller | `@deepseek-ai/dsh-api-settings-controller` | settings 与凭据配置界面的 Host Remote owner，涵盖脱敏读取、写入、凭据引用与原生文档打开。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/api/settings-controller/README.zh.md) |
| 宿主 / workspace-controller | `@deepseek-ai/dsh-api-workspace-controller` | Host 与 Client 工作区控制：修改工作区导航并跟随其完整投影。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/api/workspace-controller/README.zh.md) |
| 宿主 / api-remotes | `@deepseek-ai/dsh-api-remotes` | 应用 Remote 装配：为 Client 消费方选择带类型的 Host 能力与转发事件。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/api/remotes/README.zh.md) |

## 13 GUI 界面与功能面板

| 实例位置 | 插件入口 | 功能说明 | 适用范围 | 配置状态 | 依据 |
| --- | --- | --- | --- | --- | --- |
| 宿主 / product-analytics | `@deepseek-ai/dsh-client-product-analytics` | 配置桌面端产品埋点、身份字段和事件时机，不采集 Web 使用情况。 | Desktop 条件项；kmh-web 中禁用 | 按条件：ctx.get('profileContext')?.name !== 'desktop' | [官方包说明](../../third_party/dsh/packages/client/product-analytics/README.zh.md) |
| 宿主 / ui-open-in-app | `@deepseek-ai/dsh-client-ui-open-in-app` | Web "Open In..." 控件：会话头部在记住的应用中打开 workspace 目录的分体按钮，以及文档预览里用默认应用打开、显示单个文件位置的控件。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/client/ui-open-in-app/README.zh.md) |
| 宿主 / ui-settings-account | `@deepseek-ai/dsh-client-ui-settings-account` | 设置中的账号页面显示 DeepSeek 登录状态，并提供浏览器授权和取消；侧边栏账号菜单提供 Platform 退出登录。默认仅 Desktop 启用，配置 activateInWebBrowser 后普通 Web 浏览器同样启用。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用；kmh-web 设 activateInWebBrowser: true | [官方包说明](../../third_party/dsh/packages/client/ui-settings-account/README.zh.md) |
| 宿主 / client-hmr | `@deepseek-ai/dsh-client-hmr` | Web 客户端插件的动态图同步与开发时 bundle 重载。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/client/hmr/README.zh.md) |
| 宿主 / modules | `@deepseek-ai/dsh-client-modules` | 面向用户与维护者的 web GUI 客户端模块系统说明：宿主侧组合启动图并提供插件 bundle，浏览器侧按需加载，用于组合或排查客户端插件。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/client/modules/README.zh.md) |
| 宿主 / connection | `@deepseek-ai/dsh-client-connection` | Web GUI 的浏览器与 Host 之间的协议层：Remote RPC、带重连的事件流投递、精确 Fetch 路由、/api HTTP 桥与浏览器信任栅栏。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/client/connection/README.zh.md) |
| 宿主 / file-upload | `@deepseek-ai/dsh-client-file-upload` | 按 Session 寻址上传浏览器文件，提供流式接收、进度、取消和供后续 prompt 使用的暂存凭证。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/client/file-upload/README.zh.md) |
| 宿主 / ui-theme | `@deepseek-ai/dsh-client-ui-theme` | dsh Web 客户端的主题与正文字号设置：--dsw-* token 样式表、ThemeRuntime 状态、「通用」设置行与插件前引导。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/client/ui-theme/README.zh.md) |
| 宿主 / locale | `@deepseek-ai/dsh-client-locale` | 面向用户与插件作者的 web GUI 本地化说明：zh/en 偏好、浏览器派生回退、类型化命名空间字典与框架翻译席位。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/client/locale/README.zh.md) |
| 宿主 / shortcuts | `@deepseek-ai/dsh-client-shortcuts` | 为每台设备自定义应用键盘命令 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/client/shortcuts/README.zh.md) |
| 宿主 / ui-shortcuts | `@deepseek-ai/dsh-client-ui-shortcuts` | 查看当前窗口可用的命令，按操作名称、英文别名或键位搜索 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/client/ui-shortcuts/README.zh.md) |
| 宿主 / ui-layout | `@deepseek-ai/dsh-client-ui-layout` | Web GUI 的外壳布局：三栏 AppFrame（右栏作为贴边面板的轨道）、面板几何服务与主题呈现；供窗口外壳的使用者与维护者阅读。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/client/ui-layout/README.zh.md) |
| 宿主 / ui-renderer | `@deepseek-ai/dsh-client-ui-renderer` | 浏览器 UI 渲染器：普通 Slot 与可复用 Component Factory 的 React 绑定、ctx.uiRenderer 与组装后的 dsh Web 应用根。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/client/ui-renderer/README.zh.md) |
| 宿主 / ui-session | `@deepseek-ai/dsh-client-ui-session` | 面向 Session Controller 列表、交互状态与逐会话上下文的 React 与 Slot 适配器。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/client/ui-session/README.zh.md) |
| 宿主 / resources | `@deepseek-ai/dsh-client-resources` | 客户端资源模型：按协议注册的提供方把 URL 地址解析为实时值，任何 slot 组件都通过 useResource 标准钩子读取。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/client/resources/README.zh.md) |
| 宿主 / ui-sidebar | `@deepseek-ai/dsh-client-ui-sidebar` | dsh Web 客户端的侧边栏外壳插件：品牌行、New Session 操作、折叠控件、可感知滚动的区域席位与底部固定的 Settings 席位。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/client/ui-sidebar/README.zh.md) |
| 宿主 / ui-sidebar-right | `@deepseek-ai/dsh-client-ui-sidebar-right` | dsh Web 客户端的右侧 Sidebar：每会话一个停靠面、两种呈现形态、导航控制器 ctx.sidebarRight、tab 类型注册表 ctx.sidebarRightTabs 与 Tab 域。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/client/ui-sidebar-right/README.zh.md) |
| 宿主 / ui-sidebar-documentpreview | `@deepseek-ai/dsh-client-ui-sidebar-documentpreview` | 右侧 Sidebar 的文档预览：共享文件加载与控件，可选 Markdown、代码、图片、PDF、Office 和 HTML 渲染器，并以纯文本兜底。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/client/ui-sidebar-documentpreview/README.zh.md) |
| 宿主 / ui-sidebar-browser | `@deepseek-ai/dsh-client-ui-sidebar-browser` | 右侧 Sidebar 浏览器 tab：在 sandbox 中访问 HTTP(S) 页面，包括 loopback 服务。 | Desktop 条件项；kmh-web 中禁用 | 按条件：ctx.get('profileContext')?.name !== 'desktop' | [官方包说明](../../third_party/dsh/packages/client/ui-sidebar-browser/README.zh.md) |
| 宿主 / ui-sidebar-terminal | `@deepseek-ai/dsh-client-ui-sidebar-terminal` | 在 Web 右侧栏打开、恢复和控制交互式 shell 标签页。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/client/ui-sidebar-terminal/README.zh.md) |
| 宿主 / ui-sidebar-files | `@deepseek-ai/dsh-client-ui-sidebar-files` | dsh Web 客户端右侧 Sidebar 的文件树 tab 类型：通过网络逐层列出会话工作区根目录，按资源地址把文件打开到 Sidebar。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/client/ui-sidebar-files/README.zh.md) |
| 宿主 / ui-settings | `@deepseek-ai/dsh-client-ui-settings` | 设置领域底座插件：共享配置表单、schema 服务，以及 dsh Web 客户端的规范设置 slot 类型约定。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/client/ui-settings/README.zh.md) |
| 宿主 / ui-settings-general | `@deepseek-ai/dsh-client-ui-settings-general` | dsh Web 客户端的设置外壳、无特定功能归属文案与持久化产品引导命名空间：「通用」分区、触发控件界面框架与引导账本投影。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/client/ui-settings-general/README.zh.md) |
| 宿主 / ui-settings-models | `@deepseek-ai/dsh-client-ui-settings-models` | dsh Web 客户端的模型设置与产品引导插件：提供商行、API 密钥管理、模型列表与 DeepSeek 首次运行弹窗。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/client/ui-settings-models/README.zh.md) |
| 宿主 / ui-plugin-manager | `@deepseek-ai/dsh-client-ui-plugin-manager` | 从 Web 侧栏管理 profile 的插件组合包、它们的行，以及插件的配置。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/client/ui-plugin-manager/README.zh.md) |
| 宿主 / ui-settings-plugin-inventory | `@deepseek-ai/dsh-client-ui-settings-plugin-inventory` | dsh Web 客户端设置中按作用域分组的只读插件清单标签页：Agent 预设组合在前，全局平面收在折叠分组里，搜索跨两组。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/client/ui-settings-plugin-inventory/README.zh.md) |
| 宿主 / ui-conversation | `@deepseek-ai/dsh-client-ui-conversation` | Target-neutral 对话装配与浏览器 shell：事件和视图注册表、逐会话 binding、输入状态、slot 与临时 composer takeover。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/client/ui-conversation/README.zh.md) |
| 宿主 / ui-approval | `@deepseek-ai/dsh-client-ui-approval` | 通过作用域交互路径响应 Host 权限请求的浏览器批准界面。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/client/ui-approval/README.zh.md) |
| 宿主 / ui-chat | `@deepseek-ai/dsh-client-ui-chat` | 渲染会话对话节点、历史图片、操作、本地化和滚动状态的浏览器 Chat target。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/client/ui-chat/README.zh.md) |
| 宿主 / ui-brand-official | `@deepseek-ai/dsh-client-ui-brand-official` | 面向侧栏的官方 DeepSeek Harness 品牌填充，仅在官方构建中生效；供选择或替换品牌呈现的用户与维护者阅读。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/client/ui-brand-official/README.zh.md) |
| 宿主 / ui-attachment | `@deepseek-ai/dsh-client-ui-attachment` | 对话 UI 的附件呈现：混合草稿附件栏、文档拖放目标、历史图片画廊与原图灯箱；供 Web 附件体验的用户与维护者阅读。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/client/ui-attachment/README.zh.md) |
| 宿主 / ui-tool | `@deepseek-ai/dsh-client-ui-tool` | dsh Web 客户端的 Client 工具展示插件：完整调用树的组合、按工具名称键控的视图 slot，以及内置原子工具卡片。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/client/ui-tool/README.zh.md) |
| 宿主 / ui-deliverables | `@deepseek-ai/dsh-client-ui-deliverables` | Web GUI 的改动文件、交付文件与可点击文件引用：已完成轮次末尾的改动文件卡片与交付文件卡片、逐个对比改动文件的 review tab，以及收尾正文中的行内代码链接；供产出物体验的用户与维护者阅读。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/client/ui-deliverables/README.zh.md) |
| 宿主 / ui-workspace | `@deepseek-ai/dsh-client-ui-workspace` | dsh Web 客户端的共享 Workspace 浏览器与选择器插件：分组或扁平的会话行、管理操作、由 slot 组合的 Session 行 action 与目录选择。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/client/ui-workspace/README.zh.md) |
| 宿主 / ui-workflow-run | `@deepseek-ai/dsh-client-ui-workflow-run` | dsh Web 客户端的持久化工作流运行 Conversation Node：把顶层工作流运行重建为带嵌套成员折叠的独立聊天节点。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/client/ui-workflow-run/README.zh.md) |
| 宿主 / ui-input-trigger | `@deepseek-ai/dsh-client-ui-input-trigger` | Web GUI 的输入触发流水线：光标处的 / 与 @ 检测、分组候选菜单，以及把 pick 路由到已注册 source；供斜杠命令与引用的用户与维护者阅读。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/client/ui-input-trigger/README.zh.md) |
| 宿主 / ui-commands | `@deepseek-ai/dsh-client-ui-commands` | Web GUI 的客户端命令 API：/ 命令 source、三类派发、会话级命令目录，以及面向业务包的 popupSelect 与 action 注册；供斜杠命令的用户与维护者阅读。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/client/ui-commands/README.zh.md) |
| 宿主 / ui-skill | `@deepseek-ai/dsh-client-ui-skill` | dsh Web 客户端的 skill 引用与专属 skill 工具行：/ 触发的 skill source 与 skill 调用卡片。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/client/ui-skill/README.zh.md) |
| 宿主 / ui-subagent | `@deepseek-ai/dsh-client-ui-subagent` | dsh Web 客户端的 subagent 对话目录、续接路由 UI 与 '@' 引用 source。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/client/ui-subagent/README.zh.md) |
| 宿主 / ui-reference | `@deepseek-ai/dsh-client-ui-reference` | Web @file 与 @session 引用 source：候选项、排序，以及原子行内引用（统一的文件/会话选取）。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/client/ui-reference/README.zh.md) |
| 宿主 / ui-jobs | `@deepseek-ai/dsh-client-ui-jobs` | 会话头部后台任务列表：可展开的流式输出面板、进行中/已结束分组，以及无保留输出的已结束任务的静态行。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/client/ui-jobs/README.zh.md) |
| 宿主 / ui-schedule | `@deepseek-ai/dsh-client-ui-schedule` | 跨会话的 Web 任务管理页面及当前会话的提醒列表。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/client/ui-schedule/README.zh.md) |
| 宿主 / ui-goal | `@deepseek-ai/dsh-client-ui-goal` | Web GUI 的 goal 界面：显示当前目标并支持编辑、暂停、恢复或清除的 composer 上下文条带；供 goal 体验的用户与维护者阅读。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/client/ui-goal/README.zh.md) |
| 宿主 / ui-message-feedback | `@deepseek-ai/dsh-client-ui-message-feedback` | Web 反馈界面：已定稿助手消息动作行中的 Like/Dislike 对、两种评分与 `/feedback` 共用的反馈弹窗，以及确认和失败 toast；供反馈体验的用户与维护者阅读。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/client/ui-message-feedback/README.zh.md) |
| 宿主 / ui-model-selection | `@deepseek-ai/dsh-client-ui-model-selection` | Web GUI 的模型选择：/model 弹窗与 composer 模型位共用一份按提供方分组的会话级目录；供模型路由的用户与维护者阅读。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/client/ui-model-selection/README.zh.md) |
| 宿主 / ui-permission | `@deepseek-ai/dsh-client-ui-permission-presets` | Web GUI 的权限预设界面：通用设置中的默认行与切换当前会话的 /permission 选择器；供权限策略的用户与维护者阅读。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/client/ui-permission-presets/README.zh.md) |
| 宿主 / ui-agent-preset | `@deepseek-ai/dsh-client-ui-agent-preset` | 在 Web 中选择 Agent preset 和新任务默认值，查看各模式的说明与声明的配置。创建与修改引导至创造模式。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/client/ui-agent-preset/README.zh.md) |
| 宿主 / ui-settings-session-log | `@deepseek-ai/dsh-client-ui-settings-session-log` | 在通用设置中控制随 DeepSeek API 请求上传会话日志。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/client/ui-settings-session-log/README.zh.md) |
| 宿主 / ui-settings-plugins | `@deepseek-ai/dsh-client-ui-settings-plugins` | dsh Web 客户端的「内置插件」设置分区：设置导航项与供功能插件注册标签页的标签行。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/client/ui-settings-plugins/README.zh.md) |
| 宿主 / ui-settings-shell | `@deepseek-ai/dsh-client-ui-settings-shell` | dsh Web 客户端插件页上的终端执行器设置页：shell 命名空间的命令超时与单流输出上限。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/client/ui-settings-shell/README.zh.md) |
| 宿主 / ui-settings-agent-loop | `@deepseek-ai/dsh-client-ui-settings-agent-loop` | dsh Web 客户端插件页上的 Agent 循环设置页：agent-loop 命名空间的并行工具调用上限。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/client/ui-settings-agent-loop/README.zh.md) |
| 宿主 / ui-settings-subagent | `@deepseek-ai/dsh-client-ui-settings-subagent` | dsh Web 客户端插件页上的子智能体设置页：subagent 命名空间的委派深度与并行容量，以及 subagent-model-selection 里 Agent 可选的模型，同一页一次保存。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/client/ui-settings-subagent/README.zh.md) |
| 宿主 / ui-settings-web-search | `@deepseek-ai/dsh-client-ui-settings-web-search` | dsh Web 客户端插件页上的 DeepSeek 网页搜索提供方设置页：API Key、接口地址与单次请求的搜索次数上限。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/client/ui-settings-web-search/README.zh.md) |
| 宿主 / ui-plan | `@deepseek-ai/dsh-client-ui-plan` | Web GUI 的 plan 模式状态徽章：显示 plan 模式已开启并可将其关闭的 composer 控件；供 plan 模式的用户与维护者阅读。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/client/ui-plan/README.zh.md) |
| 宿主 / ui-user-questions | `@deepseek-ai/dsh-client-ui-user-questions` | dsh Web 客户端的 ask_user_question 功能：附着式提问卡片、计时等待、草稿、迟到回复与 plan-review 审批卡片。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/client/ui-user-questions/README.zh.md) |
| 宿主 / ui-trajectory | `@deepseek-ai/dsh-client-ui-trajectory` | dsh Web 客户端的 Trajectory 视图：按轮次组织的事件记录表加交互式时间概览，注册进对话视图环。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/client/ui-trajectory/README.zh.md) |

## 14 GUI 宿主支持

| 实例位置 | 插件入口 | 功能说明 | 适用范围 | 配置状态 | 依据 |
| --- | --- | --- | --- | --- | --- |
| 宿主 / desktop-product-telemetry | `@deepseek-ai/dsh-host-product-telemetry-otel` | 配置显式产品使用事件、OTLP/HTTP 路由、批量发送与退出等待上限。 | Desktop 条件项；kmh-web 中禁用 | 按条件：ctx.get('profileContext')?.name !== 'desktop' | [官方包说明](../../third_party/dsh/packages/host/product-telemetry-otel/README.zh.md) |
| 宿主 / open-in-app | `@deepseek-ai/dsh-host-open-in-app` | open-in-app 的主机半边：在 macOS、Windows、Linux 上把已安装的编辑器、Git GUI、终端与文件管理器解析为已验证的启动器，并以三条 webServer 路由提供目录、图标与启动端点。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/host/open-in-app/README.zh.md) |
| 宿主 / directory-picker | `@deepseek-ai/dsh-host-directory-picker-auto` | 目录选择 seam 的自适应选择器：在启动时判定一次 web GUI 宿主的处境，并挂载匹配的原生或浏览后端。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/host/directory-picker-auto/README.zh.md) |
| 宿主 / plugin-inventory | `@deepseek-ai/dsh-host-plugin-inventory` | 当前 Cordis Loader 插件状态的只读投影，并附带每个 agent preset（智能体预设）的组合：面向 web GUI 宿主客户端的 pluginInventory 服务及其 pluginInventory/list Remote。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/host/plugin-inventory/README.zh.md) |
| 宿主 / office-to-pdf | `@deepseek-ai/dsh-office-to-pdf` | 通过独立发布的 LibreOffice kit 在 Host 转换 Office 文档。 | GUI/API 相关，可供图形客户端复用 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/document/office-to-pdf/README.zh.md) |

## 15 Web 启动与承载

| 实例位置 | 插件入口 | 功能说明 | 适用范围 | 配置状态 | 依据 |
| --- | --- | --- | --- | --- | --- |
| 宿主 / web-startup | `@deepseek-ai/dsh-web-app/startup` | dsh 的浏览器 GUI：交互式聊天、模型与设置管理、会话历史，供运行 dsh web 表层的用户使用。 | Web 承载 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/bundle/web-app/README.zh.md) |
| 宿主 / webserver | `@deepseek-ai/dsh-host-webserver` | web GUI 宿主的 HTTP 服务器：具名路由与 upgrade 注册、index 转换，以及服务 Web 壳 SPA dist 的唯一回退席位。 | Web 承载 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/host/webserver/README.zh.md) |
| 宿主 / web-runtime | `@deepseek-ai/dsh-web-app` | dsh 的浏览器 GUI：交互式聊天、模型与设置管理、会话历史，供运行 dsh web 表层的用户使用。 | Web 承载 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/bundle/web-app/README.zh.md) |

## 16 Agent 预设与 persona

| 实例位置 | 插件入口 | 功能说明 | 适用范围 | 配置状态 | 依据 |
| --- | --- | --- | --- | --- | --- |
| 宿主 / agent-preset-registry | `@deepseek-ai/dsh-agent-preset-registry` | 通过声明式 preset 选择 Agent 的工具、提示词和技能。同一进程可以运行多种组合。配置失败会显示在列表中；现有 Agent 保留已经使用的组合。 | 通用机制；当前由 GUI 装配 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/preset/agent-preset-registry/README.zh.md) |
| 宿主 / preset-standard | `@deepseek-ai/dsh-agent-preset` | 在普通 Cordis YAML 中定义 Agent 的子插件列表。可同时声明多个 preset，由会话选择。声明会提前加载，修改只影响之后创建的 Agent。 | 通用机制；当前由 GUI 装配 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/preset/agent-preset/README.zh.md) |
| 预设 standard / persona | `@deepseek-ai/dsh-persona` | preset 挂载的可组装人设行，让单个 agent 拥有自己的系统提示词人设，供配置或排查它的用户与维护者阅读。 | 通用机制；当前由 GUI 装配 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/preset/persona/README.zh.md) |
| 宿主 / preset-ptc | `@deepseek-ai/dsh-agent-preset` | 在普通 Cordis YAML 中定义 Agent 的子插件列表。可同时声明多个 preset，由会话选择。声明会提前加载，修改只影响之后创建的 Agent。 | 通用机制；当前由 GUI 装配 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/preset/agent-preset/README.zh.md) |
| 预设 ptc / persona | `@deepseek-ai/dsh-persona` | preset 挂载的可组装人设行，让单个 agent 拥有自己的系统提示词人设，供配置或排查它的用户与维护者阅读。 | 通用机制；当前由 GUI 装配 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/preset/persona/README.zh.md) |
| 宿主 / preset-minimal | `@deepseek-ai/dsh-agent-preset` | 在普通 Cordis YAML 中定义 Agent 的子插件列表。可同时声明多个 preset，由会话选择。声明会提前加载，修改只影响之后创建的 Agent。 | 通用机制；当前由 GUI 装配 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/preset/agent-preset/README.zh.md) |
| 预设 minimal / persona | `@deepseek-ai/dsh-persona` | preset 挂载的可组装人设行，让单个 agent 拥有自己的系统提示词人设，供配置或排查它的用户与维护者阅读。 | 通用机制；当前由 GUI 装配 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/preset/persona/README.zh.md) |
| 宿主 / preset-cordis | `@deepseek-ai/dsh-agent-preset` | 在普通 Cordis YAML 中定义 Agent 的子插件列表。可同时声明多个 preset，由会话选择。声明会提前加载，修改只影响之后创建的 Agent。 | 通用机制；当前由 GUI 装配 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/preset/agent-preset/README.zh.md) |
| 预设 cordis / persona | `@deepseek-ai/dsh-persona` | preset 挂载的可组装人设行，让单个 agent 拥有自己的系统提示词人设，供配置或排查它的用户与维护者阅读。 | 通用机制；当前由 GUI 装配 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/preset/persona/README.zh.md) |

## 17 设置、反馈与遥测

| 实例位置 | 插件入口 | 功能说明 | 适用范围 | 配置状态 | 依据 |
| --- | --- | --- | --- | --- | --- |
| 宿主 / settings | `@deepseek-ai/dsh-settings` | 通过 Config 派生表单查看和编辑插件的即时配置。 | 通用能力；当前列入 Web 配置 | 按条件：!ctx.get('profileContext') | [官方包说明](../../third_party/dsh/packages/settings/settings/README.zh.md) |
| 宿主 / otel | `@deepseek-ai/dsh-otel` | 通过共享 Cordis OTel 服务创建独立的 OTLP 上报通道。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/telemetry/otel/README.zh.md) |
| 宿主 / command-feedback | `@deepseek-ai/dsh-command-feedback` | 会话反馈：`/feedback` 命令、Web 反馈弹窗背后的 `sessionFeedback` Host Remote，以及固定的分类表；供用户与维护者选择、组合或排查反馈采集。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/feedback/command-feedback/README.zh.md) |
| 宿主 / message-feedback | `@deepseek-ai/dsh-message-feedback` | 在权威 Session 日志中保存已完成 assistant 消息的评分、分类与备注。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/feedback/message-feedback/README.zh.md) |

## 18 交付成果

| 实例位置 | 插件入口 | 功能说明 | 适用范围 | 配置状态 | 依据 |
| --- | --- | --- | --- | --- | --- |
| 宿主 / workspace-changes | `@deepseek-ai/dsh-workspace-changes` | 用 git 工作树快照和文件工具编辑前后的整文件捕获汇总每个顶层轮次改动的文件，以 workspace/changes Session 事件宣告，并在 Session 存活期间提供摘要和逐文件对比；配置、仓库要求与覆盖规则。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/deliverables/workspace-changes/README.zh.md) |
| 预设 standard / present | `@deepseek-ai/dsh-tool-present` | 通过 present 声明交付可访问的文件；配置、Session 归属与源文件打开。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/deliverables/tool-present/README.zh.md) |
| 预设 ptc / present | `@deepseek-ai/dsh-tool-present` | 通过 present 声明交付可访问的文件；配置、Session 归属与源文件打开。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/deliverables/tool-present/README.zh.md) |
| 预设 cordis / present | `@deepseek-ai/dsh-tool-present` | 通过 present 声明交付可访问的文件；配置、Session 归属与源文件打开。 | 通用能力；当前列入 Web 配置 | 配置默认启用 | [官方包说明](../../third_party/dsh/packages/deliverables/tool-present/README.zh.md) |

## 官方文档入口

- [包分组地图](../../third_party/dsh/packages/README.zh.md)
- [架构与 profile/bundle](../../third_party/dsh/docs/architecture.zh.md)
- [Web 组合包](../../third_party/dsh/packages/bundle/web-app/README.zh.md)
- [配置字段目录](../../third_party/dsh/docs/config-catalog.zh.md)
- [GUI Client 包地图](../../third_party/dsh/packages/client/README.zh.md)
- [Agent 预设](../../third_party/dsh/packages/preset/agent-preset/README.zh.md)

配置字段目录中部分包只列源码链接；对应包的 README 与 Config 源码补充具体字段。ui-settings-general 的包功能包括设置外壳、通用设置区及引导流程；当前宿主侧公开 Config 字段为 welcomeNoticeVersion。
