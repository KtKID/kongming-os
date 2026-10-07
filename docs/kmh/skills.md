---
description: "Kongming 层技能（kmh-*）的清单、文件归属、与 DSH 子模块技能的边界及链接维护说明。"
---

# KMH 技能接入

## 概述

`.agents/skills/` 中每个子目录是一个技能，`SKILL.md` 为入口。其中九个 `kmh-*` 技能是 Kongming 自有技能：由 DSH 子模块的同源技能翻译适配而来，全文简体中文，只规范 kongming-agent 这一层（启动器、配置、bundles、自有插件、文档与发布）；进入 `third_party/dsh` 开发时遵循子模块自己的规则，kmh 技能对 DSH 内部只做引用。`agent-experience` 与 `record-browser-gif` 仍是指向子模块的符号链接。Kongming 的流程技能 `private-public-git-flow`、`publish` 为自有技能。Kongming 的运行和配置说明见 [底座入口](README.md)。

## 目录

- [kmh-* 技能清单](#kmh-技能清单)
- [使用前提与文件归属](#使用前提与文件归属)
- [与 DSH 子模块的边界](#与-dsh-子模块的边界)
- [符号链接与版本维护](#符号链接与版本维护)
- [开发备注](#开发备注)

## kmh-* 技能清单

| 技能 | 用途 | 适配自（DSH 子模块） |
|---|---|---|
| [kmh-doc](../../.agents/skills/kmh-doc/SKILL.md) | Kongming 文档规范：受众分层、单一事实归属、命令说明以实际执行结果为依据、插件包 README 与升级指南模板 | `dsh-doc` |
| [kmh-prose-standard](../../.agents/skills/kmh-prose-standard/SKILL.md) | Kongming 文字与注释规范：契约保足、删推理与装饰、脚本中文说明与函数注释三要素 | `dsh-prose-standard` |
| [kmh-trim-cot-leakage](../../.agents/skills/kmh-trim-cot-leakage/SKILL.md) | 清理"推理过程泄漏"式文字：死设计引用、变更叙述、评审视角旁白 | `dsh-trim-cot-leakage` |
| [kmh-pre-push-checks](../../.agents/skills/kmh-pre-push-checks/SKILL.md) | push 前按改动面选最小检查集（pnpm test/lint/build、浏览器验证、白名单核对） | `dsh-pre-push-checks` |
| [kmh-code-review](../../.agents/skills/kmh-code-review/SKILL.md) | Kongming 层 PR 审查向导：启动器转发语义、patch 语义、插件 manifest、发布边界 | `dsh-code-review` |
| [kmh-ci-test-reliability](../../.agents/skills/kmh-ci-test-reliability/SKILL.md) | CI 不稳定测试的设计与诊断（并发、共享资源、时钟、异步 teardown） | `dsh-ci-test-reliability` |
| [kmh-create-upgrade-guide](../../.agents/skills/kmh-create-upgrade-guide/SKILL.md) | KMH 外部可感知面（launch.config.json、profiles/bundles 键、KMH_HOME、插件入口、白名单）变更时的升级说明 | `dsh-create-upgrade-guide` |
| [kmh-find-simplifications](../../.agents/skills/kmh-find-simplifications/SKILL.md) | 找有证据支撑的简化点，写提案与小清理 | `dsh-find-simplifications` |
| [kmh-speed-up-perf](../../.agents/skills/kmh-speed-up-perf/SKILL.md) | Kongming 可控面性能：启动链路、配置组合、插件装载；运行时性能归子模块 | `dsh-speed-up-perf` |

## 使用前提与文件归属

| 文件位置 | 用途与维护归属 |
|---|---|
| `.agents/skills/kmh-*/` | Kongming 自有技能，本地目录，随 Kongming 提交维护。 |
| `.agents/skills/agent-experience`、`.agents/skills/record-browser-gif` | 指向子模块的相对符号链接，内容随子模块版本更新。 |
| `.agents/skills/private-public-git-flow/`、`publish/` | Kongming 自有 Git 流程技能。 |
| `third_party/dsh/.agents/skills/` | DSH 技能源；其余 DSH 技能（含本次未接入的）都保留在这里。 |

## 与 DSH 子模块的边界

kmh 技能只规范 kongming-agent 层；`third_party/dsh` 内的开发遵循子模块的 AGENTS.md 与检查。需要深入 DSH 时，各 kmh 技能内已带有指向子模块原技能的参照链接（如 [dsh-pre-push-checks](../../third_party/dsh/.agents/skills/dsh-pre-push-checks/SKILL.md)），从那里进入子模块流程，不在 Kongming 层重复其内容。

本次未接入的 DSH 技能保留在子模块中，需要时直接参照其 `SKILL.md` 或自行建立符号链接：`dsh-archive-agent-notes`（Agent Notes 归档，DSH 特有机制）、`dsh-client-ui-ux`（DSH Web 客户端 UI 审查，Kongming 暂无自有 UI 源码）、`dsh-merging-stacked-prs`（栈式 PR，Kongming 不使用 gh stack）、`dsh-plugin-analyzer-publish-sync`（plugin-analyzer 独立发布仓，DSH 内部工具链）、`dsh-translate-docs`（双语 `.i18n.yaml` 配对翻译工作流；Kongming 文档为中文单语、无配对，翻译子模块文档时才需要它）。

## 符号链接与版本维护

符号链接指向仓库内的子模块路径，移动整个 Kongming 仓库后仍通过相对路径解析；子模块未初始化时链接目标缺失，先完成 [启动与构建](README.md#启动与构建)。子模块升级后，维护者在更新子模块指针的同一改动中：核对仍在使用的符号链接目标存在且 `SKILL.md` 可读；核对各 kmh 技能内"子模块原技能参照"链接有效，目标改名或移除时同步调整。新增 Kongming 自有技能以 `kmh-` 前缀登记在本清单。

## 开发备注

无。
