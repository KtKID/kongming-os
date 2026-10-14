---
description: Kongming 当前架构、DSH 接入、插件开发、运行维护和现行规格的导航。
---

# Kongming OS 文档

Kongming 使用 DSH Node 底座，自有启动器、profiles、bundles 和业务插件由本仓库维护。当前开发从下列入口查找实际源码与配置。

| 任务                                  | 入口                                                    |
| ------------------------------------- | ------------------------------------------------------- |
| 理解当前架构与维护归属                | [当前架构](architecture/kongming-runtime.md)            |
| 安装、构建、配置与升级 DSH 底座       | [DSH 接入与升级](kmh/README.md)                         |
| 查找现有能力及实现归属                | [插件索引](kmh/plugin-index.md)                         |
| 新增自有插件或 bundle                 | [包接入指南](kmh/adding-a-plugin-package.md)            |
| 为插件开发 Web 界面                   | [插件 Web 界面规范](kmh/web-ui.md)                      |
| 查 DSH 上游文档（插件开发、架构参考） | [DSH 文档地图](kmh/dsh-docs-map.md)                     |
| 修改 Web profile 与部署配置           | [Web 配置](../profiles/kmh-web/README.md)               |
| 从外部进程调用 KMH                    | [Headless 外部调用](kmh/headless.md)                    |
| 接入持续聊天的文件与记录助手          | [小艺移动助手](integrations/xiaoyi-mobile-assistant.md) |
| 查找数据、日志与后台启停入口          | [运行记录](kmh/runtime-records.md)                      |
| 迁移运行数据目录                      | [数据目录升级](kmh/runtime-home-upgrade.md)             |
| 选择和维护开发技能                    | [技能接入](kmh/skills.md)                               |

## 规格与方案

[Spec 索引](spec/README.md)集中列出现行插件规格与正在推进的方案。产品行为以源码、配置和包 README 为准；方案按其评审状态与任务范围使用。

[模型请求监督说明](research/zcode-cli-request-supervision.md)区分当前原生会话中继、停止回执及待实施的记录与恢复目标；需求与实施记录位于[对应规格](spec/kmh-zcode-cli-request-supervision/spec.md)。

## 文档归属

`architecture/` 描述当前跨包运行链路；`kmh/` 描述本仓库的接入与维护；单包使用契约保存在 `packages/`、`bundles/` 和 `profiles/` 各自的 README；`spec/` 保存现行需求与任务记录；`research/` 保存当前相关方案；`assets/` 保存全局复用图片。
