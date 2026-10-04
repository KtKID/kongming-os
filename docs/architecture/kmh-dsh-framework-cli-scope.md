# KMH：DSH 基础框架与 CLI 迁移范围

状态：历史迁移记录。当前底座归属与启动流程见 [DSH 底座接入](../kmh/README.md)。

本文件仅列出关键目录与迁移范围。本轮交付为文档；源码迁移、后端替换和 Web 接入另行执行。

目标是复用 DSH 的 Cordis 插件底座、配置装配和 CLI，作为后续替换 Kongming Python 后端的基础。保留 Kongming 现有 `web/` 及其独特功能，DSH 客户端属于排除范围。

参考源码：`/Volumes/machub_app/proj/agent/deepseek-harness`；基线提交：`85805356f6b5fbc55d06ea129fc4e98e4b903ed3`。DSH 工作区中的未提交 SDK 修改单独归属后续评估。

## 1. 插件底座与 CLI 的关键目录

以下路径相对于 DSH 仓库根目录。

| 目录 | 职责 | 迁移原则 |
|---|---|---|
| `vendor/cordis/` | Context、Service、Fiber、依赖激活、事件和效果回收 | 采用基线提交内的完整版本及本地修复，统一框架实例 |
| `vendor/cosmokit/`、`vendor/schemastery/` | Cordis 工具库与配置校验 | 随 Cordis 使用基线内的配套版本 |
| `vendor/loader/`、`vendor/include/`、`vendor/group/` | 插件加载、配置文件与 patch、服务隔离组合 | 沿用上游配置语法和装配语义 |
| `vendor/timer/`、`vendor/logger-console/` | 生命周期内的定时活动和日志 | 根据 CLI 装配依赖纳入 |
| `vendor/hmr/`、`packages/boot/hmr/` | 源码与配置重载、重载协调 | 根据启用的 CLI 组合纳入 |
| `apps/cli/` | 命令解析、profile 启动、插件管理、配置与 schema 查看、退出和启动诊断 | 保留 CLI 源码入口及相关测试，核对其包依赖 |
| `packages/boot/app-boot/` | profile、bundle、patch 分层装配、模块解析、启动与失败处理 | 复用实际实现 |
| `packages/boot/cmdline/` | 向插件提供命令行参数、应用就绪与退出服务 | 纳入 CLI 启动链 |
| `packages/boot/plugin-manager/` | 插件包安装、启停、配置修改、版本兼容管理 | 纳入 CLI 管理功能使用的实现及依赖 |
| `packages/util/` | 路径、启动环境、包元数据、原子写入、代理等公共能力 | 按依赖逐包选择 |
| `native/system/` | 文件锁与进程隔离等原生能力 | 随实际使用的后端包纳入对应构建与平台依赖 |

优先核对的公共包：`packages/util/home-paths/`、`launch-environment/`、`package-manifest/`、`atomic-write/`、`http-proxy/`。最终清单以源码引用、包依赖和配置中加载的插件共同确定。

## 2. CLI 执行 Agent 任务所需的后端目录

CLI 启动框架和 CLI 执行 Agent 任务对应两个层次。执行任务时，以下目录中实际被组合引用的包属于后端依赖。

| 目录 | 职责 |
|---|---|
| `packages/bundle/headless/` | CLI 单次任务运行、输出与会话恢复 |
| `packages/bundle/base/` | 上游基础组合；核对其中实际装配的后端插件 |
| `packages/core/` | Agent 接口与循环、Session 日志、工具注册、系统提示、Agent 作用域 |
| `packages/llm/` | 模型调用接口、提供者、重试与 token 统计 |
| `packages/session/`、`packages/session-query/` | 会话持久化、投影、恢复与查询 |
| `packages/fs/`、`packages/shell/`、`packages/subprocess/`、`packages/terminal/` | 文件、命令、子进程和终端执行 |
| `packages/sandbox/`、`packages/interaction/` | 沙箱、审批和用户交互 |
| `packages/context/`、`packages/compaction/`、`packages/skill/`、`packages/mcp/` | 上下文、压缩、技能与外部工具 |
| `packages/subagent/`、`packages/jobs/`、`packages/workflow/` | 子 Agent、后台任务和工作流 |

这些目录是能力定位入口，具体迁移单位为目录中的包。`packages/typert/`、`packages/api/`、`packages/host/` 中的后台协议或服务包也可能被 CLI 后端引用，按实际依赖选择。

## 3. 配套工程文件

保留选定包的 `src/`、`package.json`、公开导出、配置文件、README、许可证及相关测试。沿用 DSH 的 `vendor/`、`packages/<能力组>/<包>/`、`apps/cli/` 布局。

根级工程需核对 `package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`、`tsconfig*.json`、`tsdown*.ts`、`vitest*.ts`、`scripts/` 与 `patches/`。工作区、构建和测试入口需要覆盖选定的 CLI 后端包；配置格式继续采用 DSH 的 profile、bundle、`cordis.patch.yml` 和 `--patch`。

## 4. 排除项与现有工程

| 路径或内容 | 处理方式 |
|---|---|
| DSH `apps/desktop/`、`apps/desktop-host/` | 排除 Electron 桌面应用及宿主 |
| DSH `apps/web/`、`packages/client/`、`packages/bundle/web-app/` | 排除 Web 客户端、客户端 UI 和 Web 产品组合 |
| DSH `packages/extensions/cordis-client-runner/` | 排除客户端插件运行器 |
| DSH `website/`、客户端专用资源、桌面打包与签名流程 | 排除产品展示和客户端交付内容 |
| Kongming `web/` | 保留现有前端及独特功能 |
| Kongming `src/` | 保留当前运行版本，后续按功能迁移并验收 Python 后端的替代实现 |
| Kongming 当前 `packages/` | 保留本轮状态，后续源码迁移时明确替换与归档范围 |

## 5. 依赖核对规则

上游 `apps/cli/package.json` 同时声明了 Web 和客户端相关包；`packages/bundle/base/` 也装配了大量后端能力。因此，迁移清单从 CLI 入口、插件装配和源码引用出发，逐包确认必要依赖，并显式排除客户端产品。

Cordis 统一来自同一基线的 `vendor/cordis/`，相关服务声明、插件导出和模块解析对齐该版本。验收覆盖 CLI 启动、配置读取、插件依赖激活、卸载与回收，并检查客户端排除范围。现有 Web 的协议与业务迁移单独建立验收清单。

## 源码入口

- [Cordis 版本与本地修改](../../../agent/deepseek-harness/vendor/README.md)
- [CLI 包与依赖](../../../agent/deepseek-harness/apps/cli/package.json)
- [CLI profile 启动](../../../agent/deepseek-harness/apps/cli/src/profile-boot.ts)
- [框架启动与装配](../../../agent/deepseek-harness/packages/boot/app-boot/src/index.ts)
- [headless CLI 组合](../../../agent/deepseek-harness/packages/bundle/headless/cordis.patch.yml)
- [上游基础组合](../../../agent/deepseek-harness/packages/bundle/base/cordis.patch.yml)
